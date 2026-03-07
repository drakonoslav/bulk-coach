export type ForecastStatus =
  | "rising"
  | "near_peak"
  | "past_peak"
  | "stable"
  | "rising_risk"
  | "high_risk"
  | "progressing"
  | "slowing"
  | "plateau_likely"
  | "insufficient_data";

export type ForecastConfidence = "low" | "medium" | "high";

export interface ForecastWindow {
  daysMin: number | null;
  daysMax: number | null;
}

export interface ForecastResult {
  status: ForecastStatus;
  window: ForecastWindow;
  confidence: ForecastConfidence;
  drivers: string[];
}

export interface ForecastSummary {
  peakStrength: ForecastResult;
  fatigueRisk: ForecastResult;
  hypertrophyPlateau: ForecastResult;
}

export interface PeakStrengthForecastInput {
  strengthVelocityNowPctPerWeek: number | null;
  strengthVelocityPrevPctPerWeek: number | null;
  phase:
    | "NEURAL_REBOUND"
    | "LATE_NEURAL"
    | "HYPERTROPHY_PROGRESS"
    | "STALL"
    | "PLATEAU"
    | string
    | null;
  adaptationStage:
    | "NOVELTY_WINDOW"
    | "STANDARD_HYPERTROPHY"
    | "ADVANCED_SLOW_GAIN"
    | "PLATEAU_RISK"
    | string
    | null;
  signalQuality: number | null;
  daysSincePhaseTransition: number | null;
  plateauDetected: boolean;
}

export interface FatigueRiskForecastInput {
  readinessNow: number | null;
  readinessPrev: number | null;
  readinessConfidence: number | null;
  hpaNow: number | null;
  hpaPrev: number | null;
  recoveryIndexNow: number | null;
  recoveryIndexPrev: number | null;
  cortisolFlag: boolean;
  sleepDeltaPct: number | null;
  hrvDeltaPct: number | null;
  rhrDelta: number | null;
}

export interface PlateauForecastInput {
  strengthVelocityNowPctPerWeek: number | null;
  strengthVelocityPrevPctPerWeek: number | null;
  ffmVelocityNowLbPerWeek: number | null;
  ffmVelocityPrevLbPerWeek: number | null;
  waistVelocityNowInPerWeek: number | null;
  plateauDetected: boolean;
  adaptationStage:
    | "NOVELTY_WINDOW"
    | "STANDARD_HYPERTROPHY"
    | "ADVANCED_SLOW_GAIN"
    | "PLATEAU_RISK"
    | string
    | null;
  structuralConfidence: number | null;
  mode: string | null;
}
