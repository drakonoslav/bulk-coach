import type { DailyEntry } from "./coaching-engine";
import { ffmVelocity14d, ffmRollingAvg, weightVelocity14d } from "./coaching-engine";
import type { StrengthBaselines, StrengthVelocityResult } from "./strength-index";
import { strengthVelocity14d, swapPenaltyMultiplier } from "./strength-index";
import type { AdaptationResult } from "./adaptation-stage";
import { classifyAdaptationStage } from "./adaptation-stage";

export interface FfmSignalQuality {
  score: number;
  measurementCount7d: number;
  velocityAboveNoise: boolean;
  directionConsistent: boolean;
}

export interface WaistSignalQuality {
  score: number;
  measurementCount14d: number;
  velocityAboveNoise: boolean;
  directionConsistent: boolean;
}

export interface StrengthSignalQuality {
  score: number;
  sessionsIn14d: number;
  velocityAboveNoise: boolean;
  swapPenalty: number;
}

export interface SCSResult {
  total: number;
  ffm: FfmSignalQuality;
  waist: WaistSignalQuality;
  strength: StrengthSignalQuality;
}

export type TrainingMode = "LEAN_BULK" | "RECOMP" | "CUT" | "UNCERTAIN";

export type TrainingPhase = "neural" | "hypertrophy";

export interface WaistWarning {
  active: boolean;
  label: string;
  severity: "amber" | "none";
}

export interface StrengthPlateau {
  flagged: boolean;
  label: string;
  coachingNotes: string[];
}

export interface ModeClassification {
  mode: TrainingMode;
  label: string;
  color: string;
  confidence: number;
  ffmVelocity: number | null;
  waistVelocity: number | null;
  strengthVelocityPct: number | null;
  weightVelocity: number | null;
  reasons: string[];
  calorieAction: CalorieAction;
  trainingPhase: TrainingPhase;
  waistWarning: WaistWarning;
  strengthPlateau: StrengthPlateau;
  adaptation: AdaptationResult;
}

export interface CalorieAction {
  delta: number;
  reason: string;
  priority: "high" | "medium" | "low";
}

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

function countMeasurementsInWindow(
  entries: DailyEntry[],
  field: keyof DailyEntry,
  windowDays: number,
): number {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const latestDate = parseDate(sorted[sorted.length - 1].day);
  const startDate = new Date(latestDate);
  startDate.setDate(startDate.getDate() - windowDays);

  return sorted.filter((e) => {
    const d = parseDate(e.day);
    return d >= startDate && e[field] != null;
  }).length;
}

function checkDirectionConsistency(
  entries: DailyEntry[],
  field: keyof DailyEntry,
  velocity: number,
  lastN: number = 3,
): boolean {
  const sorted = [...entries]
    .sort((a, b) => a.day.localeCompare(b.day))
    .filter((e) => e[field] != null);

  if (sorted.length < lastN) return false;

  const recent = sorted.slice(-lastN);
  const values = recent.map((e) => e[field] as number);

  if (Math.abs(velocity) < 0.001) return true;

  let consistent = 0;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if ((velocity > 0 && delta >= 0) || (velocity < 0 && delta <= 0)) {
      consistent++;
    }
  }
  return consistent >= Math.floor((lastN - 1) * 0.5);
}

export function computeFfmSignalQuality(entries: DailyEntry[]): FfmSignalQuality {
  let score = 0;

  const count7d = countMeasurementsInWindow(entries, "fatFreeMassLb", 7);
  if (count7d >= 4) score += 13;
  else if (count7d >= 2) score += 7;
  else if (count7d >= 1) score += 3;

  const ffmV = ffmVelocity14d(entries);
  const velocityAboveNoise = ffmV != null && Math.abs(ffmV.velocityLbPerWeek) >= 0.15;
  if (velocityAboveNoise) score += 9;
  else if (ffmV != null && Math.abs(ffmV.velocityLbPerWeek) >= 0.08) score += 4;

  const directionConsistent = ffmV != null && checkDirectionConsistency(
    entries, "fatFreeMassLb", ffmV.velocityLbPerWeek, 3,
  );
  if (directionConsistent) score += 13;
  else if (ffmV != null) score += 4;

  return {
    score: Math.min(35, score),
    measurementCount7d: count7d,
    velocityAboveNoise,
    directionConsistent,
  };
}

