import { pool } from "./db";

const DEFAULT_PLAN_BED = "21:45";
const DEFAULT_PLAN_WAKE = "05:30";

function toMin(t: string): number {
  const clean = t.includes(" ") ? t.split(" ")[1] : t;
  const [h, m] = clean.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function wrapDev(raw: number): number {
  let d = raw;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

function spanMinutes(startMin: number, endMin: number): number {
  let diff = endMin - startMin;
  if (diff <= 0) diff += 1440;
  return diff;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type SleepDeviationType =
  | "efficient_on_plan"
  | "behavioral_drift"
  | "physiological_shortfall"
  | "oversleep_spillover";

export interface SleepDeviationResult {
  label: SleepDeviationType | null;
  bedDevMin: number | null;
  wakeDevMin: number | null;
  sleepNeedMin: number | null;
  sleepAsleepMin: number | null;
  sleepShortfallMin: number | null;
  reason: string[];
  displayLine: string;
  shortfallLine: string | null;
}

const BED_TOL = 20;
const WAKE_TOL = 20;
const SLEEP_TOL = 20;
const OVERSLEEP_TOL = 30;

function formatDevMin(raw: number | null): string {
  if (raw == null) return "\u2014";
  let value = Math.round(raw);
  if (Math.abs(value) < 3) value = 0;
  if (value === 0) return "0m";
  const sign = value > 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(value)}m`;
}

function formatBedWakeLine(bedDev: number | null, wakeDev: number | null): string {
  if (bedDev == null && wakeDev == null) return "\u2014";
  return `bed ${formatDevMin(bedDev)}, wake ${formatDevMin(wakeDev)}`;
}

function formatShortfallLine(plannedMin: number | null, actualMin: number | null): string | null {
  if (plannedMin == null || actualMin == null) return null;
  const shortfall = plannedMin - actualMin;
  if (shortfall <= 0) return null;
  const rounded = Math.round(shortfall);
  if (rounded < 3) return null;
  return `shortfall +${rounded}m`;
}

export function classifySleepDeviation(input: {
  planBed?: string | null;
  planWake?: string | null;
  srBed?: string | null;
  srWake?: string | null;
  fitbitSleepMin?: number | null;
  latencyMin?: number | null;
  wasoMin?: number | null;
}): SleepDeviationResult {
  const { planBed, planWake, srBed, srWake, fitbitSleepMin, latencyMin, wasoMin } = input;

  const empty: SleepDeviationResult = {
    label: null, bedDevMin: null, wakeDevMin: null,
    sleepNeedMin: null, sleepAsleepMin: null, sleepShortfallMin: null,
    reason: ["missing_plan"], displayLine: "\u2014", shortfallLine: null,
  };

  if (!planBed || !planWake) return empty;

  const sleepNeedMin = spanMinutes(toMin(planBed), toMin(planWake));
  const bedDevMin = srBed ? wrapDev(toMin(srBed) - toMin(planBed)) : null;
  const wakeDevMin = srWake ? wrapDev(toMin(srWake) - toMin(planWake)) : null;

  let sleepAsleepMin: number | null = null;
  if (typeof fitbitSleepMin === "number") {
    sleepAsleepMin = fitbitSleepMin;
  } else if (srBed && srWake) {
    const inBed = spanMinutes(toMin(srBed), toMin(srWake));
    sleepAsleepMin = Math.max(0, inBed - Math.max(0, latencyMin ?? 0) - Math.max(0, wasoMin ?? 0));
  }

  const sleepShortfallMin = sleepAsleepMin == null ? null : Math.max(0, sleepNeedMin - sleepAsleepMin);

  const reason: string[] = [];
  const overslept = wakeDevMin != null && wakeDevMin >= OVERSLEEP_TOL;
  const drift =
    (bedDevMin != null && Math.abs(bedDevMin) >= BED_TOL) ||
    (wakeDevMin != null && Math.abs(wakeDevMin) >= WAKE_TOL);
  const shortfall = sleepShortfallMin != null && sleepShortfallMin > SLEEP_TOL;

  const displayLine = formatBedWakeLine(bedDevMin, wakeDevMin);
  const shortfallLine = formatShortfallLine(sleepNeedMin, sleepAsleepMin);

  const build = (label: SleepDeviationType | null): SleepDeviationResult => ({
    label, bedDevMin, wakeDevMin, sleepNeedMin, sleepAsleepMin, sleepShortfallMin, reason, displayLine, shortfallLine,
  });

  if (overslept) {
    reason.push("wake_late");
    return build("oversleep_spillover");
  }
  if (drift && !shortfall) {
    reason.push("schedule_drift");
    return build("behavioral_drift");
  }
  if (shortfall && !drift) {
    reason.push("sleep_shortfall");
    return build("physiological_shortfall");
  }
  if (
    bedDevMin != null && wakeDevMin != null &&
    Math.abs(bedDevMin) <= BED_TOL &&
    Math.abs(wakeDevMin) <= WAKE_TOL &&
    !shortfall
  ) {
    reason.push("on_plan");
    return build("efficient_on_plan");
  }

  if (drift) reason.push("schedule_drift");
  if (shortfall) reason.push("sleep_shortfall");

  const label: SleepDeviationType | null =
    drift ? "behavioral_drift" :
    shortfall ? "physiological_shortfall" :
    null;

  return build(label);
}

const DEVIATION_LABELS: Record<SleepDeviationType, string> = {
  efficient_on_plan: "Efficient & on-plan",
  behavioral_drift: "Behavioral drift",
  physiological_shortfall: "Physiological shortfall",
  oversleep_spillover: "Oversleep spillover",
};

export function deviationHumanLabel(dt: SleepDeviationType | null): string | null {
  return dt ? DEVIATION_LABELS[dt] : null;
}

export interface SleepBlock {
  plannedBedTime: string | null;
  plannedWakeTime: string | null;
  actualBedTime: string | null;
  actualWakeTime: string | null;
  sleepLatencyMin: number | null;
  sleepWasoMin: number | null;
  napMinutes: number | null;
  fitbitSleepMinutes: number | null;

  plannedSleepMin: number | null;
  bedDevMin: number | null;
  wakeDevMin: number | null;
  sleepDebtMin: number | null;
  scheduleAdherenceScore: number | null;
  sleepAdequacyScore: number | null;
  sleepEfficiencyEst: number | null;

  timeInBedMin: number | null;
  estimatedSleepMin: number | null;
  fitbitVsReportedDeltaMin: number | null;

  deviation: SleepDeviationResult;
}

export async function computeSleepBlock(date: string): Promise<SleepBlock | null> {
  const { rows } = await pool.query(
    `SELECT sleep_minutes,
            planned_bed_time, planned_wake_time,
            actual_bed_time, actual_wake_time,
            sleep_latency_min, sleep_waso_min, nap_minutes
     FROM daily_log WHERE day = $1`,
    [date]
  );
  if (!rows[0]) return null;

  const r = rows[0];
  const plannedBed: string | null = r.planned_bed_time || null;
  const plannedWake: string | null = r.planned_wake_time || null;
  const actualBed: string | null = r.actual_bed_time || null;
  const actualWake: string | null = r.actual_wake_time || null;
  const latency: number | null = r.sleep_latency_min != null ? Number(r.sleep_latency_min) : null;
  const waso: number | null = r.sleep_waso_min != null ? Number(r.sleep_waso_min) : null;
  const napMin: number | null = r.nap_minutes != null ? Number(r.nap_minutes) : null;
  const fitbitMin: number | null = r.sleep_minutes != null ? Number(r.sleep_minutes) : null;

  let plannedSleepMin: number | null = null;
  if (plannedBed && plannedWake) {
    plannedSleepMin = spanMinutes(toMin(plannedBed), toMin(plannedWake));
  }

  let bedDevMin: number | null = null;
  let wakeDevMin: number | null = null;
  let scheduleAdherenceScore: number | null = null;

  if (plannedBed && plannedWake && actualBed && actualWake) {
    bedDevMin = wrapDev(toMin(actualBed) - toMin(plannedBed));
    wakeDevMin = wrapDev(toMin(actualWake) - toMin(plannedWake));
    const absBed = Math.min(Math.abs(bedDevMin), 120);
    const absWake = Math.min(Math.abs(wakeDevMin), 120);
    scheduleAdherenceScore = clamp(Math.round(100 - (absBed + absWake) / 2.4), 0, 100);
  }

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

  const deviation = classifySleepDeviation({
    planBed: plannedBed,
    planWake: plannedWake,
    srBed: actualBed,
    srWake: actualWake,
    fitbitSleepMin: fitbitMin,
    latencyMin: latency,
    wasoMin: waso,
  });

  return {
    plannedBedTime: plannedBed,
    plannedWakeTime: plannedWake,
    actualBedTime: actualBed,
    actualWakeTime: actualWake,
    sleepLatencyMin: latency,
    sleepWasoMin: waso,
    napMinutes: napMin,
    fitbitSleepMinutes: fitbitMin,

    plannedSleepMin,
    bedDevMin,
    wakeDevMin,
    sleepDebtMin,
    scheduleAdherenceScore,
    sleepAdequacyScore,
    sleepEfficiencyEst,

    timeInBedMin,
    estimatedSleepMin,
    fitbitVsReportedDeltaMin,

    deviation,
  };
}

export async function getSleepPlanSettings(): Promise<{ bedtime: string; wake: string }> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'sleep_plan_bedtime'`
  );
  const { rows: rows2 } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'sleep_plan_wake'`
  );
  return {
    bedtime: rows[0]?.value || DEFAULT_PLAN_BED,
    wake: rows2[0]?.value || DEFAULT_PLAN_WAKE,
  };
}

export interface SleepTrending {
  adherence7d: number | null;
  adherence28d: number | null;
  adequacy7d: number | null;
  adequacy28d: number | null;
  avgDebt7d: number | null;
  avgDebt28d: number | null;
  daysWithSchedule7d: number;
  daysWithAdequacy7d: number;
}

export async function computeSleepTrending(date: string): Promise<SleepTrending> {
  const d = new Date(date + "T00:00:00Z");
  const d7 = new Date(d);
  d7.setUTCDate(d7.getUTCDate() - 6);
  const d28 = new Date(d);
  d28.setUTCDate(d28.getUTCDate() - 27);
  const from28 = d28.toISOString().slice(0, 10);
  const from7 = d7.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT day, planned_bed_time, planned_wake_time,
            actual_bed_time, actual_wake_time, sleep_minutes
     FROM daily_log
     WHERE day BETWEEN $1 AND $2
     ORDER BY day ASC`,
    [from28, date]
  );

  const blocks: Array<{ day: string; adherence: number | null; adequacy: number | null; debt: number | null }> = [];

  for (const r of rows) {
    const plannedBed = r.planned_bed_time || null;
    const plannedWake = r.planned_wake_time || null;
    const actualBed = r.actual_bed_time || null;
    const actualWake = r.actual_wake_time || null;
    const fitbit = r.sleep_minutes != null ? Number(r.sleep_minutes) : null;

    let adherence: number | null = null;
    let adequacy: number | null = null;
    let debt: number | null = null;

    if (plannedBed && plannedWake && actualBed && actualWake) {
      const bedDev = wrapDev(toMin(actualBed) - toMin(plannedBed));
      const wakeDev = wrapDev(toMin(actualWake) - toMin(plannedWake));
      const absBed = Math.min(Math.abs(bedDev), 120);
      const absWake = Math.min(Math.abs(wakeDev), 120);
      adherence = clamp(Math.round(100 - (absBed + absWake) / 2.4), 0, 100);
    }

    if (plannedBed && plannedWake && fitbit != null) {
      const plannedMin = spanMinutes(toMin(plannedBed), toMin(plannedWake));
      debt = plannedMin - fitbit;
      const ratio = fitbit / plannedMin;
      adequacy = clamp(Math.round(ratio * 100), 0, 100);
    }

    blocks.push({ day: r.day, adherence, adequacy, debt });
  }

  const last7 = blocks.filter(b => b.day >= from7);
  const last28 = blocks;

  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v != null);
    return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  };

  return {
    adherence7d: avg(last7.map(b => b.adherence)),
    adherence28d: avg(last28.map(b => b.adherence)),
    adequacy7d: avg(last7.map(b => b.adequacy)),
    adequacy28d: avg(last28.map(b => b.adequacy)),
    avgDebt7d: avg(last7.map(b => b.debt)),
    avgDebt28d: avg(last28.map(b => b.debt)),
    daysWithSchedule7d: last7.filter(b => b.adherence != null).length,
    daysWithAdequacy7d: last7.filter(b => b.adequacy != null).length,
  };
}

export async function setSleepPlanSettings(bedtime: string, wake: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('sleep_plan_bedtime', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [bedtime]
  );
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('sleep_plan_wake', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [wake]
  );
}
