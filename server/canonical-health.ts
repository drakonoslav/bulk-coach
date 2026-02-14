import { pool } from "./db";

export const DEFAULT_USER_ID = 'local_default';

export interface IngestionContext {
  user_id: string;
  source: string;
  timezone?: string | null;
}

export interface SleepSummary {
  date: string;
  user_id?: string;
  sleep_start: string | null;
  sleep_end: string | null;
  total_sleep_minutes: number;
  time_in_bed_minutes: number | null;
  awake_minutes: number | null;
  rem_minutes: number | null;
  deep_minutes: number | null;
  light_or_core_minutes: number | null;
  sleep_efficiency: number | null;
  sleep_latency_min: number | null;
  waso_min: number | null;
  source: string;
  timezone?: string | null;
}

export interface VitalsDaily {
  date: string;
  user_id?: string;
  resting_hr_bpm: number | null;
  hrv_rmssd_ms: number | null;
  hrv_sdnn_ms: number | null;
  respiratory_rate_bpm: number | null;
  spo2_pct: number | null;
  skin_temp_delta_c: number | null;
  steps: number | null;
  active_zone_minutes: number | null;
  energy_burned_kcal: number | null;
  zone1_min: number | null;
  zone2_min: number | null;
  zone3_min: number | null;
  below_zone1_min: number | null;
  source: string;
  timezone?: string | null;
}

export interface WorkoutSession {
  session_id: string;
  date: string;
  user_id?: string;
  start_ts: string;
  end_ts: string | null;
  workout_type: "strength" | "cardio" | "hiit" | "flexibility" | "other";
  duration_minutes: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories_burned: number | null;
  session_strain_score: number | null;
  session_type_tag: string | null;
  recovery_slope: number | null;
  strength_bias: number | null;
  cardio_bias: number | null;
  pre_session_rmssd: number | null;
  min_session_rmssd: number | null;
  post_session_rmssd: number | null;
  hrv_suppression_pct: number | null;
  hrv_rebound_pct: number | null;
  suppression_depth_pct: number | null;
  rebound_bpm_per_min: number | null;
  baseline_window_seconds: number | null;
  time_to_recovery_sec: number | null;
  source: string;
  timezone?: string | null;
}

export interface WorkoutHrSample {
  session_id: string;
  ts: string;
  hr_bpm: number;
  source: string;
}

export interface WorkoutRrInterval {
  session_id: string;
  ts: string;
  rr_ms: number;
  source: string;
}

export interface HrvBaselineDaily {
  date: string;
  user_id?: string;
  night_hrv_rmssd_ms: number | null;
  night_hrv_sdnn_ms: number | null;
  baseline_hrv_rmssd_7d_median: number | null;
  baseline_hrv_sdnn_7d_median: number | null;
  deviation_rmssd_pct: number | null;
  deviation_sdnn_pct: number | null;
  morning_hrv_sdnn_ms: number | null;
  morning_deviation_pct: number | null;
  source: string;
}

export async function upsertSleepSummary(s: SleepSummary): Promise<void> {
  console.log('[sleep-upsert]', { user_id: s.user_id ?? DEFAULT_USER_ID, date: s.date, sleep_start: s.sleep_start, sleep_end: s.sleep_end, tz: s.timezone, interpreted_day: s.date });
  await pool.query(
    `INSERT INTO sleep_summary_daily
       (user_id, date, sleep_start, sleep_end, total_sleep_minutes, time_in_bed_minutes,
        awake_minutes, rem_minutes, deep_minutes, light_or_core_minutes,
        sleep_efficiency, sleep_latency_min, waso_min, source, timezone, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (user_id, date) DO UPDATE SET
       sleep_start = COALESCE(EXCLUDED.sleep_start, sleep_summary_daily.sleep_start),
       sleep_end = COALESCE(EXCLUDED.sleep_end, sleep_summary_daily.sleep_end),
       total_sleep_minutes = EXCLUDED.total_sleep_minutes,
       time_in_bed_minutes = COALESCE(EXCLUDED.time_in_bed_minutes, sleep_summary_daily.time_in_bed_minutes),
       awake_minutes = COALESCE(EXCLUDED.awake_minutes, sleep_summary_daily.awake_minutes),
       rem_minutes = COALESCE(EXCLUDED.rem_minutes, sleep_summary_daily.rem_minutes),
       deep_minutes = COALESCE(EXCLUDED.deep_minutes, sleep_summary_daily.deep_minutes),
       light_or_core_minutes = COALESCE(EXCLUDED.light_or_core_minutes, sleep_summary_daily.light_or_core_minutes),
       sleep_efficiency = COALESCE(EXCLUDED.sleep_efficiency, sleep_summary_daily.sleep_efficiency),
       sleep_latency_min = COALESCE(EXCLUDED.sleep_latency_min, sleep_summary_daily.sleep_latency_min),
       waso_min = COALESCE(EXCLUDED.waso_min, sleep_summary_daily.waso_min),
       source = EXCLUDED.source,
       timezone = COALESCE(EXCLUDED.timezone, sleep_summary_daily.timezone),
       updated_at = NOW()`,
    [s.user_id ?? DEFAULT_USER_ID, s.date, s.sleep_start, s.sleep_end, s.total_sleep_minutes, s.time_in_bed_minutes,
     s.awake_minutes, s.rem_minutes, s.deep_minutes, s.light_or_core_minutes,
     s.sleep_efficiency, s.sleep_latency_min, s.waso_min, s.source, s.timezone ?? null]
  );
}

