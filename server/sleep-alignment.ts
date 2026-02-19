import { pool } from "./db";
import {
  noiseFloorMinutes,
  formatSignedMinutes,
  sleepAlignmentScore,
  formatBedWakeDeviation,
  classifySleepDeviation,
  type SleepClassification,
} from "../lib/sleep-timing";

const DEFAULT_USER_ID = 'local_default';
const DEFAULT_PLAN_BED = "21:45";
const DEFAULT_PLAN_WAKE = "05:30";

function toMin(t: string): number {
  const s = t.trim();

  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return h * 60 + m;
  }

  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) {
    return parseInt(iso[1], 10) * 60 + parseInt(iso[2], 10);
  }

  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) {
    return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  }

  return 0;
}

function circularDeltaMinutes(actualMin: number, plannedMin: number): number {
  let d = actualMin - plannedMin;
  while (d > 720) d -= 1440;
  while (d < -720) d += 1440;
  return d;
}

function spanMinutes(startMin: number, endMin: number): number {
  let diff = endMin - startMin;
  if (diff <= 0) diff += 1440;
  return diff;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface SleepAlignment {
  plannedBedTime: string | null;
  plannedWakeTime: string | null;
  observedBedLocal: string | null;
  observedWakeLocal: string | null;
  bedDeviationMin: number | null;
  wakeDeviationMin: number | null;
  alignmentScore: number | null;
  deviationLabel: string;
  shortfallMin: number | null;
  classification: SleepClassification;
}

export interface SleepBlock {
  sleepAlignment: SleepAlignment;

  plannedSleepMin: number | null;
  sleepDebtMin: number | null;
  sleepAdequacyScore: number | null;
  sleepEfficiencyEst: number | null;
  fitbitSleepMinutes: number | null;
  napMinutes: number | null;
  timeInBedMin: number | null;
  estimatedSleepMin: number | null;
  fitbitVsReportedDeltaMin: number | null;

  // --- NEW (derived / resolved sleep-structure fields) ---
  // Manual fields (from daily_log) after resolution; do NOT invent values.
  sleepLatencyMin: number | null;
  sleepWASOMin: number | null;
  // Derived: time spent awake while in bed (latency + WASO), only when at least
  // one awake component is known. Otherwise null (unknown).
  awakeInBedMin: number | null;
  // Derived: prefer canonical device efficiency if present; else estimatedSleepMin / timeInBedMin.
  // Ratio 0..1 (clamped).
  sleepEfficiency: number | null;
}

export async function computeSleepBlock(date: string, userId: string = DEFAULT_USER_ID): Promise<SleepBlock | null> {
  const yesterday = new Date(date + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const [logResult, canonResult, logYestResult, canonYestResult] = await Promise.all([
    pool.query(
      `SELECT sleep_minutes,
              planned_bed_time, planned_wake_time,
              actual_bed_time, actual_wake_time,
              sleep_latency_min, sleep_waso_min, nap_minutes
       FROM daily_log WHERE day = $1 AND user_id = $2`,
      [date, userId]
    ),
    pool.query(
      `SELECT sleep_start, sleep_end, total_sleep_minutes, sleep_efficiency
       FROM sleep_summary_daily WHERE date = $1 AND user_id = $2`,
      [date, userId]
    ),
    pool.query(
      `SELECT sleep_minutes,
              planned_bed_time, planned_wake_time,
              actual_bed_time, actual_wake_time,
              sleep_latency_min, sleep_waso_min, nap_minutes
       FROM daily_log WHERE day = $1 AND user_id = $2`,
      [yesterdayStr, userId]
    ),
    pool.query(
      `SELECT sleep_start, sleep_end, total_sleep_minutes, sleep_efficiency
       FROM sleep_summary_daily WHERE date = $1 AND user_id = $2`,
      [yesterdayStr, userId]
    ),
  ]);

  let r = logResult.rows[0];
  let canon = canonResult.rows[0];

  const hasSleepToday = !!(r?.actual_bed_time || r?.sleep_minutes || canon?.sleep_start || canon?.total_sleep_minutes);

  if (!hasSleepToday) {
    r = r || logYestResult.rows[0];
    canon = canon || canonYestResult.rows[0];
  }

  if (!r && !canon) return null;

  const schedule = await getSleepPlanSettings(userId);
  const plannedBed: string | null = r?.planned_bed_time || schedule.bedtime;
  const plannedWake: string | null = r?.planned_wake_time || schedule.wake;
  const actualBed: string | null = r?.actual_bed_time || canon?.sleep_start || null;
  const actualWake: string | null = r?.actual_wake_time || canon?.sleep_end || null;
  const latency: number | null = r?.sleep_latency_min != null ? Number(r.sleep_latency_min) : null;
  const waso: number | null = r?.sleep_waso_min != null ? Number(r.sleep_waso_min) : null;
  const napMin: number | null = r?.nap_minutes != null ? Number(r.nap_minutes) : null;
  const fitbitMin: number | null = r?.sleep_minutes != null ? Number(r.sleep_minutes) : (canon?.total_sleep_minutes != null ? Number(canon.total_sleep_minutes) : null);

  let plannedSleepMin: number | null = null;
  if (plannedBed && plannedWake) {
    plannedSleepMin = spanMinutes(toMin(plannedBed), toMin(plannedWake));
  }

  let bedDevMin: number | null = null;
  let wakeDevMin: number | null = null;

  if (plannedBed && actualBed) {
    bedDevMin = noiseFloorMinutes(circularDeltaMinutes(toMin(actualBed), toMin(plannedBed)));
  }
  if (plannedWake && actualWake) {
    wakeDevMin = noiseFloorMinutes(circularDeltaMinutes(toMin(actualWake), toMin(plannedWake)));
  }

  const score = sleepAlignmentScore(bedDevMin, wakeDevMin);
  const devLabel = formatBedWakeDeviation(bedDevMin, wakeDevMin);

  let shortfallMin: number | null = null;
  if (plannedSleepMin != null && fitbitMin != null) {
    const raw = Math.max(0, plannedSleepMin - fitbitMin);
    shortfallMin = noiseFloorMinutes(raw);
  }

  const classification = classifySleepDeviation({ bedDevMin, wakeDevMin, shortfallMin });

  const sleepAlignment: SleepAlignment = {
    plannedBedTime: plannedBed,
    plannedWakeTime: plannedWake,
    observedBedLocal: actualBed,
    observedWakeLocal: actualWake,
    bedDeviationMin: bedDevMin,
    wakeDeviationMin: wakeDevMin,
    alignmentScore: score,
    deviationLabel: devLabel,
    shortfallMin,
    classification,
  };

  let sleepDebtMin: number | null = null;
  let sleepAdequacyScore: number | null = null;

  if (plannedSleepMin != null && fitbitMin != null) {
    sleepDebtMin = plannedSleepMin - fitbitMin;
    const ratio = fitbitMin / plannedSleepMin;
    sleepAdequacyScore = clamp(Math.round(ratio * 100), 0, 100);
  }

  let timeInBedMin: number | null = null;
  let sleepEfficiencyEst: number | null = null;
  let estimatedSleepMin: number | null = null;

  if (actualBed && actualWake) {
    timeInBedMin = spanMinutes(toMin(actualBed), toMin(actualWake));

    if (latency != null || waso != null) {
      estimatedSleepMin = timeInBedMin - (latency ?? 0) - (waso ?? 0);
      if (estimatedSleepMin < 0) estimatedSleepMin = 0;
    }

    if (fitbitMin != null && timeInBedMin > 0) {
      sleepEfficiencyEst = Math.round((fitbitMin / timeInBedMin) * 100) / 100;
      if (sleepEfficiencyEst > 1.0) sleepEfficiencyEst = 1.0;
    }
  }

  let fitbitVsReportedDeltaMin: number | null = null;
  if (estimatedSleepMin != null && fitbitMin != null) {
    fitbitVsReportedDeltaMin = fitbitMin - estimatedSleepMin;
  }

  const sleepLatencyMin = latency ?? null;
  const sleepWASOMin = waso ?? null;

  let awakeInBedMin: number | null = null;
  if (timeInBedMin != null) {
    if (sleepLatencyMin != null || sleepWASOMin != null) {
      awakeInBedMin = (sleepLatencyMin ?? 0) + (sleepWASOMin ?? 0);
    }
  }

  let sleepEfficiency: number | null = null;
  if (canon?.sleep_efficiency != null) {
    const raw = Number(canon.sleep_efficiency);
    sleepEfficiency = raw > 1 ? raw / 100 : raw;
  } else if (estimatedSleepMin != null && timeInBedMin != null && timeInBedMin > 0) {
    sleepEfficiency = estimatedSleepMin / timeInBedMin;
  }
  if (sleepEfficiency != null) {
    sleepEfficiency = Math.max(0, Math.min(1, sleepEfficiency));
  }

  return {
    sleepAlignment,
    plannedSleepMin,
    sleepDebtMin,
    sleepAdequacyScore,
    sleepEfficiencyEst,
    fitbitSleepMinutes: fitbitMin,
    napMinutes: napMin,
    timeInBedMin,
    estimatedSleepMin,
    fitbitVsReportedDeltaMin,
    sleepLatencyMin,
    sleepWASOMin,
    awakeInBedMin,
    sleepEfficiency,
  };
}

export async function getSleepPlanSettings(userId: string = DEFAULT_USER_ID): Promise<{ bedtime: string; wake: string }> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'sleep_plan_bedtime' AND user_id = $1`,
    [userId]
  );
  const { rows: rows2 } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'sleep_plan_wake' AND user_id = $1`,
    [userId]
  );
  return {
    bedtime: rows[0]?.value || DEFAULT_PLAN_BED,
    wake: rows2[0]?.value || DEFAULT_PLAN_WAKE,
  };
}