export function computeWaistSignalQuality(entries: DailyEntry[]): WaistSignalQuality {
  let score = 0;

  const count14d = countMeasurementsInWindow(entries, "waistIn", 14);
  if (count14d >= 4) score += 8;
  else if (count14d >= 2) score += 4;
  else if (count14d >= 1) score += 2;

  const waistV = waistVelocity14d(entries);
  const velocityAboveNoise = waistV != null && Math.abs(waistV) >= 0.10;
  if (velocityAboveNoise) score += 8;
  else if (waistV != null && Math.abs(waistV) >= 0.05) score += 4;

  const directionConsistent = waistV != null && checkDirectionConsistency(
    entries, "waistIn", waistV, 3,
  );
  if (directionConsistent) score += 9;
  else if (waistV != null) score += 3;

  return {
    score: Math.min(25, score),
    measurementCount14d: count14d,
    velocityAboveNoise,
    directionConsistent,
  };
}

export function computeStrengthSignalQuality(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): StrengthSignalQuality {
  let score = 0;

  const hasStrengthData = (e: DailyEntry) =>
    e.pushupsReps != null || e.pullupsReps != null || e.benchReps != null || e.ohpReps != null;

  const sessionsIn14d = countMeasurementsInWindow(
    entries.map((e) => ({ ...e, _hasStrength: hasStrengthData(e) ? 1 : undefined } as any)),
    "_hasStrength" as any,
    14,
  );

  const actualSessions = entries.filter((e) => {
    const d = parseDate(e.day);
    const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
    if (sorted.length === 0) return false;
    const latestDate = parseDate(sorted[sorted.length - 1].day);
    const startDate = new Date(latestDate);
    startDate.setDate(startDate.getDate() - 14);
    return d >= startDate && hasStrengthData(e);
  }).length;

  if (actualSessions >= 3) score += 14;
  else if (actualSessions >= 2) score += 8;
  else if (actualSessions >= 1) score += 4;

  const sV = strengthVelocity14d(entries, baselines);
  const velocityAboveNoise = sV != null && Math.abs(sV.pctPerWeek) >= 0.25;
  if (velocityAboveNoise) score += 13;
  else if (sV != null && Math.abs(sV.pctPerWeek) >= 0.10) score += 6;

  const penalty = swapPenaltyMultiplier(entries);
  if (penalty >= 0.9) score += 13;
  else if (penalty >= 0.8) score += 6;
  else score += 2;

  return {
    score: Math.min(40, score),
    sessionsIn14d: actualSessions,
    velocityAboveNoise,
    swapPenalty: penalty,
  };
}

export function computeSCS(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): SCSResult {
  const ffm = computeFfmSignalQuality(entries);
  const waist = computeWaistSignalQuality(entries);
  const strength = computeStrengthSignalQuality(entries, baselines);

  return {
    total: ffm.score + waist.score + strength.score,
    ffm,
    waist,
    strength,
  };
}

function waistVelocity14d(entries: DailyEntry[]): number | null {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const withWaist = sorted.filter((e) => e.waistIn != null);
  if (withWaist.length < 3) return null;

  const waistRolling = computeWaistRolling(withWaist, 7);
  if (waistRolling.length < 2) return null;

  const today = waistRolling[waistRolling.length - 1];
  const todayDate = parseDate(today.day);

  let best: { day: string; avg: number } | null = null;
  for (let i = waistRolling.length - 2; i >= 0; i--) {
    const d = parseDate(waistRolling[i].day);
    const span = daysBetween(d, todayDate);
    if (span >= 10 && span <= 18) {
      best = waistRolling[i];
      break;
    }
  }
  if (!best) {
    for (let i = waistRolling.length - 2; i >= 0; i--) {
      const d = parseDate(waistRolling[i].day);
      const span = daysBetween(d, todayDate);
      if (span >= 7) {
        best = waistRolling[i];
        break;
      }
    }
  }
  if (!best) return null;

  const spanDays = daysBetween(parseDate(best.day), todayDate);
  if (spanDays < 7) return null;

  return ((today.avg - best.avg) / spanDays) * 7;
}