export async function upsertVitalsDaily(v: VitalsDaily): Promise<void> {
  await pool.query(
    `INSERT INTO vitals_daily
       (user_id, date, resting_hr_bpm, hrv_rmssd_ms, hrv_sdnn_ms, respiratory_rate_bpm,
        spo2_pct, skin_temp_delta_c, steps, active_zone_minutes, energy_burned_kcal,
        zone1_min, zone2_min, zone3_min, below_zone1_min, source, timezone, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
     ON CONFLICT (user_id, date) DO UPDATE SET
       resting_hr_bpm = COALESCE(EXCLUDED.resting_hr_bpm, vitals_daily.resting_hr_bpm),
       hrv_rmssd_ms = COALESCE(EXCLUDED.hrv_rmssd_ms, vitals_daily.hrv_rmssd_ms),
       hrv_sdnn_ms = COALESCE(EXCLUDED.hrv_sdnn_ms, vitals_daily.hrv_sdnn_ms),
       respiratory_rate_bpm = COALESCE(EXCLUDED.respiratory_rate_bpm, vitals_daily.respiratory_rate_bpm),
       spo2_pct = COALESCE(EXCLUDED.spo2_pct, vitals_daily.spo2_pct),
       skin_temp_delta_c = COALESCE(EXCLUDED.skin_temp_delta_c, vitals_daily.skin_temp_delta_c),
       steps = COALESCE(EXCLUDED.steps, vitals_daily.steps),
       active_zone_minutes = COALESCE(EXCLUDED.active_zone_minutes, vitals_daily.active_zone_minutes),
       energy_burned_kcal = COALESCE(EXCLUDED.energy_burned_kcal, vitals_daily.energy_burned_kcal),
       zone1_min = COALESCE(EXCLUDED.zone1_min, vitals_daily.zone1_min),
       zone2_min = COALESCE(EXCLUDED.zone2_min, vitals_daily.zone2_min),
       zone3_min = COALESCE(EXCLUDED.zone3_min, vitals_daily.zone3_min),
       below_zone1_min = COALESCE(EXCLUDED.below_zone1_min, vitals_daily.below_zone1_min),
       source = EXCLUDED.source,
       timezone = COALESCE(EXCLUDED.timezone, vitals_daily.timezone),
       updated_at = NOW()`,
    [v.user_id ?? DEFAULT_USER_ID, v.date, v.resting_hr_bpm, v.hrv_rmssd_ms, v.hrv_sdnn_ms, v.respiratory_rate_bpm,
     v.spo2_pct, v.skin_temp_delta_c, v.steps, v.active_zone_minutes, v.energy_burned_kcal,
     v.zone1_min, v.zone2_min, v.zone3_min, v.below_zone1_min, v.source, v.timezone ?? null]
  );
}

