import type { StrengthSet } from "./entry-storage";

export interface MuscleGroupRow {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface ExerciseMuscleWeightRow {
  exercise_id: string;
  muscle_id: string;
  weight_pct: number;
  role?: string | null;
  version?: number;
  active?: boolean;
}

export interface StrengthV2Mapping {
  muscles: MuscleGroupRow[];
  weights: ExerciseMuscleWeightRow[];
}

export interface MuscleIndexDay {
  day: string;
  muscleId: string;
  muscleName: string;
  index: number;
  confidence: number;
  quantCount: number;
}

export interface GlobalStrengthIndexDay {
  day: string;
  index: number;
  confidence: number;
}

export interface StrengthVelocityResultV2 {
  velocity7dPerWeek: number;
  si7dToday: number;
  si7d14dAgo: number;
  spanDays: number;
  totalSpanDays: number;
  label: string;
  pctPerWeek: number;
}

const NOISE_FLOOR_PCT = 0.25;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

function epley1RM(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function setPerf(s: StrengthSet): number | null {
  if (s.seconds != null && s.weightLb != null && s.weightLb > 0 && s.seconds > 0) {
    return s.weightLb * s.seconds;
  }
  if (s.weightLb != null && s.reps != null && s.weightLb > 0 && s.reps > 0) {
    const rir = s.rir != null ? clamp(s.rir, 0, 4) : 0;
    const effectiveReps = s.reps + rir;
    return epley1RM(s.weightLb, effectiveReps);
  }
  if (s.reps != null && s.reps > 0) return s.reps;
  return null;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function groupBestPerfByDayExercise(sets: StrengthSet[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of sets) {
    const perf = setPerf(s);
    if (perf == null || perf <= 0) continue;
    const day = s.day;
    const ex = s.exerciseId;

    if (!out.has(day)) out.set(day, new Map());
    const m = out.get(day)!;
    const prev = m.get(ex);
    if (prev == null || perf > prev) m.set(ex, perf);
  }
  return out;
}

function computeExerciseBaselines(
  bestByDay: Map<string, Map<string, number>>,
  exposuresNeeded: number = 3,
): Map<string, number> {
  const days = [...bestByDay.keys()].sort((a, b) => a.localeCompare(b));
  const perExercise: Record<string, number[]> = {};

  for (const day of days) {
    const exMap = bestByDay.get(day)!;
    for (const [exId, perf] of exMap.entries()) {
      if (!perExercise[exId]) perExercise[exId] = [];
      if (perExercise[exId].length < exposuresNeeded) {
        perExercise[exId].push(perf);
      }
    }
  }

  const baselines = new Map<string, number>();
  for (const exId of Object.keys(perExercise)) {
    const vals = perExercise[exId];
    if (vals.length >= Math.min(2, exposuresNeeded)) {
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      baselines.set(exId, avg);
    }
  }
  return baselines;
}

function buildMuscleNameMap(mapping: StrengthV2Mapping): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of mapping.muscles) m.set(row.id, row.name);
  return m;
}

function buildWeightsByExercise(mapping: StrengthV2Mapping): Map<string, Array<{ muscleId: string; w: number }>> {
  const out = new Map<string, Array<{ muscleId: string; w: number }>>();
  for (const row of mapping.weights) {
    const exId = row.exercise_id;
    const muscleId = row.muscle_id;
    const w = Number(row.weight_pct);
    if (!out.has(exId)) out.set(exId, []);
    out.get(exId)!.push({ muscleId, w });
  }
  return out;
}

function computeQuantCount(
  windowDays: string[],
  bestByDay: Map<string, Map<string, number>>,
  weightsByEx: Map<string, Array<{ muscleId: string; w: number }>>,
  muscleId: string,
  minMeaningfulW: number = 0.15,
): number {
  const exercises: string[] = [];
  for (const d of windowDays) {
    const exMap = bestByDay.get(d);
    if (!exMap) continue;
    for (const exId of exMap.keys()) {
      const wList = weightsByEx.get(exId) ?? [];
      const w = wList.find((x) => x.muscleId === muscleId)?.w ?? 0;
      if (w >= minMeaningfulW) exercises.push(exId);
    }
  }
  return uniq(exercises).length;
}

function computeAttributionSum(
  windowDays: string[],
  bestByDay: Map<string, Map<string, number>>,
  weightsByEx: Map<string, Array<{ muscleId: string; w: number }>>,
  muscleId: string,
): number {
  let sum = 0;
  const seen = new Set<string>();
  for (const d of windowDays) {
    const exMap = bestByDay.get(d);
    if (!exMap) continue;
    for (const exId of exMap.keys()) {
      if (seen.has(exId)) continue;
      seen.add(exId);
      const wList = weightsByEx.get(exId) ?? [];
      const w = wList.find((x) => x.muscleId === muscleId)?.w ?? 0;
      sum += w;
    }
  }
  return sum;
}

function computeConfidence(quantCount: number, attributionSum: number): number {
  const C_cov = clamp(quantCount / 3, 0, 1);
  const C_attr = clamp(attributionSum / 0.8, 0, 1);
  return Math.sqrt(C_cov * C_attr);
}

export function computeRegionalMuscleIndicesV2(
  sets: StrengthSet[],
  mapping: StrengthV2Mapping,
  windowDaysForConfidence: number = 21,
): MuscleIndexDay[] {
  const bestByDay = groupBestPerfByDayExercise(sets);
  const baselines = computeExerciseBaselines(bestByDay, 3);
  const muscleName = buildMuscleNameMap(mapping);
  const weightsByEx = buildWeightsByExercise(mapping);

  const days = [...bestByDay.keys()].sort((a, b) => a.localeCompare(b));
  const muscles = mapping.muscles.map((m) => m.id);

  const out: MuscleIndexDay[] = [];

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const dayDate = parseDate(day);

    const windowDays = days.filter((d) => {
      const diff = daysBetween(parseDate(d), dayDate);
      return diff >= 0 && diff < windowDaysForConfidence;
    });

    const exMap = bestByDay.get(day)!;
    const exIndex = new Map<string, number>();
    for (const [exId, perf] of exMap.entries()) {
      const base = baselines.get(exId);
      if (!base || base <= 0) continue;
      exIndex.set(exId, clamp(perf / base, 0.5, 2.0));
    }

    for (const muscleId of muscles) {
      let raw = 0;
      let any = false;

      for (const [exId, idx] of exIndex.entries()) {
        const wList = weightsByEx.get(exId) ?? [];
        const w = wList.find((x) => x.muscleId === muscleId)?.w ?? 0;
        if (w <= 0) continue;
        raw += idx * w;
        any = true;
      }

      if (!any) continue;

      const quantCount = computeQuantCount(windowDays, bestByDay, weightsByEx, muscleId, 0.15);
      const attrSum = computeAttributionSum(windowDays, bestByDay, weightsByEx, muscleId);
      const conf = computeConfidence(quantCount, attrSum);

      const index = 1.0 + conf * (raw - 1.0);

      out.push({
        day,
        muscleId,
        muscleName: muscleName.get(muscleId) ?? muscleId,
        index: Math.round(index * 10000) / 10000,
        confidence: Math.round(conf * 1000) / 1000,
        quantCount,
      });
    }
  }

