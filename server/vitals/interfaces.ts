// ═══════════════════════════════════════════════════════════════════════════════
// BulkCoach Vitals — Formal Interfaces (v1 Build Packet)
// ═══════════════════════════════════════════════════════════════════════════════

import {
  CardioMode, LiftMode, MacroDayType,
  OscillatorClass, CycleWeekType,
} from "./enums.js";

// ─── Primitive helpers ────────────────────────────────────────────────────────

export interface ScoreBreakdownItem {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  note?: string;
}

export interface MacroTargets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MealTimingTargets {
  preCardioCarbsG: number;
  postCardioProteinG: number;
  postCardioCarbsG: number;
  postCardioFatG: number;
  meal2ProteinG: number;
  meal2CarbsG: number;
  meal2FatG: number;
  preLiftProteinG: number;
  preLiftCarbsG: number;
  preLiftFatG: number;
  postLiftProteinG: number;
  postLiftCarbsG: number;
  postLiftFatG: number;
  finalMealProteinG: number;
  finalMealCarbsG: number;
  finalMealFatG: number;
}

// ─── Baseline / rolling reference types ──────────────────────────────────────

export interface UserVitalsBaselines {
  hrvYearAvg: number | null;
  rhrYearAvg: number | null;
  bodyWeightSetpointLb: number | null;
  waistSetpointIn: number | null;
  proteinFloorG: number;
  fatFloorAvgG: number;
  defaultKcal: number;
}

export interface RollingReferences {
  hrv7dAvg: number | null;
  rhr7dAvg: number | null;
  sleepDuration7dAvg: number | null;
  sleepMidpoint7dAvg: number | null;
  bodyWeight7dAvg: number | null;
  kcal7dAvg: number | null;
  protein7dAvg: number | null;
  carbs7dAvg: number | null;
  fat7dAvg: number | null;
  weightTrend14dLbPerWeek: number | null;
  ffmTrend14dLbPerWeek: number | null;
  waistChange14dIn: number | null;
  strengthTrend14dPct: number | null;
  hrv28dAvg: number | null;
  hrvPrev28dAvg: number | null;
  rhr28dAvg: number | null;
  rhrPrev28dAvg: number | null;
  sleepRegularity28dScore: number | null;
  sleepRegularityPrev28dScore: number | null;
  ffm28dAvg: number | null;
  ffmPrev28dAvg: number | null;
  weight28dChangeLb: number | null;
  waist28dChangeIn: number | null;
  cardioZone2Count7d: number;
  cardioZone3Count7d: number;
  cardioRecoveryCount7d: number;
  neuralLiftCount7d: number;
  resetOrResensitizeDayCount28d: number;
  deloadCompliance28d: boolean;
  trainingMonotonyIndex28d: number | null;
  lightExposureConsistency28d: number | null;
  virilityTrend28d: number | null;
}

// ─── Recommendation interfaces ────────────────────────────────────────────────

export interface DailyRecommendationFlags {
  hardStopFatigue: boolean;
  lowSleep: boolean;
  elevatedRhr: boolean;
  suppressedHrv: boolean;
  cardioMonotony: boolean;
  monthlyResensitizeOverride: boolean;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface VitalsDashboardResponse {
  date: string;
  userId: string;
  scores: {
    acute: number;
    resource: number;
    seasonal: number;
    composite: number;
    oscillatorClass: OscillatorClass;
  };
  today: {
    bodyWeightLb: number | null;
    bodyFatPct: number | null;
    fatFreeMassLb: number | null;
    waistAtNavelIn: number | null;
    restingHrBpm: number | null;
    hrvMs: number | null;
    sleepDurationMin: number | null;
    kcalActual: number | null;
    proteinGActual: number | null;
    carbsGActual: number | null;
    fatGActual: number | null;
  };
  trends: {
    weightTrend14dLbPerWeek: number | null;
    ffmTrend14dLbPerWeek: number | null;
    strengthTrend14dPct: number | null;
    waistChange14dIn: number | null;
    hrv28dAvg: number | null;
    rhr28dAvg: number | null;
  };
  weeklyDistribution: {
    zone2Count7d: number;
    zone3Count7d: number;
    recoveryCount7d: number;
    neuralLiftCount7d: number;
  };
  recommendation: {
    cardioMode: CardioMode;
    liftMode: LiftMode;
    macroDayType: MacroDayType;
    macroTargets: MacroTargets;
    mealTimingTargets: MealTimingTargets;
    reasoning: string[];
  };
  breakdowns: {
    acute: ScoreBreakdownItem[];
    resource: ScoreBreakdownItem[];
    seasonal: ScoreBreakdownItem[];
  };
  flags: DailyRecommendationFlags;
  cycleDay28: number;
  cycleWeekType: CycleWeekType;
  explanationText: string;
  dataQuality: "full" | "partial" | "insufficient";
}
