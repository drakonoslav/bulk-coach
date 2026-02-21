import { classifyStrengthPhase } from "../strength-index";

describe("StrengthPhase — noise floor + thresholds", () => {
  // Suite 1: Noise floor clamp (display behavior)

  test("clamps +0.10%/wk to 0.00 stable", () => {
    const r = classifyStrengthPhase(0.10);
    expect(r.rawPctPerWeek).toBeCloseTo(0.10, 6);
    expect(r.displayPctPerWeek).toBeCloseTo(0.00, 6);
    expect(r.isClamped).toBe(true);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
    expect(r.label).toBe("Stable (within noise)");
  });

  test("clamps -0.10%/wk to 0.00 stable", () => {
    const r = classifyStrengthPhase(-0.10);
    expect(r.rawPctPerWeek).toBeCloseTo(-0.10, 6);
    expect(r.displayPctPerWeek).toBeCloseTo(0.00, 6);
    expect(r.isClamped).toBe(true);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
    expect(r.label).toBe("Stable (within noise)");
  });

  test("does not clamp exactly at +0.25%/wk", () => {
    const r = classifyStrengthPhase(0.25);
    expect(r.displayPctPerWeek).toBeCloseTo(0.25, 6);
    expect(r.isClamped).toBe(false);
    expect(r.label).not.toBe("Stable (within noise)");
  });

  test("does not clamp exactly at -0.25%/wk", () => {
    const r = classifyStrengthPhase(-0.25);
    expect(r.displayPctPerWeek).toBeCloseTo(-0.25, 6);
    expect(r.isClamped).toBe(false);
  });

  test("null -> INSUFFICIENT_DATA", () => {
    const r = classifyStrengthPhase(null);
    expect(r.phase).toBe("INSUFFICIENT_DATA");
    expect(r.displayPctPerWeek).toBeNull();
    expect(r.rawPctPerWeek).toBeNull();
    expect(r.isClamped).toBe(false);
    expect(r.label).toContain("Insufficient");
  });

  // Suite 2: Phase classification (exact boundaries)

  // A) NEURAL_REBOUND
  test("NEURAL_REBOUND at 6.01%/wk", () => {
    const r = classifyStrengthPhase(6.01);
    expect(r.phase).toBe("NEURAL_REBOUND");
  });

  test("NEURAL_REBOUND at 10.0%/wk", () => {
    const r = classifyStrengthPhase(10.0);
    expect(r.phase).toBe("NEURAL_REBOUND");
  });

  test("NEURAL_REBOUND at 6.0%/wk boundary (inclusive)", () => {
    const r = classifyStrengthPhase(6.0);
    expect(r.phase).toBe("NEURAL_REBOUND");
  });

  // B) LATE_NEURAL
  test("LATE_NEURAL at 5.99%/wk", () => {
    const r = classifyStrengthPhase(5.99);
    expect(r.phase).toBe("LATE_NEURAL");
  });

  test("LATE_NEURAL at 3.0%/wk boundary (inclusive)", () => {
    const r = classifyStrengthPhase(3.0);
    expect(r.phase).toBe("LATE_NEURAL");
  });

  test("LATE_NEURAL at 4.5%/wk", () => {
    const r = classifyStrengthPhase(4.5);
    expect(r.phase).toBe("LATE_NEURAL");
  });

  // C) HYPERTROPHY_PROGRESS
  test("HYPERTROPHY_PROGRESS at 2.99%/wk", () => {
    const r = classifyStrengthPhase(2.99);
    expect(r.phase).toBe("HYPERTROPHY_PROGRESS");
  });

  test("HYPERTROPHY_PROGRESS at 0.5%/wk boundary (inclusive)", () => {
    const r = classifyStrengthPhase(0.5);
    expect(r.phase).toBe("HYPERTROPHY_PROGRESS");
  });

  test("HYPERTROPHY_PROGRESS at 1.25%/wk", () => {
    const r = classifyStrengthPhase(1.25);
    expect(r.phase).toBe("HYPERTROPHY_PROGRESS");
  });

  // D) STALL_OR_FATIGUE
  test("STALL_OR_FATIGUE at 0.49%/wk", () => {
    const r = classifyStrengthPhase(0.49);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
  });

  test("STALL_OR_FATIGUE negative -1.0%/wk", () => {
    const r = classifyStrengthPhase(-1.0);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
    expect(r.isClamped).toBe(false);
    expect(r.label).toBe("Strength declining");
  });

  test("STALL_OR_FATIGUE at 0.10%/wk AND clamped", () => {
    const r = classifyStrengthPhase(0.10);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
    expect(r.isClamped).toBe(true);
    expect(r.label).toBe("Stable (within noise)");
  });

  test("STALL_OR_FATIGUE at -0.10%/wk AND clamped", () => {
    const r = classifyStrengthPhase(-0.10);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
    expect(r.isClamped).toBe(true);
    expect(r.label).toBe("Stable (within noise)");
  });

  test("STALL_OR_FATIGUE at 0.26%/wk (not clamped but still <0.5)", () => {
    const r = classifyStrengthPhase(0.26);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
    expect(r.isClamped).toBe(false);
  });

  // Suite 3: Label text expectations
  test("label contains 'Neural rebound' at 8.0%/wk", () => {
    const r = classifyStrengthPhase(8.0);
    expect(r.label).toContain("Neural rebound");
  });

  test("label contains 'Late neural' at 4.0%/wk", () => {
    const r = classifyStrengthPhase(4.0);
    expect(r.label).toContain("Late neural");
  });

  test("label contains 'Hypertrophy-range' at 1.0%/wk", () => {
    const r = classifyStrengthPhase(1.0);
    expect(r.label).toContain("Hypertrophy-range");
  });

  test("label equals 'Stable (within noise)' at 0.0%/wk (clamped)", () => {
    const r = classifyStrengthPhase(0.0);
    expect(r.label).toBe("Stable (within noise)");
    expect(r.isClamped).toBe(true);
  });

  // Edge: zero is within noise floor
  test("zero is within noise floor and STALL_OR_FATIGUE", () => {
    const r = classifyStrengthPhase(0.0);
    expect(r.phase).toBe("STALL_OR_FATIGUE");
    expect(r.displayPctPerWeek).toBe(0.0);
    expect(r.isClamped).toBe(true);
  });
});
