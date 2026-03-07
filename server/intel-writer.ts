const INTEL_BASE = process.env.LIFTING_INTEL_BASE_URL || "";
const INTEL_TIMEOUT_MS = 3000;

const GAME_TO_INTEL: Record<string, number[]> = {
  chest_upper: [17],
  chest_mid: [17],
  chest_lower: [17],
  back_lats: [16],
  back_upper: [13],
  back_mid: [14],
  delts_front: [5],
  delts_side: [7],
  delts_rear: [6],
  biceps: [2],
  triceps: [3],
  quads: [23],
  hamstrings: [24],
  glutes: [20],
  calves: [26],
  abs: [19],
  neck: [8],
};

export function gameKeyToIntelTargets(gameKey: string): number[] {
  return GAME_TO_INTEL[gameKey] || [];
}

interface LogSetPayload {
  event_id: string;
  session_id: string;
  muscle_targets: number[];
  movement_type: "compound" | "isolation";
  rpe: number | null;
  performed_at: string;
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
      console.log(`[intel-writer] log-set OK: event_id=${payload.event_id} session_id=${payload.session_id}`);
    }
  } catch (err: any) {
    const reason = err.name === "AbortError" ? "timeout" : err.message;
    console.error(`[intel-writer] log-set error: ${reason} event_id=${payload.event_id}`);
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
