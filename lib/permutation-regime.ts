export type RankKey = string;

export type RegimeAnalysis = {
  code: string;
  ranked: { key: RankKey; value: number }[];
  gapTop: number;
  gapBottom: number;
  minGap: number;
  confidencePct: number;
  confidenceLabel: "fragile" | "soft" | "moderate" | "strong";
  adjacentEvolution: string | null;
  boundaryDriver: string;
};

export type RegimeMomentum = {
  direction: "toward" | "away" | "stable";
  velocity: number;
  label: string;
};

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function analyzePermutationRegime(
  values: Record<RankKey, number | null | undefined>,
  maxMeaningfulGap = 25
): RegimeAnalysis | null {
  const ranked = Object.entries(values)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([key, value]) => ({ key, value: value as number }))
    .sort((a, b) => b.value - a.value);

  if (ranked.length !== 3) return null;

  const code = ranked.map(r => r.key).join("");
  const gapTop = ranked[0].value - ranked[1].value;
  const gapBottom = ranked[1].value - ranked[2].value;
  const minGap = Math.min(gapTop, gapBottom);

  const confidencePct = Math.round(100 * clamp01(minGap / maxMeaningfulGap));

  let confidenceLabel: RegimeAnalysis["confidenceLabel"] = "fragile";
  if (confidencePct >= 70) confidenceLabel = "strong";
  else if (confidencePct >= 40) confidenceLabel = "moderate";
  else if (confidencePct >= 15) confidenceLabel = "soft";

  let adjacentEvolution: string | null = null;
  let boundaryDriver = "";

  if (gapTop <= gapBottom) {
    adjacentEvolution = `${ranked[1].key}${ranked[0].key}${ranked[2].key}`;
    boundaryDriver = `${ranked[0].key} ~ ${ranked[1].key}`;
  } else {
    adjacentEvolution = `${ranked[0].key}${ranked[2].key}${ranked[1].key}`;
    boundaryDriver = `${ranked[1].key} ~ ${ranked[2].key}`;
  }

  return {
    code,
    ranked,
    gapTop,
    gapBottom,
    minGap,
    confidencePct,
    confidenceLabel,
    adjacentEvolution,
    boundaryDriver,
  };
}

export function humanizeBoundaryDriver(
  raw: string,
  mode: "capacity" | "output"
): string {
  if (mode === "capacity") {
    return raw
      .replace(/\bA\b/g, "Awake")
      .replace(/\bL\b/g, "Latency")
      .replace(/\bW\b/g, "WASO");
  }

  return raw
    .replace(/\bC\b/g, "Capacity")
    .replace(/\bD\b/g, "Deep Sleep")
    .replace(/\bF\b/g, "FFM");
}

export function confidenceTone(
  pct: number
): "low" | "moderate" | "high" {
  if (pct >= 70) return "high";
  if (pct >= 40) return "moderate";
  return "low";
}

export function simpleSlope(
  series: Array<number | null | undefined>,
  idx: number
): number | null {
  if (!series || idx < 2) return null;

  const a = series[idx - 2];
  const b = series[idx - 1];
  const c = series[idx];

  if (
    typeof a !== "number" ||
    !Number.isFinite(a) ||
    typeof b !== "number" ||
    !Number.isFinite(b) ||
    typeof c !== "number" ||
    !Number.isFinite(c)
  ) {
    return null;
  }

  return ((b - a) + (c - b)) / 2;
}

export function analyzeRegimeMomentum(
  ranked: { key: string; value: number }[],
  slopes: Record<string, number | null | undefined>,
  boundaryDriver: string,
  eps = 0.001
): RegimeMomentum | null {
  if (!ranked || ranked.length !== 3) return null;

  const [leftKeyRaw, rightKeyRaw] = boundaryDriver.split("~").map(s => s.trim());
  if (!leftKeyRaw || !rightKeyRaw) return null;

  const slopeLeft = slopes[leftKeyRaw];
  const slopeRight = slopes[rightKeyRaw];

  if (
    typeof slopeLeft !== "number" ||
    !Number.isFinite(slopeLeft) ||
    typeof slopeRight !== "number" ||
    !Number.isFinite(slopeRight)
  ) {
    return null;
  }

  const velocity = slopeRight - slopeLeft;

  if (velocity > eps) {
    return {
      direction: "toward",
      velocity,
      label: "Drifting toward crossover",
    };
  }

  if (velocity < -eps) {
    return {
      direction: "away",
      velocity,
      label: "Drifting away from crossover",
    };
  }

  return {
    direction: "stable",
    velocity,
    label: "Boundary stable",
  };
}

export function humanizeMomentumLabel(
  momentum: RegimeMomentum | null,
  adjacentEvolution: string | null
): string {
  if (!momentum) return "—";
  if (!adjacentEvolution) return momentum.label;

  if (momentum.direction === "toward") {
    return `Toward ${adjacentEvolution}`;
  }
  if (momentum.direction === "away") {
    return `Away from ${adjacentEvolution}`;
  }
  return "Stable";
}

export function momentumArrow(
  momentum: RegimeMomentum | null
): "\u2191" | "\u2193" | "\u2192" {
  if (!momentum) return "\u2192";
  if (momentum.direction === "toward") return "\u2191";
  if (momentum.direction === "away") return "\u2193";
  return "\u2192";
}

export function adjacentOpacity(confidencePct: number): number {
  const t = confidencePct / 100;
  const instability = 1 - t;
  const fade = Math.max(0, (instability - 0.2) / 0.8);
  return Math.min(1, fade);
}