function computeWaistRolling(
  entries: DailyEntry[],
  days: number,
): Array<{ day: string; avg: number }> {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const items = sorted
    .filter((e) => e.waistIn != null)
    .map((e) => ({ date: parseDate(e.day), waist: e.waistIn!, day: e.day }));

  const out: Array<{ day: string; avg: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const di = items[i].date;
    const window = items.filter((w) => {
      const diff = daysBetween(w.date, di);
      return diff >= 0 && diff < days;
    });
    if (window.length >= Math.min(days, 2)) {
      const avg = window.reduce((s, w) => s + w.waist, 0) / window.length;
      out.push({ day: items[i].day, avg: Math.round(avg * 1000) / 1000 });
    }
  }
  return out;
}

export function detectWaistWarning(waistVel: number | null): WaistWarning {
  if (waistVel != null && waistVel > 0.20) {
    return { active: true, label: "Waist rising quickly", severity: "amber" };
  }
  return { active: false, label: "", severity: "none" };
}

export function detectTrainingPhase(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): TrainingPhase {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length < 14) return "neural";

  let phase: TrainingPhase = "neural";
  let hypertrophyStreak = 0;
  let revertStreak = 0;

  for (let i = 13; i < sorted.length; i++) {
    const window = sorted.slice(0, i + 1);
    const sV = strengthVelocity14d(window, baselines);
    const ffmV = ffmVelocity14d(window);
    const penalty = swapPenaltyMultiplier(window);

    if (phase === "neural") {
      const met =
        sV != null && sV.pctPerWeek >= 0.25 &&
        ffmV != null && ffmV.velocityLbPerWeek >= 0 &&
        penalty >= 0.90;
      if (met) { hypertrophyStreak++; } else { hypertrophyStreak = 0; }
      if (hypertrophyStreak >= 14) {
        phase = "hypertrophy";
        revertStreak = 0;
      }
    } else {
      const shouldRevert = sV != null && sV.pctPerWeek < 0;
      if (shouldRevert) { revertStreak++; } else { revertStreak = 0; }
      if (revertStreak >= 14) {
        phase = "neural";
        hypertrophyStreak = 0;
      }
    }
  }

  return phase;
}

function caloriesIncreasedRecently(entries: DailyEntry[]): boolean {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const withCals = sorted.filter(e => e.caloriesIn != null && e.caloriesIn > 0);
  if (withCals.length < 4) return false;

  const recent7 = withCals.slice(-7);
  const prior7 = withCals.slice(-14, -7);
  if (prior7.length < 2 || recent7.length < 2) return false;

  const avgRecent = recent7.reduce((s, e) => s + (e.caloriesIn ?? 0), 0) / recent7.length;
  const avgPrior = prior7.reduce((s, e) => s + (e.caloriesIn ?? 0), 0) / prior7.length;

  return avgRecent > avgPrior + 25;
}

export function detectStrengthPlateau(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
  currentMode: TrainingMode,
): StrengthPlateau {
  const sV = strengthVelocity14d(entries, baselines);
  const ffmV = ffmVelocity14d(entries);

  const strengthStalled = sV != null && sV.pctPerWeek < 0.005;
  const ffmFlat = ffmV == null || ffmV.velocityLbPerWeek <= 0;
  const inSurplusContext = currentMode === "LEAN_BULK" || caloriesIncreasedRecently(entries);

  if (strengthStalled && ffmFlat && inSurplusContext) {
    const waistV = waistVelocity14d(entries);
    const notes: string[] = [
      "Improve lift adherence / progressive overload",
      "Hold calories — do not add more",
    ];
    if (waistV != null && waistV > 0.20) {
      notes.push("Waist rising quickly with stalled strength — consider −100 kcal");
    }
    return {
      flagged: true,
      label: "Surplus not productive: strength/FFM not rising",
      coachingNotes: notes,
    };
  }

  return { flagged: false, label: "", coachingNotes: [] };
}

function capCalorieDelta(delta: number, phase: TrainingPhase, wkGainLb?: number | null): number {
  if (delta <= 0) return delta;
  if (phase !== "hypertrophy" && wkGainLb != null && wkGainLb <= -0.50) {
    return Math.min(delta, 250);
  }
  const cap = phase === "hypertrophy" ? 150 : 100;
  return Math.min(delta, cap);
}

