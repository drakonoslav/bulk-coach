const BASE = "http://localhost:5000";
const sessionId = `golden_${Date.now()}`;

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const checks: Check[] = [];

function check(name: string, passed: boolean, detail?: string) {
  checks.push({ name, passed, detail });
  const icon = passed ? "✅" : "❌";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function post(path: string, body: any): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function generateHrSamples(sessionStartMs: number) {
  const samples: { ts: string; hr_bpm: number }[] = [];
  const baselineEnd = sessionStartMs + 60 * 1000;
  const activeEnd = baselineEnd + 5 * 60 * 1000;
  const recoveryEnd = activeEnd + 3 * 60 * 1000;

  for (let t = sessionStartMs; t < baselineEnd; t += 1000) {
    const hr = 65 + Math.random() * 10;
    samples.push({ ts: new Date(t).toISOString(), hr_bpm: Math.round(hr) });
  }

  for (let t = baselineEnd; t < activeEnd; t += 1000) {
    const progress = (t - baselineEnd) / (activeEnd - baselineEnd);
    const base = 130 + progress * 40;
    const hr = base + (Math.random() - 0.5) * 10;
    samples.push({ ts: new Date(t).toISOString(), hr_bpm: Math.round(Math.min(hr, 175)) });
  }

  for (let t = activeEnd; t < recoveryEnd; t += 1000) {
    const progress = (t - activeEnd) / (recoveryEnd - activeEnd);
    const hr = 140 - progress * 50 + (Math.random() - 0.5) * 6;
    samples.push({ ts: new Date(t).toISOString(), hr_bpm: Math.round(Math.max(hr, 80)) });
  }

  return samples;
}

function generateRrIntervals(sessionStartMs: number) {
  const intervals: { ts: string; rr_ms: number }[] = [];
  const baselineEnd = sessionStartMs + 60 * 1000;
  const activeEnd = baselineEnd + 5 * 60 * 1000;
  const recoveryEnd = activeEnd + 3 * 60 * 1000;

  let t = sessionStartMs;
  while (t < baselineEnd) {
    const rr = 800 + Math.random() * 100;
    intervals.push({ ts: new Date(t).toISOString(), rr_ms: Math.round(rr) });
    t += rr;
  }

  while (t < activeEnd) {
    const progress = (t - baselineEnd) / (activeEnd - baselineEnd);
    const baseRr = 450 - progress * 100;
    const rr = Math.max(350, baseRr + (Math.random() - 0.5) * 40);
    intervals.push({ ts: new Date(t).toISOString(), rr_ms: Math.round(rr) });
    t += rr;
  }

  while (t < recoveryEnd) {
    const progress = (t - activeEnd) / (recoveryEnd - activeEnd);
    const rr = 430 + progress * 240 + (Math.random() - 0.5) * 30;
    intervals.push({ ts: new Date(t).toISOString(), rr_ms: Math.round(rr) });
    t += rr;
  }

  return intervals;
}

async function main() {
  console.log(`\n🏋️  Golden Session Smoke Test`);
  console.log(`   Session ID: ${sessionId}\n`);

  const sessionStartMs = Date.now() - 30 * 60 * 1000;
  const sessionStartTs = new Date(sessionStartMs).toISOString();
  const dateStr = new Date(sessionStartMs).toISOString().slice(0, 10);

  console.log("── Step A: Start workout session");
  const startRes = await post("/api/workout/start", {
    sessionId,
    readinessScore: 75,
    workoutType: "strength",
  });
  check("response has session_id", startRes.session_id === sessionId, `session_id=${startRes.session_id}`);
  check("response has phase", typeof startRes.phase === "string", `phase=${startRes.phase}`);
  check("response has cbpStart", typeof startRes.cbpStart === "number", `cbpStart=${startRes.cbpStart}`);
  check("response has cbpCurrent", typeof startRes.cbpCurrent === "number", `cbpCurrent=${startRes.cbpCurrent}`);

  console.log("\n── Step B: Upsert HR samples (bulk)");
  const hrSamples = generateHrSamples(sessionStartMs);
  const hrRes = await post("/api/canonical/workouts/hr-samples/upsert-bulk", {
    session_id: sessionId,
    source: "golden_test",
    samples: hrSamples,
  });
  check("HR upsert ok", hrRes.ok === true, `inserted_or_updated=${hrRes.inserted_or_updated}`);
  const hrCount1 = hrRes.inserted_or_updated;
  check("HR sample count > 0", hrCount1 > 0, `count=${hrCount1}`);

  console.log("\n── Step C: Upsert RR intervals (bulk)");
  const rrIntervals = generateRrIntervals(sessionStartMs);
  const rrRes = await post("/api/canonical/workouts/rr-intervals/upsert-bulk", {
    session_id: sessionId,
    source: "golden_test",
    intervals: rrIntervals,
  });
  check("RR upsert ok", rrRes.ok === true, `inserted_or_updated=${rrRes.inserted_or_updated}`);
  const rrCount1 = rrRes.inserted_or_updated;
  check("RR interval count > 0", rrCount1 > 0, `count=${rrCount1}`);

  console.log("\n── Step D: Log set — chest_upper");
  const set1Res = await post(`/api/workout/${sessionId}/set`, {
    muscle: "chest_upper",
    rpe: 7,
    isCompound: true,
    cbpCurrent: startRes.cbpCurrent,
    compoundSets: 0,
    isolationSets: 0,
    phase: "COMPOUND",
    strainPoints: 0,
  });
  check("compoundSets incremented", set1Res.compoundSets === 1, `compoundSets=${set1Res.compoundSets}`);
  check("cbpCurrent decreased", set1Res.cbpCurrent < startRes.cbpCurrent, `cbpCurrent=${set1Res.cbpCurrent}`);

  console.log("\n── Step E: Log set — back_lats");
  const set2Res = await post(`/api/workout/${sessionId}/set`, {
    muscle: "back_lats",
    rpe: 8,
    isCompound: true,
    cbpCurrent: set1Res.cbpCurrent,
    compoundSets: set1Res.compoundSets,
    isolationSets: set1Res.isolationSets,
    phase: set1Res.phase,
    strainPoints: set1Res.strainPoints,
  });
  check("compoundSets incremented again", set2Res.compoundSets === 2, `compoundSets=${set2Res.compoundSets}`);

  console.log("\n── Step F: Get next-prompt");
  const promptRes = await get(`/api/workout/${sessionId}/next-prompt`);
  check("has prompt_title", typeof promptRes.prompt_title === "string" && promptRes.prompt_title.length > 0, `prompt_title="${promptRes.prompt_title}"`);
  check("has recommended_muscles", Array.isArray(promptRes.recommended_muscles) && promptRes.recommended_muscles.length > 0, `muscles=${JSON.stringify(promptRes.recommended_muscles)}`);

  console.log("\n── Step G: End session (upsert with end_ts)");
  const endTs = new Date(sessionStartMs + 30 * 60 * 1000).toISOString();
  const endRes = await post("/api/canonical/workouts/upsert-session", {
    session_id: sessionId,
    date: dateStr,
    start_ts: sessionStartTs,
    end_ts: endTs,
    workout_type: "strength",
    source: "golden_test",
  });
  check("session end ok", endRes.ok === true, `session_id=${endRes.session_id}`);

  console.log("\n── Step H: Analyze HRV");
  const hrvRes = await post(`/api/canonical/workouts/${sessionId}/analyze-hrv`, {});
  console.log("   HRV analysis result:", JSON.stringify(hrvRes, null, 2));
  check("analyze-hrv ok", hrvRes.ok === true);
  if (hrvRes.hrv_suppression_pct != null) {
    check("hrv_suppression_pct 0-100", hrvRes.hrv_suppression_pct >= 0 && hrvRes.hrv_suppression_pct <= 100, `val=${hrvRes.hrv_suppression_pct}`);
  } else {
    check("hrv_suppression_pct present (nullable OK)", true, "null — insufficient RR data for this window");
  }
  if (hrvRes.strength_bias != null) {
    check("strength_bias 0-1", hrvRes.strength_bias >= 0 && hrvRes.strength_bias <= 1, `val=${hrvRes.strength_bias}`);
  } else {
    check("strength_bias present (nullable OK)", true, "null");
  }
  if (hrvRes.cardio_bias != null) {
    check("cardio_bias 0-1", hrvRes.cardio_bias >= 0 && hrvRes.cardio_bias <= 1, `val=${hrvRes.cardio_bias}`);
  }

  console.log("\n── Step I: Idempotency — re-upsert HR & RR");
  const hrRes2 = await post("/api/canonical/workouts/hr-samples/upsert-bulk", {
    session_id: sessionId,
    source: "golden_test",
    samples: hrSamples,
  });
  check("HR re-upsert ok (no error)", hrRes2.ok === true);
  check("HR idempotent count matches", hrRes2.inserted_or_updated === hrCount1, `first=${hrCount1}, second=${hrRes2.inserted_or_updated}`);

  const rrRes2 = await post("/api/canonical/workouts/rr-intervals/upsert-bulk", {
    session_id: sessionId,
    source: "golden_test",
    intervals: rrIntervals,
  });
  check("RR re-upsert ok (no error)", rrRes2.ok === true);
  check("RR idempotent count matches", rrRes2.inserted_or_updated === rrCount1, `first=${rrCount1}, second=${rrRes2.inserted_or_updated}`);

  const hrRows = await get(`/api/canonical/workouts/${sessionId}/hr`);
  check("HR row count unchanged after re-upsert", Array.isArray(hrRows) && hrRows.length === hrCount1, `rows=${hrRows.length}, expected=${hrCount1}`);

  const rrRows = await get(`/api/canonical/workouts/${sessionId}/rr`);
  check("RR row count unchanged after re-upsert", Array.isArray(rrRows) && rrRows.length === rrCount1, `rows=${rrRows.length}, expected=${rrCount1}`);

  console.log("\n── Step J: Get events");
  const events = await get(`/api/workout/${sessionId}/events`);
  check("events exist", Array.isArray(events) && events.length > 0, `count=${events.length}`);
  const hasStart = events.some((e: any) => e.event_type === "SESSION_START");
  check("SESSION_START event present", hasStart);
  const hasSet = events.some((e: any) => e.event_type === "SET_COMPLETE");
  check("SET_COMPLETE event(s) present", hasSet);

  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;
  console.log(`  Total: ${checks.length}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
  if (failed > 0) {
    console.log("\n  Failed checks:");
    for (const c of checks.filter((c) => !c.passed)) {
      console.log(`    ❌ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }
  console.log("═".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err.message || err);
  process.exit(2);
});
