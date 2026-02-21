import {
  computeDisturbanceScore,
  classifyContextPhase,
  cortisolFlagAligned,
  PHASE_THRESH,
} from "../../server/context-lens";

describe("computeDisturbanceScore", () => {
  test("neutral inputs return ~50", () => {
    const r = computeDisturbanceScore({
      hrvDeltaPct: 0,
      rhrDeltaPct: 0,
      sleepDeltaPct: 0,
      proxyDeltaPct: 0,
      bedtimeDriftMin7d: 0,
    });
    expect(r.score).toBe(50);
  });

  test("all-null inputs return 50", () => {
    const r = computeDisturbanceScore({});
    expect(r.score).toBe(50);
    expect(r.reasons).toHaveLength(0);
  });

  test("heavily negative HRV delta raises score above mild threshold", () => {
    const r = computeDisturbanceScore({
      hrvDeltaPct: -12,
      rhrDeltaPct: 0,
      sleepDeltaPct: 0,
      proxyDeltaPct: 0,
      bedtimeDriftMin7d: 0,
    });
    expect(r.score).toBeGreaterThan(PHASE_THRESH.DISTURB_MILD);
    expect(r.components.hrv).toBeGreaterThan(0);
  });

  test("positive HRV delta lowers score", () => {
    const r = computeDisturbanceScore({
      hrvDeltaPct: 12,
      rhrDeltaPct: 0,
      sleepDeltaPct: 0,
      proxyDeltaPct: 0,
      bedtimeDriftMin7d: 0,
    });
    expect(r.score).toBeLessThan(50);
  });

  test("all-bad inputs push score toward high disturbance", () => {
    const r = computeDisturbanceScore({
      hrvDeltaPct: -12,
      rhrDeltaPct: 5,
      sleepDeltaPct: -15,
      proxyDeltaPct: -15,
      bedtimeDriftMin7d: 60,
    });
    expect(r.score).toBeGreaterThan(PHASE_THRESH.DISTURB_HIGH);
  });

  test("score clamps to 0-100", () => {
    const extreme = computeDisturbanceScore({
      hrvDeltaPct: -30,
      rhrDeltaPct: 20,
      sleepDeltaPct: -30,
      proxyDeltaPct: -30,
      bedtimeDriftMin7d: 120,
    });
    expect(extreme.score).toBeLessThanOrEqual(100);
    expect(extreme.score).toBeGreaterThanOrEqual(0);
  });

  test("high bedtime drift adds disturbance", () => {
    const low = computeDisturbanceScore({ bedtimeDriftMin7d: 0 });
    const high = computeDisturbanceScore({ bedtimeDriftMin7d: 60 });
    expect(high.score).toBeGreaterThan(low.score);
  });

  test("RHR increase adds disturbance", () => {
    const baseline = computeDisturbanceScore({ rhrDeltaPct: 0 });
    const elevated = computeDisturbanceScore({ rhrDeltaPct: 5 });
    expect(elevated.score).toBeGreaterThan(baseline.score);
  });
});

describe("cortisolFlagAligned", () => {
  test("returns false with insufficient aligned signals", () => {
    expect(cortisolFlagAligned({ hrvDeltaPct: -10, rhrDeltaPct: 5 })).toBe(false);
  });

  test("returns true with 3+ aligned signals", () => {
    expect(
      cortisolFlagAligned({
        hrvDeltaPct: -10,
        rhrDeltaPct: 5,
        sleepDeltaPct: -12,
        proxyDeltaPct: -12,
      }),
    ).toBe(true);
  });

  test("returns false when values are within tolerance", () => {
    expect(
      cortisolFlagAligned({
        hrvDeltaPct: -5,
        rhrDeltaPct: 2,
        sleepDeltaPct: -5,
        proxyDeltaPct: -5,
      }),
    ).toBe(false);
  });
});

describe("classifyContextPhase", () => {
  const base = {
    tag: "travel",
    taggedDaysInLast21: 5,
    disturbanceNow: 60,
    disturbanceSlope14d: 0 as number | null,
    adjustmentAttemptedInLast28: false,
    daysSinceAdjustmentAttempt: null as number | null,
    cortisolFlagRate: null as number | null,
  };

  test("insufficient data when <3 tagged days", () => {
    const r = classifyContextPhase({ ...base, taggedDaysInLast21: 2 });
    expect(r.phase).toBe("INSUFFICIENT_DATA");
  });

  test("insufficient data when slope is null", () => {
    const r = classifyContextPhase({ ...base, disturbanceSlope14d: null });
    expect(r.phase).toBe("INSUFFICIENT_DATA");
  });

  test("novelty disturbance when no adjustment attempted", () => {
    const r = classifyContextPhase({
      ...base,
      adjustmentAttemptedInLast28: false,
      disturbanceSlope14d: 1,
    });
    expect(r.phase).toBe("NOVELTY_DISTURBANCE");
  });

  test("novelty disturbance when adjustment too recent", () => {
    const r = classifyContextPhase({
      ...base,
      adjustmentAttemptedInLast28: true,
      daysSinceAdjustmentAttempt: 7,
      disturbanceSlope14d: 1,
    });
    expect(r.phase).toBe("NOVELTY_DISTURBANCE");
  });

  test("chronic suppression: high disturbance + worsening + post-adjustment", () => {
    const r = classifyContextPhase({
      ...base,
      disturbanceNow: 75,
      disturbanceSlope14d: 3,
      adjustmentAttemptedInLast28: true,
      daysSinceAdjustmentAttempt: 20,
    });
    expect(r.phase).toBe("CHRONIC_SUPPRESSION");
    expect(r.confidence).toBe(90);
  });

  test("chronic suppression: by cortisol flag rate", () => {
    const r = classifyContextPhase({
      ...base,
      disturbanceNow: 60,
      disturbanceSlope14d: 0,
      adjustmentAttemptedInLast28: true,
      daysSinceAdjustmentAttempt: 20,
      cortisolFlagRate: 0.35,
    });
    expect(r.phase).toBe("CHRONIC_SUPPRESSION");
  });

  test("adaptive stabilization: improving slope after adjustment", () => {
    const r = classifyContextPhase({
      ...base,
      disturbanceNow: 55,
      disturbanceSlope14d: -3,
      adjustmentAttemptedInLast28: true,
      daysSinceAdjustmentAttempt: 20,
    });
    expect(r.phase).toBe("ADAPTIVE_STABILIZATION");
    expect(r.confidence).toBe(85);
  });

  test("adaptive stabilization: flat slope after adjustment", () => {
    const r = classifyContextPhase({
      ...base,
      disturbanceNow: 55,
      disturbanceSlope14d: 0,
      adjustmentAttemptedInLast28: true,
      daysSinceAdjustmentAttempt: 20,
    });
    expect(r.phase).toBe("ADAPTIVE_STABILIZATION");
    expect(r.confidence).toBe(70);
  });

  test("metrics object is always populated", () => {
    const r = classifyContextPhase(base);
    expect(r.metrics).toHaveProperty("disturbanceScore");
    expect(r.metrics).toHaveProperty("disturbanceSlope14d");
    expect(r.metrics).toHaveProperty("taggedDays");
    expect(r.metrics).toHaveProperty("adjustmentAttempted");
    expect(r.metrics).toHaveProperty("cortisolFlagRate");
  });
});
