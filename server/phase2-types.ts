export type IsoDate = string;
export type IsoDateTime = string;

export type DataSource = "apple_health" | "polar" | "fitbit" | "manual";

export type WorkoutType =
  | "strength"
  | "cardio"
  | "hiit"
  | "flexibility"
  | "other";

export type WorkoutPhase = "COMPOUND" | "ISOLATION";

export type MuscleGroup =
  | "chest_upper" | "chest_mid" | "chest_lower"
  | "back_lats" | "back_upper" | "back_mid"
  | "delts_front" | "delts_side" | "delts_rear"
  | "biceps" | "triceps"
  | "quads" | "hamstrings" | "glutes"
  | "calves" | "abs" | "neck";

export type HrvResponseFlag = "suppressed" | "increased" | "flat" | "insufficient";

export interface SleepSummaryUpsertPayload {
  date: IsoDate;
  sleep_start: IsoDateTime;
  sleep_end: IsoDateTime;
  total_sleep_minutes: number;
  time_in_bed_minutes?: number;
  awake_minutes?: number;
  rem_minutes?: number;
  deep_minutes?: number;
  light_or_core_minutes?: number;
  sleep_efficiency?: number;
  sleep_latency_min?: number;
  waso_min?: number;
  source: DataSource;
  timezone: string;
  device_time_offset_min?: number;
  raw?: {
    hk_device_name?: string;
    hk_source_bundle_id?: string;
  };
}

export interface VitalsDailyUpsertPayload {
  date: IsoDate;
  resting_hr?: number;
  hrv_sdnn_ms?: number;
  hrv_rmssd_ms?: number;
  spo2?: number;
  respiratory_rate?: number;
  steps?: number;
  active_energy_kcal?: number;
  source: DataSource;
  timezone: string;
  device_time_offset_min?: number;
  raw?: {
    hk_device_name?: string;
    hk_source_bundle_id?: string;
  };
}

export interface WorkoutSessionUpsertPayload {
  session_id: string;
  date: IsoDate;
  start_ts: IsoDateTime;
  end_ts?: IsoDateTime;
  workout_type: WorkoutType;
  calories_burned?: number;
  source: DataSource;
  timezone: string;
  hk_workout_uuid?: string;
  phase?: WorkoutPhase;
  cbp_start?: number;
  cbp_current?: number;
}

export interface HrSamplePoint {
  ts: IsoDateTime;
  hr_bpm: number;
}

export interface HrSamplesUpsertBulkPayload {
  session_id: string;
  source: DataSource;
  samples: HrSamplePoint[];
}

export interface RrIntervalPoint {
  ts: IsoDateTime;
  rr_ms: number;
}

export interface RrIntervalsUpsertBulkPayload {
  session_id: string;
  source: DataSource;
  intervals: RrIntervalPoint[];
}

export interface UpsertResult {
  ok: true;
  date: IsoDate;
  updated_at: IsoDateTime;
}

export interface WorkoutSessionUpsertResponse {
  ok: true;
  session_id: string;
}

export interface SamplesUpsertBulkResponse {
  ok: true;
  session_id: string;
  inserted_or_updated: number;
}

export interface SessionHrvAnalysisResponse {
  ok: true;
  session_id: string;
  pre_session_rmssd: number | null;
  min_session_rmssd: number | null;
  post_session_rmssd: number | null;
  hrv_suppression_pct: number | null;
  hrv_rebound_pct: number | null;
  hrv_response_flag: HrvResponseFlag;
  suppression_depth_pct: number | null;
  rebound_bpm_per_min: number | null;
  time_to_recovery_sec: number | null;
  strength_bias: number;
  cardio_bias: number;
}

export const HK_READ_TYPES = {
  sleep: "HKCategoryTypeIdentifierSleepAnalysis",
  restingHr: "HKQuantityTypeIdentifierRestingHeartRate",
  hrvSdnn: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  respiratoryRate: "HKQuantityTypeIdentifierRespiratoryRate",
  spo2: "HKQuantityTypeIdentifierOxygenSaturation",
  steps: "HKQuantityTypeIdentifierStepCount",
  workouts: "HKWorkoutTypeIdentifier",
  heartRate: "HKQuantityTypeIdentifierHeartRate",
} as const;

export interface HealthKitPermissions {
  read: string[];
}

export interface HealthKitSyncOptions {
  daysBack: number;
  timezone: string;
  now?: IsoDateTime;
}

export interface HealthKitSyncResult {
  sleep: SleepSummaryUpsertPayload[];
  vitals: VitalsDailyUpsertPayload[];
  workouts: {
    sessions: WorkoutSessionUpsertPayload[];
    hrSamplesBySessionId: Record<string, HrSamplesUpsertBulkPayload>;
  };
}

export interface IHealthKitAdapter {
  requestPermissions(perms: HealthKitPermissions): Promise<{ ok: true }>;
  isAvailable(): Promise<boolean>;
  buildSyncPayloads(opts: HealthKitSyncOptions): Promise<HealthKitSyncResult>;
}

export interface PolarScanResult {
  deviceId: string;
  name?: string;
  rssi?: number;
}

export interface PolarSessionConfig {
  session_id: string;
  timezone: string;
  baselineCaptureSec: number;
  hrSampleHz?: number;
}

export interface PolarLiveSample {
  ts: IsoDateTime;
  hr_bpm: number;
  rr_ms?: number[];
}

export interface PolarSessionStats {
  total_hr_samples: number;
  total_rr_intervals: number;
  started_at: IsoDateTime;
  ended_at?: IsoDateTime;
}

export interface IPolarBleAdapter {
  scan(timeoutMs: number): Promise<PolarScanResult[]>;
  connect(deviceId: string): Promise<{ ok: true }>;
  disconnect(deviceId: string): Promise<{ ok: true }>;
  startStreaming(
    deviceId: string,
    cfg: PolarSessionConfig,
    onSample: (s: PolarLiveSample) => void
  ): Promise<() => Promise<void>>;
}

export interface PolarUploader {
  upsertSession(payload: WorkoutSessionUpsertPayload): Promise<void>;
  upsertHrSamples(payload: HrSamplesUpsertBulkPayload): Promise<void>;
  upsertRrIntervals(payload: RrIntervalsUpsertBulkPayload): Promise<void>;
  analyzeSession(sessionId: string): Promise<SessionHrvAnalysisResponse>;
}
