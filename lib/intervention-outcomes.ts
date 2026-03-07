import type {
  InterventionExperience,
  InterventionOutcomeWindow,
  InterventionStateSnapshot,
} from "./intervention-types";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function delta(after: number | null, before: number | null): number | null {
  if (!isFiniteNumber(after) || !isFiniteNumber(before)) return null;
  return after - before;
}

function norm(deltaValue: number | null, scale: number, invert = false): number | null {
  if (!isFiniteNumber(deltaValue) || scale <= 0) return null;
  const v = invert ? -deltaValue : deltaValue;
  return clamp(v / scale, -1, 1);
}

function boolBonus(v: boolean | null): number {
  if (v == null) return 0;
  return v === true ? 0.5 : 0;
}

function safeWeightedAverage(
  items: Array<{ value: number | null; weight: number }>,
): number | null {
  let num = 0;
  let den = 0;

  for (const item of items) {
    if (!isFiniteNumber(item.value)) continue;
    num += item.value * item.weight;
    den += item.weight;
  }

  if (den <= 0) return null;
  return num / den;
}

export function buildOutcomeWindow(
  beforeState: InterventionStateSnapshot,
  afterState: InterventionStateSnapshot,
  days: 3 | 7 | 14,
): InterventionOutcomeWindow {
  const readinessDelta = delta(afterState.readinessScore, beforeState.readinessScore);
  const hpaDelta = delta(afterState.hpaScore, beforeState.hpaScore);
  const recoveryIndexDelta = delta(afterState.recoveryIndex, beforeState.recoveryIndex);
  const strengthVelocityDelta = delta(
    afterState.strengthVelocityPctPerWeek,
    beforeState.strengthVelocityPctPerWeek,
  );
  const ffmVelocityDelta = delta(
    afterState.ffmVelocityLbPerWeek,
    beforeState.ffmVelocityLbPerWeek,
  );
  const waistVelocityDelta = delta(
    afterState.waistVelocityInPerWeek,
    beforeState.waistVelocityInPerWeek,
  );

  const plateauRiskImproved =
    beforeState.plateauForecastStatus === "plateau_likely" &&
    afterState.plateauForecastStatus !== "plateau_likely"
      ? true
      : beforeState.plateauForecastStatus != null && afterState.plateauForecastStatus != null
        ? false
        : null;

  const fatigueRiskImproved =
    (beforeState.fatigueForecastStatus === "high_risk" ||
      beforeState.fatigueForecastStatus === "rising_risk") &&
    afterState.fatigueForecastStatus === "stable"
      ? true
      : beforeState.fatigueForecastStatus != null && afterState.fatigueForecastStatus != null
        ? false
        : null;

  const peakReached =
    beforeState.peakForecastStatus === "near_peak" &&
    (afterState.peakForecastStatus === "past_peak" ||
      afterState.peakForecastStatus === "near_peak")
      ? true
      : beforeState.peakForecastStatus != null && afterState.peakForecastStatus != null
        ? false
        : null;

  return {
    days,
    readinessDelta,
    hpaDelta,
    recoveryIndexDelta,
    strengthVelocityDelta,
    ffmVelocityDelta,
    waistVelocityDelta,
    plateauRiskImproved,
    fatigueRiskImproved,
    peakReached,
  };
}

export function scoreOutcomeWindow(
  outcome: InterventionOutcomeWindow,
): number | null {
  const scoreReadiness = norm(outcome.readinessDelta, 15, false);
  const scoreHpa = norm(outcome.hpaDelta, 15, true);
  const scoreRecovery = norm(outcome.recoveryIndexDelta, 0.15, false);
  const scoreStrength = norm(outcome.strengthVelocityDelta, 2.0, false);
  const scoreFfm = norm(outcome.ffmVelocityDelta, 0.15, false);
  const scoreWaist = norm(outcome.waistVelocityDelta, 0.15, true);

  const bonusFatigue = boolBonus(outcome.fatigueRiskImproved);
  const bonusPlateau = boolBonus(outcome.plateauRiskImproved);
  const bonusPeak = outcome.peakReached === true ? 0.5 : 0;

  if (outcome.days === 3) {
    return safeWeightedAverage([
      { value: scoreReadiness, weight: 0.30 },
      { value: scoreHpa, weight: 0.25 },
      { value: scoreRecovery, weight: 0.20 },
      { value: scoreStrength, weight: 0.10 },
      { value: scoreFfm, weight: 0.05 },
      { value: scoreWaist, weight: 0.05 },
      { value: bonusFatigue, weight: 0.05 },
    ]);
  }

  if (outcome.days === 7) {
    return safeWeightedAverage([
      { value: scoreReadiness, weight: 0.20 },
      { value: scoreHpa, weight: 0.15 },
      { value: scoreRecovery, weight: 0.15 },
      { value: scoreStrength, weight: 0.20 },
      { value: scoreFfm, weight: 0.15 },
      { value: scoreWaist, weight: 0.05 },
      { value: bonusFatigue, weight: 0.05 },
      { value: bonusPlateau, weight: 0.05 },
    ]);
  }

  return safeWeightedAverage([
    { value: scoreReadiness, weight: 0.10 },
    { value: scoreHpa, weight: 0.10 },
    { value: scoreRecovery, weight: 0.10 },
    { value: scoreStrength, weight: 0.20 },
    { value: scoreFfm, weight: 0.25 },
    { value: scoreWaist, weight: 0.10 },
    { value: bonusPlateau, weight: 0.10 },
    { value: bonusPeak, weight: 0.05 },
  ]);
}

export function scoreInterventionEffectiveness(
  exp: InterventionExperience,
): number | null {
  const s3 = exp.outcome3d ? scoreOutcomeWindow(exp.outcome3d) : null;
  const s7 = exp.outcome7d ? scoreOutcomeWindow(exp.outcome7d) : null;
  const s14 = exp.outcome14d ? scoreOutcomeWindow(exp.outcome14d) : null;

  return safeWeightedAverage([
    { value: s3, weight: 0.25 },
    { value: s7, weight: 0.40 },
    { value: s14, weight: 0.35 },
  ]);
}
