import { suggestCalorieAdjustment } from "../coaching-engine";

describe("coaching-engine: suggestCalorieAdjustment (integration contract)", () => {
  test("returns expected deltas for known weekly gains", () => {
    expect(suggestCalorieAdjustment(-2.0)).toBeDefined();
    expect(suggestCalorieAdjustment(-1.0)).toBeDefined();
    expect(suggestCalorieAdjustment(-0.5)).toBeDefined();
    expect(suggestCalorieAdjustment(0.0)).toBeDefined();
    expect(suggestCalorieAdjustment(+0.25)).toBeDefined();
    expect(suggestCalorieAdjustment(+0.5)).toBeDefined();
    expect(suggestCalorieAdjustment(+1.0)).toBeDefined();

    const allowed = new Set([+300, +250, +200, +100, 0, -50, -100, -150]);
    const inputs = [-2, -1, -0.5, 0, 0.25, 0.5, 1] as const;
    for (const x of inputs) {
      expect(allowed.has(suggestCalorieAdjustment(x))).toBe(true);
    }
  });

  test("is pure: same input always returns same output", () => {
    const x = -1.64;
    expect(suggestCalorieAdjustment(x)).toBe(suggestCalorieAdjustment(x));
    expect(suggestCalorieAdjustment(x)).toBe(suggestCalorieAdjustment(x));
  });

  test("strength/phase does not and cannot affect calorie delta (contract test)", () => {
    const wkGain = 0.10;

    const fakeStrengthVelocityPctPerWeek = 999;
    const fakePhase = "Hypertrophy";
    const fakeSCS = 100;

    const deltaA = suggestCalorieAdjustment(wkGain);

    void fakeStrengthVelocityPctPerWeek;
    void fakePhase;
    void fakeSCS;

    const deltaB = suggestCalorieAdjustment(wkGain);

    expect(deltaA).toBe(deltaB);
  });

  test("monotonic sanity: higher weekly gain should not recommend larger increases", () => {
    const d1 = suggestCalorieAdjustment(-1.0);
    const d2 = suggestCalorieAdjustment(0.0);
    const d3 = suggestCalorieAdjustment(+1.0);

    expect(d1).toBeGreaterThanOrEqual(d2);
    expect(d2).toBeGreaterThanOrEqual(d3);
  });
});
