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

const DEVIATION_LABELS: Record<SleepDeviationType, string> = {
  efficient_on_plan: "Efficient & on-plan",
  behavioral_drift: "Behavioral drift",
  physiological_shortfall: "Physiological shortfall",
  oversleep_spillover: "Oversleep spillover",
};

export function deviationHumanLabel(dt: SleepDeviationType | null): string | null {
  return dt ? DEVIATION_LABELS[dt] : null;
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

  const pBed = toMin(planBed);
  const pWake = toMin(planWake);
  const sleepNeedMin = spanMinutes(pBed, pWake);
  const bedDevMin = srBed ? wrapDev(toMin(srBed) - pBed) : null;
  const wakeDevMin = srWake ? wrapDev(toMin(srWake) - pWake) : null;

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
