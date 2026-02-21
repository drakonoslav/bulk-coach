const BASE = process.env.TEST_API_URL || "http://localhost:5000";
const API_KEY = process.env.API_KEY || "";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function upsert(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/calorie-decisions/upsert`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getDecisions(days = 14) {
  const res = await fetch(`${BASE}/api/calorie-decisions?days=${days}`, {
    headers: authHeaders(),
  });
  return { status: res.status, body: await res.json() };
}

describe("calorie-decisions routes", () => {
  const testDay = "2099-12-31";

  afterAll(async () => {
    await upsert({
      day: testDay,
      deltaKcal: 0,
      source: "weight_only",
      priority: "low",
      reason: "cleanup",
    });
  });

  test("POST upsert: creates decision for a day", async () => {
    const { status, body } = await upsert({
      day: testDay,
      deltaKcal: 100,
      source: "weight_only",
      priority: "low",
      reason: "Weight policy (weekly rate)",
      wkGainLb: 0.15,
      mode: "LEAN_BULK",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("POST upsert: idempotent — second upsert overwrites same day", async () => {
    const { status, body } = await upsert({
      day: testDay,
      deltaKcal: -50,
      source: "mode_override",
      priority: "high",
      reason: "Waist guardrail triggered",
      wkGainLb: 0.35,
      mode: "CUT",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const { body: getBody } = await getDecisions(365);
    const row = getBody.decisions.find((d: any) => d.day === testDay);
    expect(row).toBeDefined();
    expect(row.deltaKcal).toBe(-50);
    expect(row.source).toBe("mode_override");
    expect(row.priority).toBe("high");
    expect(row.reason).toBe("Waist guardrail triggered");
    expect(row.mode).toBe("CUT");
  });

  test("GET ordering: newest first", async () => {
    const { status, body } = await getDecisions(365);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.decisions)).toBe(true);
    if (body.decisions.length >= 2) {
      expect(body.decisions[0].day >= body.decisions[1].day).toBe(true);
    }
  });

  test("POST upsert: rejects invalid source", async () => {
    const { status, body } = await upsert({
      day: testDay,
      deltaKcal: 100,
      source: "invalid",
      priority: "low",
      reason: "test",
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  test("POST upsert: rejects missing day", async () => {
    const { status, body } = await upsert({
      deltaKcal: 100,
      source: "weight_only",
      priority: "low",
      reason: "test",
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  test("POST upsert: rejects missing deltaKcal", async () => {
    const { status, body } = await upsert({
      day: testDay,
      source: "weight_only",
      priority: "low",
      reason: "test",
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  test("POST upsert: rejects invalid priority", async () => {
    const { status, body } = await upsert({
      day: testDay,
      deltaKcal: 100,
      source: "weight_only",
      priority: "critical",
      reason: "test",
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });
});
