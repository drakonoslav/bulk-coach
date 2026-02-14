import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/query-client";

export type WorkoutPhase = "COMPOUND" | "ISOLATION";
export type MuscleGroup =
  | "chest_upper" | "chest_mid" | "chest_lower"
  | "back_lats" | "back_upper" | "back_mid"
  | "delts_front" | "delts_side" | "delts_rear"
  | "biceps" | "triceps"
  | "quads" | "hamstrings" | "glutes"
  | "calves" | "abs" | "neck";

export interface WorkoutState {
  session_id: string;
  start_ts: string;
  phase: WorkoutPhase;
  cbpStart: number;
  cbpCurrent: number;
  strainPoints: number;
  compoundSets: number;
  isolationSets: number;
}

export interface SetResult extends WorkoutState {
  phaseTransitionReason?: string;
}

export type EngineStatus = "idle" | "starting" | "active" | "logging" | "ending" | "finished" | "error";

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest_upper: "Upper Chest",
  chest_mid: "Mid Chest",
  chest_lower: "Lower Chest",
  back_lats: "Lats",
  back_upper: "Upper Back",
  back_mid: "Mid Back",
  delts_front: "Front Delts",
  delts_side: "Side Delts",
  delts_rear: "Rear Delts",
  biceps: "Biceps",
  triceps: "Triceps",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  abs: "Abs",
  neck: "Neck",
};

export { MUSCLE_LABELS };

async function postJson(path: string, body: any): Promise<any> {
  const res = await apiRequest("POST", path, body);
  return res.json();
}

async function getJson(path: string): Promise<any> {
  const res = await apiRequest("GET", path);
  return res.json();
}

export function useWorkoutEngine() {
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [state, setState] = useState<WorkoutState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isolationTargets, setIsolationTargets] = useState<MuscleGroup[]>([]);
  const [weeklyLoads, setWeeklyLoads] = useState<Record<string, number>>({});

  const startWorkout = useCallback(async (
    readinessScore: number,
    workoutType: string = "strength",
    sessionIdOverride?: string,
  ) => {
    setStatus("starting");
    setError(null);

    const startTs = new Date().toISOString();
    const sessionId = sessionIdOverride || `wk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    try {
      const result = await postJson("/api/workout/start", {
        sessionId,
        readinessScore,
        workoutType,
      });

      setState({ ...result, start_ts: result.start_ts ?? startTs });
      setStatus("active");

      try {
        const loads = await getJson("/api/muscle/weekly-load");
        setWeeklyLoads(loads);
      } catch {}
    } catch (err: any) {
      setError(err.message || "Failed to start workout");
      setStatus("error");
    }
  }, []);

  const logSet = useCallback(async (
    muscle: MuscleGroup,
    rpe: number,
    isCompound: boolean,
  ) => {
    if (!state) return;
    setStatus("logging");
    setError(null);

    try {
      const result: SetResult = await postJson(`/api/workout/${encodeURIComponent(state.session_id)}/set`, {
        muscle,
        rpe,
        isCompound,
        cbpCurrent: state.cbpCurrent,
        compoundSets: state.compoundSets,
        isolationSets: state.isolationSets,
        phase: state.phase,
        strainPoints: state.strainPoints,
      });

      setState(result);
      setStatus("active");

      if (result.phase === "ISOLATION" && state.phase === "COMPOUND") {
        try {
          const targets = await postJson("/api/muscle/isolation-targets", {
            readinessScore: 100 * Math.pow(result.cbpStart / 100, 1 / 1.4),
            dayType: "FULL_BODY",
            count: 3,
          });
          setIsolationTargets(targets.targets || []);
        } catch {}
      }

      return result;
    } catch (err: any) {
      setError(err.message || "Failed to log set");
      setStatus("active");
      return null;
    }
  }, [state]);

  const fetchIsolationTargets = useCallback(async (readinessScore: number, dayType: string = "FULL_BODY") => {
    try {
      const targets = await postJson("/api/muscle/isolation-targets", {
        readinessScore,
        dayType,
        count: 3,
      });
      setIsolationTargets(targets.targets || []);
    } catch {}
  }, []);

  const endWorkout = useCallback(async (opts?: { polarOwned?: boolean }) => {
    if (!state) return;
    setStatus("ending");

    if (opts?.polarOwned) {
      setStatus("finished");
      return;
    }

    try {
      const endTs = new Date().toISOString();
      await postJson("/api/canonical/workouts/upsert-session", {
        session_id: state.session_id,
        date: state.start_ts.slice(0, 10),
        start_ts: state.start_ts,
        end_ts: endTs,
        workout_type: "strength",
        source: "app",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setStatus("finished");
    } catch (err: any) {
      setError(err.message || "Failed to end workout");
      setStatus("error");
    }
  }, [state]);

  const reset = useCallback(() => {
    setState(null);
    setError(null);
    setIsolationTargets([]);
    setWeeklyLoads({});
    setStatus("idle");
  }, []);

  return {
    status,
    state,
    error,
    isolationTargets,
    weeklyLoads,
    startWorkout,
    logSet,
    fetchIsolationTargets,
    endWorkout,
    reset,
  };
}
