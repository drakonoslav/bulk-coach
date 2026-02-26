import type { DailyEntry } from "./coaching-engine";
import type { StrengthBaselines } from "./strength-index";
import { classifyStrengthPhase, strengthVelocity14d, computeDayStrengthIndex } from "./strength-index";

export type AdaptationStage =
  | "INSUFFICIENT_DATA"
  | "NOVELTY_WINDOW"
  | "STANDARD_HYPERTROPHY"
  | "ADVANCED_SLOW_GAIN"
  | "PLATEAU_RISK";

export type PlateauCondition = "A_no_pr_improvement" | "B_absolute_si_floor" | null;

export interface AdaptationDebug {
  trainingAgeDays: number | null;
  consistency4w: number | null;
  pctPerWeek: number | null;
  sPhasePhase: string | null;
  plateauCondition: PlateauCondition;
  siDelta14d: number | null;
  prRecent14d: number | null;
  prPrior14d: number | null;
}

export interface AdaptationResult {
  stage: AdaptationStage;
  label: string;
  trainingAgeDays: number | null;
  consistency4w: number | null;
  noveltyScore: number | null;
  reasons: string[];
  debug: AdaptationDebug;
}

const SI_ABSOLUTE_FLOOR = 0.005;

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
    end.setDate(end.getDate() - (w * 7) + 1);
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

function bestSiInWindow(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
  startDay: Date,
  endDay: Date,
): number | null {
  let best: number | null = null;
  for (const e of entries) {
    const d = parseDate(e.day);
    if (d < startDay || d > endDay) continue;
    if (!isStrengthSession(e)) continue;
    const si = computeDayStrengthIndex(e, baselines);
    if (si.strengthIndexRaw != null) {
      if (best == null || si.strengthIndexRaw > best) {
        best = si.strengthIndexRaw;
      }
    }
  }
  return best;
}

function makeDebug(
  trainingAgeDays: number | null,
  consistency4w: number | null,
  pctPerWeek: number | null,
  sPhasePhase: string | null,
  plateauCondition: PlateauCondition = null,
  siDelta14d: number | null = null,
  prRecent14d: number | null = null,
  prPrior14d: number | null = null,
): AdaptationDebug {
  return { trainingAgeDays, consistency4w, pctPerWeek, sPhasePhase, plateauCondition, siDelta14d, prRecent14d, prPrior14d };
}

export function classifyAdaptationStage(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): AdaptationResult {
  const reasons: string[] = [];
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length === 0) {
    return { stage: "INSUFFICIENT_DATA", label: "Data-poor", trainingAgeDays: null, consistency4w: null, noveltyScore: null, reasons: ["No entries"], debug: makeDebug(null, null, null, null) };
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
      debug: makeDebug(trainingAgeDays, consistency4w, null, null),
    };
  }

  const sV = strengthVelocity14d(sorted, baselines);
  const pctPerWeek = sV?.pctPerWeek ?? null;
  const sPhase = classifyStrengthPhase(pctPerWeek);

  if (sPhase.phase === "INSUFFICIENT_DATA") {
    return {
      stage: "INSUFFICIENT_DATA",
      label: "Data-poor",
      trainingAgeDays,
      consistency4w,
      noveltyScore: null,
      reasons: ["Strength velocity unavailable — cannot classify adaptation stage"],
      debug: makeDebug(trainingAgeDays, consistency4w, pctPerWeek, sPhase.phase),
    };
  }

  const ageFactor = Math.exp(-trainingAgeDays / 90);
  const strengthFactor = clamp(((pctPerWeek ?? 0) / 6), 0, 1);
  const consistencyFactor = clamp(consistency4w, 0, 1);
  const noveltyScore = Math.round(100 * ageFactor * (0.4 + 0.6 * strengthFactor) * (0.5 + 0.5 * consistencyFactor));

  const inNoveltyAge = trainingAgeDays <= 90;
  const isConsistent = consistency4w >= 0.50;

  if (inNoveltyAge && isConsistent && (sPhase.phase === "NEURAL_REBOUND" || sPhase.phase === "LATE_NEURAL")) {
    reasons.push("Training age ≤90d + consistent + neural-phase strength acceleration");
    return { stage: "NOVELTY_WINDOW", label: "Novelty", trainingAgeDays, consistency4w, noveltyScore, reasons, debug: makeDebug(trainingAgeDays, consistency4w, pctPerWeek, sPhase.phase) };
  }

  if (trainingAgeDays > 365 && sPhase.phase === "HYPERTROPHY_PROGRESS") {
    reasons.push("Training age >1y + progress phase ⇒ slower gains expected");
    return { stage: "ADVANCED_SLOW_GAIN", label: "Advanced", trainingAgeDays, consistency4w, noveltyScore, reasons, debug: makeDebug(trainingAgeDays, consistency4w, pctPerWeek, sPhase.phase) };
  }

  if (trainingAgeDays > 90 && isConsistent) {
    const latest = parseDate(sorted[sorted.length - 1].day);
    const w1End = latest;
    const w1Start = new Date(latest);
    w1Start.setDate(w1Start.getDate() - 14);
    const w2Start = new Date(latest);
    w2Start.setDate(w2Start.getDate() - 28);
    const w3Start = new Date(latest);
    w3Start.setDate(w3Start.getDate() - 42);

    const prWindow1 = bestSiInWindow(sorted, baselines, w1Start, w1End);
    const prWindow2 = bestSiInWindow(sorted, baselines, w2Start, w1Start);
    const prWindow3 = bestSiInWindow(sorted, baselines, w3Start, w2Start);

    const siDelta14d = sV != null ? Math.round((sV.si7dToday - sV.si7d14dAgo) * 10000) / 10000 : null;

    const w1StagnantA = prWindow1 != null && prWindow2 != null && prWindow1 <= prWindow2;
    const w2StagnantA = prWindow2 != null && prWindow3 != null && prWindow2 <= prWindow3;
    const persistentA = w1StagnantA && w2StagnantA;

    const w1StagnantB = siDelta14d != null && Math.abs(siDelta14d) < SI_ABSOLUTE_FLOOR;
    const persistentB = w1StagnantB && w1StagnantA;

    let plateauCondition: PlateauCondition = null;
    if (persistentA) plateauCondition = "A_no_pr_improvement";
    if (persistentB && !persistentA) plateauCondition = "B_absolute_si_floor";

    if (persistentA || persistentB) {
      const detail = persistentA
        ? `PR stagnant ≥28d: w1=${prWindow1?.toFixed(4)} ≤ w2=${prWindow2?.toFixed(4)} ≤ w3=${prWindow3?.toFixed(4)}`
        : `SI delta below floor ≥28d: ΔSI=${siDelta14d?.toFixed(4)} < ${SI_ABSOLUTE_FLOOR}`;
      reasons.push(`Post-novelty + consistent + ${detail}`);
      return {
        stage: "PLATEAU_RISK",
        label: "Plateau risk",
        trainingAgeDays,
        consistency4w,
        noveltyScore,
        reasons,
        debug: makeDebug(trainingAgeDays, consistency4w, pctPerWeek, sPhase.phase, plateauCondition, siDelta14d, prWindow1, prWindow2),
      };
    }
  }

  reasons.push("Default: stable regime");
  return { stage: "STANDARD_HYPERTROPHY", label: "Standard", trainingAgeDays, consistency4w, noveltyScore, reasons, debug: makeDebug(trainingAgeDays, consistency4w, pctPerWeek, sPhase.phase) };
}
