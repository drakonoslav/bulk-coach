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

function toMin(t: string): number {
  const clean = t.includes(" ") ? t.split(" ")[1] : t;
  const [h, m] = clean.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

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
  return `bed ${formatDevMin(bedDev)} / wake ${formatDevMin(wakeDev)}`;
}

function formatShortfallLine(shortfall: number | null): string | null {
  if (shortfall == null || shortfall <= 0) return null;
  const rounded = Math.round(shortfall);
  if (rounded < 3) return null;
  return `shortfall +${rounded}m`;
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
