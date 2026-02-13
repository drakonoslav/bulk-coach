import type {
  SleepSummary,
  VitalsDaily,
  WorkoutSession,
} from "../canonical-health";

export function fitbitDayBucketToVitals(
  date: string,
  bucket: {
    steps: number | null;
    energyBurnedKcal: number | null;
    zone1Min: number | null;
    zone2Min: number | null;
    zone3Min: number | null;
    belowZone1Min: number | null;
    activeZoneMinutes: number | null;
    restingHr: number | null;
    hrv: number | null;
  },
): VitalsDaily {
  return {
    date,
    resting_hr_bpm: bucket.restingHr,
    hrv_rmssd_ms: bucket.hrv,
    hrv_sdnn_ms: null,
    respiratory_rate_bpm: null,
    spo2_pct: null,
    skin_temp_delta_c: null,
    steps: bucket.steps,
    active_zone_minutes: bucket.activeZoneMinutes,
    energy_burned_kcal: bucket.energyBurnedKcal,
    zone1_min: bucket.zone1Min,
    zone2_min: bucket.zone2Min,
    zone3_min: bucket.zone3Min,
    below_zone1_min: bucket.belowZone1Min,
    source: "fitbit",
  };
}

export function fitbitDayBucketToSleep(
  date: string,
  bucket: {
    sleepMinutes: number | null;
    sleepStartTime: string | null;
    sleepEndTime: string | null;
    sleepLatencyMin: number | null;
    sleepWasoMin: number | null;
    tossedMinutes: number | null;
  },
  sleepStages?: {
    rem?: number;
    deep?: number;
    light?: number;
    wake?: number;
  },
): SleepSummary | null {
  if (bucket.sleepMinutes == null) return null;

  const totalSleep = bucket.sleepMinutes;
  const awake = sleepStages?.wake ?? bucket.sleepWasoMin ?? null;
  const timeInBed = awake != null ? totalSleep + awake : null;
  const efficiency = timeInBed != null && timeInBed > 0
    ? Math.round((totalSleep / timeInBed) * 1000) / 10
    : null;

  return {
    date,
    sleep_start: bucket.sleepStartTime,
    sleep_end: bucket.sleepEndTime,
    total_sleep_minutes: totalSleep,
    time_in_bed_minutes: timeInBed,
    awake_minutes: awake,
    rem_minutes: sleepStages?.rem ?? null,
    deep_minutes: sleepStages?.deep ?? null,
    light_or_core_minutes: sleepStages?.light ?? null,
    sleep_efficiency: efficiency,
    sleep_latency_min: bucket.sleepLatencyMin,
    waso_min: bucket.sleepWasoMin,
    source: "fitbit",
  };
}

export function fitbitApiSleepToCanonical(apiResponse: {
  dateOfSleep?: string;
  startTime?: string;
  endTime?: string;
  minutesAsleep?: number;
  minutesAwake?: number;
  timeInBed?: number;
  efficiency?: number;
  minutesToFallAsleep?: number;
  levels?: {
    summary?: {
      rem?: { minutes?: number };
      deep?: { minutes?: number };
      light?: { minutes?: number };
      wake?: { minutes?: number };
    };
  };
}): SleepSummary | null {
  if (!apiResponse.dateOfSleep || apiResponse.minutesAsleep == null) return null;

  const stages = apiResponse.levels?.summary;
  return {
    date: apiResponse.dateOfSleep,
    sleep_start: apiResponse.startTime || null,
    sleep_end: apiResponse.endTime || null,
    total_sleep_minutes: apiResponse.minutesAsleep,
    time_in_bed_minutes: apiResponse.timeInBed ?? null,
    awake_minutes: apiResponse.minutesAwake ?? stages?.wake?.minutes ?? null,
    rem_minutes: stages?.rem?.minutes ?? null,
    deep_minutes: stages?.deep?.minutes ?? null,
    light_or_core_minutes: stages?.light?.minutes ?? null,
    sleep_efficiency: apiResponse.efficiency ?? null,
    sleep_latency_min: apiResponse.minutesToFallAsleep ?? null,
    waso_min: apiResponse.minutesAwake ?? null,
    source: "fitbit",
  };
}

export function fitbitApiHrvToCanonical(date: string, rmssd: number): VitalsDaily {
  return {
    date,
    resting_hr_bpm: null,
    hrv_rmssd_ms: rmssd,
    hrv_sdnn_ms: null,
    respiratory_rate_bpm: null,
    spo2_pct: null,
    skin_temp_delta_c: null,
    steps: null,
    active_zone_minutes: null,
    energy_burned_kcal: null,
    zone1_min: null,
    zone2_min: null,
    zone3_min: null,
    below_zone1_min: null,
    source: "fitbit",
  };
}

export function fitbitApiActivityToCanonical(
  date: string,
  data: {
    steps?: number;
    caloriesOut?: number;
    activeZoneMinutes?: number;
    restingHeartRate?: number;
    heartRateZones?: Array<{ name: string; minutes: number }>;
  },
): VitalsDaily {
  let zone1 = null as number | null;
  let zone2 = null as number | null;
  let zone3 = null as number | null;
  let below = null as number | null;

  if (data.heartRateZones) {
    for (const z of data.heartRateZones) {
      const name = z.name.toLowerCase();
      if (name === "fat burn") zone1 = z.minutes;
      else if (name === "cardio") zone2 = z.minutes;
      else if (name === "peak") zone3 = z.minutes;
      else if (name.includes("below") || name === "out of range") below = z.minutes;
    }
  }

  return {
    date,
    resting_hr_bpm: data.restingHeartRate ?? null,
    hrv_rmssd_ms: null,
    hrv_sdnn_ms: null,
    respiratory_rate_bpm: null,
    spo2_pct: null,
    skin_temp_delta_c: null,
    steps: data.steps ?? null,
    active_zone_minutes: data.activeZoneMinutes ?? null,
    energy_burned_kcal: data.caloriesOut ?? null,
    zone1_min: zone1,
    zone2_min: zone2,
    zone3_min: zone3,
    below_zone1_min: below,
    source: "fitbit",
  };
}
