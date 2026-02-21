import {
  ffmVelocity14d,
  ffmLeanGainRatio,
  weightVelocity14d,
  FFM_VELOCITY_NOISE_FLOOR,
  WEIGHT_VELOCITY_RATIO_FLOOR,
  type DailyEntry,
} from "../coaching-engine";
import {
  detectWaistWarning,
  detectTrainingPhase,
  classifyMode,
  type TrainingPhase,
} from "../structural-confidence";
import type { StrengthBaselines } from "../strength-index";

function makeEntries(
  days: number,
  startWeight: number,
  weightDelta: number,
  startFfm: number | null,
  ffmDelta: number,
): DailyEntry[] {
  const entries: DailyEntry[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date("2026-01-01");
    d.setDate(d.getDate() + i);
    const day = d.toISOString().slice(0, 10);
    entries.push({
      day,
      weight: startWeight + (weightDelta / days) * i,
      morningWeightLb: startWeight + (weightDelta / days) * i,
      waistIn: undefined,
      caloriesIn: undefined,
      fatFreeMassLb: startFfm != null ? startFfm + (ffmDelta / days) * i : undefined,
    } as unknown as DailyEntry);
  }
  return entries;
}

describe("FFM velocity noise floor clamp", () => {
  test("ffmVelocity = 0.12 lb/wk → clamped to 0.00, labeled stable", () => {
    const entries = makeEntries(21, 180, 0.36, 145, 0.36);
    const result = ffmVelocity14d(entries);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.clampedToNoise).toBe(true);
    expect(result.velocityLbPerWeek).toBe(0);
    expect(result.label).toBe("Stable (within noise)");
    expect(Math.abs(result.rawVelocityLbPerWeek)).toBeLessThan(FFM_VELOCITY_NOISE_FLOOR);
  });

  test("ffmVelocity = 0.18 lb/wk → NOT clamped, passes through", () => {
    const entries = makeEntries(21, 180, 0.54, 145, 0.54);
    const result = ffmVelocity14d(entries);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.clampedToNoise).toBe(false);
    expect(result.velocityLbPerWeek).not.toBe(0);
    expect(result.label).toBe("Lean tissue increasing");
  });

  test("negative ffmVelocity below noise floor → clamped to 0", () => {
    const entries = makeEntries(21, 180, 0.36, 145, -0.24);
    const result = ffmVelocity14d(entries);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.clampedToNoise).toBe(true);
    expect(result.velocityLbPerWeek).toBe(0);
    expect(result.label).toBe("Stable (within noise)");
  });
});

describe("FFM Lean Gain Ratio denominator guard", () => {
  test("weightVelocity = 0.10 lb/wk → ratio null, insufficientWeight", () => {
    const entries = makeEntries(21, 180, 0.30, 145, 0.60);
    const result = ffmLeanGainRatio(entries);
    expect(result.ratio).toBeNull();
    expect(result.insufficientWeight).toBe(true);
    expect(result.label).toBe("Insufficient weight movement for ratio");
  });

  test("weightVelocity = 0.20 lb/wk → ratio computed", () => {
    const entries = makeEntries(21, 180, 0.60, 145, 0.60);
    const result = ffmLeanGainRatio(entries);
    const wV = weightVelocity14d(entries);
    expect(wV).not.toBeNull();
    if (wV != null) {
      expect(Math.abs(wV)).toBeGreaterThanOrEqual(WEIGHT_VELOCITY_RATIO_FLOOR);
    }
    expect(result.insufficientWeight).toBe(false);
    expect(result.ratio).not.toBeNull();
    expect(typeof result.ratio).toBe("number");
  });

  test("no FFM data → ratio null, not flagged as insufficient weight", () => {
    const entries = makeEntries(21, 180, 0.60, null, 0);
    const result = ffmLeanGainRatio(entries);
    expect(result.ratio).toBeNull();
    expect(result.insufficientWeight).toBe(false);
    expect(result.label).toBe("Insufficient data");
  });
});

describe("Waist acceleration warning", () => {
  test("waistVelocity > +0.20 → warning active, amber severity", () => {
    const w = detectWaistWarning(0.25);
    expect(w.active).toBe(true);
    expect(w.label).toBe("Waist rising quickly");
    expect(w.severity).toBe("amber");
  });

  test("waistVelocity = +0.20 → no warning (not strictly above threshold)", () => {
    const w = detectWaistWarning(0.20);
    expect(w.active).toBe(false);
    expect(w.severity).toBe("none");
  });

  test("waistVelocity = -0.10 → no warning", () => {
    const w = detectWaistWarning(-0.10);
    expect(w.active).toBe(false);
  });

  test("null waistVelocity → no warning", () => {
    const w = detectWaistWarning(null);
    expect(w.active).toBe(false);
  });
});

describe("Training phase detection", () => {
  const emptyBaselines: StrengthBaselines = { pushups: null, pullups: null, benchBarReps: null, ohpBarReps: null };

  test("fewer than 14 entries → default neural", () => {
    const entries = makeEntries(10, 180, 1.0, 145, 1.0);
    const phase = detectTrainingPhase(entries, emptyBaselines);
    expect(phase).toBe("neural");
  });

  test("14+ entries without strength data → neural (no velocity)", () => {
    const entries = makeEntries(21, 180, 1.0, 145, 1.0);
    const phase = detectTrainingPhase(entries, emptyBaselines);
    expect(phase).toBe("neural");
  });
});

describe("Calorie cap by phase", () => {
  const emptyBaselines: StrengthBaselines = { pushups: null, pullups: null, benchBarReps: null, ohpBarReps: null };

  test("classifyMode returns trainingPhase field", () => {
    const entries = makeEntries(21, 180, 1.0, 145, 1.0);
    const result = classifyMode(entries, emptyBaselines);
    expect(["neural", "hypertrophy"]).toContain(result.trainingPhase);
  });

  test("classifyMode returns waistWarning field", () => {
    const entries = makeEntries(21, 180, 1.0, 145, 1.0);
    const result = classifyMode(entries, emptyBaselines);
    expect(result.waistWarning).toBeDefined();
    expect(typeof result.waistWarning.active).toBe("boolean");
  });
});
