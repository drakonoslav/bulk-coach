import { pool } from "./db";
import type { MuscleGroup } from "./workout-engine";
import { ALL_MUSCLE_GROUPS } from "./workout-engine";

export type DayType = "PUSH" | "PULL" | "LEGS" | "FULL_BODY" | "UPPER" | "LOWER";

export interface ProgramContext {
  dayType: DayType;
  priority: MuscleGroup[];
  weeklyTargetSets: Partial<Record<MuscleGroup, number>>;
}

export const DEFAULT_WEEKLY_TARGETS: Record<MuscleGroup, number> = {
  chest_upper: 10, chest_mid: 8, chest_lower: 6,
  back_lats: 12, back_upper: 10, back_mid: 8,
  delts_front: 8, delts_side: 16, delts_rear: 14,
  biceps: 12, triceps: 12,
  quads: 12, hamstrings: 10, glutes: 10,
  calves: 8, abs: 8, neck: 4,
};

const LOW_SYSTEMIC: MuscleGroup[] = [
  "delts_front", "delts_side", "delts_rear",
  "biceps", "triceps",
  "calves", "abs", "neck",
];

const DAY_PRIMARY_MUSCLES: Record<DayType, MuscleGroup[]> = {
  PUSH: ["chest_upper", "chest_mid", "chest_lower", "delts_front", "delts_side", "triceps"],
  PULL: ["back_lats", "back_upper", "back_mid", "delts_rear", "biceps"],
  LEGS: ["quads", "hamstrings", "glutes", "calves"],
  UPPER: ["chest_upper", "chest_mid", "back_lats", "back_upper", "delts_side", "delts_rear", "biceps", "triceps"],
  LOWER: ["quads", "hamstrings", "glutes", "calves", "abs"],
  FULL_BODY: ALL_MUSCLE_GROUPS,
};

export function pickIsolationTargets(
  readinessScore: number,
  weekLoads: Partial<Record<MuscleGroup, number>>,
  ctx: ProgramContext,
  count: number = 3,
): MuscleGroup[] {
  const candidates = readinessScore < 60
    ? LOW_SYSTEMIC
    : (DAY_PRIMARY_MUSCLES[ctx.dayType] || ALL_MUSCLE_GROUPS);

  const scored = candidates.map(m => {
    const target = ctx.weeklyTargetSets[m] ?? DEFAULT_WEEKLY_TARGETS[m] ?? 0;
    const done = weekLoads[m] ?? 0;
    const deficit = target - done;
    const priorityBoost = ctx.priority.includes(m) ? 3 : 0;
    return { muscle: m, score: deficit + priorityBoost, deficit, target, done };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, count).map(x => x.muscle);
}

export function fallbackIsolation(dayType: DayType): MuscleGroup[] {
  if (dayType === "PUSH") return ["chest_upper", "delts_side", "triceps"];
  if (dayType === "PULL") return ["back_lats", "delts_rear", "biceps"];
  if (dayType === "LEGS") return ["hamstrings", "quads", "calves"];
  return ["delts_side", "back_lats", "calves"];
}

export function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export async function getWeeklyLoads(weekStart: string): Promise<Partial<Record<MuscleGroup, number>>> {
  const { rows } = await pool.query(
    `SELECT muscle, hard_sets FROM muscle_weekly_load WHERE week_start = $1`,
    [weekStart]
  );
  const result: Partial<Record<MuscleGroup, number>> = {};
  for (const r of rows) {
    result[r.muscle as MuscleGroup] = Number(r.hard_sets);
  }
  return result;
}

export async function incrementMuscleLoad(
  muscle: MuscleGroup,
  weekStart: string,
  sets: number = 1,
  isHard: boolean = true,
): Promise<void> {
  await pool.query(
    `INSERT INTO muscle_weekly_load (muscle, week_start, hard_sets, total_sets, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (muscle, week_start) DO UPDATE SET
       hard_sets = muscle_weekly_load.hard_sets + $3,
       total_sets = muscle_weekly_load.total_sets + $4,
       updated_at = NOW()`,
    [muscle, weekStart, isHard ? sets : 0, sets]
  );
}

export async function getWeeklyLoadSummary(weekStart: string): Promise<{
  loads: Partial<Record<MuscleGroup, { hard_sets: number; total_sets: number; target: number; deficit: number }>>;
  totalSets: number;
  musclesAtTarget: number;
  musclesBelowTarget: number;
}> {
  const { rows } = await pool.query(
    `SELECT muscle, hard_sets, total_sets FROM muscle_weekly_load WHERE week_start = $1`,
    [weekStart]
  );

  const loads: Partial<Record<MuscleGroup, { hard_sets: number; total_sets: number; target: number; deficit: number }>> = {};
  let totalSets = 0;
  let musclesAtTarget = 0;
  let musclesBelowTarget = 0;

  for (const m of ALL_MUSCLE_GROUPS) {
    const row = rows.find((r: any) => r.muscle === m);
    const hardSets = row ? Number(row.hard_sets) : 0;
    const totalS = row ? Number(row.total_sets) : 0;
    const target = DEFAULT_WEEKLY_TARGETS[m];
    const deficit = target - hardSets;

    loads[m] = { hard_sets: hardSets, total_sets: totalS, target, deficit };
    totalSets += totalS;

    if (deficit <= 0) musclesAtTarget++;
    else musclesBelowTarget++;
  }

  return { loads, totalSets, musclesAtTarget, musclesBelowTarget };
}