export function classifyMode(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): ModeClassification {
  const scs = computeSCS(entries, baselines);
  const ffmV = ffmVelocity14d(entries);
  const waistV = waistVelocity14d(entries);
  const sV = strengthVelocity14d(entries, baselines);
  const wV = weightVelocity14d(entries);

  const ffmVel = ffmV?.velocityLbPerWeek ?? null;
  const waistVel = waistV;
  const strengthPct = sV?.pctPerWeek ?? null;
  const weightVel = wV;

  const trainingPhase = detectTrainingPhase(entries, baselines);
  const waistWarning = detectWaistWarning(waistVel);
  const adaptation = classifyAdaptationStage(entries, baselines);

  const reasons: string[] = [];

  if (scs.total < 60) {
    const plateau = detectStrengthPlateau(entries, baselines, "UNCERTAIN");
    return {
      mode: "UNCERTAIN",
      label: "Uncertain",
      color: "#6B7280",
      confidence: scs.total,
      ffmVelocity: ffmVel,
      waistVelocity: waistVel,
      strengthVelocityPct: strengthPct,
      weightVelocity: weightVel,
      trainingPhase,
      waistWarning,
      strengthPlateau: plateau,
      adaptation,
      reasons: ["Insufficient measurement confidence (SCS < 60)", "Log more frequently: FFM 4x/wk, waist 3x/wk, strength 2x/wk"],
      calorieAction: { delta: 0, reason: "Hold calories — need more data", priority: "low" },
    };
  }

  const isLeanBulk =
    ffmVel != null && ffmVel >= 0.25 &&
    (waistVel == null || waistVel >= -0.05) &&
    (strengthPct == null || strengthPct >= 0.25);

  if (isLeanBulk && scs.total >= 65) {
    reasons.push("FFM rising ≥0.25 lb/wk");
    if (waistVel != null) reasons.push(`Waist ${waistVel >= 0 ? "stable/rising" : "slightly down"}`);
    if (strengthPct != null && strengthPct >= 0.25) reasons.push("Strength trending up");

    const plateau = detectStrengthPlateau(entries, baselines, "LEAN_BULK");
    let calorieAction: CalorieAction;

    if (plateau.flagged && waistWarning.active) {
      calorieAction = { delta: -100, reason: "Plateau + waist rising — reduce calories", priority: "high" };
    } else if (plateau.flagged) {
      calorieAction = { delta: 0, reason: "Surplus not productive — hold calories, improve overload", priority: "high" };
    } else if (weightVel != null && weightVel < 0.25) {
      const raw = trainingPhase === "hypertrophy" ? 150 : 100;
      calorieAction = { delta: capCalorieDelta(raw, trainingPhase, weightVel), reason: "Weight gain below target — add calories", priority: "medium" };
    } else if (weightVel != null && weightVel > 0.75) {
      calorieAction = { delta: -100, reason: "Weight gain too fast — reduce calories", priority: "medium" };
    } else if (waistWarning.active && (strengthPct == null || strengthPct < 0.25)) {
      calorieAction = { delta: 0, reason: "Waist rising quickly without strength gains — hold", priority: "high" };
    } else {
      calorieAction = { delta: 0, reason: "On track — maintain current intake", priority: "low" };
    }

    return {
      mode: "LEAN_BULK",
      label: "Lean Bulk",
      color: "#34D399",
      confidence: scs.total,
      ffmVelocity: ffmVel, waistVelocity: waistVel, strengthVelocityPct: strengthPct, weightVelocity: weightVel,
      trainingPhase, waistWarning, strengthPlateau: plateau, adaptation,
      reasons,
      calorieAction,
    };
  }

  const isRecomp =
    (ffmVel == null || ffmVel >= -0.05) &&
    waistVel != null && waistVel <= -0.10 &&
    (strengthPct == null || strengthPct >= 0);

  if (isRecomp && scs.total >= 60) {
    reasons.push("Waist decreasing ≥0.10 in/wk");
    if (ffmVel != null) reasons.push(`FFM ${ffmVel >= 0 ? "stable/rising" : "slightly down"}`);
    if (strengthPct != null && strengthPct >= 0) reasons.push("Strength holding or rising");

    const plateau = detectStrengthPlateau(entries, baselines, "RECOMP");
    let calorieAction: CalorieAction;

    if (plateau.flagged && waistWarning.active) {
      calorieAction = { delta: -100, reason: "Plateau + waist rising — reduce calories", priority: "high" };
    } else if (plateau.flagged) {
      calorieAction = { delta: 0, reason: "Surplus not productive — hold calories, improve overload", priority: "high" };
    } else if (strengthPct != null && strengthPct > 0 && (waistVel <= -0.10)) {
      calorieAction = { delta: capCalorieDelta(50, trainingPhase, weightVel), reason: "Recomp fuel — strength rising + waist dropping", priority: "low" };
    } else if (ffmVel != null && ffmVel < -0.15) {
      calorieAction = { delta: capCalorieDelta(75, trainingPhase, weightVel), reason: "Protect lean tissue — FFM declining", priority: "high" };
    } else {
      calorieAction = { delta: 0, reason: "Recomp on track — hold calories", priority: "low" };
    }

    return {
      mode: "RECOMP",
      label: "Recomp",
      color: "#FBBF24",
      confidence: scs.total,
      ffmVelocity: ffmVel, waistVelocity: waistVel, strengthVelocityPct: strengthPct, weightVelocity: weightVel,
      trainingPhase, waistWarning, strengthPlateau: plateau, adaptation,
      reasons,
      calorieAction,
    };
  }

  const isCut =
    waistVel != null && waistVel <= -0.10 &&
    ((weightVel != null && weightVel <= -0.5) ||
     (strengthPct != null && strengthPct <= -0.25 && ffmVel != null && ffmVel <= -0.25));

  if (isCut && scs.total >= 60) {
    reasons.push("Significant fat loss detected");
    if (weightVel != null && weightVel <= -0.5) reasons.push(`Weight dropping ${Math.abs(weightVel).toFixed(2)} lb/wk`);
    if (strengthPct != null && strengthPct <= -0.25) reasons.push("Strength declining — may be too aggressive");

    const plateau = detectStrengthPlateau(entries, baselines, "CUT");
    let calorieAction: CalorieAction;
    if (plateau.flagged && waistWarning.active) {
      calorieAction = { delta: -100, reason: "Plateau + waist rising — reduce calories", priority: "high" };
    } else if (plateau.flagged) {
      calorieAction = { delta: 0, reason: "Surplus not productive — hold calories, improve overload", priority: "high" };
    } else if (strengthPct != null && strengthPct <= -0.25 && ffmVel != null && ffmVel <= -0.15) {
      calorieAction = { delta: capCalorieDelta(100, trainingPhase, weightVel), reason: "Lean tissue at risk — add calories or reduce volume", priority: "high" };
    } else if (waistVel != null && Math.abs(waistVel) < 0.05) {
      calorieAction = { delta: -100, reason: "Fat loss stalled — reduce calories slightly", priority: "medium" };
    } else {
      calorieAction = { delta: 0, reason: "Cut progressing — maintain", priority: "low" };
    }

    return {
      mode: "CUT",
      label: "Cut",
      color: "#F87171",
      confidence: scs.total,
      ffmVelocity: ffmVel, waistVelocity: waistVel, strengthVelocityPct: strengthPct, weightVelocity: weightVel,
      trainingPhase, waistWarning, strengthPlateau: plateau, adaptation,
      reasons,
      calorieAction,
    };
  }

  const fallbackPlateau = detectStrengthPlateau(entries, baselines, "UNCERTAIN");
  reasons.push("Signals don't clearly match any single mode");
  if (ffmVel != null) reasons.push(`FFM: ${ffmVel >= 0 ? "+" : ""}${ffmVel.toFixed(2)} lb/wk`);
  if (waistVel != null) reasons.push(`Waist: ${waistVel >= 0 ? "+" : ""}${waistVel.toFixed(2)} in/wk`);
  if (strengthPct != null) reasons.push(`Strength: ${strengthPct >= 0 ? "+" : ""}${strengthPct.toFixed(2)}%/wk`);

  let fallbackAction: CalorieAction;
  if (fallbackPlateau.flagged && waistWarning.active) {
    fallbackAction = { delta: -100, reason: "Plateau + waist rising — reduce calories", priority: "high" };
  } else if (fallbackPlateau.flagged) {
    fallbackAction = { delta: 0, reason: "Surplus not productive — hold calories", priority: "high" };
  } else {
    fallbackAction = { delta: 0, reason: "Hold calories — conflicting signals", priority: "low" };
  }

  return {
    mode: "UNCERTAIN",
    label: "Uncertain",
    color: "#6B7280",
    confidence: scs.total,
    ffmVelocity: ffmVel, waistVelocity: waistVel, strengthVelocityPct: strengthPct, weightVelocity: weightVel,
    trainingPhase, waistWarning, strengthPlateau: fallbackPlateau, adaptation,
    reasons,
    calorieAction: fallbackAction,
  };
}

export { waistVelocity14d };
