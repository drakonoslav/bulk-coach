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

export const WORKOUT_RULES = {
  isolationSwitchAbsoluteCbp: 25,
  isolationSwitchAfterCompounds: 8,
  isolationSwitchWaningCbp: 40,

  baseDrainCompound: 8,
  baseDrainIsolation: 3,

  rpePenaltyStart: 7,
  rpePenaltyPerPointCompound: 2,
  rpePenaltyPerPointIsolation: 1,
} as const;

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
  const base = isCompound
    ? WORKOUT_RULES.baseDrainCompound
    : WORKOUT_RULES.baseDrainIsolation;
  const rpeAdj = rpe != null
    ? Math.max(0, rpe - WORKOUT_RULES.rpePenaltyStart) *
      (isCompound ? WORKOUT_RULES.rpePenaltyPerPointCompound : WORKOUT_RULES.rpePenaltyPerPointIsolation)
    : 0;
  return base + rpeAdj;
}

export function shouldSwitchToIsolation(s: WorkoutState): boolean {
  if (s.cbpCurrent <= WORKOUT_RULES.isolationSwitchAbsoluteCbp) return true;
  if (s.compoundSets >= WORKOUT_RULES.isolationSwitchAfterCompounds &&
      s.cbpCurrent <= WORKOUT_RULES.isolationSwitchWaningCbp) return true;
  return false;
}

export function applyEvent(s: WorkoutState, e: WorkoutEvent): WorkoutState {
  const next: WorkoutState = {
    ...s,
    setLog: [...s.setLog],
  };

  if (e.type === "PHASE_SET" && e.phase) {
    next.phase = e.phase;
    next.phaseTransitionReason = undefined;
    return next;
  }

  if (e.type === "SET_COMPLETE" && e.muscle) {
    const isCompound = e.isCompound ?? (next.phase === "COMPOUND");
    const drain = drainForSet(isCompound, e.rpe);

    next.strainPoints += drain;
    next.cbpCurrent = Math.max(0, next.cbpCurrent - drain);

    if (isCompound) next.compoundSets += 1;
    else next.isolationSets += 1;

    next.setLog.push({
      t: e.t,
      muscle: e.muscle,
      isCompound,
      rpe: e.rpe ?? null,
      drain,
      cbpAfter: next.cbpCurrent,
    });

    if (next.phase === "COMPOUND" && shouldSwitchToIsolation(next)) {
      next.phase = "ISOLATION";
      if (next.cbpCurrent <= WORKOUT_RULES.isolationSwitchAbsoluteCbp) {
        next.phaseTransitionReason = "Compound budget depleted";
      } else {
        next.phaseTransitionReason = "Compound budget waning after 8+ sets";
      }
    }

    return next;
  }

  return next;
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

export interface SessionSummary {
  totalStrain: number;
  avgRpe: number | null;
  compoundSets: number;
  isolationSets: number;
  finalCbp: number;
  musclesWorked: MuscleGroup[];
}

export function computeSessionSummary(
  initialReadiness: number,
  events: WorkoutEvent[]
): SessionSummary {
  let state = initWorkoutState("replay", initialReadiness);

  for (const e of events) {
    state = applyEvent(state, e);
  }

  const rpes = state.setLog
    .map(l => l.rpe)
    .filter((r): r is number => r != null);

  const avgRpe =
    rpes.length > 0
      ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10
      : null;

  return {
    totalStrain: state.strainPoints,
    avgRpe,
    compoundSets: state.compoundSets,
    isolationSets: state.isolationSets,
    finalCbp: state.cbpCurrent,
    musclesWorked: [...new Set(state.setLog.map(l => l.muscle))],
  };
}
