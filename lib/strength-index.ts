import type { DailyEntry } from "./coaching-engine";
import { ffmVelocity14d } from "./coaching-engine";

export interface StrengthBaselines {
  pushups: number | null;
  pullups: number | null;
  benchBarReps: number | null;
  ohpBarReps: number | null;
}

export interface StrengthIndexDay {
  day: string;
  pushupRatio: number | null;
  pullupRatio: number | null;
  benchRatio: number | null;
  ohpRatio: number | null;
  upperPushScore: number | null;
  upperPullScore: number | null;
  strengthIndexRaw: number | null;
}

export interface StrengthVelocityResult {
  velocity7dPerWeek: number;
  si7dToday: number;
  si7d14dAgo: number;
  spanDays: number;
  totalSpanDays: number;
  label: string;
  pctPerWeek: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function epley1RM(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

export function computeExerciseRatio(
  todayReps: number | undefined | null,
  todayWeight: number | undefined | null,
  baselineValue: number | null,
  baselineType: "reps" | "e1rm" = "reps",
): number | null {
  if (todayReps == null || baselineValue == null || baselineValue <= 0) return null;

  if (todayWeight != null && todayWeight > 0) {
    const e1rm = epley1RM(todayWeight, todayReps);
    if (baselineType === "e1rm") {
      return clamp(e1rm / baselineValue, 0.5, 2.0);
    }
    const baselineE1rm = epley1RM(45, baselineValue);
    return clamp(e1rm / baselineE1rm, 0.5, 2.0);
  }

  return clamp(todayReps / baselineValue, 0.5, 1.5);
}

export function computeDayStrengthIndex(
  entry: DailyEntry,
  baselines: StrengthBaselines,
): StrengthIndexDay {
  const pushupRatio = computeExerciseRatio(entry.pushupsReps, null, baselines.pushups);
  const pullupRatio = computeExerciseRatio(entry.pullupsReps, null, baselines.pullups);
  const benchRatio = computeExerciseRatio(entry.benchReps, entry.benchWeightLb, baselines.benchBarReps);
  const ohpRatio = computeExerciseRatio(entry.ohpReps, entry.ohpWeightLb, baselines.ohpBarReps);

  let upperPushScore: number | null = null;
  const pushParts: { ratio: number; weight: number }[] = [];
  if (pushupRatio != null) pushParts.push({ ratio: pushupRatio, weight: 0.4 });
  if (benchRatio != null) pushParts.push({ ratio: benchRatio, weight: 0.35 });
  if (ohpRatio != null) pushParts.push({ ratio: ohpRatio, weight: 0.25 });

  if (pushParts.length > 0) {
    const totalW = pushParts.reduce((s, p) => s + p.weight, 0);
    upperPushScore = pushParts.reduce((s, p) => s + p.ratio * (p.weight / totalW), 0);
  }

  const upperPullScore = pullupRatio;

  let strengthIndexRaw: number | null = null;
  if (upperPushScore != null && upperPullScore != null) {
    strengthIndexRaw = upperPushScore * 0.6 + upperPullScore * 0.4;
  } else if (upperPushScore != null) {
    strengthIndexRaw = upperPushScore;
  } else if (upperPullScore != null) {
    strengthIndexRaw = upperPullScore;
  }

  return {
    day: entry.day,
    pushupRatio,
    pullupRatio,
    benchRatio,
    ohpRatio,
    upperPushScore,
    upperPullScore,
    strengthIndexRaw,
  };
}

export function strengthIndexRollingAvg(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
  days: number = 7,
): Array<{ day: string; avg: number }> {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const siDays = sorted
    .map((e) => computeDayStrengthIndex(e, baselines))
    .filter((s): s is StrengthIndexDay & { strengthIndexRaw: number } => s.strengthIndexRaw != null)
    .map((s) => ({ date: parseDate(s.day), si: s.strengthIndexRaw, day: s.day }));

  const out: Array<{ day: string; avg: number }> = [];

  for (let i = 0; i < siDays.length; i++) {
    const di = siDays[i].date;
    const window = siDays.filter((w) => {
      const diff = daysBetween(w.date, di);
      return diff >= 0 && diff < days;
    });
    if (window.length >= Math.min(days, 2)) {
      const avg = window.reduce((s, w) => s + w.si, 0) / window.length;
      out.push({ day: siDays[i].day, avg: Math.round(avg * 10000) / 10000 });
    }
  }
  return out;
}

export function strengthVelocity14d(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): StrengthVelocityResult | null {
  const ra = strengthIndexRollingAvg(entries, baselines, 7);
  if (ra.length < 2) return null;

  const today = ra[ra.length - 1];
  const todayDate = parseDate(today.day);

  let best: { day: string; avg: number } | null = null;
  for (let i = ra.length - 2; i >= 0; i--) {
    const d = parseDate(ra[i].day);
    const span = daysBetween(d, todayDate);
    if (span >= 10 && span <= 18) {
      best = ra[i];
      break;
    }
  }
  if (!best) {
    for (let i = ra.length - 2; i >= 0; i--) {
      const d = parseDate(ra[i].day);
      const span = daysBetween(d, todayDate);
      if (span >= 7) {
        best = ra[i];
        break;
      }
    }
  }
  if (!best) return null;

  const spanDays = daysBetween(parseDate(best.day), todayDate);
  if (spanDays < 7) return null;

  const totalSpanDays = daysBetween(parseDate(ra[0].day), todayDate);

  const velocity7dPerWeek = ((today.avg - best.avg) / spanDays) * 7;
  const pctPerWeek = best.avg > 0 ? (velocity7dPerWeek / best.avg) * 100 : 0;

  let label: string;
  if (pctPerWeek >= 2.0) label = "Strong neural improvement";
  else if (pctPerWeek >= 1.0) label = "Strength improving";
  else if (pctPerWeek >= 0.25) label = "Strength trending up";
  else if (pctPerWeek > -0.25) label = "Strength stable";
  else if (pctPerWeek > -1.0) label = "Strength declining";
  else label = "Significant strength loss";

  return {
    velocity7dPerWeek: Math.round(velocity7dPerWeek * 10000) / 10000,
    si7dToday: today.avg,
    si7d14dAgo: best.avg,
    spanDays,
    totalSpanDays,
    label,
    pctPerWeek: Math.round(pctPerWeek * 100) / 100,
  };
}

export function strengthVelocityOverTime(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): Array<{ day: string; pctPerWeek: number }> {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length < 14) return [];

  const out: Array<{ day: string; pctPerWeek: number }> = [];
  for (let i = 13; i < sorted.length; i++) {
    const window = sorted.slice(0, i + 1);
    const sv = strengthVelocity14d(window, baselines);
    if (sv != null) {
      out.push({ day: sorted[i].day, pctPerWeek: sv.pctPerWeek });
    }
  }
  return out;
}

export interface PhaseTransition {
  day: string;
  from: "neural" | "hypertrophy";
  to: "neural" | "hypertrophy";
}

export function detectPhaseTransitions(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): PhaseTransition[] {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length < 14) return [];

