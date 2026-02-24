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
const DEFAULT_PLAN_BED = "22:30";
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

export interface StageBaseline {
  avg7d: number | null;
  avg28d: number | null;
  deltaVs7d: number | null;
  deltaVs28d: number | null;
}

export interface SleepBlock {
  sleepAlignment: SleepAlignment;

  plannedSleepMin: number | null;
  sleepDebtMin: number | null;
  sleepDeltaMin: number | null;
  sleepAdequacyScore: number | null;
  sleepEfficiencyEst: number | null;
  fitbitSleepMinutes: number | null;
  napMinutes: number | null;
  timeInBedMin: number | null;
  estimatedSleepMin: number | null;
  fitbitVsReportedDeltaMin: number | null;

  latencyMin: number | null;
  wasoMin: number | null;
  awakeInBedMin: number | null;
  tossTurnMin: number | null;
  sleepEfficiency: number | null;

  awakeMin: number | null;
  remMin: number | null;
  coreMin: number | null;
  deepMin: number | null;

  stagesTotalSleepMin: number | null;
  stagesTotalInBedMin: number | null;

  remPct: number | null;
  deepPct: number | null;

  awakeInBedDeltaMin: number | null;
  remDeltaMin: number | null;
  coreDeltaMin: number | null;
  deepDeltaMin: number | null;

  stageBaselines: {
    awake: StageBaseline;
    rem: StageBaseline;
    core: StageBaseline;
    deep: StageBaseline;
    asleep: StageBaseline;
  } | null;
}

function buildStageBaselines(
  rows: any[],
  todayAwake: number, todayRem: number, todayCore: number, todayDeep: number
): SleepBlock["stageBaselines"] {
  if (rows.length === 0) return null;

  const mk = (vals: number[], today: number): StageBaseline => {
    const last7 = vals.slice(0, Math.min(7, vals.length));
    const avg7 = last7.length > 0 ? Math.round(last7.reduce((a, b) => a + b, 0) / last7.length) : null;
    const avg28 = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return {
      avg7d: avg7,
      avg28d: avg28,
      deltaVs7d: avg7 != null ? today - avg7 : null,
      deltaVs28d: avg28 != null ? today - avg28 : null,
    };
  };

  const awakes = rows.map(r => Number(r.sleep_awake_min));
  const rems = rows.map(r => Number(r.sleep_rem_min));
  const cores = rows.map(r => Number(r.sleep_core_min));
  const deeps = rows.map(r => Number(r.sleep_deep_min));
  const asleeps = rows.map((r, i) => rems[i] + cores[i] + deeps[i]);
  const todayAsleep = todayRem + todayCore + todayDeep;

  return {
    awake: mk(awakes, todayAwake),
    rem: mk(rems, todayRem),
    core: mk(cores, todayCore),
    deep: mk(deeps, todayDeep),
    asleep: mk(asleeps, todayAsleep),
  };
}

