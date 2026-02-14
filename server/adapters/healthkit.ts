import type {
  SleepSummary,
  VitalsDaily,
  WorkoutSession,
  WorkoutHrSample,
  WorkoutRrInterval,
} from "../canonical-health";
import type {
  DataSource,
  IsoDate,
  IsoDateTime,
  SleepSummaryUpsertPayload,
  VitalsDailyUpsertPayload,
  WorkoutSessionUpsertPayload,
  HrSamplesUpsertBulkPayload,
  HealthKitPermissions,
  HealthKitSyncOptions,
  HealthKitSyncResult,
  IHealthKitAdapter,
} from "../phase2-types";
import { HK_READ_TYPES } from "../phase2-types";

export interface HKQuantitySample {
  uuid: string;
  startDate: string;
  endDate: string;
  value: number;
  unit: string;
  sourceName?: string;
  sourceId?: string;
  metadata?: Record<string, string>;
}

export interface HKCategorySample {
  uuid: string;
  startDate: string;
  endDate: string;
  value: number;
  sourceName?: string;
}

export interface HKWorkoutSample {
  uuid: string;
  startDate: string;
  endDate: string;
  duration: number;
  workoutActivityType: string;
  totalEnergyBurned?: number;
  totalDistance?: number;
  sourceName?: string;
  metadata?: Record<string, string>;
}

export interface HKHeartbeatSeries {
  startDate: string;
  heartbeatSamples: Array<{ timeSinceStart: number; precededByGap: boolean }>;
}

const HK_WORKOUT_TYPE_MAP: Record<string, WorkoutSession["workout_type"]> = {
  HKWorkoutActivityTypeTraditionalStrengthTraining: "strength",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "strength",
  HKWorkoutActivityTypeRunning: "cardio",
  HKWorkoutActivityTypeCycling: "cardio",
  HKWorkoutActivityTypeSwimming: "cardio",
  HKWorkoutActivityTypeElliptical: "cardio",
  HKWorkoutActivityTypeRowing: "cardio",
  HKWorkoutActivityTypeStairClimbing: "cardio",
  HKWorkoutActivityTypeHighIntensityIntervalTraining: "hiit",
  HKWorkoutActivityTypeCrossTraining: "hiit",
  HKWorkoutActivityTypeYoga: "flexibility",
  HKWorkoutActivityTypePilates: "flexibility",
  HKWorkoutActivityTypeFlexibility: "flexibility",
  HKWorkoutActivityTypeMindAndBody: "flexibility",
};

const HK_SLEEP_VALUE_MAP: Record<number, string> = {
  0: "inBed",
  1: "asleepUnspecified",
  2: "awake",
  3: "asleepCore",
  4: "asleepDeep",
  5: "asleepREM",
};

const SOURCE: DataSource = "apple_health";

export function healthkitWorkoutToCanonical(
  workout: HKWorkoutSample,
  hrSamples?: HKQuantitySample[],
): WorkoutSession {
  const workoutType = HK_WORKOUT_TYPE_MAP[workout.workoutActivityType] ?? "other";
  const durationMin = workout.duration / 60;

  let avgHr: number | null = null;
  let maxHr: number | null = null;
  if (hrSamples && hrSamples.length > 0) {
    const hrs = hrSamples.map(s => s.value);
    avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
    maxHr = Math.max(...hrs);
  }

  return {
    session_id: `hk_${workout.uuid}`,
    date: workout.startDate.slice(0, 10),
    start_ts: workout.startDate,
    end_ts: workout.endDate,
    workout_type: workoutType,
    duration_minutes: Math.round(durationMin * 10) / 10,
    avg_hr: avgHr,
    max_hr: maxHr,
    calories_burned: workout.totalEnergyBurned != null
      ? Math.round(workout.totalEnergyBurned)
      : null,
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
    source: SOURCE,
  };
}

export function healthkitHrSamplesToCanonical(
  sessionId: string,
  samples: HKQuantitySample[],
): WorkoutHrSample[] {
  return samples
    .filter(s => s.value >= 30 && s.value <= 250)
    .map(s => ({
      session_id: sessionId,
      ts: s.startDate,
      hr_bpm: Math.round(s.value),
      source: SOURCE,
    }));
}

