import type {
  InterventionConfidence,
  InterventionPolicySummary,
  InterventionStateSnapshot,
  SimilarCaseMatch,
} from "./intervention-types";
import type { CandidateAction } from "./intervention-candidates";

export interface RankedCandidateAction {
  key: CandidateAction["key"];
  action: CandidateAction["action"];
  score: number;
  historicalActionScore: number;
  forecastAlignment: number;
  evidenceScore: number;
  riskPenalty: number;
  drivers: string[];
  supportingCases: SimilarCaseMatch[];
}

export interface InterventionDecisionSummary {
  recommendedAction: RankedCandidateAction | null;
  confidence: InterventionConfidence;
  drivers: string[];
  runnerUps: RankedCandidateAction[];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function evidenceLevelToScore(
  level: "weak" | "moderate" | "strong" | null | undefined,
): number {
  if (level === "weak") return 0.35;
  if (level === "moderate") return 0.65;
  if (level === "strong") return 0.90;
  return 0.40;
}

function confidenceLabel(score: number): InterventionConfidence {
  if (score > 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

export function scoreHistoricalAction(
  candidate: CandidateAction,
  policy: InterventionPolicySummary,
): { score: number; supportingCases: SimilarCaseMatch[] } {
  const supportingCases = (policy.similarCases ?? []).filter(
    (c) => c.action.kind === candidate.action.kind,
  );

  if (!supportingCases.length) {
    return { score: 0.45, supportingCases: [] };
  }

  const avgCaseScore = mean(supportingCases.map((c) => c.caseScore));
  return {
    score: clamp(avgCaseScore, 0, 1),
    supportingCases,
  };
}

export function scoreForecastAlignment(
  candidate: CandidateAction,
  state: InterventionStateSnapshot,
): { score: number; drivers: string[] } {
  let score = 0.5;
  const drivers: string[] = [];

  const fatigue = state.fatigueForecastStatus;
  const plateau = state.plateauForecastStatus;
  const peak = state.peakForecastStatus;

  if (fatigue === "high_risk") {
    if (candidate.key === "DELOAD") { score += 0.35; drivers.push("matches high fatigue risk"); }
    if (candidate.key === "REDUCE_VOLUME_20") { score += 0.25; drivers.push("supports fatigue reduction"); }
    if (candidate.key === "ADD_REST_DAY") { score += 0.25; drivers.push("supports recovery"); }
    if (candidate.key === "REDUCE_CARDIO_1_SESSION") { score += 0.15; drivers.push("reduces recovery burden"); }
    if (candidate.key === "HOLD_STEADY") { score -= 0.25; drivers.push("conflicts with high fatigue risk"); }
    if (candidate.key === "INCREASE_CARBS_40G") { score += 0.05; drivers.push("mildly supports recovery"); }
  } else if (fatigue === "rising_risk") {
    if (candidate.key === "DELOAD") { score += 0.20; drivers.push("matches rising fatigue risk"); }
    if (candidate.key === "REDUCE_VOLUME_20") { score += 0.20; drivers.push("supports fatigue reduction"); }
    if (candidate.key === "ADD_REST_DAY") { score += 0.15; drivers.push("supports recovery"); }
    if (candidate.key === "REDUCE_CARDIO_1_SESSION") { score += 0.10; drivers.push("reduces recovery burden"); }
    if (candidate.key === "HOLD_STEADY") { score -= 0.15; drivers.push("less ideal with rising fatigue"); }
    if (candidate.key === "INCREASE_CARBS_40G") { score += 0.05; drivers.push("mildly supports recovery"); }
  }

  if (plateau === "plateau_likely") {
    if (candidate.key === "INCREASE_CARBS_40G") { score += 0.25; drivers.push("supports plateau escape"); }
    if (candidate.key === "REDUCE_CARDIO_1_SESSION") { score += 0.20; drivers.push("supports growth recovery"); }
    if (candidate.key === "HOLD_STEADY") { score += 0.05; drivers.push("minimally compatible with plateau"); }
    if (candidate.key === "DELOAD") { score -= 0.15; drivers.push("may delay plateau resolution"); }
  } else if (plateau === "slowing") {
    if (candidate.key === "INCREASE_CARBS_40G") { score += 0.15; drivers.push("supports slowing growth"); }
    if (candidate.key === "REDUCE_CARDIO_1_SESSION") { score += 0.15; drivers.push("supports slowing growth"); }
    if (candidate.key === "HOLD_STEADY") { score += 0.05; drivers.push("compatible with slowing phase"); }
  }

  if (peak === "near_peak") {
    if (candidate.key === "HOLD_STEADY") { score += 0.25; drivers.push("protects near-peak window"); }
    if (candidate.key === "REDUCE_VOLUME_20") { score += 0.10; drivers.push("light fatigue reduction near peak"); }
    if (candidate.key === "ADD_REST_DAY") { score += 0.05; drivers.push("can preserve peak freshness"); }
    if (candidate.key === "DELOAD") { score -= 0.25; drivers.push("too disruptive near peak"); }
    if (candidate.key === "INCREASE_CARBS_40G") { score += 0.05; drivers.push("mild support for peak performance"); }
    if (candidate.key === "REDUCE_CARDIO_1_SESSION") { score += 0.05; drivers.push("mild support for peak performance"); }
  } else if (peak === "rising") {
    if (candidate.key === "HOLD_STEADY") { score += 0.10; drivers.push("supports continued rise"); }
    if (candidate.key === "DELOAD") { score -= 0.10; drivers.push("unnecessary if peak is still rising"); }
  }

  return { score: clamp(score, 0, 1), drivers };
}

export function scoreEvidence(
  policy: InterventionPolicySummary,
): number {
  return evidenceLevelToScore(policy.evidenceLevel ?? null);
}

export function scoreRiskPenalty(
  candidate: CandidateAction,
  state: InterventionStateSnapshot,
): { score: number; drivers: string[] } {
  let penalty = 0;
  const drivers: string[] = [];

  const waist = state.waistVelocityInPerWeek;
  const readiness = state.readinessScore;
  const fatigue = state.fatigueForecastStatus;
  const peak = state.peakForecastStatus;

  if (candidate.key === "INCREASE_CARBS_40G" && typeof waist === "number") {
    if (waist > 0.15) {
      penalty += 0.35;
      drivers.push("waist trend makes extra carbs riskier");
    } else if (waist > 0.08) {
      penalty += 0.20;
      drivers.push("waist trend mildly penalizes extra carbs");
    }
  }

  if (candidate.key === "HOLD_STEADY") {
    if (fatigue === "high_risk") {
      penalty += 0.40;
      drivers.push("hold steady is risky with high fatigue");
    }
    if (state.cortisolFlag) {
      penalty += 0.15;
      drivers.push("cortisol flag penalizes hold steady");
    }
    if (typeof readiness === "number" && readiness < 45) {
      penalty += 0.20;
      drivers.push("low readiness penalizes hold steady");
    }
  }

  if (candidate.key === "DELOAD") {
    if (peak === "near_peak") {
      penalty += 0.30;
      drivers.push("deload disrupts near-peak state");
    }
    if (fatigue === "stable") {
      penalty += 0.10;
      drivers.push("stable fatigue slightly penalizes deload");
    }
    if (typeof readiness === "number" && readiness > 70) {
      penalty += 0.10;
      drivers.push("good readiness slightly penalizes deload");
    }
  }

  if (candidate.key === "REDUCE_CARDIO_1_SESSION") {
    if (fatigue === "stable" && state.plateauForecastStatus === "progressing") {
      penalty += 0.10;
      drivers.push("reduced cardio less needed in stable/progressing state");
    }
  }

  if (candidate.key === "ADD_REST_DAY") {
    if (typeof readiness === "number" && readiness > 75 && fatigue === "stable") {
      penalty += 0.15;
      drivers.push("extra rest less needed with high readiness");
    }
  }

  return { score: clamp(penalty, 0, 1), drivers };
}

export function scoreCandidateAction(
  candidate: CandidateAction,
  state: InterventionStateSnapshot,
  policy: InterventionPolicySummary,
): RankedCandidateAction {
  const hist = scoreHistoricalAction(candidate, policy);
  const align = scoreForecastAlignment(candidate, state);
  const evidence = scoreEvidence(policy);
  const risk = scoreRiskPenalty(candidate, state);

  const score = clamp(
    0.40 * hist.score +
      0.25 * align.score +
      0.20 * evidence -
      0.15 * risk.score,
    0,
    1,
  );

  return {
    key: candidate.key,
    action: candidate.action,
    score,
    historicalActionScore: hist.score,
    forecastAlignment: align.score,
    evidenceScore: evidence,
    riskPenalty: risk.score,
    supportingCases: hist.supportingCases,
    drivers: [
      ...align.drivers,
      ...risk.drivers,
      hist.supportingCases.length
        ? `${hist.supportingCases.length} supporting historical case(s)`
        : "limited direct historical support",
    ],
  };
}

export function rankCandidateActions(
  candidates: CandidateAction[],
  state: InterventionStateSnapshot,
  policy: InterventionPolicySummary,
): RankedCandidateAction[] {
  return candidates
    .map((c) => scoreCandidateAction(c, state, policy))
    .sort((a, b) => b.score - a.score);
}

export function buildDecisionSummary(
  ranked: RankedCandidateAction[],
  policy: InterventionPolicySummary,
): InterventionDecisionSummary {
  if (!ranked.length) {
    return {
      recommendedAction: null,
      confidence: "low",
      drivers: ["no candidate actions available"],
      runnerUps: [],
    };
  }

  const top = ranked[0];
  const runnerUp = ranked[1] ?? null;
  const scoreGap = runnerUp ? top.score - runnerUp.score : top.score;
  const scoreGapScaled = clamp(scoreGap / 0.25, 0, 1);
  const evidenceBase = scoreEvidence(policy);
  const historySupport = clamp(top.supportingCases.length / 4, 0, 1);

  const decisionConfidenceScore =
    0.45 * top.score +
    0.20 * scoreGapScaled +
    0.20 * evidenceBase +
    0.15 * historySupport;

  const confidence = confidenceLabel(decisionConfidenceScore);

  const drivers = [
    `decision score ${top.score.toFixed(2)}`,
    `evidence ${(evidenceBase * 100).toFixed(0)}%`,
    `score gap ${scoreGap.toFixed(2)}`,
    ...top.drivers.slice(0, 3),
  ];

  if (policy.topAction == null) {
    drivers.push("policy history is sparse; decision leans on forecast/risk structure");
  }

  return {
    recommendedAction: top,
    confidence,
    drivers,
    runnerUps: ranked.slice(1, 3),
  };
}
