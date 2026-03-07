import type {
  FatigueRiskForecastInput,
  ForecastConfidence,
  ForecastResult,
} from "./forecast-types";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function safeDiv(a: number, b: number): number {
  return Math.abs(b) < 1e-9 ? 0 : a / b;
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

export function forecastFatigueRisk(
  input: FatigueRiskForecastInput,
): ForecastResult {
  const {
    readinessNow,
    readinessPrev,
    readinessConfidence,
    hpaNow,
    hpaPrev,
    recoveryIndexNow,
    recoveryIndexPrev,
    cortisolFlag,
    sleepDeltaPct,
    hrvDeltaPct,
    rhrDelta,
  } = input;

  if (
    !isFiniteNumber(readinessNow) ||
    !isFiniteNumber(readinessPrev) ||
    !isFiniteNumber(hpaNow) ||
    !isFiniteNumber(hpaPrev) ||
    !isFiniteNumber(recoveryIndexNow) ||
    !isFiniteNumber(recoveryIndexPrev)
  ) {
    return insufficient(["required readiness/HPA/recovery inputs unavailable"]);
  }

  if (!isFiniteNumber(readinessConfidence) || readinessConfidence < 0.45) {
    return insufficient(["readiness confidence too low for fatigue forecasting"]);
  }

  const drivers: string[] = [];
  const horizonMax = 10;
  const fatigueCollapseThresh = 0.72;

  const riskReadiness = clamp((70 - readinessNow) / 40, 0, 1);
  const riskHpa = clamp((hpaNow - 50) / 30, 0, 1);
  const riskRecovery = clamp((0.85 - recoveryIndexNow) / 0.25, 0, 1);
  const riskCortisol = cortisolFlag ? 1 : 0;

  const fatigueRiskNow =
    0.35 * riskReadiness +
    0.3 * riskHpa +
    0.2 * riskRecovery +
    0.15 * riskCortisol;

  const dReadiness = readinessNow - readinessPrev;
  const dHpa = hpaNow - hpaPrev;
  const dRecovery = recoveryIndexNow - recoveryIndexPrev;

  const riskSlopeDay =
    0.35 * clamp(-dReadiness / 10, -1, 1) +
    0.3 * clamp(dHpa / 10, -1, 1) +
    0.2 * clamp(-dRecovery / 0.08, -1, 1) +
    0.15 * (cortisolFlag ? 0.5 : 0);

  if (dReadiness < 0) drivers.push("readiness trending down");
  if (dHpa > 0) drivers.push("HPA score rising");
  if (recoveryIndexNow < 0.85) drivers.push("recovery index below stimulus threshold");
  if (cortisolFlag) drivers.push("cortisol flag active");
  if (isFiniteNumber(hrvDeltaPct) && hrvDeltaPct <= -8) drivers.push("HRV materially below baseline");
  if (isFiniteNumber(sleepDeltaPct) && sleepDeltaPct <= -10) drivers.push("sleep materially below baseline");
  if (isFiniteNumber(rhrDelta) && rhrDelta >= 3) drivers.push("resting heart rate elevated");

  if (fatigueRiskNow >= fatigueCollapseThresh) {
    const confScore =
      0.35 * readinessConfidence +
      0.2 * (cortisolFlag ? 1 : 0.6) +
      0.2 * clamp(Math.abs(riskSlopeDay) / 0.08, 0, 1) +
      0.15 * (Math.abs(dRecovery) > 0.02 ? 1 : 0.6) +
      0.1 * ((Math.abs(dHpa) > 2 || Math.abs(dReadiness) > 2) ? 1 : 0.5);

    return {
      status: "high_risk",
      window: { daysMin: 0, daysMax: 2 },
      confidence: confidenceLabel(confScore),
      drivers,
    };
  }

  if (fatigueRiskNow >= 0.5 || riskSlopeDay > 0.04) {
    const daysToCollapse = clamp(
      safeDiv(fatigueCollapseThresh - fatigueRiskNow, riskSlopeDay),
      0,
      horizonMax,
    );

    const uncertaintyDays =
      1 +
      3 * (1 - readinessConfidence) +
      (cortisolFlag ? 0 : 1) +
      (Math.abs(riskSlopeDay) < 0.03 ? 2 : 0);

    const confScore =
      0.35 * readinessConfidence +
      0.2 * (cortisolFlag ? 1 : 0.6) +
      0.2 * clamp(Math.abs(riskSlopeDay) / 0.08, 0, 1) +
      0.15 * (Math.abs(dRecovery) > 0.02 ? 1 : 0.6) +
      0.1 * ((Math.abs(dHpa) > 2 || Math.abs(dReadiness) > 2) ? 1 : 0.5);

    return {
      status: "rising_risk",
      window: buildWindow(daysToCollapse, uncertaintyDays, horizonMax),
      confidence: confidenceLabel(confScore),
      drivers,
    };
  }

  const stableConfScore =
    0.45 * readinessConfidence +
    0.2 * (cortisolFlag ? 0.5 : 1) +
    0.2 * (riskSlopeDay <= 0 ? 1 : 0.6) +
    0.15 * (recoveryIndexNow >= 0.85 ? 1 : 0.5);

  return {
    status: "stable",
    window: { daysMin: null, daysMax: null },
    confidence: confidenceLabel(stableConfScore),
    drivers: drivers.length ? drivers : ["fatigue-risk signals not currently worsening"],
  };
}
