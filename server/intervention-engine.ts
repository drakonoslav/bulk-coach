import type {
  InterventionAction,
  InterventionPolicySummary,
  InterventionStateInputs,
  InterventionStateSnapshot,
} from "../lib/intervention-types";
import { buildInterventionStateSnapshot } from "../lib/intervention-state";
import { recommendIntervention } from "../lib/intervention-policy";
import {
  saveInterventionExperience,
  listInterventionExperiences,
} from "./intervention-store";

export interface ExistingInterventionOutputs {
  date?: string | null;

  readinessScore?: number | null;
  readinessTier?: string | null;
  readinessConfidenceGrade?: string | null;

  hpaScore?: number | null;
  recoveryIndexNow?: number | null;
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

function mapConfidenceGradeToNumeric(grade: string | null | undefined): number | null {
  if (grade === "High") return 0.9;
  if (grade === "Med") return 0.65;
  if (grade === "Low") return 0.35;
  return null;
}

export function buildCurrentInterventionStateFromExistingOutputs(
  o: ExistingInterventionOutputs,
): InterventionStateSnapshot {
  const inputs: InterventionStateInputs = {
    date: o.date ?? undefined,
    readinessScore: o.readinessScore,
    readinessTier: o.readinessTier,
    readinessConfidence: mapConfidenceGradeToNumeric(o.readinessConfidenceGrade),
    hpaScore: o.hpaScore,
    recoveryIndex: o.recoveryIndexNow,
    cortisolFlag: o.cortisolFlag,
    strengthVelocityPctPerWeek: o.strengthVelocityPctPerWeek,
    ffmVelocityLbPerWeek: o.ffmVelocityLbPerWeek,
    waistVelocityInPerWeek: o.waistVelocityInPerWeek,
    strengthPhase: o.strengthPhase,
    adaptationStage: o.adaptationStage,
    mode: o.mode,
    dayClassifier: o.dayClassifier,
    plateauForecastStatus: o.plateauForecastStatus,
    fatigueForecastStatus: o.fatigueForecastStatus,
    peakForecastStatus: o.peakForecastStatus,
    sleepDeltaPct: o.sleepDeltaPct,
    hrvDeltaPct: o.hrvDeltaPct,
    rhrDeltaBpm: o.rhrDeltaBpm,
    structuralConfidence: o.structuralConfidence,
  };

  return buildInterventionStateSnapshot(inputs);
}

export async function buildInterventionPolicySummary(
  existingOutputs: ExistingInterventionOutputs,
  userId: string,
): Promise<InterventionPolicySummary> {
  const currentState = buildCurrentInterventionStateFromExistingOutputs(existingOutputs);
  const history = await listInterventionExperiences(userId, 100);
  return recommendIntervention(currentState, history);
}

export async function recordIntervention(
  userId: string,
  existingOutputs: ExistingInterventionOutputs,
  action: InterventionAction,
  notes?: string | null,
): Promise<string> {
  const state = buildCurrentInterventionStateFromExistingOutputs(existingOutputs);
  return saveInterventionExperience(userId, state, action, notes);
}
