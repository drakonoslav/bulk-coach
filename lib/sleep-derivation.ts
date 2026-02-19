export type SleepSourceMode = "clock_tib" | "stage_sum" | "manual" | "device";

export interface SleepDerivationInput {
  actualBedTime?: string | null;
  actualWakeTime?: string | null;
  timeAsleepMin?: number | null;
  awakeStageMin?: number | null;
  remMin?: number | null;
  coreMin?: number | null;
  deepMin?: number | null;
}

export interface SleepDerivationResult {
  tib: number | null;
  tst: number | null;
  awakeInBed: number | null;
  wasoEst: number | null;
  latencyProxy: number | null;
  efficiency: number | null;
  sleepSourceMode: SleepSourceMode | null;
}

function hhmmToMin(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function clockTibMinutes(bed: string, wake: string): number | null {
  const b = hhmmToMin(bed);
  const w = hhmmToMin(wake);
  if (b == null || w == null) return null;
  let diff = w - b;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

export function deriveSleep(input: SleepDerivationInput): SleepDerivationResult {
  const { actualBedTime, actualWakeTime, timeAsleepMin, awakeStageMin, remMin, coreMin, deepMin } = input;

  const hasStages = remMin != null && coreMin != null && deepMin != null;
  const hasClock = !!(actualBedTime && actualWakeTime);

  const clockTIB = hasClock ? clockTibMinutes(actualBedTime!, actualWakeTime!) : null;

  const stageTST = hasStages ? remMin! + coreMin! + deepMin! : null;
  const stageTIB = (hasStages && awakeStageMin != null) ? awakeStageMin! + stageTST! : null;

  let tib: number | null = null;
  let tst: number | null = null;
  let sleepSourceMode: SleepSourceMode | null = null;

  if (clockTIB != null) {
    tib = clockTIB;
    tst = stageTST ?? timeAsleepMin ?? null;
    sleepSourceMode = "clock_tib";
  } else if (stageTIB != null && stageTST != null) {
    tib = stageTIB;
    tst = stageTST;
    sleepSourceMode = "stage_sum";
  } else if (timeAsleepMin != null) {
    tib = null;
    tst = timeAsleepMin;
    sleepSourceMode = "manual";
  }

  const awakeInBed = (tib != null && tst != null)
    ? Math.max(0, tib - tst)
    : null;

  const wasoEst = awakeStageMin != null ? awakeStageMin : null;

  const latencyProxy = (awakeInBed != null && wasoEst != null)
    ? Math.max(0, awakeInBed - wasoEst)
    : null;

  const efficiency = (tib != null && tst != null && tib > 0)
    ? Math.round((tst / tib) * 100)
    : null;

  return { tib, tst, awakeInBed, wasoEst, latencyProxy, efficiency, sleepSourceMode };
}
