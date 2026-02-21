import { suggestCalorieAdjustment } from "../coaching-engine";

describe("suggestCalorieAdjustment — aggressive table boundary tests", () => {

  // --- <= -1.00 → +300 ---
  test("wkGainLb = -2.00 → +300", () => {
    expect(suggestCalorieAdjustment(-2.00)).toBe(+300);
  });

  test("wkGainLb = -1.01 → +300", () => {
    expect(suggestCalorieAdjustment(-1.01)).toBe(+300);
  });

  test("wkGainLb = -1.00 → +300 (boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(-1.00)).toBe(+300);
  });

  // --- (-1.00, -0.50] → +250 ---
  test("wkGainLb = -0.999 → +250 (just above -1.00)", () => {
    expect(suggestCalorieAdjustment(-0.999)).toBe(+250);
  });

  test("wkGainLb = -0.501 → +250", () => {
    expect(suggestCalorieAdjustment(-0.501)).toBe(+250);
  });

  test("wkGainLb = -0.50 → +250 (boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(-0.50)).toBe(+250);
  });

  // --- (-0.50, 0.10) → +200 ---
  test("wkGainLb = -0.499 → +200 (just above -0.50)", () => {
    expect(suggestCalorieAdjustment(-0.499)).toBe(+200);
  });

  test("wkGainLb = -0.49 → +200", () => {
    expect(suggestCalorieAdjustment(-0.49)).toBe(+200);
  });

  test("wkGainLb = 0.00 → +200", () => {
    expect(suggestCalorieAdjustment(0.00)).toBe(+200);
  });

  test("wkGainLb = 0.09 → +200", () => {
    expect(suggestCalorieAdjustment(0.09)).toBe(+200);
  });

  test("wkGainLb = 0.099 → +200", () => {
    expect(suggestCalorieAdjustment(0.099)).toBe(+200);
  });

  // --- [0.10, 0.25) → +100 ---
  test("wkGainLb = 0.10 → +100 (boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.10)).toBe(+100);
  });

  test("wkGainLb = 0.101 → +100", () => {
    expect(suggestCalorieAdjustment(0.101)).toBe(+100);
  });

  test("wkGainLb = 0.15 → +100", () => {
    expect(suggestCalorieAdjustment(0.15)).toBe(+100);
  });

  test("wkGainLb = 0.24 → +100", () => {
    expect(suggestCalorieAdjustment(0.24)).toBe(+100);
  });

  test("wkGainLb = 0.249 → +100", () => {
    expect(suggestCalorieAdjustment(0.249)).toBe(+100);
  });

  // --- [0.25, 0.50] → 0 ---
  test("wkGainLb = 0.25 → 0 (boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.25)).toBe(0);
  });

  test("wkGainLb = 0.251 → 0", () => {
    expect(suggestCalorieAdjustment(0.251)).toBe(0);
  });

  test("wkGainLb = 0.40 → 0", () => {
    expect(suggestCalorieAdjustment(0.40)).toBe(0);
  });

  test("wkGainLb = 0.499 → 0", () => {
    expect(suggestCalorieAdjustment(0.499)).toBe(0);
  });

  test("wkGainLb = 0.50 → 0 (boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.50)).toBe(0);
  });

  // --- (0.50, 0.75] → -50 ---
  test("wkGainLb = 0.501 → -50 (just above 0.50)", () => {
    expect(suggestCalorieAdjustment(0.501)).toBe(-50);
  });

  test("wkGainLb = 0.51 → -50", () => {
    expect(suggestCalorieAdjustment(0.51)).toBe(-50);
  });

  test("wkGainLb = 0.60 → -50", () => {
    expect(suggestCalorieAdjustment(0.60)).toBe(-50);
  });

  test("wkGainLb = 0.749 → -50", () => {
    expect(suggestCalorieAdjustment(0.749)).toBe(-50);
  });

  test("wkGainLb = 0.75 → -50 (boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.75)).toBe(-50);
  });

  // --- (0.75, 1.00] → -100 ---
  test("wkGainLb = 0.751 → -100 (just above 0.75)", () => {
    expect(suggestCalorieAdjustment(0.751)).toBe(-100);
  });

  test("wkGainLb = 0.76 → -100", () => {
    expect(suggestCalorieAdjustment(0.76)).toBe(-100);
  });

  test("wkGainLb = 0.999 → -100", () => {
    expect(suggestCalorieAdjustment(0.999)).toBe(-100);
  });

  test("wkGainLb = 1.00 → -100 (boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(1.00)).toBe(-100);
  });

  // --- > 1.00 → -150 ---
  test("wkGainLb = 1.001 → -150 (just above 1.00)", () => {
    expect(suggestCalorieAdjustment(1.001)).toBe(-150);
  });

  test("wkGainLb = 1.50 → -150", () => {
    expect(suggestCalorieAdjustment(1.50)).toBe(-150);
  });

  // --- floating point safety ---
  test("floating precision: 0.2499999 → +100", () => {
    expect(suggestCalorieAdjustment(0.2499999)).toBe(+100);
  });

  test("floating precision: 0.2500001 → 0", () => {
    expect(suggestCalorieAdjustment(0.2500001)).toBe(0);
  });

  // --- policy consistency: boundary crossings ---
  test("crossing -1.00 → -0.999 does not increase surplus", () => {
    expect(suggestCalorieAdjustment(-0.999)).toBeLessThanOrEqual(suggestCalorieAdjustment(-1.00));
  });

  test("crossing -0.50 → -0.499 does not increase surplus", () => {
    expect(suggestCalorieAdjustment(-0.499)).toBeLessThanOrEqual(suggestCalorieAdjustment(-0.50));
  });

  test("crossing -0.49 → -0.50 does not reduce surplus", () => {
    expect(suggestCalorieAdjustment(-0.50)).toBeGreaterThanOrEqual(suggestCalorieAdjustment(-0.49));
  });

  test("crossing 0.24 → 0.25 does not increase surplus", () => {
    expect(suggestCalorieAdjustment(0.25)).toBeLessThanOrEqual(suggestCalorieAdjustment(0.24));
  });

  test("crossing 0.50 → 0.51 does not increase surplus", () => {
    expect(suggestCalorieAdjustment(0.51)).toBeLessThanOrEqual(suggestCalorieAdjustment(0.50));
  });

  test("crossing 0.75 → 0.751 does not increase surplus", () => {
    expect(suggestCalorieAdjustment(0.751)).toBeLessThanOrEqual(suggestCalorieAdjustment(0.75));
  });

  test("crossing 1.00 → 1.001 does not increase surplus", () => {
    expect(suggestCalorieAdjustment(1.001)).toBeLessThanOrEqual(suggestCalorieAdjustment(1.00));
  });
});
