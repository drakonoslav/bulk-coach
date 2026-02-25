import { computeRecoveryModifiers, applyRecoveryModifiers } from "../recovery-helpers";

describe("computeRecoveryModifiers", () => {
  describe("suppressionFactor = 1/(1+missStreak)", () => {
    it("missStreak=0 → suppressionFactor=1.0", () => {
      const m = computeRecoveryModifiers(0, null);
      expect(m.suppressionFactor).toBe(1);
    });
    it("missStreak=1 → suppressionFactor=0.5", () => {
      const m = computeRecoveryModifiers(1, null);
      expect(m.suppressionFactor).toBe(0.5);
    });
    it("missStreak=3 → suppressionFactor=0.25", () => {
      const m = computeRecoveryModifiers(3, null);
      expect(m.suppressionFactor).toBe(0.25);
    });
  });

  describe("driftFactor math with avgDeviationMin", () => {
    it("avgDeviationMin=0 → driftPenalty=0, driftFactor=1.0", () => {
      const m = computeRecoveryModifiers(0, 0);
      expect(m.driftPenalty).toBe(0);
      expect(m.driftFactor).toBe(1);
    });
    it("avgDeviationMin=30 → driftPenalty=0.5, driftFactor=0.75", () => {
      const m = computeRecoveryModifiers(0, 30);
      expect(m.driftPenalty).toBe(0.5);
      expect(m.driftFactor).toBe(0.75);
    });
    it("avgDeviationMin=60 → driftPenalty=1.0, driftFactor=0.5", () => {
      const m = computeRecoveryModifiers(0, 60);
      expect(m.driftPenalty).toBe(1);
      expect(m.driftFactor).toBe(0.5);
    });
    it("avgDeviationMin=120 → clamped to driftPenalty=1.0, driftFactor=0.5", () => {
      const m = computeRecoveryModifiers(0, 120);
      expect(m.driftPenalty).toBe(1);
      expect(m.driftFactor).toBe(0.5);
    });
    it("avgDeviationMin=null → driftPenalty=0, driftFactor=1.0", () => {
      const m = computeRecoveryModifiers(0, null);
      expect(m.driftPenalty).toBe(0);
      expect(m.driftFactor).toBe(1);
    });
  });

  describe("applyRecoveryModifiers combines suppression and drift", () => {
    it("rawScore=100, missStreak=3, avgDev=30 → 100*0.25*0.75 = 18.75", () => {
      const mods = computeRecoveryModifiers(3, 30);
      const result = applyRecoveryModifiers(100, mods);
      expect(result).toBeCloseTo(18.75, 6);
    });
    it("rawScore=80, missStreak=0, avgDev=0 → 80 (no suppression, no drift)", () => {
      const mods = computeRecoveryModifiers(0, 0);
      const result = applyRecoveryModifiers(80, mods);
      expect(result).toBe(80);
    });
    it("clamps to 0-100 range", () => {
      const mods = computeRecoveryModifiers(0, 0);
      expect(applyRecoveryModifiers(-10, mods)).toBe(0);
      expect(applyRecoveryModifiers(150, mods)).toBe(100);
    });
  });
});
