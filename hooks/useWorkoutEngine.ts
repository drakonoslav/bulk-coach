import { useState, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/query-client";
import { collapseIntelPriority, isDroppingTooMany, GAME_TO_INTEL } from "@/lib/muscle-bridge";
import type { IntelPriorityResponse } from "@/lib/muscle-bridge";

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

export interface ExerciseRecommendation {
  exercise_id: number;
  exercise_name: string;
  score: number;
  score_breakdown: {
    activation_relevance: number;
    role_weight: number;
    bottleneck_clearance: number;
    secondary_value: number;
    freshness_bonus: number;
  };
  compound_or_isolation: "compound" | "isolation";
  primary_muscles: { muscle_id: number; muscle: string; activation: number; role_weight?: number }[];
  secondary_muscles: { muscle_id: number; muscle: string; activation: number; role_weight?: number }[];
  equipment_tags: string[];
  movement_slot: string;
  explanation: string;
}

export interface ExerciseRecsState {
  muscle: MuscleGroup;
  mode: "compound" | "isolation";
  recommendations: ExerciseRecommendation[];
  loading: boolean;
  error: string | null;
}

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
  const [compoundTargets, setCompoundTargets] = useState<MuscleGroup[]>([]);
  const [weeklyLoads, setWeeklyLoads] = useState<Record<string, number>>({});
  const [exerciseRecs, setExerciseRecs] = useState<ExerciseRecsState | null>(null);
  const exerciseReqRef = useRef(0);

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
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

  const fetchCompoundTargets = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const intelPromise = getJson(`/api/intel/game/muscle-priority?mode=compound&date=${today}&top_n=5`);
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000)
      );
      const data: IntelPriorityResponse = await Promise.race([intelPromise, timeoutPromise]) as IntelPriorityResponse;
      const bridge = collapseIntelPriority(data.queue || []);
      console.log(`[intel-bridge] compound: mapped=${bridge.mapped}, dropped=${bridge.dropped}, droppedNames=[${bridge.droppedNames.join(",")}], resultCount=${bridge.muscles.length}`);
      if (!isDroppingTooMany(bridge, 3)) {
        setCompoundTargets(bridge.muscles.slice(0, 8));
        console.log(`[intel-bridge] compound targets from Intel: [${bridge.muscles.slice(0, 8).join(",")}]`);
      }
    } catch (err: any) {
      console.log(`[intel-bridge] compound: Intel fetch failed (${err.message})`);
    }
  }, []);

  const fetchIsolationTargets = useCallback(async (readinessScore: number, dayType: string = "FULL_BODY") => {
    const today = new Date().toISOString().slice(0, 10);
    let intelUsed = false;

    try {
      const intelPromise = getJson(`/api/intel/game/muscle-priority?mode=isolation&date=${today}&top_n=5`);
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000)
      );
      const data: IntelPriorityResponse = await Promise.race([intelPromise, timeoutPromise]) as IntelPriorityResponse;
      const bridge = collapseIntelPriority(data.queue || []);
      console.log(`[intel-bridge] isolation: mapped=${bridge.mapped}, dropped=${bridge.dropped}, droppedNames=[${bridge.droppedNames.join(",")}], resultCount=${bridge.muscles.length}`);

      if (!isDroppingTooMany(bridge, 3)) {
        setIsolationTargets(bridge.muscles.slice(0, 5));
        intelUsed = true;
        console.log(`[intel-bridge] isolation targets from Intel: [${bridge.muscles.slice(0, 5).join(",")}]`);
      } else {
        console.log(`[intel-bridge] isolation: too many dropped, falling back to local`);
      }
    } catch (err: any) {
      console.log(`[intel-bridge] isolation: Intel fetch failed (${err.message}), falling back to local`);
    }

    if (!intelUsed) {
      try {
        const targets = await postJson("/api/muscle/isolation-targets", {
          readinessScore,
          dayType,
          count: 3,
        });
        setIsolationTargets(targets.targets || []);
        console.log(`[intel-bridge] isolation targets from local fallback: [${(targets.targets || []).join(",")}]`);
      } catch {}
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

    const setIndex = (state.compoundSets || 0) + (state.isolationSets || 0) + 1;
    const eventId = `${state.session_id}_s${setIndex}_${Date.now()}`;

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const localParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(state.start_ts));
      const localDay = `${localParts.find(p => p.type === 'year')?.value}-${localParts.find(p => p.type === 'month')?.value}-${localParts.find(p => p.type === 'day')?.value}`;
      const result: SetResult = await postJson(`/api/workout/${encodeURIComponent(state.session_id)}/set`, {
        muscle,
        rpe,
        isCompound,
        cbpCurrent: state.cbpCurrent,
        compoundSets: state.compoundSets,
        isolationSets: state.isolationSets,
        phase: state.phase,
        strainPoints: state.strainPoints,
        event_id: eventId,
        day: localDay,
        timezone: tz,
      });

      setState({ ...result, session_id: state.session_id, start_ts: state.start_ts });
      setStatus("active");

      if (result.phase === "ISOLATION" && state.phase === "COMPOUND") {
        const derivedReadiness = 100 * Math.pow(result.cbpStart / 100, 1 / 1.4);
        await fetchIsolationTargets(derivedReadiness, "FULL_BODY");
      }

      return result;
    } catch (err: any) {
      setError(err.message || "Failed to log set");
      setStatus("active");
      return null;
    }
  }, [state, fetchIsolationTargets]);

  const fetchExerciseRecs = useCallback(async (muscle: MuscleGroup, mode: "compound" | "isolation") => {
    const intelIds = GAME_TO_INTEL[muscle];
    if (!intelIds || intelIds.length === 0) {
      setExerciseRecs({ muscle, mode, recommendations: [], loading: false, error: "No Intel mapping" });
      return;
    }
    const muscleId = intelIds[0];
    const reqId = ++exerciseReqRef.current;
    setExerciseRecs({ muscle, mode, recommendations: [], loading: true, error: null });
    try {
      const today = new Date().toISOString().slice(0, 10);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 4000)
      );
      const fetchPromise = getJson(`/api/intel/game/exercise-recommendations?muscle_id=${muscleId}&mode=${mode}&date=${today}&top_n=5`);
      const data = await Promise.race([fetchPromise, timeoutPromise]);
      if (reqId !== exerciseReqRef.current) return;
      const recs = data.recommendations || data.candidates || [];
      setExerciseRecs({
        muscle,
        mode,
        recommendations: recs,
        loading: false,
        error: null,
      });
    } catch (err: any) {
      if (reqId !== exerciseReqRef.current) return;
      console.log(`[exercise-recs] fetch failed for ${muscle}: ${err.message}`);
      setExerciseRecs({ muscle, mode, recommendations: [], loading: false, error: err.message });
    }
  }, []);

  const clearExerciseRecs = useCallback(() => {
    setExerciseRecs(null);
  }, []);

  const logExerciseSet = useCallback(async (
    muscle: MuscleGroup,
    exerciseId: number,
    weight: number,
    reps: number,
    isCompound: boolean,
  ) => {
    if (!state) return;
    setStatus("logging");
    setError(null);

    const setIndex = (state.compoundSets || 0) + (state.isolationSets || 0) + 1;
    const eventId = `${state.session_id}_s${setIndex}_${Date.now()}`;

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const localParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(state.start_ts));
      const localDay = `${localParts.find(p => p.type === 'year')?.value}-${localParts.find(p => p.type === 'month')?.value}-${localParts.find(p => p.type === 'day')?.value}`;
      const result: SetResult = await postJson(`/api/workout/${encodeURIComponent(state.session_id)}/exercise-set`, {
        muscle,
        exerciseId,
        weight,
        reps,
        isCompound,
        cbpCurrent: state.cbpCurrent,
        compoundSets: state.compoundSets,
        isolationSets: state.isolationSets,
        phase: state.phase,
        strainPoints: state.strainPoints,
        event_id: eventId,
        day: localDay,
        timezone: tz,
      });

      setState({ ...result, session_id: state.session_id, start_ts: state.start_ts });
      setStatus("active");
      setExerciseRecs(null);

      if (result.phase === "ISOLATION" && state.phase === "COMPOUND") {
        const derivedReadiness = 100 * Math.pow(result.cbpStart / 100, 1 / 1.4);
        await fetchIsolationTargets(derivedReadiness, "FULL_BODY");
      }

      return result;
    } catch (err: any) {
      setError(err.message || "Failed to log exercise set");
      setStatus("active");
      return null;
    }
  }, [state, fetchIsolationTargets]);

  const endWorkout = useCallback(async (opts?: { polarOwned?: boolean }) => {
    if (!state) return;
    setStatus("ending");

    if (opts?.polarOwned) {
      setStatus("finished");
      return;
    }

    try {
      const endTs = new Date().toISOString();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const localParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(state.start_ts));
      const localDate = `${localParts.find(p => p.type === 'year')?.value}-${localParts.find(p => p.type === 'month')?.value}-${localParts.find(p => p.type === 'day')?.value}`;
      await postJson("/api/canonical/workouts/upsert-session", {
        session_id: state.session_id,
        date: localDate,
        start_ts: state.start_ts,
        end_ts: endTs,
        workout_type: "strength",
        source: "workout_game",
        timezone: tz,
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
    setCompoundTargets([]);
    setWeeklyLoads({});
    setExerciseRecs(null);
    setStatus("idle");
  }, []);

  return {
    status,
    state,
    error,
    isolationTargets,
    compoundTargets,
    weeklyLoads,
    exerciseRecs,
    startWorkout,
    logSet,
    logExerciseSet,
    fetchCompoundTargets,
    fetchIsolationTargets,
    fetchExerciseRecs,
    clearExerciseRecs,
    endWorkout,
    reset,
  };
}
