import type {
  FatigueRiskForecastInput,
  ForecastSummary,
  PeakStrengthForecastInput,
  PlateauForecastInput,
} from "../lib/forecast-types";

import { forecastPeakStrength } from "../lib/forecast-peak-strength";
import { forecastFatigueRisk } from "../lib/forecast-fatigue-risk";
import { forecastHypertrophyPlateau } from "../lib/forecast-plateau";

export interface ForecastEngineInputs {
  peakStrength: PeakStrengthForecastInput;
  fatigueRisk: FatigueRiskForecastInput;
  hypertrophyPlateau: PlateauForecastInput;
}

export function buildForecastSummary(
  inputs: ForecastEngineInputs,
): ForecastSummary {
  return {
    peakStrength: forecastPeakStrength(inputs.peakStrength),
    fatigueRisk: forecastFatigueRisk(inputs.fatigueRisk),
    hypertrophyPlateau: forecastHypertrophyPlateau(inputs.hypertrophyPlateau),
  };
}

export interface ExistingSystemOutputs {
  strengthVelocityNowPctPerWeek?: number | null;
  strengthVelocityPrevPctPerWeek?: number | null;
  strengthPhase?: string | null;
  adaptationStage?: string | null;
  strengthSignalQuality?: number | null;
  daysSincePhaseTransition?: number | null;
  plateauDetected?: boolean;

  readinessNow?: number | null;
  readinessPrev?: number | null;
  readinessConfidence?: number | null;
  hpaNow?: number | null;
  hpaPrev?: number | null;
  recoveryIndexNow?: number | null;
  recoveryIndexPrev?: number | null;
  cortisolFlag?: boolean;
  sleepDeltaPct?: number | null;
  hrvDeltaPct?: number | null;
  rhrDelta?: number | null;

  ffmVelocityNowLbPerWeek?: number | null;
  ffmVelocityPrevLbPerWeek?: number | null;
  waistVelocityNowInPerWeek?: number | null;
  structuralConfidence?: number | null;
  mode?: string | null;
}

export function buildForecastSummaryFromExistingOutputs(
  o: ExistingSystemOutputs,
): ForecastSummary {
  return buildForecastSummary({
    peakStrength: {
      strengthVelocityNowPctPerWeek: o.strengthVelocityNowPctPerWeek ?? null,
      strengthVelocityPrevPctPerWeek: o.strengthVelocityPrevPctPerWeek ?? null,
      phase: o.strengthPhase ?? null,
      adaptationStage: o.adaptationStage ?? null,
      signalQuality: o.strengthSignalQuality ?? null,
      daysSincePhaseTransition: o.daysSincePhaseTransition ?? null,
      plateauDetected: o.plateauDetected ?? false,
    },
    fatigueRisk: {
      readinessNow: o.readinessNow ?? null,
      readinessPrev: o.readinessPrev ?? null,
      readinessConfidence: o.readinessConfidence ?? null,
      hpaNow: o.hpaNow ?? null,
      hpaPrev: o.hpaPrev ?? null,
      recoveryIndexNow: o.recoveryIndexNow ?? null,
      recoveryIndexPrev: o.recoveryIndexPrev ?? null,
      cortisolFlag: o.cortisolFlag ?? false,
      sleepDeltaPct: o.sleepDeltaPct ?? null,
      hrvDeltaPct: o.hrvDeltaPct ?? null,
      rhrDelta: o.rhrDelta ?? null,
    },
    hypertrophyPlateau: {
      strengthVelocityNowPctPerWeek: o.strengthVelocityNowPctPerWeek ?? null,
      strengthVelocityPrevPctPerWeek: o.strengthVelocityPrevPctPerWeek ?? null,
      ffmVelocityNowLbPerWeek: o.ffmVelocityNowLbPerWeek ?? null,
      ffmVelocityPrevLbPerWeek: o.ffmVelocityPrevLbPerWeek ?? null,
      waistVelocityNowInPerWeek: o.waistVelocityNowInPerWeek ?? null,
      plateauDetected: o.plateauDetected ?? false,
      adaptationStage: o.adaptationStage ?? null,
      structuralConfidence: o.structuralConfidence ?? null,
      mode: o.mode ?? null,
    },
  });
}