export interface SleepTrending {
  alignment7d: number | null;
  alignment28d: number | null;
  adequacy7d: number | null;
  adequacy28d: number | null;
  avgDebt7d: number | null;
  avgDebt28d: number | null;
  daysWithAlignment7d: number;
  daysWithAdequacy7d: number;
}

export async function computeSleepTrending(date: string, userId: string = DEFAULT_USER_ID): Promise<SleepTrending> {
  const d = new Date(date + "T00:00:00Z");
  const d7 = new Date(d);
  d7.setUTCDate(d7.getUTCDate() - 6);
  const d28 = new Date(d);
  d28.setUTCDate(d28.getUTCDate() - 27);
  const from28 = d28.toISOString().slice(0, 10);
  const from7 = d7.toISOString().slice(0, 10);

  const [logResult, canonResult] = await Promise.all([
    pool.query(
      `SELECT day, planned_bed_time, planned_wake_time,
              actual_bed_time, actual_wake_time, sleep_minutes
       FROM daily_log
       WHERE day BETWEEN $1 AND $2 AND user_id = $3
       ORDER BY day ASC`,
      [from28, date, userId]
    ),
    pool.query(
      `SELECT date, sleep_start, sleep_end, total_sleep_minutes
       FROM sleep_summary_daily
       WHERE date BETWEEN $1 AND $2 AND user_id = $3
       ORDER BY date ASC`,
      [from28, date, userId]
    ),
  ]);

  const canonByDate = new Map<string, any>();
  for (const c of canonResult.rows) {
    canonByDate.set(c.date, c);
  }

  const allDates = new Set<string>();
  for (const r of logResult.rows) allDates.add(r.day);
  for (const c of canonResult.rows) allDates.add(c.date);
  const sortedDates = Array.from(allDates).sort();

  const logByDate = new Map<string, any>();
  for (const r of logResult.rows) logByDate.set(r.day, r);

  const blocks: Array<{ day: string; alignment: number | null; adequacy: number | null; debt: number | null }> = [];

  const schedule = await getSleepPlanSettings(userId);

  for (const day of sortedDates) {
    const r = logByDate.get(day);
    const canon = canonByDate.get(day);
    const plannedBed = r?.planned_bed_time || schedule.bedtime;
    const plannedWake = r?.planned_wake_time || schedule.wake;
    const actualBed = r?.actual_bed_time || canon?.sleep_start || null;
    const actualWake = r?.actual_wake_time || canon?.sleep_end || null;
    const fitbit = r?.sleep_minutes != null ? Number(r.sleep_minutes) : (canon?.total_sleep_minutes != null ? Number(canon.total_sleep_minutes) : null);

    let bedDev: number | null = null;
    let wakeDev: number | null = null;
    if (plannedBed && actualBed) {
      bedDev = noiseFloorMinutes(circularDeltaMinutes(toMin(actualBed), toMin(plannedBed)));
    }
    if (plannedWake && actualWake) {
      wakeDev = noiseFloorMinutes(circularDeltaMinutes(toMin(actualWake), toMin(plannedWake)));
    }

    const alignmentVal = sleepAlignmentScore(bedDev, wakeDev);

    let adequacy: number | null = null;
    let debt: number | null = null;
    let plannedMin: number | null = null;
    if (plannedBed && plannedWake) {
      plannedMin = spanMinutes(toMin(plannedBed), toMin(plannedWake));
    }
    if (plannedMin != null && fitbit != null) {
      debt = plannedMin - fitbit;
      const ratio = fitbit / plannedMin;
      adequacy = clamp(Math.round(ratio * 100), 0, 100);
    }

    blocks.push({ day, alignment: alignmentVal, adequacy, debt });
  }

  const last7 = blocks.filter(b => b.day >= from7);
  const last28 = blocks;

  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v != null);
    return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  };

  return {
    alignment7d: avg(last7.map(b => b.alignment)),
    alignment28d: avg(last28.map(b => b.alignment)),
    adequacy7d: avg(last7.map(b => b.adequacy)),
    adequacy28d: avg(last28.map(b => b.adequacy)),
    avgDebt7d: avg(last7.map(b => b.debt)),
    avgDebt28d: avg(last28.map(b => b.debt)),
    daysWithAlignment7d: last7.filter(b => b.alignment != null).length,
    daysWithAdequacy7d: last7.filter(b => b.adequacy != null).length,
  };
}

export async function setSleepPlanSettings(bedtime: string, wake: string, userId: string = DEFAULT_USER_ID): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (user_id, key, value) VALUES ($1, 'sleep_plan_bedtime', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, bedtime]
  );
  await pool.query(
    `INSERT INTO app_settings (user_id, key, value) VALUES ($1, 'sleep_plan_wake', $2)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, wake]
  );
}
