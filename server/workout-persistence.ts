import { Pool } from "pg";
import { toUTCDateString } from "./validation";
import {
  fireIntelLogSet,
  fireIntelExerciseLogSet,
  fireIntelSessionClose,
  gameKeyToIntelTargets,
  resolveSetIntent,
} from "./intel-writer";

export interface SessionDayInfo {
  day: string;
  timezone: string | null;
}

export async function resolveSessionDayInfo(
  pool: Pool,
  sessionId: string,
  userId: string,
): Promise<SessionDayInfo> {
  const r = await pool.query(
    `SELECT date, start_ts, timezone FROM workout_session WHERE session_id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId],
  );
  if (r.rowCount === 0) {
    throw new Error(`workout_session not found: ${sessionId}`);
  }
  const row = r.rows[0];
  const dateVal = typeof row.date === "string" ? row.date : (row.date as Date).toISOString().slice(0, 10);
  return { day: dateVal, timezone: row.timezone ?? null };
}

export async function resolveSessionDay(
  pool: Pool,
  sessionId: string,
  userId: string,
): Promise<string> {
  const info = await resolveSessionDayInfo(pool, sessionId, userId);
  return info.day;
}

function utcToLocalHHMM(isoTs: string, tz: string | null): string {
  try {
    const d = new Date(isoTs);
    if (isNaN(d.getTime())) return isoTs;
    const zone = tz || "UTC";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const h = parts.find(p => p.type === "hour")?.value ?? "00";
    const m = parts.find(p => p.type === "minute")?.value ?? "00";
    return `${h}:${m}`;
  } catch {
    return isoTs;
  }
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

  let sessionInfo: SessionDayInfo;
  try {
    sessionInfo = await resolveSessionDayInfo(pool, input.sessionId, input.userId);
  } catch (err: any) {
    console.error(`${tag} ABORT: ${err.message}`);
    return;
  }
  const day = sessionInfo.day;
  const sessionTz = sessionInfo.timezone;

  console.log(`${tag} resolved day=${day} tz=${sessionTz} from workout_session row for session=${input.sessionId}`);

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
      const localStartTime = utcToLocalHHMM(input.startTs, sessionTz);
      const localEndTime = utcToLocalHHMM(input.endTs, sessionTz);

      console.log(`${tag} DAILY_LOG MERGE DISABLED — would write: day=${day} start=${localStartTime} end=${localEndTime} lift_min=${durationMin} (tz=${sessionTz})`);

      try {
        const r = await pool.query(
          `INSERT INTO daily_log (user_id, day, lift_done)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (user_id, day) DO UPDATE SET
             lift_done = TRUE,
             updated_at = NOW()`,
          [input.userId, day],
        );
        console.log(`${tag} daily_log lift_done=true OK: day=${day} rows=${r.rowCount}`);
      } catch (err: any) {
        console.error(`${tag} daily_log lift_done ERROR: ${err.message}`);
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
