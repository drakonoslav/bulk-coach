export type CardioZones = { z1: number; z2: number; z3: number; z4: number; z5: number };

export type CardioContinuityResult =
  | {
      continuity: number;
      denominator: "total_weighted_offband";
      total: number;
      z1Grace: number;
      z1Penalty: number;
      offBandWeighted: number;
    }
  | { continuity: null; denominator: "total_weighted_offband"; reason: "no_total_minutes" };

export function computeCardioContinuity(z: CardioZones): CardioContinuityResult {
  const total = z.z1 + z.z2 + z.z3 + z.z4 + z.z5;
  if (total <= 0) {
    return { continuity: null, denominator: "total_weighted_offband", reason: "no_total_minutes" };
  }

  const z1Grace = Math.min(Math.max(Math.round(0.10 * total), 2), 6);
  const z1Penalty = Math.max(0, z.z1 - z1Grace);
  const offBandWeighted = 0.5 * z1Penalty + 1.25 * (z.z4 + z.z5);
  const raw = 100 * (1 - offBandWeighted / total);
  const continuity = Math.min(Math.max(raw, 0), 100);

  return {
    continuity,
    denominator: "total_weighted_offband",
    total,
    z1Grace,
    z1Penalty,
    offBandWeighted,
  };
}
