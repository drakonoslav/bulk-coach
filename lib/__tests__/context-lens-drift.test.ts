import { computeDisturbanceScore } from "../../server/context-lens";

function scoreFor(late: number | null, measured: number | null) {
  return computeDisturbanceScore({
    hrv_pct: null,
    sleep_pct: null,
    proxy_pct: null,
    rhr_bpm: null,
    bedtimeDriftLateNights7d: late,
    bedtimeDriftMeasuredNights7d: measured,
  });
}

describe("Context Lens — Drift integration boundaries", () => {
  test("Drift ignored when measured nights = 0 (no divide-by-zero, no drift contribution)", () => {
    const out = scoreFor(3, 0);
    expect(out.components.lateRate).toBeNull();
    expect(out.components.drf).toBe(0);
    expect(out.score).toBe(50);
  });

  test("Drift ignored when measured nights is null", () => {
    const out = scoreFor(3, null);
    expect(out.components.lateRate).toBeNull();
    expect(out.components.drf).toBe(0);
    expect(out.score).toBe(50);
  });

  test("2/7 late nights yields lateRate = 0.2857 and drift component < 1.0", () => {
    const out = scoreFor(2, 7);
    expect(out.components.lateRate).toBeCloseTo(2 / 7, 6);
    expect(out.components.drf).toBeGreaterThan(0);
    expect(out.components.drf).toBeLessThan(1.0);
    expect(out.score).toBeGreaterThan(50);
  });

  test("3/7 late nights is the full-swing anchor => drift component ~ 1.0", () => {
    const out = scoreFor(3, 7);
    expect(out.components.lateRate).toBeCloseTo(3 / 7, 6);
    expect(out.components.drf).toBeCloseTo(1.0, 6);
  });

  test("4/7 late nights exceeds full swing => drift component > 1.0 (and <= 1.5)", () => {
    const out = scoreFor(4, 7);
    expect(out.components.lateRate).toBeCloseTo(4 / 7, 6);
    expect(out.components.drf).toBeGreaterThan(1.0);
    expect(out.components.drf).toBeLessThanOrEqual(1.5);
  });

  test("7/7 late nights saturates drift component at <= 1.5", () => {
    const out = scoreFor(7, 7);
    expect(out.components.lateRate).toBeCloseTo(1.0, 6);
    expect(out.components.drf).toBeLessThanOrEqual(1.5);
    expect(out.components.drf).toBeGreaterThan(1.0);
  });

  test("Drift contribution is never negative (late-only signal)", () => {
    const out = scoreFor(0, 7);
    expect(out.components.lateRate).toBeCloseTo(0, 6);
    expect(out.components.drf).toBeGreaterThanOrEqual(0);
    expect(out.score).toBe(50);
  });

  test("Monotonicity: increasing late nights increases (or holds) disturbance score when other signals are constant", () => {
    const s0 = scoreFor(0, 7).score;
    const s1 = scoreFor(1, 7).score;
    const s2 = scoreFor(2, 7).score;
    const s3 = scoreFor(3, 7).score;
    const s4 = scoreFor(4, 7).score;

    expect(s1).toBeGreaterThanOrEqual(s0);
    expect(s2).toBeGreaterThanOrEqual(s1);
    expect(s3).toBeGreaterThanOrEqual(s2);
    expect(s4).toBeGreaterThanOrEqual(s3);
  });

  test("Boundary: 2/7 vs 3/7 late nights must strictly increase drift component (drf)", () => {
    const two = scoreFor(2, 7);
    const three = scoreFor(3, 7);
    expect(three.components.drf).toBeGreaterThan(two.components.drf);
  });

  test("Policy-consistency style: crossing from 2/7 to 3/7 can never decrease the final score", () => {
    const two = scoreFor(2, 7).score;
    const three = scoreFor(3, 7).score;
    expect(three).toBeGreaterThanOrEqual(two);
  });
});
