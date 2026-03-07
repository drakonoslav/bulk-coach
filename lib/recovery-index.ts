export interface RecoveryIndexPair {
  hrv: number;
  rhr: number;
  ratio: number;
}

export interface RecoveryIndexResult {
  pairs: RecoveryIndexPair[];
  now: number | null;
  prev: number | null;
}

export function computeRecoveryIndexPairs(
  rows: { hrv?: number | null; rhr?: number | null }[],
): RecoveryIndexResult {
  const pairs: RecoveryIndexPair[] = [];
  for (const r of rows) {
    if (r.hrv != null && r.rhr != null && r.rhr > 0) {
      pairs.push({ hrv: r.hrv, rhr: r.rhr, ratio: r.hrv / r.rhr });
    }
  }
  const len = pairs.length;
  return {
    pairs,
    now: len >= 1 ? pairs[len - 1].ratio : null,
    prev: len >= 2 ? pairs[len - 2].ratio : null,
  };
}
