import { suggestCalorieAdjustment } from "../coaching-engine";

describe("suggestCalorieAdjustment — Policy Consistency", () => {
  test("non-increasing policy: higher wkGainLb never increases calorie delta", () => {
    const xs = [
      -2.0, -1.0, -0.5, 0.0,
      0.05, 0.099, 0.10, 0.15, 0.24, 0.249, 0.25, 0.30, 0.50,
      0.509, 0.51, 0.60, 0.75, 0.751, 1.0, 2.0,
    ];

    for (let i = 1; i < xs.length; i++) {
      const prev = suggestCalorieAdjustment(xs[i - 1]);
      const curr = suggestCalorieAdjustment(xs[i]);

      expect(curr).toBeLessThanOrEqual(prev);
    }
  });

  test("step boundary: moving from 0.24 → 0.25 must reduce surplus", () => {
    const at024 = suggestCalorieAdjustment(0.24);
    const at025 = suggestCalorieAdjustment(0.25);

    expect(at025).toBeLessThan(at024);
  });

  test("all outputs belong to allowed discrete policy set", () => {
    const allowed = new Set([+100, +75, 0, -50, -100]);

    const xs = [
      -3, -1, 0, 0.099, 0.10, 0.2399, 0.24, 0.2499, 0.25, 0.5000, 0.5001,
      0.5099, 0.51, 0.7499, 0.75, 0.7501, 1.5, 3,
    ];

    for (const x of xs) {
      expect(allowed.has(suggestCalorieAdjustment(x))).toBe(true);
    }
  });

  test("no accidental upward bump at any threshold boundary neighborhood", () => {
    const eps = 1e-6;
    const boundaries = [0.10, 0.25, 0.51, 0.75];

    for (const b of boundaries) {
      const left = suggestCalorieAdjustment(b - eps);
      const right = suggestCalorieAdjustment(b + eps);

      expect(right).toBeLessThanOrEqual(left);
    }
  });
});
