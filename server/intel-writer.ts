const INTEL_BASE = process.env.LIFTING_INTEL_BASE_URL || "";
const INTEL_TIMEOUT_MS = 3000;

type SetIntent = "direct_isolation" | "compound_primary" | "compound_secondary";

interface MuscleProfile {
  intelIds: number[];
  intent: SetIntent;
  compoundTonnage: number;
  isolationTonnage: number;
}

const MUSCLE_PROFILES: Record<string, MuscleProfile> = {
  chest_upper:  { intelIds: [17], intent: "compound_primary",   compoundTonnage: 2800, isolationTonnage: 800 },
  chest_mid:    { intelIds: [17], intent: "compound_primary",   compoundTonnage: 3200, isolationTonnage: 900 },
  chest_lower:  { intelIds: [17], intent: "compound_secondary", compoundTonnage: 2400, isolationTonnage: 700 },
  back_lats:    { intelIds: [16], intent: "compound_primary",   compoundTonnage: 3000, isolationTonnage: 1000 },
  back_upper:   { intelIds: [13], intent: "compound_secondary", compoundTonnage: 2200, isolationTonnage: 800 },
  back_mid:     { intelIds: [14], intent: "compound_secondary", compoundTonnage: 2400, isolationTonnage: 800 },
  delts_front:  { intelIds: [5],  intent: "compound_secondary", compoundTonnage: 1600, isolationTonnage: 500 },
  delts_side:   { intelIds: [7],  intent: "direct_isolation",   compoundTonnage: 800,  isolationTonnage: 500 },
  delts_rear:   { intelIds: [6],  intent: "direct_isolation",   compoundTonnage: 800,  isolationTonnage: 500 },
  biceps:       { intelIds: [2],  intent: "direct_isolation",   compoundTonnage: 1200, isolationTonnage: 600 },
  triceps:      { intelIds: [3],  intent: "direct_isolation",   compoundTonnage: 1400, isolationTonnage: 700 },
  quads:        { intelIds: [23], intent: "compound_primary",   compoundTonnage: 4000, isolationTonnage: 1500 },
  hamstrings:   { intelIds: [24], intent: "compound_primary",   compoundTonnage: 3000, isolationTonnage: 1200 },
  glutes:       { intelIds: [20], intent: "compound_primary",   compoundTonnage: 3500, isolationTonnage: 1000 },
  calves:       { intelIds: [26], intent: "direct_isolation",   compoundTonnage: 600,  isolationTonnage: 600 },
  abs:          { intelIds: [19], intent: "direct_isolation",   compoundTonnage: 400,  isolationTonnage: 400 },
  neck:         { intelIds: [8],  intent: "direct_isolation",   compoundTonnage: 300,  isolationTonnage: 300 },
};

export function gameKeyToIntelTargets(gameKey: string): number[] {
  return MUSCLE_PROFILES[gameKey]?.intelIds || [];
}

export function resolveSetIntent(gameKey: string, isCompound: boolean): {
  movementType: "compound" | "isolation";
  estimatedTonnage: number;
} {
  const profile = MUSCLE_PROFILES[gameKey];
  if (!profile) {
    return { movementType: isCompound ? "compound" : "isolation", estimatedTonnage: isCompound ? 500 : 200 };
  }

  if (isCompound) {
    return { movementType: "compound", estimatedTonnage: profile.compoundTonnage };
  }

  if (profile.intent === "compound_primary" || profile.intent === "compound_secondary") {
    return { movementType: "isolation", estimatedTonnage: profile.isolationTonnage };
  }

  return { movementType: "isolation", estimatedTonnage: profile.isolationTonnage };
}

interface LogSetPayload {
  event_id: string;
  session_id: string;
  muscle_targets: number[];
  movement_type: "compound" | "isolation";
  rpe: number | null;
  performed_at: string;
  estimated_tonnage?: number;
}

interface ExerciseLogSetPayload {
  event_id: string;
  session_id: string;
  exercise_id: number;
  weight: number;
  reps: number;
  performed_at: string;
  source?: string;
}

interface SessionClosePayload {
  session_id: string;
  started_at: string;
  ended_at: string;
}

export async function fireIntelLogSet(payload: LogSetPayload): Promise<void> {
  if (!INTEL_BASE) {
    console.log(`[intel-writer] log-set skipped: LIFTING_INTEL_BASE_URL not configured (event_id=${payload.event_id})`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTEL_TIMEOUT_MS);

  try {
    const res = await fetch(`${INTEL_BASE}/game/log-set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[intel-writer] log-set failed: status=${res.status} event_id=${payload.event_id} body=${body.slice(0, 200)}`);
    } else {
      console.log(`[intel-writer] log-set OK: event_id=${payload.event_id} session_id=${payload.session_id} tonnage=${payload.estimated_tonnage ?? "default"}`);
    }
  } catch (err: any) {
    const reason = err.name === "AbortError" ? "timeout" : err.message;
    console.error(`[intel-writer] log-set error: ${reason} event_id=${payload.event_id}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fireIntelExerciseLogSet(payload: ExerciseLogSetPayload): Promise<void> {
  if (!INTEL_BASE) {
    console.log(`[intel-writer] exercise-log-set skipped: LIFTING_INTEL_BASE_URL not configured (event_id=${payload.event_id})`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTEL_TIMEOUT_MS);

  try {
    const res = await fetch(`${INTEL_BASE}/game/log-set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: payload.event_id,
        session_id: payload.session_id,
        exercise_id: payload.exercise_id,
        weight: payload.weight,
        reps: payload.reps,
        performed_at: payload.performed_at,
        source: payload.source || "expo_bulkcoach",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[intel-writer] exercise-log-set failed: status=${res.status} event_id=${payload.event_id} body=${body.slice(0, 200)}`);
    } else {
      console.log(`[intel-writer] exercise-log-set OK: event_id=${payload.event_id} exercise_id=${payload.exercise_id} ${payload.weight}×${payload.reps}`);
    }
  } catch (err: any) {
    const reason = err.name === "AbortError" ? "timeout" : err.message;
    console.error(`[intel-writer] exercise-log-set error: ${reason} event_id=${payload.event_id}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fireIntelSessionClose(payload: SessionClosePayload): Promise<void> {
  if (!INTEL_BASE) {
    console.log(`[intel-writer] session-close skipped: LIFTING_INTEL_BASE_URL not configured (session_id=${payload.session_id})`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTEL_TIMEOUT_MS);

  try {
    const res = await fetch(`${INTEL_BASE}/game/session-close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[intel-writer] session-close failed: status=${res.status} session_id=${payload.session_id} body=${body.slice(0, 200)}`);
    } else {
      console.log(`[intel-writer] session-close OK: session_id=${payload.session_id}`);
    }
  } catch (err: any) {
    const reason = err.name === "AbortError" ? "timeout" : err.message;
    console.error(`[intel-writer] session-close error: ${reason} session_id=${payload.session_id}`);
  } finally {
    clearTimeout(timer);
  }
}
