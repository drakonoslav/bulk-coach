import type {
  InterventionExperience,
  InterventionPolicySummary,
  InterventionStateSnapshot,
  SimilarCaseMatch,
} from "./intervention-types";
import { computeStateSimilarity } from "./intervention-similarity";
import { scoreInterventionEffectiveness } from "./intervention-outcomes";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function normalizedEffectiveness(score: number | null): number {
  if (score == null || !Number.isFinite(score)) return 0.5;
  return clamp((score + 1) / 2, 0, 1);
}

function daysOldFromDate(iso: string): number | null {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  return Math.max(0, Math.floor(diffMs / 86400000));
}

function recencyScore(daysOld: number | null): number {
  if (daysOld == null) return 0.5;
  return Math.exp(-daysOld / 90);
}

function confidenceLabel(score: number): "low" | "medium" | "high" {
  if (score >= 0.75) return "high";
  if (score >= 0.50) return "medium";
  return "low";
}

export function recommendIntervention(
  currentState: InterventionStateSnapshot,
  history: InterventionExperience[],
): InterventionPolicySummary {
  const rawCases: SimilarCaseMatch[] = history.map((exp) => {
    const similarity = computeStateSimilarity(currentState, exp.state);
    const effectivenessScore =
      exp.effectivenessScore ?? scoreInterventionEffectiveness(exp);
    const normEff = normalizedEffectiveness(effectivenessScore);
    const daysOld = daysOldFromDate(exp.createdAt);
    const rec = recencyScore(daysOld);

    const caseScore =
      0.55 * similarity +
      0.30 * normEff +
      0.15 * rec;

    return {
      experienceId: exp.id,
      similarity,
      effectivenessScore,
      action: exp.action,
      daysOld,
      caseScore,
    };
  });

  const similarCases = rawCases
    .filter((c) => c.similarity >= 0.55)
    .sort((a, b) => b.caseScore - a.caseScore);

  if (similarCases.length === 0) {
    return {
      currentState,
      topAction: null,
      confidence: "low",
      drivers: ["insufficient prior similar cases"],
      similarCases: [],
    };
  }

  const grouped = new Map<
    string,
    { action: SimilarCaseMatch["action"]; cases: SimilarCaseMatch[] }
  >();

  for (const c of similarCases) {
    const key = c.action.kind;
    const existing = grouped.get(key);
    if (existing) {
      existing.cases.push(c);
    } else {
      grouped.set(key, { action: c.action, cases: [c] });
    }
  }

  const ranked = Array.from(grouped.values()).map((group) => {
    const avgCaseScore =
      group.cases.reduce((sum, c) => sum + c.caseScore, 0) / group.cases.length;

    const effVals = group.cases.map((c) =>
      normalizedEffectiveness(c.effectivenessScore),
    );
    const avgNormEff =
      effVals.reduce((sum, x) => sum + x, 0) / Math.max(effVals.length, 1);

    const mean = avgNormEff;
    const variance =
      effVals.reduce((sum, x) => sum + (x - mean) ** 2, 0) /
      Math.max(effVals.length, 1);
    const stdevEff = Math.sqrt(variance);

    const actionScore =
      0.60 * avgCaseScore +
      0.40 * avgNormEff;

    return {
      action: group.action,
      cases: group.cases,
      avgCaseScore,
      avgNormEff,
      stdevEff,
      actionScore,
    };
  });

  ranked.sort((a, b) => b.actionScore - a.actionScore);
  const best = ranked[0];

  const topSimilarity = best.cases[0]?.similarity ?? 0;
  const supportScore = clamp(best.cases.length / 4, 0, 1);
  const consistencyScore = clamp(1 - best.stdevEff / 0.35, 0, 1);

  const policyConf =
    0.45 * topSimilarity +
    0.25 * best.avgNormEff +
    0.15 * supportScore +
    0.15 * consistencyScore;

  const drivers: string[] = [];
  drivers.push(`top similarity ${topSimilarity.toFixed(2)}`);
  drivers.push(`${best.cases.length} similar case${best.cases.length === 1 ? "" : "s"}`);
  drivers.push(`avg effectiveness ${(best.avgNormEff * 100).toFixed(0)}%`);
  if (consistencyScore >= 0.7) drivers.push("outcomes were consistent");
  else drivers.push("outcomes were mixed");

  return {
    currentState,
    topAction: best.action,
    confidence: confidenceLabel(policyConf),
    drivers,
    similarCases: similarCases.slice(0, 5),
  };
}
