import { Pool } from "pg";
import { toUTCDateString } from "./validation";
import {
  fireIntelLogSet,
  fireIntelExerciseLogSet,
  fireIntelSessionClose,
  gameKeyToIntelTargets,
  resolveSetIntent,
} from "./intel-writer";

export async function resolveSessionDay(
  pool: Pool,
  sessionId: string,
  userId: string,
): Promise<string> {
  const r = await pool.query(
    `SELECT date, start_ts, timezone FROM workout_session WHERE session_id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId],
  );
  if (r.rowCount === 0) {
    throw new Error(`workout_session not found: ${sessionId}`);
  }
  const row = r.rows[0];
  const dateVal = typeof row.date === "string" ? row.date : (row.date as Date).toISOString().slice(0, 10);
  return dateVal;
}

export type WorkoutWriteInput =
  | {
      kind: "bridge_set";
      eventId: string;
      sessionId: string;
      userId: string;
      muscle: string;
      isCompound: boolean;
      rpe: number | null;
      phase: string;
    }
  | {
      kind: "exercise_set";
      eventId: string;
      sessionId: string;
      userId: string;
      muscle: string;
      exerciseId: number;
      weight: number;
      reps: number;
      isCompound: boolean;
      rpe: number | null;
    }
  | {
      kind: "session_close";
      sessionId: string;
      userId: string;
      startTs: string;
      endTs: string;
      durationMinutes: number | null;
      workingMinutes: number | null;
    };

export async function persistWorkoutDerivedState(
  pool: Pool,
  input: WorkoutWriteInput,
): Promise<void> {
  const tag = `[workout-persist:${input.kind}]`;

  let day: string;
  try {
    day = await resolveSessionDay(pool, input.sessionId, input.userId);
  } catch (err: any) {
    console.error(`${tag} ABORT: ${err.message}`);
    return;
  }

  console.log(`${tag} resolved day=${day} from workout_session row for session=${input.sessionId}`);

  switch (input.kind) {
    case "bridge_set": {
      const intent = resolveSetIntent(input.muscle, input.isCompound);

      try {
        const r = await pool.query(
          `INSERT INTO daily_game_bridge_entries (id, user_id, day, session_id, muscle, movement_type, rpe, estimated_tonnage, phase, is_compound)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [input.eventId, input.userId, day, input.sessionId, input.muscle, intent.movementType, input.rpe, intent.estimatedTonnage, input.phase, input.isCompound],
        );
        console.log(`${tag} bridge OK: id=${input.eventId} day=${day} muscle=${input.muscle} rows=${r.rowCount}`);
      } catch (err: any) {
        console.error(`${tag} bridge ERROR: ${err.message}`);
      }

      const intelTargets = gameKeyToIntelTargets(input.muscle);
      if (intelTargets.length > 0) {
        fireIntelLogSet({
          event_id: input.eventId,
          session_id: input.sessionId,
          muscle_targets: intelTargets,
          movement_type: intent.movementType,
          rpe: input.rpe,
          performed_at: day,
          estimated_tonnage: intent.estimatedTonnage,
        }).catch(() => {});
      }
      break;
    }

    case "exercise_set": {
      try {
        const r = await pool.query(
          `WITH resolved AS (
             SELECT local_exercise_id FROM intel_exercise_mapping
             WHERE intel_exercise_id = $4 AND mapped = true
           )
           INSERT INTO strength_sets (id, user_id, day, exercise_id, weight_lb, reps, set_type, is_measured, source)
           SELECT $1, $2, $3, r.local_exercise_id, $5, $6, 'top', TRUE, 'workout_game'
           FROM resolved r
           ON CONFLICT (id) DO NOTHING`,
          [input.eventId, input.userId, day, input.exerciseId, input.weight, input.reps],
        );
        if (r.rowCount === 0) {
          console.log(`${tag} strength_sets SKIP: intel_exercise_id=${input.exerciseId} unmapped or duplicate, day=${day}`);
        } else {
          console.log(`${tag} strength_sets OK: id=${input.eventId} intel=${input.exerciseId} → local, day=${day} ${input.weight}×${input.reps}`);
        }
      } catch (err: any) {
        console.error(`${tag} strength_sets ERROR: ${err.message}`);
      }

      fireIntelExerciseLogSet({
        event_id: input.eventId,
        session_id: input.sessionId,
        exercise_id: input.exerciseId,
        weight: input.weight,
        reps: input.reps,
        performed_at: day,
        source: "expo_bulkcoach",
      }).catch(() => {});
      break;
    }

    case "session_close": {
      const durationMin = Math.round(input.durationMinutes ?? 0);
      const workingMin = input.workingMinutes != null ? Math.round(input.workingMinutes) : null;

      try {
        const r = await pool.query(
          `INSERT INTO daily_log (user_id, day, lift_done, lift_start_time, lift_end_time, lift_min, lift_working_min)
           VALUES ($1, $2, TRUE, $3, $4, $5, $6)
           ON CONFLICT (user_id, day) DO UPDATE SET
             lift_done = TRUE,
             lift_start_time = COALESCE(LEAST(daily_log.lift_start_time, EXCLUDED.lift_start_time), EXCLUDED.lift_start_time, daily_log.lift_start_time),
             lift_end_time = COALESCE(GREATEST(daily_log.lift_end_time, EXCLUDED.lift_end_time), EXCLUDED.lift_end_time, daily_log.lift_end_time),
             lift_min = COALESCE(daily_log.lift_min, 0) + COALESCE(EXCLUDED.lift_min, 0),
             lift_working_min = CASE
               WHEN EXCLUDED.lift_working_min IS NULL THEN daily_log.lift_working_min
               ELSE COALESCE(daily_log.lift_working_min, 0) + EXCLUDED.lift_working_min
             END,
             updated_at = NOW()`,
          [input.userId, day, input.startTs, input.endTs, durationMin, workingMin],
        );
        console.log(`${tag} daily_log merge OK: day=${day} lift_min=${durationMin} working_min=${workingMin} rows=${r.rowCount}`);
      } catch (err: any) {
        console.error(`${tag} daily_log merge ERROR: ${err.message}`);
      }

      fireIntelSessionClose({
        session_id: input.sessionId,
        started_at: input.startTs,
        ended_at: input.endTs,
      }).catch(() => {});
      break;
    }
  }
}

