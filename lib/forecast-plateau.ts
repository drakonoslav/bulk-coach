import type {
  ForecastConfidence,
  ForecastResult,
  PlateauForecastInput,
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

export function forecastHypertrophyPlateau(
  input: PlateauForecastInput,
): ForecastResult {
  const {
    strengthVelocityNowPctPerWeek,
    strengthVelocityPrevPctPerWeek,
    ffmVelocityNowLbPerWeek,
    ffmVelocityPrevLbPerWeek,
    waistVelocityNowInPerWeek,
    plateauDetected,
    adaptationStage,
    structuralConfidence,
    mode,
  } = input;

  if (
    !isFiniteNumber(strengthVelocityNowPctPerWeek) ||
    !isFiniteNumber(strengthVelocityPrevPctPerWeek) ||
    !isFiniteNumber(ffmVelocityNowLbPerWeek) ||
    !isFiniteNumber(ffmVelocityPrevLbPerWeek)
  ) {
    return insufficient(["required strength or FFM velocity inputs unavailable"]);
  }

  if (!isFiniteNumber(structuralConfidence) || structuralConfidence < 0.45) {
    return insufficient(["structural confidence too low for plateau forecasting"]);
  }

  const drivers: string[] = [];
  const horizonMax = 28;
  const plateauThresh = 0.22;

  const gStrengthNow = clamp(strengthVelocityNowPctPerWeek / 3.0, 0, 1);
  const gStrengthPrev = clamp(strengthVelocityPrevPctPerWeek / 3.0, 0, 1);

  const gFfmNow = clamp(ffmVelocityNowLbPerWeek / 0.25, 0, 1);
  const gFfmPrev = clamp(ffmVelocityPrevLbPerWeek / 0.25, 0, 1);

  const penaltyWaist = isFiniteNumber(waistVelocityNowInPerWeek)
    ? clamp((waistVelocityNowInPerWeek - 0.1) / 0.2, 0, 1)
    : 0;

  const growthMomentumNow = clamp(
    0.5 * gStrengthNow + 0.4 * gFfmNow - 0.1 * penaltyWaist,
    0,
    1,
  );

  const growthMomentumPrev = clamp(
    0.5 * gStrengthPrev + 0.4 * gFfmPrev - 0.1 * penaltyWaist,
    0,
    1,
  );

  const momentumSlopeDay = (growthMomentumNow - growthMomentumPrev) / 14;

  if (strengthVelocityNowPctPerWeek < strengthVelocityPrevPctPerWeek) {
    drivers.push("strength velocity decelerating");
  }
  if (ffmVelocityNowLbPerWeek < ffmVelocityPrevLbPerWeek) {
    drivers.push("lean-mass velocity fading");
  }
  if (adaptationStage === "ADVANCED_SLOW_GAIN") {
    drivers.push("adaptation stage advanced slow gain");
  }
  if (adaptationStage === "PLATEAU_RISK") {
    drivers.push("adaptation stage plateau risk");
  }
  if (plateauDetected) {
    drivers.push("plateau detector triggered");
  }
  if (penaltyWaist > 0.3) {
    drivers.push("waist trend reducing productive-gain confidence");
  }
  if (mode) {
    drivers.push(`current mode: ${mode.toLowerCase()}`);
  }

  if (plateauDetected || adaptationStage === "PLATEAU_RISK") {
    const confScore =
      0.4 * structuralConfidence +
      0.25 * 1 +
      0.2 * clamp(Math.abs(momentumSlopeDay) / 0.03, 0, 1) +
      0.15 * 1;

    return {
      status: "plateau_likely",
      window: { daysMin: 0, daysMax: 5 },
      confidence: confidenceLabel(confScore),
      drivers,
    };
  }

  let status: ForecastResult["status"] = "progressing";
  let daysToPlateau = 21;

  if (growthMomentumNow > plateauThresh && momentumSlopeDay < 0) {
    status =
      adaptationStage === "ADVANCED_SLOW_GAIN" ? "plateau_likely" : "slowing";

    daysToPlateau = (plateauThresh - growthMomentumNow) / momentumSlopeDay;
    daysToPlateau = clamp(daysToPlateau, 0, horizonMax);
  } else if (adaptationStage === "ADVANCED_SLOW_GAIN") {
    status = "slowing";
    daysToPlateau = 14;
  } else if (growthMomentumNow <= plateauThresh) {
    status = "plateau_likely";
    daysToPlateau = 4;
  }

  if (status === "progressing") {
    const confScore =
      0.4 * structuralConfidence +
      0.25 * 0.6 +
      0.2 * clamp(Math.abs(momentumSlopeDay) / 0.03, 0, 1) +
      0.15 *
        (adaptationStage === "STANDARD_HYPERTROPHY" ? 0.8 : 0.5);

    return {
      status,
      window: { daysMin: null, daysMax: null },
      confidence: confidenceLabel(confScore),
      drivers: drivers.length ? drivers : ["productive hypertrophy still progressing"],
    };
  }

  const uncertaintyDays =
    2 +
    5 * (1 - structuralConfidence) +
    (Math.abs(momentumSlopeDay) < 0.01 ? 4 : 0) +
    (adaptationStage === "STANDARD_HYPERTROPHY" ? 2 : 0);

  const confScore =
    0.4 * structuralConfidence +
    0.25 * (plateauDetected ? 1 : 0.6) +
    0.2 * clamp(Math.abs(momentumSlopeDay) / 0.03, 0, 1) +
    0.15 *
      (adaptationStage === "PLATEAU_RISK"
        ? 1
        : adaptationStage === "ADVANCED_SLOW_GAIN"
          ? 0.8
          : 0.5);

  return {
    status,
    window: buildWindow(daysToPlateau, uncertaintyDays, horizonMax),
    confidence: confidenceLabel(confScore),
    drivers,
  };
}
