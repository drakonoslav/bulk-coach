import { suggestCalorieAdjustment } from "../coaching-engine";

describe("suggestCalorieAdjustment — Policy Consistency", () => {
  test("non-increasing policy: higher wkGainLb never increases calorie delta", () => {
    const xs = [
      -2.0, -1.01, -1.0, -0.999, -0.501, -0.50, -0.499, -0.25, 0.0,
      0.05, 0.099, 0.10, 0.15, 0.24, 0.249, 0.25, 0.30, 0.499, 0.50,
      0.501, 0.51, 0.60, 0.749, 0.75, 0.751, 0.76, 0.999, 1.0, 1.001, 1.5, 2.0,
    ];

    for (let i = 1; i < xs.length; i++) {
      const prev = suggestCalorieAdjustment(xs[i - 1]);
      const curr = suggestCalorieAdjustment(xs[i]);

      expect(curr).toBeLessThanOrEqual(prev);
    }
  });

  test("step boundary: moving from 0.24 → 0.25 must reduce surplus", () => {
    expect(suggestCalorieAdjustment(0.25)).toBeLessThan(suggestCalorieAdjustment(0.24));
  });

  test("step boundary: moving from -0.49 → -0.50 must not reduce surplus", () => {
    expect(suggestCalorieAdjustment(-0.50)).toBeGreaterThanOrEqual(suggestCalorieAdjustment(-0.49));
  });

  test("step boundary: moving from -0.999 → -1.00 must not reduce surplus", () => {
    expect(suggestCalorieAdjustment(-1.00)).toBeGreaterThanOrEqual(suggestCalorieAdjustment(-0.999));
  });

  test("step boundary: moving from 1.00 → 1.001 must reduce surplus", () => {
    expect(suggestCalorieAdjustment(1.001)).toBeLessThan(suggestCalorieAdjustment(1.00));
  });

  test("all outputs belong to allowed discrete policy set", () => {
    const allowed = new Set([+300, +250, +200, +100, 0, -50, -100, -150]);

    const xs = [
      -3, -1.01, -1.0, -0.999, -0.501, -0.50, -0.499, -0.25, 0, 0.099, 0.10,
      0.2399, 0.24, 0.2499, 0.25, 0.499, 0.5000, 0.5001, 0.51, 0.749, 0.75,
      0.7501, 0.76, 0.999, 1.0, 1.001, 1.5, 3,
    ];

    for (const x of xs) {
      expect(allowed.has(suggestCalorieAdjustment(x))).toBe(true);
    }
  });

  test("no accidental upward bump at any threshold boundary neighborhood", () => {
    const eps = 1e-6;
    const boundaries = [0.10, 0.25, 0.501, 0.751, 1.001];

    for (const b of boundaries) {
      const left = suggestCalorieAdjustment(b - eps);
      const right = suggestCalorieAdjustment(b + eps);

      expect(right).toBeLessThanOrEqual(left);
    }
  });

  test("loss boundaries: approaching from above never decreases delta", () => {
    const eps = 1e-6;
    const lossBoundaries = [-0.50, -1.00];

    for (const b of lossBoundaries) {
      const above = suggestCalorieAdjustment(b + eps);
      const at = suggestCalorieAdjustment(b);

      expect(at).toBeGreaterThanOrEqual(above);
    }
  });
});