export function healthkitHeartbeatSeriesToRr(
  sessionId: string,
  series: HKHeartbeatSeries,
): WorkoutRrInterval[] {
  const intervals: WorkoutRrInterval[] = [];
  const baseMs = new Date(series.startDate).getTime();

  let prevTime = 0;
  for (const beat of series.heartbeatSamples) {
    if (beat.precededByGap) {
      prevTime = beat.timeSinceStart;
      continue;
    }
    const rrMs = (beat.timeSinceStart - prevTime) * 1000;
    if (rrMs >= 300 && rrMs <= 2000) {
      const ts = new Date(baseMs + beat.timeSinceStart * 1000).toISOString();
      intervals.push({ session_id: sessionId, ts, rr_ms: Math.round(rrMs * 10) / 10, source: SOURCE });
    }
    prevTime = beat.timeSinceStart;
  }
  return intervals;
}

export function healthkitVitalsToCanonical(
  date: string,
  data: {
    restingHr?: HKQuantitySample;
    hrv?: HKQuantitySample;
    respiratoryRate?: HKQuantitySample;
    oxygenSaturation?: HKQuantitySample;
    stepCount?: number;
    activeEnergy?: number;
    appleExerciseTime?: number;
  },
): VitalsDaily {
  return {
    date,
    resting_hr_bpm: data.restingHr?.value ?? null,
    hrv_rmssd_ms: data.hrv?.value != null
      ? Math.round(data.hrv.value * 100) / 100
      : null,
    hrv_sdnn_ms: null,
    respiratory_rate_bpm: data.respiratoryRate?.value ?? null,
    spo2_pct: data.oxygenSaturation?.value != null
      ? Math.round(data.oxygenSaturation.value * 1000) / 10
      : null,
    skin_temp_delta_c: null,
    steps: data.stepCount ?? null,
    active_zone_minutes: data.appleExerciseTime ?? null,
    energy_burned_kcal: data.activeEnergy != null
      ? Math.round(data.activeEnergy)
      : null,
    zone1_min: null,
    zone2_min: null,
    zone3_min: null,
    below_zone1_min: null,
    source: SOURCE,
  };
}