export async function upsertWorkoutSession(w: WorkoutSession): Promise<void> {
  console.log('[workout-upsert]', { session_id: w.session_id, date: w.date, start_ts: w.start_ts, end_ts: w.end_ts, tz: w.timezone, interpreted_day: w.date });
  await pool.query(
    `INSERT INTO workout_session
       (session_id, user_id, date, start_ts, end_ts, workout_type, duration_minutes,
        avg_hr, max_hr, calories_burned, session_strain_score, session_type_tag,
        recovery_slope, strength_bias, cardio_bias,
        pre_session_rmssd, min_session_rmssd, post_session_rmssd,
        hrv_suppression_pct, hrv_rebound_pct,
        suppression_depth_pct, rebound_bpm_per_min,
        baseline_window_seconds, time_to_recovery_sec, source, timezone, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       date = EXCLUDED.date,
       start_ts = EXCLUDED.start_ts,
       end_ts = COALESCE(EXCLUDED.end_ts, workout_session.end_ts),
       workout_type = EXCLUDED.workout_type,
       duration_minutes = COALESCE(EXCLUDED.duration_minutes, workout_session.duration_minutes),
       avg_hr = COALESCE(EXCLUDED.avg_hr, workout_session.avg_hr),
       max_hr = COALESCE(EXCLUDED.max_hr, workout_session.max_hr),
       calories_burned = COALESCE(EXCLUDED.calories_burned, workout_session.calories_burned),
       session_strain_score = COALESCE(EXCLUDED.session_strain_score, workout_session.session_strain_score),
       session_type_tag = COALESCE(EXCLUDED.session_type_tag, workout_session.session_type_tag),
       recovery_slope = COALESCE(EXCLUDED.recovery_slope, workout_session.recovery_slope),
       strength_bias = COALESCE(EXCLUDED.strength_bias, workout_session.strength_bias),
       cardio_bias = COALESCE(EXCLUDED.cardio_bias, workout_session.cardio_bias),
       pre_session_rmssd = COALESCE(EXCLUDED.pre_session_rmssd, workout_session.pre_session_rmssd),
       min_session_rmssd = COALESCE(EXCLUDED.min_session_rmssd, workout_session.min_session_rmssd),
       post_session_rmssd = COALESCE(EXCLUDED.post_session_rmssd, workout_session.post_session_rmssd),
       hrv_suppression_pct = COALESCE(EXCLUDED.hrv_suppression_pct, workout_session.hrv_suppression_pct),
       hrv_rebound_pct = COALESCE(EXCLUDED.hrv_rebound_pct, workout_session.hrv_rebound_pct),
       suppression_depth_pct = COALESCE(EXCLUDED.suppression_depth_pct, workout_session.suppression_depth_pct),
       rebound_bpm_per_min = COALESCE(EXCLUDED.rebound_bpm_per_min, workout_session.rebound_bpm_per_min),
       baseline_window_seconds = COALESCE(EXCLUDED.baseline_window_seconds, workout_session.baseline_window_seconds),
       time_to_recovery_sec = COALESCE(EXCLUDED.time_to_recovery_sec, workout_session.time_to_recovery_sec),
       source = EXCLUDED.source,
       timezone = COALESCE(EXCLUDED.timezone, workout_session.timezone),
       updated_at = NOW()`,
    [w.session_id, w.user_id ?? DEFAULT_USER_ID, w.date, w.start_ts, w.end_ts, w.workout_type, w.duration_minutes,
     w.avg_hr, w.max_hr, w.calories_burned, w.session_strain_score, w.session_type_tag,
     w.recovery_slope, w.strength_bias, w.cardio_bias,
     w.pre_session_rmssd, w.min_session_rmssd, w.post_session_rmssd,
     w.hrv_suppression_pct, w.hrv_rebound_pct,
     w.suppression_depth_pct, w.rebound_bpm_per_min,
     w.baseline_window_seconds, w.time_to_recovery_sec, w.source, w.timezone ?? null]
  );
}

export async function batchUpsertHrSamples(samples: WorkoutHrSample[]): Promise<number> {
  if (samples.length === 0) return 0;
  let count = 0;
  for (const s of samples) {
    await pool.query(
      `INSERT INTO workout_hr_samples (session_id, ts, hr_bpm, source)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (session_id, ts) DO UPDATE SET hr_bpm = EXCLUDED.hr_bpm, source = EXCLUDED.source`,
      [s.session_id, s.ts, s.hr_bpm, s.source]
    );
    count++;
  }
  return count;
}

export async function batchUpsertRrIntervals(intervals: WorkoutRrInterval[]): Promise<number> {
  if (intervals.length === 0) return 0;
  let count = 0;
  for (const r of intervals) {
    await pool.query(
      `INSERT INTO workout_rr_intervals (session_id, ts, rr_ms, source)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (session_id, ts) DO UPDATE SET rr_ms = EXCLUDED.rr_ms, source = EXCLUDED.source`,
      [r.session_id, r.ts, r.rr_ms, r.source]
    );
    count++;
  }
  return count;
}

export async function upsertHrvBaseline(b: HrvBaselineDaily): Promise<void> {
  await pool.query(
    `INSERT INTO hrv_baseline_daily
       (user_id, date, night_hrv_rmssd_ms, night_hrv_sdnn_ms,
        baseline_hrv_rmssd_7d_median, baseline_hrv_sdnn_7d_median,
        deviation_rmssd_pct, deviation_sdnn_pct,
        morning_hrv_sdnn_ms, morning_deviation_pct, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (user_id, date) DO UPDATE SET
       night_hrv_rmssd_ms = COALESCE(EXCLUDED.night_hrv_rmssd_ms, hrv_baseline_daily.night_hrv_rmssd_ms),
       night_hrv_sdnn_ms = COALESCE(EXCLUDED.night_hrv_sdnn_ms, hrv_baseline_daily.night_hrv_sdnn_ms),
       baseline_hrv_rmssd_7d_median = EXCLUDED.baseline_hrv_rmssd_7d_median,
       baseline_hrv_sdnn_7d_median = EXCLUDED.baseline_hrv_sdnn_7d_median,
       deviation_rmssd_pct = EXCLUDED.deviation_rmssd_pct,
       deviation_sdnn_pct = EXCLUDED.deviation_sdnn_pct,
       morning_hrv_sdnn_ms = COALESCE(EXCLUDED.morning_hrv_sdnn_ms, hrv_baseline_daily.morning_hrv_sdnn_ms),
       morning_deviation_pct = EXCLUDED.morning_deviation_pct,
       source = EXCLUDED.source,
       updated_at = NOW()`,
    [b.user_id ?? DEFAULT_USER_ID, b.date, b.night_hrv_rmssd_ms, b.night_hrv_sdnn_ms,
     b.baseline_hrv_rmssd_7d_median, b.baseline_hrv_sdnn_7d_median,
     b.deviation_rmssd_pct, b.deviation_sdnn_pct,
     b.morning_hrv_sdnn_ms, b.morning_deviation_pct, b.source]
  );
}

