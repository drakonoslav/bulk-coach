import type {
  SleepSummary,
  VitalsDaily,
  WorkoutSession,
  WorkoutHrSample,
  WorkoutRrInterval,
} from "../canonical-health";

export interface PolarExercise {
  id: string;
  startTime: string;
  duration: string;
  sport: string;
  calories?: number;
  distance?: number;
  heartRate?: {
    average: number;
    maximum: number;
  };
  trainingLoad?: number;
}

export interface PolarHrSample {
  dateTime: string;
  value: number;
}

export interface PolarRrInterval {
  dateTime: string;
  rrMs: number;
}

export interface PolarSleepData {
  date: string;
  sleepStartTime?: string;
  sleepEndTime?: string;
  totalSleepDuration?: number;
  sleepCycles?: number;
  remSleepDuration?: number;
  deepSleepDuration?: number;
  lightSleepDuration?: number;
  interruptionDuration?: number;
  sleepCharge?: number;
  deviceId?: string;
}

export interface PolarDailyActivity {
  date: string;
  activeCalories?: number;
  steps?: number;
  activeTimeMs?: number;
  deviceId?: string;
}

export interface PolarNightlyRecharge {
  date: string;
  hrvMsRmssd?: number;
  hrvMsSdnn?: number;
  breathingRate?: number;
  heartRateAvg?: number;
  ansCharge?: number;
}

const POLAR_SPORT_MAP: Record<string, WorkoutSession["workout_type"]> = {
  STRENGTH_TRAINING: "strength",
  WEIGHT_TRAINING: "strength",
  FUNCTIONAL_TRAINING: "strength",
  RUNNING: "cardio",
  CYCLING: "cardio",
  SWIMMING: "cardio",
  ROWING: "cardio",
  WALKING: "cardio",
  INDOOR_CYCLING: "cardio",
  INDOOR_RUNNING: "cardio",
  ELLIPTICAL: "cardio",
  STAIR_CLIMBING: "cardio",
  HIIT: "hiit",
  CIRCUIT_TRAINING: "hiit",
  CROSS_FIT: "hiit",
  YOGA: "flexibility",
  PILATES: "flexibility",
  STRETCHING: "flexibility",
};

function parsePolarDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 60 + minutes + seconds / 60;
}

export function polarExerciseToCanonical(exercise: PolarExercise): WorkoutSession {
  const sport = exercise.sport.toUpperCase().replace(/\s+/g, "_");
  const workoutType = POLAR_SPORT_MAP[sport] ?? "other";
  const durationMin = parsePolarDuration(exercise.duration);

  return {
    session_id: `polar_${exercise.id}`,
    date: exercise.startTime.slice(0, 10),
    start_ts: exercise.startTime,
    end_ts: new Date(
      new Date(exercise.startTime).getTime() + durationMin * 60000,
    ).toISOString(),
    workout_type: workoutType,
    duration_minutes: Math.round(durationMin * 10) / 10,
    avg_hr: exercise.heartRate?.average ?? null,
    max_hr: exercise.heartRate?.maximum ?? null,
    calories_burned: exercise.calories != null ? Math.round(exercise.calories) : null,
    session_strain_score: null,
    session_type_tag: null,
    recovery_slope: null,
    strength_bias: null,
    cardio_bias: null,
    pre_session_rmssd: null,
    min_session_rmssd: null,
    post_session_rmssd: null,
    hrv_suppression_pct: null,
    hrv_rebound_pct: null,
    suppression_depth_pct: null,
    rebound_bpm_per_min: null,
    baseline_window_seconds: null,
    time_to_recovery_sec: null,
    source: "polar",
  };
}

export function polarHrSamplesToCanonical(
  sessionId: string,
  samples: PolarHrSample[],
): WorkoutHrSample[] {
  return samples
    .filter(s => s.value >= 30 && s.value <= 250)
    .map(s => ({
      session_id: sessionId,
      ts: s.dateTime,
      hr_bpm: Math.round(s.value),
      source: "polar",
    }));
}

