const UNICODE_MINUS = "\u2212";

export function noiseFloorMinutes(x: number | null | undefined): number | null {
  if (x === null || x === undefined || Number.isNaN(x)) return null;
  return Math.abs(x) < 3 ? 0 : Math.round(x);
}

export function formatSignedMinutes(mins: number | null | undefined): string {
  const v = noiseFloorMinutes(mins);
  if (v === null) return "\u2014";
  if (v === 0) return "0m";
  if (v > 0) return `+${v}m`;
  return `${UNICODE_MINUS}${Math.abs(v)}m`;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function sleepAlignmentScore(
  bedDevMin: number | null | undefined,
  wakeDevMin: number | null | undefined,
  opts?: {
    bedOkMin?: number;
    wakeOkMin?: number;
    decayWindowMin?: number;
  }
): number | null {
  const bed = noiseFloorMinutes(bedDevMin);
  const wake = noiseFloorMinutes(wakeDevMin);

  if (bed === null || wake === null) return null;

  const BED_OK = opts?.bedOkMin ?? 15;
  const WAKE_OK = opts?.wakeOkMin ?? 10;
  const DECAY = opts?.decayWindowMin ?? 60;

  const bedPenaltyRaw = Math.max(0, bed);
  const wakePenaltyRaw = Math.max(0, -wake);

  const bedOver = Math.max(0, bedPenaltyRaw - BED_OK);
  const wakeOver = Math.max(0, wakePenaltyRaw - WAKE_OK);

  const bedScore = clamp01(1 - bedOver / DECAY);
  const wakeScore = clamp01(1 - wakeOver / DECAY);

  const score = 100 * (0.5 * bedScore + 0.5 * wakeScore);
  return Math.round(score);
}

export function formatBedWakeDeviation(
  bedDevMin: number | null | undefined,
  wakeDevMin: number | null | undefined
): string {
  return `bed ${formatSignedMinutes(bedDevMin)} / wake ${formatSignedMinutes(wakeDevMin)}`;
}

export type SleepClassification =
  | "behavioral_drift"
  | "physiological_shortfall"
  | "oversleep_spillover"
  | "efficient_on_plan"
  | "insufficient_data";

const BED_OK = 15;
const WAKE_OK = 10;
const SHORTFALL_MAJOR = 30;
const OVERSLEEP_MAJOR = 20;

export function classifySleepDeviation(args: {
  bedDevMin: number | null;
  wakeDevMin: number | null;
  shortfallMin: number | null;
}): SleepClassification {
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

export const CLASSIFICATION_LABELS: Record<SleepClassification, string> = {
  efficient_on_plan: "Efficient & on-plan",
  behavioral_drift: "Behavioral drift",
  physiological_shortfall: "Physiological shortfall",
  oversleep_spillover: "Oversleep spillover",
  insufficient_data: "Insufficient data",
};