export async function getSleepSummaryRange(startDate: string, endDate: string, userId: string = DEFAULT_USER_ID): Promise<SleepSummary[]> {
  const { rows } = await pool.query(
    `SELECT * FROM sleep_summary_daily WHERE date >= $1 AND date <= $2 AND user_id = $3 ORDER BY date ASC`,
    [startDate, endDate, userId]
  );
  return rows;
}

export async function getVitalsDailyRange(startDate: string, endDate: string, userId: string = DEFAULT_USER_ID): Promise<VitalsDaily[]> {
  const { rows } = await pool.query(
    `SELECT * FROM vitals_daily WHERE date >= $1 AND date <= $2 AND user_id = $3 ORDER BY date ASC`,
    [startDate, endDate, userId]
  );
  return rows;
}

export async function getWorkoutSessions(startDate: string, endDate: string, userId: string = DEFAULT_USER_ID): Promise<WorkoutSession[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workout_session WHERE date >= $1 AND date <= $2 AND user_id = $3 ORDER BY start_ts ASC`,
    [startDate, endDate, userId]
  );
  return rows;
}

export async function getHrSamplesForSession(sessionId: string): Promise<WorkoutHrSample[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workout_hr_samples WHERE session_id = $1 ORDER BY ts ASC`,
    [sessionId]
  );
  return rows;
}