  const transitions: PhaseTransition[] = [];
  let phase: "neural" | "hypertrophy" = "neural";
  let hypertrophyStreak = 0;
  let revertStreak = 0;

  for (let i = 13; i < sorted.length; i++) {
    const window = sorted.slice(0, i + 1);
    const sV = strengthVelocity14d(window, baselines);
    const ffmV = ffmVelocity14d(window);
    const penalty = swapPenaltyMultiplier(window);

    if (phase === "neural") {
      const met =
        sV != null && sV.pctPerWeek >= 0.02 &&
        ffmV != null && ffmV.velocityLbPerWeek >= 0 &&
        penalty >= 0.90;
      if (met) { hypertrophyStreak++; } else { hypertrophyStreak = 0; }
      if (hypertrophyStreak >= 14) {
        phase = "hypertrophy";
        revertStreak = 0;
        transitions.push({ day: sorted[i].day, from: "neural", to: "hypertrophy" });
      }
    } else {
      const shouldRevert = sV != null && sV.pctPerWeek < 0;
      if (shouldRevert) { revertStreak++; } else { revertStreak = 0; }
      if (revertStreak >= 14) {
        phase = "neural";
        hypertrophyStreak = 0;
        transitions.push({ day: sorted[i].day, from: "hypertrophy", to: "neural" });
      }
    }
  }

  return transitions;
}

export function countSwapsInWindow(
  entries: DailyEntry[],
  windowDays: number = 14,
): number {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length < 2) return 0;

  const latestDate = parseDate(sorted[sorted.length - 1].day);
  const startDate = new Date(latestDate);
  startDate.setDate(startDate.getDate() - windowDays);

  const window = sorted.filter((e) => parseDate(e.day) >= startDate);
  let swaps = 0;

  const hasExercise = (e: DailyEntry, ex: "bench" | "ohp") => {
    if (ex === "bench") return e.benchReps != null;
    return e.ohpReps != null;
  };

  const hasWeight = (e: DailyEntry, ex: "bench" | "ohp") => {
    if (ex === "bench") return (e.benchWeightLb ?? 0) > 45;
    return (e.ohpWeightLb ?? 0) > 45;
  };

  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const curr = window[i];
    if (hasExercise(prev, "bench") && hasExercise(curr, "bench")) {
      if (hasWeight(prev, "bench") !== hasWeight(curr, "bench")) swaps++;
    }
    if (hasExercise(prev, "ohp") && hasExercise(curr, "ohp")) {
      if (hasWeight(prev, "ohp") !== hasWeight(curr, "ohp")) swaps++;
    }
  }

  return swaps;
}

export function swapPenaltyMultiplier(entries: DailyEntry[]): number {
  const swapCount = countSwapsInWindow(entries, 14);
  return Math.max(0.7, 1 - swapCount * 0.1);
}

export function adjustedStrengthIndex(
  entries: DailyEntry[],
  baselines: StrengthBaselines,
): number | null {
  const ra = strengthIndexRollingAvg(entries, baselines, 7);
  if (ra.length === 0) return null;
  const latest = ra[ra.length - 1].avg;
  const penalty = swapPenaltyMultiplier(entries);
  return Math.round(latest * penalty * 10000) / 10000;
}

export function computeBaselinesFromEntries(
  entries: DailyEntry[],
  maxDays: number = 7,
): StrengthBaselines {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day)).slice(0, maxDays);

  const avg = (vals: number[]) => vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;

  const pushups = avg(sorted.filter((e) => e.pushupsReps != null).map((e) => e.pushupsReps!));
  const pullups = avg(sorted.filter((e) => e.pullupsReps != null).map((e) => e.pullupsReps!));
  const benchBarReps = avg(sorted.filter((e) => e.benchReps != null && (e.benchWeightLb == null || e.benchWeightLb <= 45)).map((e) => e.benchReps!));
  const ohpBarReps = avg(sorted.filter((e) => e.ohpReps != null && (e.ohpWeightLb == null || e.ohpWeightLb <= 45)).map((e) => e.ohpReps!));

  return {
    pushups: pushups != null ? Math.round(pushups * 10) / 10 : null,
    pullups: pullups != null ? Math.round(pullups * 10) / 10 : null,
    benchBarReps: benchBarReps != null ? Math.round(benchBarReps * 10) / 10 : null,
    ohpBarReps: ohpBarReps != null ? Math.round(ohpBarReps * 10) / 10 : null,
  };
}
