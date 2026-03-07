import type {
  InterventionAction,
  InterventionActionKind,
  InterventionStateInputs,
  InterventionStateSnapshot,
} from "./intervention-types";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function norm01(x: number | null | undefined): number | null {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  return clamp(x, 0, 1);
}

export function buildInterventionStateSnapshot(
  inputs: InterventionStateInputs,
): InterventionStateSnapshot {
  return {
    date: inputs.date ?? new Date().toISOString(),

    readinessScore: inputs.readinessScore ?? null,
    readinessTier: inputs.readinessTier ?? null,
    readinessConfidence: norm01(inputs.readinessConfidence),

    hpaScore: inputs.hpaScore ?? null,
    recoveryIndex: inputs.recoveryIndex ?? null,
    cortisolFlag: Boolean(inputs.cortisolFlag ?? false),

    strengthVelocityPctPerWeek: inputs.strengthVelocityPctPerWeek ?? null,
    ffmVelocityLbPerWeek: inputs.ffmVelocityLbPerWeek ?? null,
    waistVelocityInPerWeek: inputs.waistVelocityInPerWeek ?? null,

    strengthPhase: inputs.strengthPhase ?? null,
    adaptationStage: inputs.adaptationStage ?? null,
    mode: inputs.mode ?? null,
    dayClassifier: inputs.dayClassifier ?? null,

    plateauForecastStatus: inputs.plateauForecastStatus ?? null,
    fatigueForecastStatus: inputs.fatigueForecastStatus ?? null,
    peakForecastStatus: inputs.peakForecastStatus ?? null,

    sleepDeltaPct: inputs.sleepDeltaPct ?? null,
    hrvDeltaPct: inputs.hrvDeltaPct ?? null,
    rhrDeltaBpm: inputs.rhrDeltaBpm ?? null,

    structuralConfidence: norm01(inputs.structuralConfidence),
  };
}

export function actionDeload(days: number, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "DELOAD", payload: { days }, source };
}

export function actionReduceVolume(percent: number, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "REDUCE_VOLUME", payload: { percent }, source };
}

export function actionReduceIntensity(percent: number, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "REDUCE_INTENSITY", payload: { percent }, source };
}

export function actionAddRestDay(days: number = 1, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "ADD_REST_DAY", payload: { days }, source };
}

export function actionIncreaseCalories(kcal: number, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "INCREASE_CALORIES", payload: { kcal }, source };
}

export function actionDecreaseCalories(kcal: number, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "DECREASE_CALORIES", payload: { kcal }, source };
}

export function actionIncreaseCarbs(grams: number, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "INCREASE_CARBS", payload: { grams }, source };
}

export function actionReduceCardio(sessions: number, source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "REDUCE_CARDIO", payload: { sessions }, source };
}

export function actionShiftIsolationFocus(
  muscleGroup: string,
  deltaSets: number,
  source: InterventionAction["source"] = "coach",
): InterventionAction {
  return { kind: "SHIFT_ISOLATION_FOCUS", payload: { muscleGroup, deltaSets }, source };
}

export function actionHoldSteady(source: InterventionAction["source"] = "coach"): InterventionAction {
  return { kind: "HOLD_STEADY", payload: {}, source };
}

export function actionCustom(
  label: string,
  payload: Record<string, number | string | boolean | null> = {},
  source: InterventionAction["source"] = "coach",
): InterventionAction {
  return { kind: "CUSTOM", payload: { label, ...payload }, source };
}

export function normalizeActionKind(raw: string): InterventionActionKind {
  const x = raw.trim().toUpperCase();
  if (x.includes("DELOAD")) return "DELOAD";
  if (x.includes("REDUCE_VOLUME")) return "REDUCE_VOLUME";
  if (x.includes("REDUCE_INTENSITY")) return "REDUCE_INTENSITY";
  if (x.includes("REST")) return "ADD_REST_DAY";
  if (x.includes("INCREASE_CAL")) return "INCREASE_CALORIES";
  if (x.includes("DECREASE_CAL")) return "DECREASE_CALORIES";
  if (x.includes("CARB")) return "INCREASE_CARBS";
  if (x.includes("CARDIO")) return "REDUCE_CARDIO";
  if (x.includes("ISOLATION")) return "SHIFT_ISOLATION_FOCUS";
  if (x.includes("HOLD")) return "HOLD_STEADY";
  return "CUSTOM";
}
