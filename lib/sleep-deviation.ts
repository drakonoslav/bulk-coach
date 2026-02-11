export {
  noiseFloorMinutes,
  formatSignedMinutes,
  formatSignedMinutes as formatDevMin,
  sleepAlignmentScore,
  formatBedWakeDeviation,
  classifySleepDeviation,
  classifySleepDeviation as classifySleepDeviationType,
  CLASSIFICATION_LABELS,
  type SleepClassification,
  type SleepClassification as SleepDeviationType,
} from "./sleep-timing";

export function deviationHumanLabel(dt: string | null): string | null {
  if (!dt || dt === "insufficient_data") return null;
  const labels: Record<string, string> = {
    efficient_on_plan: "Efficient & on-plan",
    behavioral_drift: "Behavioral drift",
    physiological_shortfall: "Physiological shortfall",
    oversleep_spillover: "Oversleep spillover",
  };
  return labels[dt] ?? null;
}

export function computeClientDeviation(input: {
  planBed?: string | null;
  planWake?: string | null;
  srBed?: string | null;
  srWake?: string | null;
  fitbitSleepMin?: number | null;
  latencyMin?: number | null;
  wasoMin?: number | null;
}): {
  bedDevMin: number | null;
  wakeDevMin: number | null;
  shortfallMin: number | null;
  classification: string;
  deviationLabel: string;
  alignmentScore: number | null;
} {
  const { planBed, planWake, srBed, srWake, fitbitSleepMin, latencyMin, wasoMin } = input;

  const {
    noiseFloorMinutes: nf,
    sleepAlignmentScore: sas,
    formatBedWakeDeviation: fbd,
    classifySleepDeviation: csd,
  } = require("./sleep-timing");

  function toMin(t: string): number {
    const clean = t.includes(" ") ? t.split(" ")[1] : t;
    const [h, m] = clean.slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  }

  function circDelta(a: number, p: number): number {
    let d = a - p;
    while (d > 720) d -= 1440;
    while (d < -720) d += 1440;
    return d;
  }

  function span(s: number, e: number): number {
    let d = e - s;
    if (d <= 0) d += 1440;
    return d;
  }

  if (!planBed || !planWake) {
    return {
      bedDevMin: null, wakeDevMin: null, shortfallMin: null,
      classification: "insufficient_data",
      deviationLabel: "\u2014",
      alignmentScore: null,
    };
  }

  const pBed = toMin(planBed);
  const pWake = toMin(planWake);
  const sleepNeedMin = span(pBed, pWake);

  const bedDevMin = srBed ? nf(circDelta(toMin(srBed), pBed)) : null;
  const wakeDevMin = srWake ? nf(circDelta(toMin(srWake), pWake)) : null;

  let sleepAsleepMin: number | null = null;
  if (typeof fitbitSleepMin === "number") {
    sleepAsleepMin = fitbitSleepMin;
  } else if (srBed && srWake) {
    const inBed = span(toMin(srBed), toMin(srWake));
    sleepAsleepMin = Math.max(0, inBed - Math.max(0, latencyMin ?? 0) - Math.max(0, wasoMin ?? 0));
  }

  let shortfallMin: number | null = null;
  if (sleepAsleepMin != null) {
    shortfallMin = nf(Math.max(0, sleepNeedMin - sleepAsleepMin));
  }

  const classification = csd({ bedDevMin, wakeDevMin, shortfallMin });
  const deviationLabel = fbd(bedDevMin, wakeDevMin);
  const alignmentScore = sas(bedDevMin, wakeDevMin);

  return { bedDevMin, wakeDevMin, shortfallMin, classification, deviationLabel, alignmentScore };
}