  return out;
}

export function computeGlobalStrengthIndexV2(
  sets: StrengthSet[],
  mapping: StrengthV2Mapping,
): GlobalStrengthIndexDay[] {
  const regional = computeRegionalMuscleIndicesV2(sets, mapping, 21);

  const byDay = new Map<string, MuscleIndexDay[]>();
  for (const r of regional) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day)!.push(r);
  }

  const GLOBAL_MUSCLES: Array<{ id: string; importance: number }> = [
    { id: "quads", importance: 1.2 },
    { id: "hamstrings", importance: 1.2 },
    { id: "glutes", importance: 1.2 },
    { id: "calves", importance: 0.6 },
    { id: "adductors", importance: 0.6 },
    { id: "shins", importance: 0.3 },
    { id: "chest", importance: 1.0 },
    { id: "triceps", importance: 0.8 },
    { id: "front_delt", importance: 0.8 },
    { id: "lateral_delt", importance: 0.7 },
    { id: "lats", importance: 1.0 },
    { id: "middle_back", importance: 0.9 },
    { id: "rear_delt", importance: 0.7 },
    { id: "biceps", importance: 0.6 },
    { id: "forearms", importance: 0.4 },
    { id: "abs", importance: 0.6 },
    { id: "lower_back", importance: 0.6 },
    { id: "obliques", importance: 0.4 },
    { id: "upper_traps", importance: 0.5 },
    { id: "mid_traps", importance: 0.5 },
    { id: "lower_traps", importance: 0.5 },
  ];

  const global: GlobalStrengthIndexDay[] = [];

  for (const [day, arr] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let num = 0;
    let den = 0;
    let confNum = 0;
    let confDen = 0;

    for (const gm of GLOBAL_MUSCLES) {
      const row = arr.find((x) => x.muscleId === gm.id);
      if (!row) continue;

      const w = gm.importance * clamp(row.confidence, 0, 1);
      if (w <= 0) continue;

      num += row.index * w;
      den += w;

      confNum += row.confidence * gm.importance;
      confDen += gm.importance;
    }

    if (den <= 0) continue;

    const idx = num / den;
    const conf = confDen > 0 ? confNum / confDen : 0;

    global.push({
      day,
      index: Math.round(idx * 10000) / 10000,
      confidence: Math.round(conf * 1000) / 1000,
    });
  }

  return global;
}

export function strengthIndexRollingAvgV2(
  global: GlobalStrengthIndexDay[],
  days: number = 7,
): Array<{ day: string; avg: number }> {
  const sorted = [...global].sort((a, b) => a.day.localeCompare(b.day));
  const siDays = sorted.map((g) => ({ day: g.day, date: parseDate(g.day), si: g.index }));

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

export function strengthVelocity14dV2(
  global: GlobalStrengthIndexDay[],
): StrengthVelocityResultV2 | null {
  const ra = strengthIndexRollingAvgV2(global, 7);
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
  const withinNoise = Math.abs(pctPerWeek) < NOISE_FLOOR_PCT;
  if (pctPerWeek >= 2.0) label = "Strength improving";
  else if (pctPerWeek >= 0.25) label = "Strength trending up";
  else if (withinNoise) label = "Strength stable";
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

export function strengthVelocityOverTimeV2(
  global: GlobalStrengthIndexDay[],
): Array<{ day: string; pctPerWeek: number }> {
  const sorted = [...global].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length < 14) return [];

  const out: Array<{ day: string; pctPerWeek: number }> = [];
  for (let i = 13; i < sorted.length; i++) {
    const window = sorted.slice(0, i + 1);
    const sv = strengthVelocity14dV2(window);
    if (sv != null) out.push({ day: sorted[i].day, pctPerWeek: sv.pctPerWeek });
  }
  return out;
}
