import type { InterventionStateSnapshot } from "./intervention-types";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function numericSimilarity(
  a: number | null,
  b: number | null,
  scale: number,
): number | null {
  if (!isFiniteNumber(a) || !isFiniteNumber(b) || scale <= 0) return null;
  return clamp(1 - Math.abs(a - b) / scale, 0, 1);
}

function exactSimilarity(
  a: string | boolean | null,
  b: string | boolean | null,
): number | null {
  if (a == null || b == null) return null;
  return a === b ? 1 : 0;
}

export function computeStateSimilarity(
  now: InterventionStateSnapshot,
  past: InterventionStateSnapshot,
): number {
  const parts: Array<{ sim: number | null; weight: number }> = [
    { sim: numericSimilarity(now.readinessScore, past.readinessScore, 25), weight: 1.2 },
    { sim: numericSimilarity(now.hpaScore, past.hpaScore, 25), weight: 1.2 },
    { sim: numericSimilarity(now.recoveryIndex, past.recoveryIndex, 0.25), weight: 1.0 },
    { sim: exactSimilarity(now.cortisolFlag, past.cortisolFlag), weight: 0.8 },

    { sim: numericSimilarity(now.strengthVelocityPctPerWeek, past.strengthVelocityPctPerWeek, 3.0), weight: 1.0 },
    { sim: numericSimilarity(now.ffmVelocityLbPerWeek, past.ffmVelocityLbPerWeek, 0.25), weight: 0.9 },
    { sim: numericSimilarity(now.waistVelocityInPerWeek, past.waistVelocityInPerWeek, 0.20), weight: 0.5 },

    { sim: exactSimilarity(now.strengthPhase, past.strengthPhase), weight: 0.8 },
    { sim: exactSimilarity(now.adaptationStage, past.adaptationStage), weight: 1.0 },
    { sim: exactSimilarity(now.mode, past.mode), weight: 0.8 },
    { sim: exactSimilarity(now.dayClassifier, past.dayClassifier), weight: 0.5 },

    { sim: exactSimilarity(now.plateauForecastStatus, past.plateauForecastStatus), weight: 0.7 },
    { sim: exactSimilarity(now.fatigueForecastStatus, past.fatigueForecastStatus), weight: 0.8 },
    { sim: exactSimilarity(now.peakForecastStatus, past.peakForecastStatus), weight: 0.6 },

    { sim: numericSimilarity(now.sleepDeltaPct, past.sleepDeltaPct, 15), weight: 0.4 },
    { sim: numericSimilarity(now.hrvDeltaPct, past.hrvDeltaPct, 15), weight: 0.5 },
    { sim: numericSimilarity(now.rhrDeltaBpm, past.rhrDeltaBpm, 5), weight: 0.5 },

    { sim: numericSimilarity(now.structuralConfidence, past.structuralConfidence, 0.40), weight: 0.3 },
    { sim: numericSimilarity(now.readinessConfidence, past.readinessConfidence, 0.40), weight: 0.3 },
  ];

  let num = 0;
  let den = 0;
  let matchedFeatureCount = 0;
  let totalWeight = 0;

  for (const part of parts) {
    totalWeight += part.weight;
    if (part.sim == null) continue;
    matchedFeatureCount++;
    num += part.sim * part.weight;
    den += part.weight;
  }

  if (den <= 0) return 0;

  const MIN_MATCHED_FEATURES = 4;
  const MIN_WEIGHT_FRACTION = 0.30;
  if (matchedFeatureCount < MIN_MATCHED_FEATURES || den / totalWeight < MIN_WEIGHT_FRACTION) {
    return 0;
  }

  return clamp(num / den, 0, 1);
}
