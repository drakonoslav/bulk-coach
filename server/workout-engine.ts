import { pool } from "./db";

export const DEFAULT_USER_ID = 'local_default';

export type MuscleGroup =
  | "chest_upper" | "chest_mid" | "chest_lower"
  | "back_lats" | "back_upper" | "back_mid"
  | "delts_front" | "delts_side" | "delts_rear"
  | "biceps" | "triceps"
  | "quads" | "hamstrings" | "glutes"
  | "calves" | "abs" | "neck";

export const ALL_MUSCLE_GROUPS: MuscleGroup[] = [
  "chest_upper", "chest_mid", "chest_lower",
  "back_lats", "back_upper", "back_mid",
  "delts_front", "delts_side", "delts_rear",
  "biceps", "triceps",
  "quads", "hamstrings", "glutes",
  "calves", "abs", "neck",
];

export type WorkoutPhase = "COMPOUND" | "ISOLATION";

export type WorkoutEventType =
  | "SESSION_START"
  | "PHASE_SET"
  | "SET_COMPLETE"
  | "REST_START"
  | "REST_END"
  | "SESSION_END";

export interface WorkoutEvent {
  t: number;
  type: WorkoutEventType;
  phase?: WorkoutPhase;
  muscle?: MuscleGroup;
  rpe?: number;
  isCompound?: boolean;
}

export interface WorkoutState {
  session_id: string;
  phase: WorkoutPhase;
  cbpStart: number;
  cbpCurrent: number;
  strainPoints: number;
  compoundSets: number;
  isolationSets: number;
  setLog: SetLogEntry[];
  lastHr?: number;
  phaseTransitionReason?: string;
}

export interface SetLogEntry {
  t: number;
  muscle: MuscleGroup;
  isCompound: boolean;
  rpe: number | null;
  drain: number;
  cbpAfter: number;
}

export function compoundBudgetPoints(readinessScore: number): number {
  return Math.round(Math.pow(readinessScore / 100, 1.4) * 100);
}

export function initWorkoutState(sessionId: string, readinessScore: number): WorkoutState {
  const cbp = compoundBudgetPoints(readinessScore);
  return {
    session_id: sessionId,
    phase: "COMPOUND",
    cbpStart: cbp,
    cbpCurrent: cbp,
    strainPoints: 0,
    compoundSets: 0,
    isolationSets: 0,
    setLog: [],
  };
}

export function drainForSet(isCompound: boolean, rpe?: number): number {
  const base = isCompound ? 8 : 3;
  const rpeAdj = rpe != null ? Math.max(0, rpe - 7) * (isCompound ? 2 : 1) : 0;
  return base + rpeAdj;
}

export function shouldSwitchToIsolation(s: WorkoutState): boolean {
  if (s.cbpCurrent <= 25) return true;
  if (s.compoundSets >= 8 && s.cbpCurrent <= 40) return true;
  return false;
}

export function applyEvent(s: WorkoutState, e: WorkoutEvent): WorkoutState {
  if (e.type === "PHASE_SET" && e.phase) {
    s.phase = e.phase;
    s.phaseTransitionReason = undefined;
    return s;
  }

  if (e.type === "SET_COMPLETE" && e.muscle) {
    const isCompound = e.isCompound ?? (s.phase === "COMPOUND");
    const drain = drainForSet(isCompound, e.rpe);
    const cbpBefore = s.cbpCurrent;

    s.strainPoints += drain;
    s.cbpCurrent = Math.max(0, s.cbpCurrent - drain);

    if (isCompound) s.compoundSets += 1;
    else s.isolationSets += 1;

    s.setLog.push({
      t: e.t,
      muscle: e.muscle,
      isCompound,
      rpe: e.rpe ?? null,
      drain,
      cbpAfter: s.cbpCurrent,
    });

    if (s.phase === "COMPOUND" && shouldSwitchToIsolation(s)) {
      s.phase = "ISOLATION";
      if (s.cbpCurrent <= 25) {
        s.phaseTransitionReason = "Compound budget depleted";
      } else {
        s.phaseTransitionReason = "Compound budget waning after 8+ sets";
      }
    }

    return s;
  }

  return s;
}

export async function persistWorkoutEvent(
  sessionId: string,
  event: WorkoutEvent,
  cbpBefore: number,
  cbpAfter: number,
  drain: number,
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  await pool.query(
    `INSERT INTO workout_events
       (session_id, user_id, t, event_type, phase, muscle, rpe, is_compound, cbp_before, cbp_after, drain)
     VALUES ($1, $2, to_timestamp($3/1000.0), $4, $5, $6, $7, $8, $9, $10, $11)`,
    [sessionId, userId, event.t, event.type, event.phase || null,
     event.muscle || null, event.rpe || null, event.isCompound ?? null,
     cbpBefore, cbpAfter, drain]
  );
}

export async function getWorkoutEvents(sessionId: string, userId: string = DEFAULT_USER_ID): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workout_events WHERE session_id = $1 AND user_id = $2 ORDER BY t ASC`,
    [sessionId, userId]
  );
  return rows;
}