export async function getWorkoutSessionAudit(
  pool: Pool,
  sessionId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const [session, events, strengthSets, bridgeSets, dailyLog] = await Promise.all([
    pool.query(
      `SELECT session_id, date, start_ts, end_ts, workout_type, duration_minutes, source, timezone
       FROM workout_session WHERE session_id = $1 AND user_id = $2`,
      [sessionId, userId],
    ),
    pool.query(
      `SELECT event_type, muscle, cbp_before, cbp_after, drain, created_at
       FROM workout_events WHERE session_id = $1 AND user_id = $2 ORDER BY created_at`,
      [sessionId, userId],
    ),
    pool.query(
      `SELECT id, day, exercise_id, weight_lb, reps, source, created_at
       FROM strength_sets WHERE id LIKE $1 || '%' AND user_id = $2 ORDER BY created_at`,
      [sessionId + "_", userId],
    ),
    pool.query(
      `SELECT id, day, muscle, movement_type, rpe, is_compound, created_at
       FROM daily_game_bridge_entries WHERE session_id = $1 AND user_id = $2 ORDER BY created_at`,
      [sessionId, userId],
    ),
    pool.query(
      `SELECT day, lift_done, lift_min, lift_working_min, lift_start_time, lift_end_time
       FROM daily_log WHERE user_id = $2 AND day = (
         SELECT date FROM workout_session WHERE session_id = $1 AND user_id = $2 LIMIT 1
       )`,
      [sessionId, userId],
    ),
  ]);

  return {
    session: session.rows[0] || null,
    workout_events: events.rows,
    strength_sets: strengthSets.rows,
    bridge_sets: bridgeSets.rows,
    daily_log: dailyLog.rows[0] || null,
    summary: {
      session_exists: session.rowCount > 0,
      event_count: events.rowCount,
      strength_set_count: strengthSets.rowCount,
      bridge_set_count: bridgeSets.rowCount,
      daily_log_merged: dailyLog.rowCount > 0 && dailyLog.rows[0]?.lift_done === true,
    },
  };
}
