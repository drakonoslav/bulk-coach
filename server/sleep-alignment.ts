import { pool } from "./db";

const DEFAULT_PLAN_BED = "21:45";
const DEFAULT_PLAN_WAKE = "05:30";

function toMin(t: string): number {
  const clean = t.includes(" ") ? t.split(" ")[1] : t;
  const [h, m] = clean.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function spanMinutes(startMin: number, endMin: number): number {
  let diff = endMin - startMin;
  if (diff <= 0) diff += 1440;
  return diff;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const clamp01 = (x: number) => clamp(x, 0, 1);

function circularDeltaMinutes(actualMin: number, plannedMin: number): number {
  let d = actualMin - plannedMin;
  while (d > 720) d -= 1440;
  while (d < -720) d += 1440;
  return d;
}

function roundAndNoiseFloor(d: number): number {
  let v = Math.round(d);
  if (Math.abs(v) < 3) v = 0;
  return v;
}

function linearScore(absDev: number, ok: number, cap: number): number {
  const penalty = clamp01((absDev - ok) / (cap - ok));
  return Math.round(100 * (1 - penalty));
}

function weightedMeanAvailable(items: Array<{ score: number | null; w: number }>): number | null {
  const present = items.filter(i => i.score != null);
  if (present.length === 0) return null;
  const wsum = present.reduce((a, i) => a + i.w, 0);
  const total = present.reduce((a, i) => a + (i.score as number) * (i.w / wsum), 0);
  return total;
}

export function formatDevMin(raw: number | null): string {
  if (raw == null) return "\u2014";
  let value = Math.round(raw);
  if (Math.abs(value) < 3) value = 0;
  if (value === 0) return "0m";
  const sign = value > 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(value)}m`;
}

function formatBedWakeLine(bedDev: number | null, wakeDev: number | null): string {
  if (bedDev == null && wakeDev == null) return "\u2014";
  return `bed ${formatDevMin(bedDev)} / wake ${formatDevMin(wakeDev)}`;
}

function formatShortfallLine(shortfall: number | null): string | null {
  if (shortfall == null || shortfall <= 0) return null;
  const rounded = Math.round(shortfall);
  if (rounded < 3) return null;
  return `shortfall +${rounded}m`;
}

export type SleepDeviationType =
  | "efficient_on_plan"
  | "behavioral_drift"
  | "physiological_shortfall"
  | "oversleep_spillover"
  | "insufficient_data";

export interface SleepDeviationResult {
  label: SleepDeviationType;
  bedDevMin: number | null;
  wakeDevMin: number | null;
  shortfallMin: number | null;
  reason: string[];
  displayLine: string;
  shortfallLine: string | null;
}

const BED_OK = 15;
const WAKE_OK = 10;
const SHORTFALL_MAJOR = 30;
const OVERSLEEP_MAJOR = 20;

export function classifySleepDeviationType(args: {
  bedDevMin: number | null;
  wakeDevMin: number | null;
  shortfallMin: number | null;
}): SleepDeviationType {
  const { bedDevMin, wakeDevMin, shortfallMin } = args;
  const hasTiming = bedDevMin != null && wakeDevMin != null;
  const hasDuration = shortfallMin != null;

  if (!hasTiming && !hasDuration) return "insufficient_data";

  if (wakeDevMin != null && wakeDevMin >= OVERSLEEP_MAJOR) return "oversleep_spillover";
  if (shortfallMin != null && shortfallMin >= SHORTFALL_MAJOR) return "physiological_shortfall";

  const timingOnPlan =
    hasTiming &&
    Math.abs(bedDevMin as number) <= BED_OK &&
    Math.abs(wakeDevMin as number) <= WAKE_OK;
  const durationOnPlan = !hasDuration || shortfallMin === 0;

  if (timingOnPlan && durationOnPlan) return "efficient_on_plan";

  return "behavioral_drift";
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
    label: "insufficient_data", bedDevMin: null, wakeDevMin: null,
    shortfallMin: null, reason: ["missing_plan"], displayLine: "\u2014", shortfallLine: null,
  };

  if (!planBed || !planWake) return empty;

  const pBed = toMin(planBed);
  const pWake = toMin(planWake);
  const sleepNeedMin = spanMinutes(pBed, pWake);

  const bedDevMin = srBed ? roundAndNoiseFloor(circularDeltaMinutes(toMin(srBed), pBed)) : null;
  const wakeDevMin = srWake ? roundAndNoiseFloor(circularDeltaMinutes(toMin(srWake), pWake)) : null;

  let sleepAsleepMin: number | null = null;
  if (typeof fitbitSleepMin === "number") {
    sleepAsleepMin = fitbitSleepMin;
  } else if (srBed && srWake) {
    const inBed = spanMinutes(toMin(srBed), toMin(srWake));
    sleepAsleepMin = Math.max(0, inBed - Math.max(0, latencyMin ?? 0) - Math.max(0, wasoMin ?? 0));
  }

  let shortfallMin: number | null = null;
  if (sleepAsleepMin != null) {
    const raw = Math.max(0, sleepNeedMin - sleepAsleepMin);
    shortfallMin = roundAndNoiseFloor(raw);
  }

  const label = classifySleepDeviationType({ bedDevMin, wakeDevMin, shortfallMin });

  const reason: string[] = [];
  if (label === "oversleep_spillover") reason.push("wake_late");
  else if (label === "physiological_shortfall") reason.push("sleep_shortfall");
  else if (label === "behavioral_drift") reason.push("schedule_drift");
  else if (label === "efficient_on_plan") reason.push("on_plan");
  else reason.push("insufficient_data");

  const displayLine = formatBedWakeLine(bedDevMin, wakeDevMin);
  const shortfallLine = formatShortfallLine(shortfallMin);

  return { label, bedDevMin, wakeDevMin, shortfallMin, reason, displayLine, shortfallLine };
}

const DEVIATION_LABELS: Record<SleepDeviationType, string> = {
  efficient_on_plan: "Efficient & on-plan",
  behavioral_drift: "Behavioral drift",
  physiological_shortfall: "Physiological shortfall",
  oversleep_spillover: "Oversleep spillover",
  insufficient_data: "Insufficient data",
};

export function deviationHumanLabel(dt: SleepDeviationType | null): string | null {
  return dt && dt !== "insufficient_data" ? DEVIATION_LABELS[dt] : null;
}

export interface SleepAlignmentResult {
  alignmentScore: number | null;
  bedDevMin: number | null;
  wakeDevMin: number | null;
  shortfallMin: number | null;
  bedScore: number | null;
  wakeScore: number | null;
  durationScore: number | null;
  oversleepDampener: number | null;
}

export function computeSleepAlignmentScore(args: {
  planBedMin: number | null;
  planWakeMin: number | null;
  planSleepMin: number | null;
  obsBedMin: number | null;
  obsWakeMin: number | null;
  obsSleepMin: number | null;
}): SleepAlignmentResult {
  const { planBedMin, planWakeMin, planSleepMin, obsBedMin, obsWakeMin, obsSleepMin } = args;

  let bedDevMin: number | null = null;
  let bedScore: number | null = null;
  if (planBedMin != null && obsBedMin != null) {
    bedDevMin = roundAndNoiseFloor(circularDeltaMinutes(obsBedMin, planBedMin));
    bedScore = linearScore(Math.abs(bedDevMin), 15, 120);
  }

  let wakeDevMin: number | null = null;
  let wakeScore: number | null = null;
  if (planWakeMin != null && obsWakeMin != null) {
    wakeDevMin = roundAndNoiseFloor(circularDeltaMinutes(obsWakeMin, planWakeMin));
    wakeScore = linearScore(Math.abs(wakeDevMin), 10, 90);
  }

  let shortfallMin: number | null = null;
  let durationScore: number | null = null;
  if (planSleepMin != null && obsSleepMin != null) {
    const rawShort = Math.max(0, planSleepMin - obsSleepMin);
    shortfallMin = roundAndNoiseFloor(rawShort);
    durationScore = linearScore(shortfallMin, 0, 120);
  }

  const base = weightedMeanAvailable([
    { score: bedScore, w: 0.35 },
    { score: wakeScore, w: 0.40 },
    { score: durationScore, w: 0.25 },
  ]);

  if (base == null) {
    return {
      alignmentScore: null,
      bedDevMin, wakeDevMin, shortfallMin,
      bedScore, wakeScore, durationScore,
      oversleepDampener: null,
    };
  }

  let oversleepDampener: number | null = null;
  let final = base;

  if (wakeDevMin != null && wakeDevMin > 10) {
    const spill = wakeDevMin - 10;
    const spillPenalty = clamp01(spill / (120 - 10));
    const spillScore = 100 * (1 - spillPenalty);
    oversleepDampener = 0.6 + 0.4 * (spillScore / 100);
    final = base * oversleepDampener;
  }

  const alignmentScore = Math.round(clamp(final, 0, 100));

  return {
    alignmentScore,
    bedDevMin, wakeDevMin, shortfallMin,
    bedScore, wakeScore, durationScore,
    oversleepDampener,
  };
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
  sleepAdequacyScore: number | null;
  sleepEfficiencyEst: number | null;

  alignment: SleepAlignmentResult;

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

  if (plannedBed && plannedWake && actualBed && actualWake) {
    bedDevMin = roundAndNoiseFloor(circularDeltaMinutes(toMin(actualBed), toMin(plannedBed)));
    wakeDevMin = roundAndNoiseFloor(circularDeltaMinutes(toMin(actualWake), toMin(plannedWake)));
  }

  const alignment = computeSleepAlignmentScore({
    planBedMin: plannedBed ? toMin(plannedBed) : null,
    planWakeMin: plannedWake ? toMin(plannedWake) : null,
    planSleepMin: plannedSleepMin,
    obsBedMin: actualBed ? toMin(actualBed) : null,
    obsWakeMin: actualWake ? toMin(actualWake) : null,
    obsSleepMin: fitbitMin,
  });

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
    sleepAdequacyScore,
    sleepEfficiencyEst,

    alignment,

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
  alignment7d: number | null;
  alignment28d: number | null;
  adequacy7d: number | null;
  adequacy28d: number | null;
  avgDebt7d: number | null;
  avgDebt28d: number | null;
  daysWithAlignment7d: number;
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

  const blocks: Array<{ day: string; alignment: number | null; adequacy: number | null; debt: number | null }> = [];

  for (const r of rows) {
    const plannedBed = r.planned_bed_time || null;
    const plannedWake = r.planned_wake_time || null;
    const actualBed = r.actual_bed_time || null;
    const actualWake = r.actual_wake_time || null;
    const fitbit = r.sleep_minutes != null ? Number(r.sleep_minutes) : null;

    let alignmentVal: number | null = null;
    let adequacy: number | null = null;
    let debt: number | null = null;

    let plannedMin: number | null = null;
    if (plannedBed && plannedWake) {
      plannedMin = spanMinutes(toMin(plannedBed), toMin(plannedWake));
    }

    const aResult = computeSleepAlignmentScore({
      planBedMin: plannedBed ? toMin(plannedBed) : null,
      planWakeMin: plannedWake ? toMin(plannedWake) : null,
      planSleepMin: plannedMin,
      obsBedMin: actualBed ? toMin(actualBed) : null,
      obsWakeMin: actualWake ? toMin(actualWake) : null,
      obsSleepMin: fitbit,
    });
    alignmentVal = aResult.alignmentScore;

    if (plannedMin != null && fitbit != null) {
      debt = plannedMin - fitbit;
      const ratio = fitbit / plannedMin;
      adequacy = clamp(Math.round(ratio * 100), 0, 100);
    }

    blocks.push({ day: r.day, alignment: alignmentVal, adequacy, debt });
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
