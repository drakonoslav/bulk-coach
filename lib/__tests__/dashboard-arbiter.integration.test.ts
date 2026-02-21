const BASE = process.env.TEST_API_URL || "http://localhost:5000";
const API_KEY = process.env.API_KEY || "";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

describe("dashboard arbiter + calorie decision logging", () => {
  test("GET /api/dashboard returns structured payload with calorie fields", async () => {
    const end = new Date().toISOString().slice(0, 10);
    const start = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 120);
      return d.toISOString().slice(0, 10);
    })();

    const res = await fetch(
      `${BASE}/api/dashboard?start=${start}&end=${end}`,
      { headers: authHeaders() }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(body).toHaveProperty("appliedCalorieDelta");
    expect(body).toHaveProperty("policySource");
    expect(body).toHaveProperty("modeInsightReason");
    expect(body).toHaveProperty("decisions14d");
    expect(Array.isArray(body.entries)).toBe(true);
    expect(Array.isArray(body.decisions14d)).toBe(true);
  });

  test("dashboard call triggers calorie decision upsert visible in GET /api/calorie-decisions", async () => {
    const end = new Date().toISOString().slice(0, 10);
    const start = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 120);
      return d.toISOString().slice(0, 10);
    })();

    const dashRes = await fetch(
      `${BASE}/api/dashboard?start=${start}&end=${end}`,
      { headers: authHeaders() }
    );
    expect(dashRes.status).toBe(200);
    const dashBody = await dashRes.json();

    if (dashBody.entries.length < 7) {
      console.log("Skipping decision check — fewer than 7 entries (ramp-up)");
      return;
    }

    expect(dashBody.appliedCalorieDelta).not.toBeNull();
    expect(["weight_only", "mode_override"]).toContain(dashBody.policySource);

    const decisionsRes = await fetch(
      `${BASE}/api/calorie-decisions?days=14`,
      { headers: authHeaders() }
    );
    expect(decisionsRes.status).toBe(200);
    const decisionsBody = await decisionsRes.json();
    expect(decisionsBody.ok).toBe(true);
    expect(Array.isArray(decisionsBody.decisions)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    const todayDecision = decisionsBody.decisions.find(
      (d: any) => d.day === today
    );
    expect(todayDecision).toBeDefined();
    expect(todayDecision.deltaKcal).toBe(dashBody.appliedCalorieDelta);
    expect(todayDecision.source).toBe(dashBody.policySource);
  });

  test("decisions are returned newest-first", async () => {
    const res = await fetch(
      `${BASE}/api/calorie-decisions?days=365`,
      { headers: authHeaders() }
    );
    const body = await res.json();
    if (body.decisions.length >= 2) {
      for (let i = 1; i < body.decisions.length; i++) {
        expect(body.decisions[i - 1].day >= body.decisions[i].day).toBe(true);
      }
    }
  });

  test("dashboard entries are sorted ascending by day", async () => {
    const end = new Date().toISOString().slice(0, 10);
    const start = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().slice(0, 10);
    })();

    const res = await fetch(
      `${BASE}/api/dashboard?start=${start}&end=${end}`,
      { headers: authHeaders() }
    );
    const body = await res.json();

    if (body.entries.length >= 2) {
      for (let i = 1; i < body.entries.length; i++) {
        expect(body.entries[i].day >= body.entries[i - 1].day).toBe(true);
      }
    }
  });
});
