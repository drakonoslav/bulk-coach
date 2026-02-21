import { suggestCalorieAdjustment } from "../coaching-engine";

describe("suggestCalorieAdjustment — exact threshold behavior", () => {

  // --- < 0.10 → +100 kcal ---
  test("wkGainLb = -1.00 → +100", () => {
    expect(suggestCalorieAdjustment(-1.00)).toBe(+100);
  });

  test("wkGainLb = 0.00 → +100", () => {
    expect(suggestCalorieAdjustment(0.00)).toBe(+100);
  });

  test("wkGainLb = 0.099 → +100", () => {
    expect(suggestCalorieAdjustment(0.099)).toBe(+100);
  });

  // --- 0.10 – 0.24 → +75 kcal ---
  test("wkGainLb = 0.10 → +75 (lower boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.10)).toBe(+75);
  });

  test("wkGainLb = 0.15 → +75", () => {
    expect(suggestCalorieAdjustment(0.15)).toBe(+75);
  });

  test("wkGainLb = 0.24 → +75 (upper boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.24)).toBe(+75);
  });

  // --- 0.25 – 0.50 → 0 kcal ---
  test("wkGainLb = 0.25 → 0 (lower boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.25)).toBe(0);
  });

  test("wkGainLb = 0.40 → 0", () => {
    expect(suggestCalorieAdjustment(0.40)).toBe(0);
  });

  test("wkGainLb = 0.50 → 0 (upper boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.50)).toBe(0);
  });

  // --- 0.51 – 0.75 → -50 kcal ---
  test("wkGainLb = 0.51 → -50 (lower boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.51)).toBe(-50);
  });

  test("wkGainLb = 0.60 → -50", () => {
    expect(suggestCalorieAdjustment(0.60)).toBe(-50);
  });

  test("wkGainLb = 0.75 → -50 (upper boundary inclusive)", () => {
    expect(suggestCalorieAdjustment(0.75)).toBe(-50);
  });

  // --- > 0.75 → -100 kcal ---
  test("wkGainLb = 0.751 → -100", () => {
    expect(suggestCalorieAdjustment(0.751)).toBe(-100);
  });

  test("wkGainLb = 1.50 → -100", () => {
    expect(suggestCalorieAdjustment(1.50)).toBe(-100);
  });

  // --- floating point safety ---
  test("floating precision: 0.2499999 → +75", () => {
    expect(suggestCalorieAdjustment(0.2499999)).toBe(+75);
  });

  test("floating precision: 0.2500001 → 0", () => {
    expect(suggestCalorieAdjustment(0.2500001)).toBe(0);
  });

  // --- policy consistency: crossing a boundary never increases surplus ---
  test("crossing 0.24 → 0.25 does not increase calorie surplus", () => {
    const below = suggestCalorieAdjustment(0.24);
    const above = suggestCalorieAdjustment(0.25);
    expect(below).toBeGreaterThanOrEqual(above);
  });

  test("crossing 0.50 → 0.51 does not increase calorie surplus", () => {
    const below = suggestCalorieAdjustment(0.50);
    const above = suggestCalorieAdjustment(0.51);
    expect(below).toBeGreaterThanOrEqual(above);
  });

  test("crossing 0.75 → 0.751 does not increase calorie surplus", () => {
    const below = suggestCalorieAdjustment(0.75);
    const above = suggestCalorieAdjustment(0.751);
    expect(below).toBeGreaterThanOrEqual(above);
  });
});
