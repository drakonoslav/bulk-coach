export type InterventionConfidence = "low" | "medium" | "high";

export type InterventionEvidenceLevel = "weak" | "moderate" | "strong";

export type InterventionActionKind =
  | "DELOAD"
  | "REDUCE_VOLUME"
  | "REDUCE_INTENSITY"
  | "ADD_REST_DAY"
  | "INCREASE_CALORIES"
  | "DECREASE_CALORIES"
  | "INCREASE_CARBS"
  | "REDUCE_CARDIO"
  | "SHIFT_ISOLATION_FOCUS"
  | "HOLD_STEADY"
  | "CUSTOM";

export interface InterventionStateSnapshot {
  date: string;

  readinessScore: number | null;
  readinessTier: string | null;
  readinessConfidence: number | null;

  hpaScore: number | null;
  recoveryIndex: number | null;
  cortisolFlag: boolean;

  strengthVelocityPctPerWeek: number | null;
  ffmVelocityLbPerWeek: number | null;
  waistVelocityInPerWeek: number | null;

  strengthPhase: string | null;
  adaptationStage: string | null;
  mode: string | null;
  dayClassifier: string | null;

  plateauForecastStatus: string | null;
  fatigueForecastStatus: string | null;
  peakForecastStatus: string | null;

  sleepDeltaPct: number | null;
  hrvDeltaPct: number | null;
  rhrDeltaBpm: number | null;

  structuralConfidence: number | null;
}

export interface InterventionAction {
  kind: InterventionActionKind;
  payload?: Record<string, number | string | boolean | null>;
  source: "user" | "coach" | "auto";
}

export interface InterventionOutcomeWindow {
  days: 3 | 7 | 14;

  readinessDelta: number | null;
  hpaDelta: number | null;
  recoveryIndexDelta: number | null;
  strengthVelocityDelta: number | null;
  ffmVelocityDelta: number | null;
  waistVelocityDelta: number | null;

  plateauRiskImproved: boolean | null;
  fatigueRiskImproved: boolean | null;
  peakReached: boolean | null;
}

export interface InterventionExperience {
  id: string;
  createdAt: string;

  state: InterventionStateSnapshot;
  action: InterventionAction;

  outcome3d?: InterventionOutcomeWindow;
  outcome7d?: InterventionOutcomeWindow;
  outcome14d?: InterventionOutcomeWindow;

  effectivenessScore?: number | null;
  notes?: string | null;
}

export interface SimilarCaseMatch {
  experienceId: string;
  similarity: number;
  effectivenessScore: number | null;
  action: InterventionAction;
  daysOld: number | null;
  caseScore: number;
}

export interface InterventionPolicySummary {
  currentState: InterventionStateSnapshot;
  topAction: InterventionAction | null;
  confidence: InterventionConfidence;
  evidenceLevel: InterventionEvidenceLevel;
  evidenceScore: number;
  drivers: string[];
  similarCases: SimilarCaseMatch[];
}

export interface InterventionStateInputs {
  date?: string | null;

  readinessScore?: number | null;
  readinessTier?: string | null;
  readinessConfidence?: number | null;

  hpaScore?: number | null;
  recoveryIndex?: number | null;
  cortisolFlag?: boolean | null;

  strengthVelocityPctPerWeek?: number | null;
  ffmVelocityLbPerWeek?: number | null;
  waistVelocityInPerWeek?: number | null;

  strengthPhase?: string | null;
  adaptationStage?: string | null;
  mode?: string | null;
  dayClassifier?: string | null;

  plateauForecastStatus?: string | null;
  fatigueForecastStatus?: string | null;
  peakForecastStatus?: string | null;

  sleepDeltaPct?: number | null;
  hrvDeltaPct?: number | null;
  rhrDeltaBpm?: number | null;

  structuralConfidence?: number | null;
}