export function healthkitSleepToCanonical(
  date: string,
  samples: HKCategorySample[],
): SleepSummary | null {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  const sleepStart = sorted[0].startDate;
  const sleepEnd = sorted[sorted.length - 1].endDate;

  let remMin = 0;
  let deepMin = 0;
  let coreMin = 0;
  let awakeMin = 0;
  let totalSleepMin = 0;
  let totalInBedMin = 0;

  for (const s of sorted) {
    const durMin =
      (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
    const stage = HK_SLEEP_VALUE_MAP[s.value] ?? "inBed";

    totalInBedMin += durMin;

    switch (stage) {
      case "asleepREM":
        remMin += durMin;
        totalSleepMin += durMin;
        break;
      case "asleepDeep":
        deepMin += durMin;
        totalSleepMin += durMin;
        break;
      case "asleepCore":
      case "asleepUnspecified":
        coreMin += durMin;
        totalSleepMin += durMin;
        break;
      case "awake":
        awakeMin += durMin;
        break;
      case "inBed":
        break;
    }
  }

  if (totalSleepMin < 1) return null;

  const efficiency =
    totalInBedMin > 0
      ? Math.round((totalSleepMin / totalInBedMin) * 1000) / 10
      : null;

  return {
    date,
    sleep_start: sleepStart,
    sleep_end: sleepEnd,
    total_sleep_minutes: Math.round(totalSleepMin),
    time_in_bed_minutes: Math.round(totalInBedMin),
    awake_minutes: Math.round(awakeMin),
    rem_minutes: remMin > 0 ? Math.round(remMin) : null,
    deep_minutes: deepMin > 0 ? Math.round(deepMin) : null,
    light_or_core_minutes: coreMin > 0 ? Math.round(coreMin) : null,
    sleep_efficiency: efficiency,
    sleep_latency_min: null,
    waso_min: awakeMin > 0 ? Math.round(awakeMin) : null,
    source: SOURCE,
  };
}

export function buildSleepPayload(
  date: IsoDate,
  samples: HKCategorySample[],
  timezone: string,
  deviceName?: string,
): SleepSummaryUpsertPayload | null {
  const canonical = healthkitSleepToCanonical(date, samples);
  if (!canonical) return null;
  return {
    date: canonical.date,
    sleep_start: canonical.sleep_start ?? "",
    sleep_end: canonical.sleep_end ?? "",
    total_sleep_minutes: canonical.total_sleep_minutes,
    time_in_bed_minutes: canonical.time_in_bed_minutes ?? undefined,
    awake_minutes: canonical.awake_minutes ?? undefined,
    rem_minutes: canonical.rem_minutes ?? undefined,
    deep_minutes: canonical.deep_minutes ?? undefined,
    light_or_core_minutes: canonical.light_or_core_minutes ?? undefined,
    sleep_efficiency: canonical.sleep_efficiency ?? undefined,
    sleep_latency_min: canonical.sleep_latency_min ?? undefined,
    waso_min: canonical.waso_min ?? undefined,
    source: SOURCE,
    timezone,
    raw: deviceName ? { hk_device_name: deviceName, hk_source_bundle_id: "com.apple.health" } : undefined,
  };
}

export function buildVitalsPayload(
  date: IsoDate,
  data: {
    restingHr?: HKQuantitySample;
    hrv?: HKQuantitySample;
    respiratoryRate?: HKQuantitySample;
    oxygenSaturation?: HKQuantitySample;
    stepCount?: number;
    activeEnergy?: number;
  },
  timezone: string,
  deviceName?: string,
): VitalsDailyUpsertPayload {
  return {
    date,
    resting_hr: data.restingHr?.value,
    hrv_sdnn_ms: data.hrv?.value != null
      ? Math.round(data.hrv.value * 100) / 100
      : undefined,
    spo2: data.oxygenSaturation?.value != null
      ? Math.round(data.oxygenSaturation.value * 1000) / 10
      : undefined,
    respiratory_rate: data.respiratoryRate?.value,
    steps: data.stepCount,
    active_energy_kcal: data.activeEnergy != null
      ? Math.round(data.activeEnergy)
      : undefined,
    source: SOURCE,
    timezone,
    raw: deviceName ? { hk_device_name: deviceName, hk_source_bundle_id: "com.apple.health" } : undefined,
  };
}

export function buildWorkoutPayload(
  workout: HKWorkoutSample,
  timezone: string,
): WorkoutSessionUpsertPayload {
  const workoutType = HK_WORKOUT_TYPE_MAP[workout.workoutActivityType] ?? "other";
  return {
    session_id: `hk_${workout.uuid}`,
    date: workout.startDate.slice(0, 10),
    start_ts: workout.startDate,
    end_ts: workout.endDate,
    workout_type: workoutType,
    calories_burned: workout.totalEnergyBurned != null
      ? Math.round(workout.totalEnergyBurned)
      : undefined,
    source: SOURCE,
    timezone,
    hk_workout_uuid: workout.uuid,
  };
}

export function buildHrSamplesPayload(
  sessionId: string,
  hrSamples: HKQuantitySample[],
): HrSamplesUpsertBulkPayload {
  return {
    session_id: sessionId,
    source: SOURCE,
    samples: hrSamples
      .filter(s => s.value >= 30 && s.value <= 250)
      .map(s => ({
        ts: s.startDate,
        hr_bpm: Math.round(s.value),
      })),
  };
}

export function buildSyncPayloads(
  opts: HealthKitSyncOptions,
  rawData: {
    sleepByDate: Record<string, HKCategorySample[]>;
    vitalsByDate: Record<string, {
      restingHr?: HKQuantitySample;
      hrv?: HKQuantitySample;
      respiratoryRate?: HKQuantitySample;
      oxygenSaturation?: HKQuantitySample;
      stepCount?: number;
      activeEnergy?: number;
    }>;
    workouts: HKWorkoutSample[];
    hrByWorkoutUuid: Record<string, HKQuantitySample[]>;
  },
  deviceName?: string,
): HealthKitSyncResult {
  const sleepPayloads: SleepSummaryUpsertPayload[] = [];
  for (const [date, samples] of Object.entries(rawData.sleepByDate)) {
    const p = buildSleepPayload(date, samples, opts.timezone, deviceName);
    if (p) sleepPayloads.push(p);
  }

  const vitalsPayloads: VitalsDailyUpsertPayload[] = [];
  for (const [date, data] of Object.entries(rawData.vitalsByDate)) {
    vitalsPayloads.push(buildVitalsPayload(date, data, opts.timezone, deviceName));
  }

  const sessions: WorkoutSessionUpsertPayload[] = [];
  const hrSamplesBySessionId: Record<string, HrSamplesUpsertBulkPayload> = {};
  for (const workout of rawData.workouts) {
    const sessionPayload = buildWorkoutPayload(workout, opts.timezone);
    sessions.push(sessionPayload);
    const hrSamples = rawData.hrByWorkoutUuid[workout.uuid];
    if (hrSamples && hrSamples.length > 0) {
      hrSamplesBySessionId[sessionPayload.session_id] = buildHrSamplesPayload(
        sessionPayload.session_id,
        hrSamples,
      );
    }
  }

  return {
    sleep: sleepPayloads,
    vitals: vitalsPayloads,
    workouts: { sessions, hrSamplesBySessionId },
  };
}
