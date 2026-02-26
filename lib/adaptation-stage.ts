import type { DailyEntry } from "./coaching-engine";
import type { StrengthBaselines } from "./strength-index";
import { classifyStrengthPhase, strengthVelocity14d } from "./strength-index";

export type AdaptationStage =
  | "INSUFFICIENT_DATA"
  | "NOVELTY_WINDOW"
  | "STANDARD_HYPERTROPHY"
  | "ADVANCED_SLOW_GAIN"
  | "PLATEAU_RISK";

export interface AdaptationResult {
  stage: AdaptationStage;
  label: string;
  trainingAgeDays: number | null;
  consistency4w: number | null;
  noveltyScore: number | null;
  reasons: string[];
}

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

function isStrengthSession(e: DailyEntry): boolean {
  return (
    e.pushupsReps != null ||
    e.pullupsReps != null ||
    e.benchReps != null ||
    e.ohpReps != null
  );
}

function sessionsInLastNDays(entries: DailyEntry[], n: number): number {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const latest = parseDate(sorted[sorted.length - 1].day);
  const start = new Date(latest);
  start.setDate(start.getDate() - n);

  return sorted.filter(e => {
    const d = parseDate(e.day);
    return d >= start && isStrengthSession(e);
  }).length;
}

function computeTrainingAgeDays(entries: DailyEntry[]): number | null {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted.find(e => isStrengthSession(e));
  if (!first) return null;
  const latest = sorted[sorted.length - 1];
  return daysBetween(parseDate(first.day), parseDate(latest.day));
}

function computeConsistency4w(entries: DailyEntry[]): number | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const latest = parseDate(sorted[sorted.length - 1].day);

  const weeks: number[] = [];
  for (let w = 0; w < 4; w++) {
    const end = new Date(latest);
    end.setDate(end.getDate() - (w * 7));
    const start = new Date(end);
    start.setDate(start.getDate() - 7);

    const count = sorted.filter(e => {
      const d = parseDate(e.day);
      return d >= start && d < end && isStrengthSession(e);
    }).length;

    weeks.push(count);
  }

  const qualifying = weeks.filter(c => c >= 2).length;
  return qualifying / 4;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function classifyAdaptationStage(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): AdaptationResult {
  const reasons: string[] = [];
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length === 0) {
    return { stage: "INSUFFICIENT_DATA", label: "Data-poor", trainingAgeDays: null, consistency4w: null, noveltyScore: null, reasons: ["No entries"] };
  }

  const sessions14d = sessionsInLastNDays(sorted, 14);
  const trainingAgeDays = computeTrainingAgeDays(sorted);
  const consistency4w = computeConsistency4w(sorted);

  if (sessions14d < 2 || trainingAgeDays == null || consistency4w == null) {
    return {
      stage: "INSUFFICIENT_DATA",
      label: "Data-poor",
      trainingAgeDays,
      consistency4w,
      noveltyScore: null,
      reasons: ["Need ≥2 strength sessions in 14d to classify adaptation stage"],
    };
  }

  const sV = strengthVelocity14d(sorted, baselines);
  const pctPerWeek = sV?.pctPerWeek ?? null;
  const sPhase = classifyStrengthPhase(pctPerWeek);

  const ageFactor = Math.exp(-trainingAgeDays / 90);
  const strengthFactor = clamp(((pctPerWeek ?? 0) / 6), 0, 1);
  const consistencyFactor = clamp(consistency4w, 0, 1);
  const noveltyScore = Math.round(100 * ageFactor * (0.4 + 0.6 * strengthFactor) * (0.5 + 0.5 * consistencyFactor));

  const inNoveltyAge = trainingAgeDays <= 90;
  const isConsistent = consistency4w >= 0.50;

  if (inNoveltyAge && isConsistent && (sPhase.phase === "NEURAL_REBOUND" || sPhase.phase === "LATE_NEURAL")) {
    reasons.push("Training age ≤90d + consistent + neural-phase strength acceleration");
    return { stage: "NOVELTY_WINDOW", label: "Novelty", trainingAgeDays, consistency4w, noveltyScore, reasons };
  }

  if (trainingAgeDays > 365 && sPhase.phase === "HYPERTROPHY_PROGRESS") {
    reasons.push("Training age >1y + progress phase ⇒ slower gains expected");
    return { stage: "ADVANCED_SLOW_GAIN", label: "Advanced", trainingAgeDays, consistency4w, noveltyScore, reasons };
  }

  if (trainingAgeDays > 90 && sPhase.phase === "STALL_OR_FATIGUE" && isConsistent) {
    reasons.push("Post-novelty + consistent training + stalled/flat strength velocity");
    return { stage: "PLATEAU_RISK", label: "Plateau risk", trainingAgeDays, consistency4w, noveltyScore, reasons };
  }

  reasons.push("Default: stable regime");
  return { stage: "STANDARD_HYPERTROPHY", label: "Standard", trainingAgeDays, consistency4w, noveltyScore, reasons };
}
