import type {
  ForecastConfidence,
  ForecastResult,
  PeakStrengthForecastInput,
} from "./forecast-types";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function confidenceLabel(score: number): ForecastConfidence {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function insufficient(drivers: string[]): ForecastResult {
  return {
    status: "insufficient_data",
    window: { daysMin: null, daysMax: null },
    confidence: "low",
    drivers,
  };
}

function buildWindow(
  centerDays: number,
  uncertaintyDays: number,
  horizonMax: number,
): { daysMin: number; daysMax: number } {
  let daysMin = clamp(Math.floor(centerDays - uncertaintyDays), 0, horizonMax);
  let daysMax = clamp(Math.ceil(centerDays + uncertaintyDays), 0, horizonMax);

  if (daysMin === daysMax && daysMax < horizonMax) {
    daysMax += 1;
  }

  return { daysMin, daysMax };
}

function getPeakThresholdPctPerWeek(phase: string | null): number {
  if (phase === "NEURAL_REBOUND") return 3.0;
  if (phase === "LATE_NEURAL") return 1.5;
  if (phase === "HYPERTROPHY_PROGRESS") return 0.5;
  return 0.5;
}

export function forecastPeakStrength(
  input: PeakStrengthForecastInput,
): ForecastResult {
  const {
    strengthVelocityNowPctPerWeek: vNow,
    strengthVelocityPrevPctPerWeek: vPrev,
    phase,
    adaptationStage,
    signalQuality,
    daysSincePhaseTransition,
    plateauDetected,
  } = input;

  if (!isFiniteNumber(vNow)) {
    return insufficient(["current strength velocity unavailable"]);
  }

  if (!isFiniteNumber(vPrev)) {
    return insufficient(["previous strength velocity unavailable"]);
  }

  if (!isFiniteNumber(signalQuality) || signalQuality < 0.45) {
    return insufficient(["strength signal quality too low for forecasting"]);
  }

  const drivers: string[] = [];
  const horizonMax = 14;

  const aDay = (vNow - vPrev) / 14;
  const vPeakThresh = getPeakThresholdPctPerWeek(phase);

  if (plateauDetected || phase === "PLATEAU" || phase === "STALL") {
    drivers.push("plateau already detected");
    if (phase) drivers.push(`current phase: ${phase.toLowerCase()}`);
    return {
      status: "past_peak",
      window: { daysMin: 0, daysMax: 3 },
      confidence: confidenceLabel(
        0.4 * signalQuality + 0.35 + 0.25 * (phase ? 1 : 0.7),
      ),
      drivers,
    };
  }

  let status: ForecastResult["status"] = "rising";
  let daysToPeak = 0;

  if (vNow <= vPeakThresh && vNow > 0) {
    status = "near_peak";
    daysToPeak = 2;
    drivers.push("strength velocity is already near phase-specific peak threshold");
  } else if (vNow > vPeakThresh && aDay < 0) {
    status = "rising";
    daysToPeak = (vPeakThresh - vNow) / aDay;
    daysToPeak = clamp(daysToPeak, 0, horizonMax);
    drivers.push("velocity deceleration indicates approaching crest");
  } else if (vNow > vPeakThresh && aDay >= 0) {
    status = "rising";
    daysToPeak = clamp(7 - 2 * Math.min(vNow / 3, 1), 3, 10);
    drivers.push("strength velocity still positive and not yet decelerating");
  } else if (vNow <= 0) {
    status = "past_peak";
    daysToPeak = 0;
    drivers.push("strength velocity is non-positive");
  }

  if (phase === "NEURAL_REBOUND") {
    drivers.push("current phase: neural rebound");
  } else if (phase === "LATE_NEURAL") {
    drivers.push("current phase: late neural");
  } else if (phase === "HYPERTROPHY_PROGRESS") {
    drivers.push("current phase: hypertrophy progress");
  }

  if (daysSincePhaseTransition != null) {
    drivers.push(`recent phase transition ${daysSincePhaseTransition}d ago`);
  }

  if (adaptationStage === "PLATEAU_RISK") {
    drivers.push("adaptation stage indicates plateau risk");
  }

  const uncertaintyDays =
    1 +
    3 * (1 - signalQuality) +
    (Math.abs(aDay) < 0.03 ? 2 : 0) +
    (daysSincePhaseTransition == null ? 1 : 0);

  const window = buildWindow(daysToPeak, uncertaintyDays, horizonMax);

  const confScore =
    0.4 * signalQuality +
    0.25 * (daysSincePhaseTransition != null ? 1 : 0) +
    0.2 * clamp(Math.abs(aDay) / 0.08, 0, 1) +
    0.15 * (status === "near_peak" || status === "past_peak" ? 1 : 0.7);

  return {
    status,
    window,
    confidence: confidenceLabel(confScore),
    drivers,
  };
}