export function polarRrIntervalsToCanonical(
  sessionId: string,
  intervals: PolarRrInterval[],
): WorkoutRrInterval[] {
  return intervals
    .filter(r => r.rrMs >= 300 && r.rrMs <= 2000)
    .map(r => ({
      session_id: sessionId,
      ts: r.dateTime,
      rr_ms: Math.round(r.rrMs * 10) / 10,
      source: "polar",
    }));
}

export function polarBleRrToCanonical(
  sessionId: string,
  startTs: string,
  rrValuesMs: number[],
): WorkoutRrInterval[] {
  const intervals: WorkoutRrInterval[] = [];
  let cumulativeMs = 0;
  const baseMs = new Date(startTs).getTime();

  for (const rr of rrValuesMs) {
    if (rr < 300 || rr > 2000) {
      cumulativeMs += rr;
      continue;
    }
    cumulativeMs += rr;
    const ts = new Date(baseMs + cumulativeMs).toISOString();
    intervals.push({
      session_id: sessionId,
      ts,
      rr_ms: Math.round(rr * 10) / 10,
      source: "polar_ble",
    });
  }
  return intervals;
}

export function polarNightlyRechargeToVitals(
  data: PolarNightlyRecharge,
): VitalsDaily {
  return {
    date: data.date,
    resting_hr_bpm: data.heartRateAvg ?? null,
    hrv_rmssd_ms: data.hrvMsRmssd != null
      ? Math.round(data.hrvMsRmssd * 100) / 100
      : null,
    hrv_sdnn_ms: data.hrvMsSdnn != null
      ? Math.round(data.hrvMsSdnn * 100) / 100
      : null,
    respiratory_rate_bpm: data.breathingRate ?? null,
    spo2_pct: null,
    skin_temp_delta_c: null,
    steps: null,
    active_zone_minutes: null,
    energy_burned_kcal: null,
    zone1_min: null,
    zone2_min: null,
    zone3_min: null,
    below_zone1_min: null,
    source: "polar",
  };
}

export function polarDailyActivityToVitals(
  data: PolarDailyActivity,
): VitalsDaily {
  const activeMinutes = data.activeTimeMs != null
    ? Math.round(data.activeTimeMs / 60000)
    : null;

  return {
    date: data.date,
    resting_hr_bpm: null,
    hrv_rmssd_ms: null,
    hrv_sdnn_ms: null,
    respiratory_rate_bpm: null,
    spo2_pct: null,
    skin_temp_delta_c: null,
    steps: data.steps ?? null,
    active_zone_minutes: activeMinutes,
    energy_burned_kcal: data.activeCalories != null
      ? Math.round(data.activeCalories)
      : null,
    zone1_min: null,
    zone2_min: null,
    zone3_min: null,
    below_zone1_min: null,
    source: "polar",
  };
}

export function polarSleepToCanonical(data: PolarSleepData): SleepSummary | null {
  if (data.totalSleepDuration == null) return null;

  const totalSleepMin = Math.round(data.totalSleepDuration / 60000);
  const remMin = data.remSleepDuration != null
    ? Math.round(data.remSleepDuration / 60000)
    : null;
  const deepMin = data.deepSleepDuration != null
    ? Math.round(data.deepSleepDuration / 60000)
    : null;
  const lightMin = data.lightSleepDuration != null
    ? Math.round(data.lightSleepDuration / 60000)
    : null;
  const interruptionMin = data.interruptionDuration != null
    ? Math.round(data.interruptionDuration / 60000)
    : null;

  const timeInBed = interruptionMin != null
    ? totalSleepMin + interruptionMin
    : null;

  const efficiency = timeInBed != null && timeInBed > 0
    ? Math.round((totalSleepMin / timeInBed) * 1000) / 10
    : null;

  return {
    date: data.date,
    sleep_start: data.sleepStartTime ?? null,
    sleep_end: data.sleepEndTime ?? null,
    total_sleep_minutes: totalSleepMin,
    time_in_bed_minutes: timeInBed,
    awake_minutes: interruptionMin,
    rem_minutes: remMin,
    deep_minutes: deepMin,
    light_or_core_minutes: lightMin,
    sleep_efficiency: efficiency,
    sleep_latency_min: null,
    waso_min: interruptionMin,
    source: "polar",
  };
}