export async function getRrIntervalsForSession(sessionId: string): Promise<WorkoutRrInterval[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workout_rr_intervals WHERE session_id = $1 ORDER BY ts ASC`,
    [sessionId]
  );
  return rows;
}

export async function getHrvBaselineRange(startDate: string, endDate: string, userId: string = DEFAULT_USER_ID): Promise<HrvBaselineDaily[]> {
  const { rows } = await pool.query(
    `SELECT * FROM hrv_baseline_daily WHERE date >= $1 AND date <= $2 AND user_id = $3 ORDER BY date ASC`,
    [startDate, endDate, userId]
  );
  return rows;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function recomputeHrvBaselines(startDate: string, endDate: string, userId: string = DEFAULT_USER_ID): Promise<number> {
  const { rows: vitals } = await pool.query(
    `SELECT date::text as date, hrv_rmssd_ms, hrv_sdnn_ms, source FROM vitals_daily
     WHERE date >= ($1::date - interval '14 days') AND date <= $2::date AND user_id = $3
     ORDER BY date ASC`,
    [startDate, endDate, userId]
  );

  const rmssdMap = new Map<string, number>();
  const sdnnMap = new Map<string, number>();
  const sourceMap = new Map<string, string>();
  for (const r of vitals) {
    if (r.hrv_rmssd_ms != null) rmssdMap.set(r.date, Number(r.hrv_rmssd_ms));
    if (r.hrv_sdnn_ms != null) sdnnMap.set(r.date, Number(r.hrv_sdnn_ms));
    sourceMap.set(r.date, r.source);
  }

  let count = 0;
  const allDates: string[] = [];
  let cur = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cur <= end) {
    allDates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  for (const date of allDates) {
    const nightRmssd = rmssdMap.get(date) ?? null;
    const nightSdnn = sdnnMap.get(date) ?? null;
    if (nightRmssd == null && nightSdnn == null) continue;

    const prev7: string[] = [];
    const d = new Date(date + "T00:00:00Z");
    for (let i = 1; i <= 7; i++) {
      const pd = new Date(d);
      pd.setUTCDate(pd.getUTCDate() - i);
      prev7.push(pd.toISOString().slice(0, 10));
    }

    const rmssdVals = prev7.map(dd => rmssdMap.get(dd)).filter((v): v is number => v != null);
    const sdnnVals = prev7.map(dd => sdnnMap.get(dd)).filter((v): v is number => v != null);

    const baselineRmssd = rmssdVals.length >= 3 ? Math.round(median(rmssdVals) * 10) / 10 : null;
    const baselineSdnn = sdnnVals.length >= 3 ? Math.round(median(sdnnVals) * 10) / 10 : null;

    const devRmssd = nightRmssd != null && baselineRmssd != null && baselineRmssd > 0
      ? Math.round(((nightRmssd - baselineRmssd) / baselineRmssd) * 1000) / 10
      : null;
    const devSdnn = nightSdnn != null && baselineSdnn != null && baselineSdnn > 0
      ? Math.round(((nightSdnn - baselineSdnn) / baselineSdnn) * 1000) / 10
      : null;

    await upsertHrvBaseline({
      date,
      user_id: userId,
      night_hrv_rmssd_ms: nightRmssd,
      night_hrv_sdnn_ms: nightSdnn,
      baseline_hrv_rmssd_7d_median: baselineRmssd,
      baseline_hrv_sdnn_7d_median: baselineSdnn,
      deviation_rmssd_pct: devRmssd,
      deviation_sdnn_pct: devSdnn,
      morning_hrv_sdnn_ms: null,
      morning_deviation_pct: null,
      source: sourceMap.get(date) || "unknown",
    });
    count++;
  }

  return count;
}

export function computeSessionStrain(
  avgHr: number | null,
  maxHr: number | null,
  durationMin: number | null,
  workoutType: string,
): { strainScore: number; typeTag: string } {
  const baseIntensity = avgHr != null && maxHr != null && maxHr > 0
    ? (avgHr / maxHr) * 100
    : 50;

  const durationFactor = durationMin != null
    ? Math.min(durationMin / 60, 2.0)
    : 1.0;

  const typeMultiplier: Record<string, number> = {
    hiit: 1.4,
    cardio: 1.2,
    strength: 1.0,
    flexibility: 0.5,
    other: 0.8,
  };
  const mult = typeMultiplier[workoutType] ?? 1.0;

  const raw = baseIntensity * durationFactor * mult;
  const strainScore = Math.round(Math.min(raw, 200) * 10) / 10;

  let typeTag = "moderate";
  if (workoutType === "strength") {
    typeTag = avgHr != null && avgHr > 130 ? "strength_high_intensity" : "strength_hypertrophy";
  } else if (workoutType === "cardio") {
    typeTag = avgHr != null && avgHr > 150 ? "cardio_high" : "cardio_steady";
  } else if (workoutType === "hiit") {
    typeTag = "hiit";
  } else {
    typeTag = workoutType;
  }

  return { strainScore, typeTag };
}

export function computeRecoverySlope(
  hrSamples: WorkoutHrSample[],
  sessionEndTs: string,
): number | null {
  const endTime = new Date(sessionEndTs).getTime();
  if (isNaN(endTime)) return null;

  const postSamples = hrSamples
    .filter(s => {
      const t = new Date(s.ts).getTime();
      return t >= endTime && t <= endTime + 20 * 60 * 1000;
    })
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  if (postSamples.length < 2) return null;

  const firstHr = postSamples[0].hr_bpm;
  const lastHr = postSamples[postSamples.length - 1].hr_bpm;
  const elapsedMin = (new Date(postSamples[postSamples.length - 1].ts).getTime() - new Date(postSamples[0].ts).getTime()) / 60000;

  if (elapsedMin < 1) return null;

  return Math.round(((firstHr - lastHr) / elapsedMin) * 100) / 100;
}

export type HrvResponseFlag = "suppressed" | "increased" | "flat" | "insufficient";

export interface SessionHrvAnalysis {
  pre_session_rmssd: number | null;
  min_session_rmssd: number | null;
  post_session_rmssd: number | null;
  hrv_suppression_pct: number | null;
  hrv_rebound_pct: number | null;
  hrv_response_flag: HrvResponseFlag;
  suppression_depth_pct: number | null;
  rebound_bpm_per_min: number | null;
  baseline_window_seconds: number;
  baseline_rr_count: number;
  active_rr_count: number;
  recovery_rr_count: number;
  time_to_recovery_sec: number | null;
  strength_bias: number;
  cardio_bias: number;
}

export function computeRmssdFromRr(rrIntervalsMs: number[]): number | null {
  if (rrIntervalsMs.length < 2) return null;

  const filtered = rrIntervalsMs.filter(rr => rr >= 300 && rr <= 2000);
  if (filtered.length < 2) return null;

  let sumSqDiff = 0;
  for (let i = 1; i < filtered.length; i++) {
    const diff = filtered[i] - filtered[i - 1];
    sumSqDiff += diff * diff;
  }
  const rmssd = Math.sqrt(sumSqDiff / (filtered.length - 1));
  return Math.round(rmssd * 100) / 100;
}

function clampPct(val: number): number {
  return Math.round(Math.max(0, Math.min(100, val)) * 10) / 10;
}

function medianOf(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function meanOf(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function computeTimeBasedRollingRmssd(
  rrWithTs: { ts: number; rr_ms: number }[],
  windowSec: number = 60,
  stepSec: number = 10,
  minBeatsPerWindow: number = 20,
): number[] {
  if (rrWithTs.length < minBeatsPerWindow) return [];
  const startTs = rrWithTs[0].ts;
  const endTs = rrWithTs[rrWithTs.length - 1].ts;
  const results: number[] = [];

  for (let wStart = startTs; wStart + windowSec * 1000 <= endTs; wStart += stepSec * 1000) {
    const wEnd = wStart + windowSec * 1000;
    const windowRr = rrWithTs
      .filter(r => r.ts >= wStart && r.ts < wEnd)
      .map(r => r.rr_ms);

    if (windowRr.length < minBeatsPerWindow) continue;
    const rmssd = computeRmssdFromRr(windowRr);
    if (rmssd != null) results.push(rmssd);
  }
  return results;
}

function p10(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(s.length * 0.10) - 1);
  return s[idx];
}

function smoothedHr(
  samples: { ts: number; hr: number }[],
  windowMs: number = 15000,
): { ts: number; hr: number }[] {
  if (samples.length === 0) return [];
  const result: { ts: number; hr: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const center = samples[i].ts;
    const half = windowMs / 2;
    const neighbors = samples.filter(s => s.ts >= center - half && s.ts <= center + half);
    const avgHr = neighbors.reduce((sum, s) => sum + s.hr, 0) / neighbors.length;
    result.push({ ts: center, hr: Math.round(avgHr * 10) / 10 });
  }
  return result;
}

export function processSessionRrIntervals(
  rrIntervals: WorkoutRrInterval[],
  hrSamples: WorkoutHrSample[],
  sessionStartTs: string,
  sessionEndTs: string | null,
  baselineWindowSec: number = 120,
  recoveryWindowSec: number = 600,
): SessionHrvAnalysis {
  const startTime = new Date(sessionStartTs).getTime();
  const endTime = sessionEndTs ? new Date(sessionEndTs).getTime() : null;
  const nullResult: SessionHrvAnalysis = {
    pre_session_rmssd: null, min_session_rmssd: null, post_session_rmssd: null,
    hrv_suppression_pct: null, hrv_rebound_pct: null,
    hrv_response_flag: "insufficient" as HrvResponseFlag,
    suppression_depth_pct: null, rebound_bpm_per_min: null,
    baseline_window_seconds: baselineWindowSec, baseline_rr_count: 0,
    active_rr_count: 0, recovery_rr_count: 0, time_to_recovery_sec: null,
    strength_bias: 0.5, cardio_bias: 0.5,
  };

  if (isNaN(startTime)) return nullResult;

  const sortedRr = rrIntervals
    .map(r => ({ ts: new Date(r.ts).getTime(), rr_ms: r.rr_ms }))
    .filter(r => !isNaN(r.ts) && r.rr_ms >= 300 && r.rr_ms <= 2000)
    .sort((a, b) => a.ts - b.ts);

  const hrSorted = hrSamples
    .map(s => ({ ts: new Date(s.ts).getTime(), hr: s.hr_bpm }))
    .filter(s => !isNaN(s.ts))
    .sort((a, b) => a.ts - b.ts);

  const baselineStart = startTime - baselineWindowSec * 1000;
  const baselineRr = sortedRr.filter(r => r.ts >= baselineStart && r.ts < startTime);
  const activeRr = sortedRr.filter(r => r.ts >= startTime && (endTime == null || r.ts < endTime));
  const recoverySkipMs = 60 * 1000;
  const recoveryRr = endTime != null
    ? sortedRr.filter(r => r.ts >= endTime + recoverySkipMs && r.ts <= endTime + recoveryWindowSec * 1000)
    : [];

  const MIN_BASELINE_BEATS = 60;
  const MIN_RECOVERY_BEATS = 60;
  const preRmssd = baselineRr.length >= MIN_BASELINE_BEATS
    ? computeRmssdFromRr(baselineRr.map(r => r.rr_ms))
    : null;

  let minRmssd: number | null = null;
  if (activeRr.length >= 20) {
    const rolling = computeTimeBasedRollingRmssd(activeRr, 60, 10, 20);
    if (rolling.length > 0) {
      minRmssd = p10(rolling);
      if (minRmssd != null) minRmssd = Math.round(minRmssd * 100) / 100;
    }
  }

  const postRmssd = recoveryRr.length >= MIN_RECOVERY_BEATS
    ? computeRmssdFromRr(recoveryRr.map(r => r.rr_ms))
    : null;

  let hrvSuppressionPct: number | null = null;
  if (preRmssd != null && minRmssd != null && preRmssd > 0) {
    hrvSuppressionPct = clampPct(((preRmssd - minRmssd) / preRmssd) * 100);
  }

  let hrvReboundPct: number | null = null;
  if (preRmssd != null && minRmssd != null && postRmssd != null && preRmssd > minRmssd) {
    const raw = (postRmssd - minRmssd) / (preRmssd - minRmssd);
    hrvReboundPct = clampPct(raw * 100);
  }

  const baselineHrSamples = hrSorted.filter(s => s.ts >= baselineStart && s.ts < startTime);
  let restingHr: number | null = medianOf(baselineHrSamples.map(s => s.hr));
  if (restingHr == null && baselineRr.length > 0) {
    const meanRr = meanOf(baselineRr.map(r => r.rr_ms));
    if (meanRr != null && meanRr > 0) restingHr = 60000 / meanRr;
  }

  let suppressionDepthPct: number | null = null;
  let reboundBpmPerMin: number | null = null;
  let timeToRecoverySec: number | null = null;

  const activeSamples = hrSorted.filter(s => s.ts >= startTime && (endTime == null || s.ts < endTime));
  const peakHr = activeSamples.length >= 5 ? Math.max(...activeSamples.map(s => s.hr)) : null;

  if (restingHr != null && restingHr > 0) {
    if (peakHr != null) {
      const rawDepth = ((peakHr - restingHr) / restingHr) * 100;
      suppressionDepthPct = Math.round(Math.max(0, Math.min(500, rawDepth)) * 10) / 10;
    }

    if (endTime != null) {
      const postSamples = hrSorted.filter(s => s.ts >= endTime && s.ts <= endTime + 5 * 60 * 1000);
      if (postSamples.length >= 2) {
        const first = postSamples[0];
        const last = postSamples[postSamples.length - 1];
        const elapsedMin = (last.ts - first.ts) / 60000;
        if (elapsedMin >= 0.5) {
          reboundBpmPerMin = Math.round(((first.hr - last.hr) / elapsedMin) * 100) / 100;
        }
      }

      if (peakHr != null) {
        const recoveryTarget = restingHr + 0.10 * (peakHr - restingHr);
        const smoothed = smoothedHr(postSamples, 15000);
        const SUSTAIN_MS = 30000;

        for (let i = 0; i < smoothed.length; i++) {
          if (smoothed[i].hr > recoveryTarget) continue;
          const sustainStart = smoothed[i].ts;
          let sustained = true;
          for (let j = i + 1; j < smoothed.length; j++) {
            if (smoothed[j].ts > sustainStart + SUSTAIN_MS) break;
            if (smoothed[j].hr > recoveryTarget) { sustained = false; break; }
          }
          if (sustained && smoothed.length > i + 1) {
            const lastInWindow = smoothed.find(s => s.ts > sustainStart + SUSTAIN_MS);
            const endOfSustain = lastInWindow ? sustainStart + SUSTAIN_MS : smoothed[smoothed.length - 1].ts;
            if (endOfSustain - sustainStart >= SUSTAIN_MS * 0.8) {
              timeToRecoverySec = Math.round((sustainStart - endTime) / 1000);
              break;
            }
          }
        }
      }
    }
  }

  const biases = computeSessionBiasesFromPhysiology(hrSorted, startTime, endTime, preRmssd, minRmssd);

  let hrvResponseFlag: HrvResponseFlag = "insufficient";
  if (preRmssd != null && minRmssd != null) {
    const ratio = (preRmssd - minRmssd) / preRmssd;
    if (ratio > 0.05) {
      hrvResponseFlag = "suppressed";
    } else if (ratio < -0.05) {
      hrvResponseFlag = "increased";
    } else {
      hrvResponseFlag = "flat";
    }
  }

  return {
    pre_session_rmssd: preRmssd,
    min_session_rmssd: minRmssd,
    post_session_rmssd: postRmssd,
    hrv_suppression_pct: hrvSuppressionPct,
    hrv_rebound_pct: hrvReboundPct,
    hrv_response_flag: hrvResponseFlag,
    suppression_depth_pct: suppressionDepthPct,
    rebound_bpm_per_min: reboundBpmPerMin,
    baseline_window_seconds: baselineWindowSec,
    baseline_rr_count: baselineRr.length,
    active_rr_count: activeRr.length,
    recovery_rr_count: recoveryRr.length,
    time_to_recovery_sec: timeToRecoverySec,
    ...biases,
  };
}

function computeHrOscillation(
  hrSamples: { ts: number; hr: number }[],
  startTime: number,
  endTime: number | null,
): { amplitude: number; oscillationCount: number; sustainedHighPct: number } {
  const active = hrSamples.filter(s => s.ts >= startTime && (endTime == null || s.ts < endTime));
  if (active.length < 10) return { amplitude: 0, oscillationCount: 0, sustainedHighPct: 0 };

  const hrs = active.map(s => s.hr);
  const meanHr = hrs.reduce((a, b) => a + b, 0) / hrs.length;
  const maxHr = Math.max(...hrs);
  const highThreshold = meanHr + (maxHr - meanHr) * 0.3;

  let oscillations = 0;
  let wasHigh = hrs[0] > meanHr;
  for (let i = 1; i < hrs.length; i++) {
    const isHigh = hrs[i] > meanHr;
    if (isHigh !== wasHigh) {
      oscillations++;
      wasHigh = isHigh;
    }
  }

  const sustainedHighCount = hrs.filter(h => h >= highThreshold).length;
  const sustainedHighPct = sustainedHighCount / hrs.length;

  let amplitudeSum = 0;
  let amplitudeCount = 0;
  const chunkSize = Math.max(5, Math.floor(hrs.length / 20));
  for (let i = 0; i < hrs.length - chunkSize; i += chunkSize) {
    const chunk = hrs.slice(i, i + chunkSize);
    const chunkMax = Math.max(...chunk);
    const chunkMin = Math.min(...chunk);
    amplitudeSum += chunkMax - chunkMin;
    amplitudeCount++;
  }
  const amplitude = amplitudeCount > 0 ? amplitudeSum / amplitudeCount : 0;

  return { amplitude, oscillationCount: oscillations, sustainedHighPct };
}

function computeSessionBiasesFromPhysiology(
  hrSamples: { ts: number; hr: number }[],
  startTime: number,
  endTime: number | null,
  preRmssd: number | null,
  minRmssd: number | null,
): { strength_bias: number; cardio_bias: number } {
  const osc = computeHrOscillation(hrSamples, startTime, endTime);

  let strength = 0.5;
  let cardio = 0.5;

  if (osc.amplitude > 20 && osc.oscillationCount > 10) {
    strength += 0.25;
    cardio -= 0.15;
  } else if (osc.amplitude < 10 && osc.sustainedHighPct > 0.6) {
    cardio += 0.25;
    strength -= 0.15;
  }

  if (preRmssd != null && minRmssd != null && preRmssd > 0) {
    const suppressionRatio = (preRmssd - minRmssd) / preRmssd;
    if (suppressionRatio > 0.5) {
      strength += 0.1;
    } else if (suppressionRatio < 0.2) {
      cardio += 0.1;
    }
  }

  strength = Math.max(0, Math.min(1, strength));
  cardio = Math.max(0, Math.min(1, cardio));
  const total = strength + cardio;
  if (total > 0) {
    strength = strength / total;
    cardio = cardio / total;
  } else {
    strength = 0.5;
    cardio = 0.5;
  }
  strength = Math.round(strength * 10000) / 10000;
  cardio = Math.round((1 - strength) * 10000) / 10000;

  return { strength_bias: strength, cardio_bias: cardio };
}

export function computeSessionBiases(
  workoutType: string,
  avgHr: number | null,
  maxHr: number | null,
  durationMin: number | null,
): { strength_bias: number; cardio_bias: number } {
  let strength = 0;
  let cardio = 0;

  if (workoutType === "strength") {
    strength = 0.8;
    cardio = 0.2;
  } else if (workoutType === "cardio") {
    strength = 0.1;
    cardio = 0.9;
  } else if (workoutType === "hiit") {
    strength = 0.5;
    cardio = 0.5;
  } else if (workoutType === "flexibility") {
    strength = 0.1;
    cardio = 0.05;
  } else {
    strength = 0.4;
    cardio = 0.4;
  }

  if (avgHr != null && maxHr != null && maxHr > 0) {
    const hrRatio = avgHr / maxHr;
    if (hrRatio > 0.85) {
      cardio = Math.min(cardio + 0.15, 1.0);
    } else if (hrRatio < 0.65) {
      strength = Math.min(strength + 0.1, 1.0);
    }
  }

  if (durationMin != null) {
    if (durationMin > 60) {
      cardio = Math.min(cardio + 0.05, 1.0);
    }
    if (durationMin < 30 && workoutType === "strength") {
      strength = Math.min(strength + 0.05, 1.0);
    }
  }

  return {
    strength_bias: Math.round(strength * 100) / 100,
    cardio_bias: Math.round(cardio * 100) / 100,
  };
}

export async function analyzeSessionHrv(sessionId: string): Promise<SessionHrvAnalysis> {
  const { rows: sessions } = await pool.query(
    `SELECT * FROM workout_session WHERE session_id = $1`,
    [sessionId]
  );
  if (sessions.length === 0) throw new Error(`Session ${sessionId} not found`);
  const session = sessions[0];

  const rrIntervals = await getRrIntervalsForSession(sessionId);
  const hrSamples = await getHrSamplesForSession(sessionId);

  const analysis = processSessionRrIntervals(
    rrIntervals, hrSamples,
    session.start_ts, session.end_ts,
    session.baseline_window_seconds || 120,
  );

  await pool.query(
    `UPDATE workout_session SET
       pre_session_rmssd = $2,
       min_session_rmssd = $3,
       post_session_rmssd = $4,
       hrv_suppression_pct = $5,
       hrv_rebound_pct = $6,
       hrv_response_flag = $7,
       suppression_depth_pct = $8,
       rebound_bpm_per_min = $9,
       baseline_window_seconds = $10,
       time_to_recovery_sec = $11,
       strength_bias = $12,
       cardio_bias = $13,
       updated_at = NOW()
     WHERE session_id = $1`,
    [sessionId,
     analysis.pre_session_rmssd, analysis.min_session_rmssd, analysis.post_session_rmssd,
     analysis.hrv_suppression_pct, analysis.hrv_rebound_pct, analysis.hrv_response_flag,
     analysis.suppression_depth_pct, analysis.rebound_bpm_per_min,
     analysis.baseline_window_seconds, analysis.time_to_recovery_sec,
     analysis.strength_bias, analysis.cardio_bias]
  );

  return analysis;
}