export async function computeSleepBlock(date: string, userId: string = DEFAULT_USER_ID): Promise<SleepBlock | null> {
  const yesterday = new Date(date + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const [logResult, canonResult, logYestResult, canonYestResult, baselineResult] = await Promise.all([
    pool.query(
      `SELECT sleep_minutes,
              planned_bed_time, planned_wake_time,
              actual_bed_time, actual_wake_time,
              sleep_latency_min, sleep_waso_min, nap_minutes,
              sleep_awake_min, sleep_rem_min, sleep_core_min, sleep_deep_min
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
              sleep_latency_min, sleep_waso_min, nap_minutes,
              sleep_awake_min, sleep_rem_min, sleep_core_min, sleep_deep_min
       FROM daily_log WHERE day = $1 AND user_id = $2`,
      [yesterdayStr, userId]
    ),
    pool.query(
      `SELECT sleep_start, sleep_end, total_sleep_minutes, sleep_efficiency
       FROM sleep_summary_daily WHERE date = $1 AND user_id = $2`,
      [yesterdayStr, userId]
    ),
    pool.query(
      `SELECT sleep_awake_min, sleep_rem_min, sleep_core_min, sleep_deep_min
       FROM daily_log
       WHERE user_id = $1 AND day < $2 AND day >= ($2::date - 28)::text
         AND sleep_awake_min IS NOT NULL
         AND sleep_rem_min IS NOT NULL
         AND sleep_core_min IS NOT NULL
         AND sleep_deep_min IS NOT NULL
       ORDER BY day DESC`,
      [userId, date]
    ),
  ]);

  let r = logResult.rows[0] ?? null;
  let canon = canonResult.rows[0] ?? null;

  const hasSleepInRow = (row: any, can: any) =>
    !!(row?.actual_bed_time || row?.sleep_minutes || row?.sleep_awake_min != null ||
       can?.sleep_start || can?.total_sleep_minutes);

  if (!hasSleepInRow(r, canon)) {
    const yestR = logYestResult.rows[0] ?? null;
    const yestC = canonYestResult.rows[0] ?? null;
    r = yestR ?? r;
    canon = yestC ?? canon;
  }

  if (!r && !canon) return null;

  const schedule = await getSleepPlanSettings(userId);
  const plannedBed: string = schedule.bedtime;
  const plannedWake: string = schedule.wake;
  const actualBed: string | null = r?.actual_bed_time || canon?.sleep_start || null;
  const actualWake: string | null = r?.actual_wake_time || canon?.sleep_end || null;
  const napMin: number | null = r?.nap_minutes != null ? Number(r.nap_minutes) : null;
  const fitbitMin: number | null = r?.sleep_minutes != null ? Number(r.sleep_minutes) : (canon?.total_sleep_minutes != null ? Number(canon.total_sleep_minutes) : null);

  const plannedSleepMin: number = spanMinutes(toMin(plannedBed), toMin(plannedWake));

  const stageAwake: number | null = r?.sleep_awake_min != null ? Number(r.sleep_awake_min) : null;
  const stageRem: number | null = r?.sleep_rem_min != null ? Number(r.sleep_rem_min) : null;
  const stageCore: number | null = r?.sleep_core_min != null ? Number(r.sleep_core_min) : null;
  const stageDeep: number | null = r?.sleep_deep_min != null ? Number(r.sleep_deep_min) : null;
  const hasStages = stageAwake != null && stageRem != null && stageCore != null && stageDeep != null;

  let bedDevMin: number | null = null;
  let wakeDevMin: number | null = null;

  if (actualBed) {
    bedDevMin = circularDeltaMinutes(toMin(actualBed), toMin(plannedBed));
  }
  if (actualWake) {
    wakeDevMin = circularDeltaMinutes(toMin(actualWake), toMin(plannedWake));
  }

  let alignmentScore: number | null = null;
  if (bedDevMin != null && wakeDevMin != null) {
    const penalty = clamp(Math.abs(bedDevMin) + Math.abs(wakeDevMin), 0, 180);
    alignmentScore = Math.round(100 - (penalty * (100 / 180)));
  }

  const devLabel = formatBedWakeDeviation(bedDevMin, wakeDevMin);

  let timeInBedMin: number | null = null;
  let estimatedSleepMin: number | null = null;
  let sleepEfficiency: number | null = null;
  let awakeInBedMin: number | null = null;
  let sleepDeltaMin: number | null = null;
  let shortfallMin: number | null = null;
  let sleepDebtMin: number | null = null;
  let sleepAdequacyScore: number | null = null;
  let sleepEfficiencyEst: number | null = null;
  let fitbitVsReportedDeltaMin: number | null = null;
  let remPct: number | null = null;
  let deepPct: number | null = null;

  let stagesTotalSleepMin: number | null = null;
  let stagesTotalInBedMin: number | null = null;
  let latencyMin: number | null = null;
  let wasoMin: number | null = null;
  let tossTurnMin: number | null = null;

  if (hasStages) {
    stagesTotalSleepMin = stageRem + stageCore + stageDeep;
    stagesTotalInBedMin = stageAwake + stageRem + stageCore + stageDeep;
    timeInBedMin = stagesTotalInBedMin;
    estimatedSleepMin = stagesTotalSleepMin;
  } else if (actualBed && actualWake) {
    timeInBedMin = spanMinutes(toMin(actualBed), toMin(actualWake));
    estimatedSleepMin = fitbitMin;
  }

  const timeAsleepMin = estimatedSleepMin;

  awakeInBedMin = (timeInBedMin != null && timeAsleepMin != null)
    ? Math.max(0, timeInBedMin - timeAsleepMin)
    : null;

  wasoMin = stageAwake != null ? stageAwake : null;

  latencyMin = (awakeInBedMin != null && wasoMin != null)
    ? Math.max(0, awakeInBedMin - wasoMin)
    : null;

  tossTurnMin = wasoMin;

  sleepEfficiency = (timeInBedMin != null && timeInBedMin > 0 && timeAsleepMin != null)
    ? clamp(timeAsleepMin / timeInBedMin, 0, 1)
    : null;

  sleepEfficiencyEst = sleepEfficiency;

  if (timeAsleepMin != null) {
    sleepDeltaMin = timeAsleepMin - plannedSleepMin;
    shortfallMin = Math.max(0, -sleepDeltaMin);
    sleepDebtMin = -sleepDeltaMin;
    sleepAdequacyScore = clamp(Math.round(100 * timeAsleepMin / plannedSleepMin), 0, 110);
  }

  if (hasStages && estimatedSleepMin != null && estimatedSleepMin > 0) {
    remPct = Math.round((stageRem / estimatedSleepMin) * 1000) / 10;
    deepPct = Math.round((stageDeep / estimatedSleepMin) * 1000) / 10;
  }

  if (!hasStages) {
    if (sleepEfficiency == null && canon?.sleep_efficiency != null) {
      const raw = Number(canon.sleep_efficiency);
      sleepEfficiency = raw > 1 ? raw / 100 : raw;
      sleepEfficiency = clamp(sleepEfficiency, 0, 1);
      sleepEfficiencyEst = sleepEfficiency;
    }
    if (estimatedSleepMin != null && fitbitMin != null) {
      fitbitVsReportedDeltaMin = fitbitMin - estimatedSleepMin;
    }
  }

  const classification = classifySleepDeviation({ bedDevMin, wakeDevMin, shortfallMin: shortfallMin != null ? noiseFloorMinutes(shortfallMin) : null });

  const sleepAlignment: SleepAlignment = {
    plannedBedTime: plannedBed,
    plannedWakeTime: plannedWake,
    observedBedLocal: actualBed,
    observedWakeLocal: actualWake,
    bedDeviationMin: bedDevMin,
    wakeDeviationMin: wakeDevMin,
    alignmentScore,
    deviationLabel: devLabel,
    shortfallMin: shortfallMin != null ? noiseFloorMinutes(shortfallMin) : null,
    classification,
  };

  const stageBaselines = hasStages
    ? buildStageBaselines(baselineResult.rows, stageAwake, stageRem, stageCore, stageDeep)
    : null;

  let awakeInBedDeltaMin: number | null = null;
  let remDeltaMin: number | null = null;
  let coreDeltaMin: number | null = null;
  let deepDeltaMin: number | null = null;

  if (stageBaselines) {
    if (stageBaselines.awake.avg7d != null && awakeInBedMin != null) {
      awakeInBedDeltaMin = awakeInBedMin - stageBaselines.awake.avg7d;
    }
    if (stageBaselines.rem.avg7d != null && stageRem != null) {
      remDeltaMin = stageRem - stageBaselines.rem.avg7d;
    }
    if (stageBaselines.core.avg7d != null && stageCore != null) {
      coreDeltaMin = stageCore - stageBaselines.core.avg7d;
    }
    if (stageBaselines.deep.avg7d != null && stageDeep != null) {
      deepDeltaMin = stageDeep - stageBaselines.deep.avg7d;
    }
  }

  return {
    sleepAlignment,
    plannedSleepMin,
    sleepDebtMin,
    sleepDeltaMin,
    sleepAdequacyScore,
    sleepEfficiencyEst,
    fitbitSleepMinutes: timeAsleepMin,
    napMinutes: napMin,
    timeInBedMin,
    estimatedSleepMin: timeAsleepMin,
    fitbitVsReportedDeltaMin,
    latencyMin,
    wasoMin,
    awakeInBedMin,
    tossTurnMin,
    sleepEfficiency,
    awakeMin: stageAwake,
    remMin: stageRem,
    coreMin: stageCore,
    deepMin: stageDeep,
    stagesTotalSleepMin,
    stagesTotalInBedMin,
    remPct,
    deepPct,
    awakeInBedDeltaMin,
    remDeltaMin,
    coreDeltaMin,
    deepDeltaMin,
    stageBaselines,
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
