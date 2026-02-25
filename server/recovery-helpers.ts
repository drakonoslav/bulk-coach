const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface RecoveryModifiers {
  missStreak: number;
  suppressionFactor: number;
  avgDeviationMin: number | null;
  driftPenalty: number;
  driftFactor: number;
}

export function computeRecoveryModifiers(
  missStreak: number,
  avgDeviationMin: number | null,
): RecoveryModifiers {
  const suppressionFactor = 1 / (1 + missStreak);
  const driftPenalty = avgDeviationMin != null ? clamp(avgDeviationMin / 60, 0, 1) : 0;
  const driftFactor = 1 - 0.5 * driftPenalty;
  return { missStreak, suppressionFactor, avgDeviationMin, driftPenalty, driftFactor };
}

export function applyRecoveryModifiers(rawScore: number, mods: RecoveryModifiers): number {
  return clamp(rawScore * mods.suppressionFactor * mods.driftFactor, 0, 100);
}
