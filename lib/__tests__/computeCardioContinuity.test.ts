import { computeCardioContinuity } from "../../server/cardio/computeCardioContinuity";

describe("computeCardioContinuity", () => {
  test("all z2/z3 → continuity=100", () => {
    const result = computeCardioContinuity({ z1: 0, z2: 20, z3: 20, z4: 0, z5: 0 });
    expect(result.continuity).toBe(100);
    expect(result.denominator).toBe("total_weighted_offband");
  });

  test("zero total → continuity=null", () => {
    const result = computeCardioContinuity({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
    expect(result.continuity).toBeNull();
    expect(result.denominator).toBe("total_weighted_offband");
    expect((result as any).reason).toBe("no_total_minutes");
  });

  test("z1 within grace → no penalty", () => {
    const result = computeCardioContinuity({ z1: 3, z2: 20, z3: 17, z4: 0, z5: 0 });
    expect(result.continuity).toBe(100);
    if (result.continuity != null) {
      expect(result.z1Grace).toBeGreaterThanOrEqual(2);
      expect(result.z1Penalty).toBe(0);
    }
  });

  test("z1 exceeding grace → partial penalty", () => {
    const result = computeCardioContinuity({ z1: 10, z2: 20, z3: 10, z4: 0, z5: 0 });
    if (result.continuity != null) {
      expect(result.z1Grace).toBe(4);
      expect(result.z1Penalty).toBe(6);
      expect(result.offBandWeighted).toBe(3);
      expect(result.continuity).toBeCloseTo(100 * (1 - 3 / 40), 6);
    }
  });

  test("z4+z5 penalized at 1.25× weight", () => {
    const result = computeCardioContinuity({ z1: 0, z2: 20, z3: 10, z4: 5, z5: 5 });
    if (result.continuity != null) {
      expect(result.offBandWeighted).toBe(1.25 * 10);
      expect(result.continuity).toBeCloseTo(100 * (1 - 12.5 / 40), 6);
    }
  });

  test("z1Grace clamped to min=2", () => {
    const result = computeCardioContinuity({ z1: 1, z2: 5, z3: 5, z4: 0, z5: 0 });
    if (result.continuity != null) {
      expect(result.z1Grace).toBe(2);
    }
  });

  test("z1Grace clamped to max=6", () => {
    const result = computeCardioContinuity({ z1: 10, z2: 50, z3: 40, z4: 0, z5: 0 });
    if (result.continuity != null) {
      expect(result.z1Grace).toBe(6);
    }
  });

  test("continuity never below 0", () => {
    const result = computeCardioContinuity({ z1: 0, z2: 1, z3: 0, z4: 50, z5: 50 });
    if (result.continuity != null) {
      expect(result.continuity).toBeGreaterThanOrEqual(0);
    }
  });

  test("continuity never above 100", () => {
    const result = computeCardioContinuity({ z1: 0, z2: 30, z3: 30, z4: 0, z5: 0 });
    if (result.continuity != null) {
      expect(result.continuity).toBeLessThanOrEqual(100);
    }
  });
});
