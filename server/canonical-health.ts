import { pool } from "./db";

export interface SleepSummary {
  date: string;
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
}

export interface VitalsDaily {
  date: string;
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
}

export interface WorkoutSession {
  session_id: string;
  date: string;
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
  source: string;
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
  await pool.query(
    `INSERT INTO sleep_summary_daily
       (date, sleep_start, sleep_end, total_sleep_minutes, time_in_bed_minutes,
        awake_minutes, rem_minutes, deep_minutes, light_or_core_minutes,
        sleep_efficiency, sleep_latency_min, waso_min, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (date) DO UPDATE SET
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
       updated_at = NOW()`,
    [s.date, s.sleep_start, s.sleep_end, s.total_sleep_minutes, s.time_in_bed_minutes,
     s.awake_minutes, s.rem_minutes, s.deep_minutes, s.light_or_core_minutes,
     s.sleep_efficiency, s.sleep_latency_min, s.waso_min, s.source]
  );
}

export async function upsertVitalsDaily(v: VitalsDaily): Promise<void> {
  await pool.query(
    `INSERT INTO vitals_daily
       (date, resting_hr_bpm, hrv_rmssd_ms, hrv_sdnn_ms, respiratory_rate_bpm,
        spo2_pct, skin_temp_delta_c, steps, active_zone_minutes, energy_burned_kcal,
        zone1_min, zone2_min, zone3_min, below_zone1_min, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (date) DO UPDATE SET
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
       updated_at = NOW()`,
    [v.date, v.resting_hr_bpm, v.hrv_rmssd_ms, v.hrv_sdnn_ms, v.respiratory_rate_bpm,
     v.spo2_pct, v.skin_temp_delta_c, v.steps, v.active_zone_minutes, v.energy_burned_kcal,
     v.zone1_min, v.zone2_min, v.zone3_min, v.below_zone1_min, v.source]
  );
}

export async function upsertWorkoutSession(w: WorkoutSession): Promise<void> {
  await pool.query(
    `INSERT INTO workout_session
       (session_id, date, start_ts, end_ts, workout_type, duration_minutes,
        avg_hr, max_hr, calories_burned, session_strain_score, session_type_tag,
        recovery_slope, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (session_id) DO UPDATE SET
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
       source = EXCLUDED.source,
       updated_at = NOW()`,
    [w.session_id, w.date, w.start_ts, w.end_ts, w.workout_type, w.duration_minutes,
     w.avg_hr, w.max_hr, w.calories_burned, w.session_strain_score, w.session_type_tag,
     w.recovery_slope, w.source]
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
       (date, night_hrv_rmssd_ms, night_hrv_sdnn_ms,
        baseline_hrv_rmssd_7d_median, baseline_hrv_sdnn_7d_median,
        deviation_rmssd_pct, deviation_sdnn_pct,
        morning_hrv_sdnn_ms, morning_deviation_pct, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (date) DO UPDATE SET
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
    [b.date, b.night_hrv_rmssd_ms, b.night_hrv_sdnn_ms,
     b.baseline_hrv_rmssd_7d_median, b.baseline_hrv_sdnn_7d_median,
     b.deviation_rmssd_pct, b.deviation_sdnn_pct,
     b.morning_hrv_sdnn_ms, b.morning_deviation_pct, b.source]
  );
}

export async function getSleepSummaryRange(startDate: string, endDate: string): Promise<SleepSummary[]> {
  const { rows } = await pool.query(
    `SELECT * FROM sleep_summary_daily WHERE date >= $1 AND date <= $2 ORDER BY date ASC`,
    [startDate, endDate]
  );
  return rows;
}

export async function getVitalsDailyRange(startDate: string, endDate: string): Promise<VitalsDaily[]> {
  const { rows } = await pool.query(
    `SELECT * FROM vitals_daily WHERE date >= $1 AND date <= $2 ORDER BY date ASC`,
    [startDate, endDate]
  );
  return rows;
}

export async function getWorkoutSessions(startDate: string, endDate: string): Promise<WorkoutSession[]> {
  const { rows } = await pool.query(
    `SELECT * FROM workout_session WHERE date >= $1 AND date <= $2 ORDER BY start_ts ASC`,
    [startDate, endDate]
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

export async function getHrvBaselineRange(startDate: string, endDate: string): Promise<HrvBaselineDaily[]> {
  const { rows } = await pool.query(
    `SELECT * FROM hrv_baseline_daily WHERE date >= $1 AND date <= $2 ORDER BY date ASC`,
    [startDate, endDate]
  );
  return rows;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function recomputeHrvBaselines(startDate: string, endDate: string): Promise<number> {
  const { rows: vitals } = await pool.query(
    `SELECT date::text as date, hrv_rmssd_ms, hrv_sdnn_ms, source FROM vitals_daily
     WHERE date >= ($1::date - interval '14 days') AND date <= $2::date
     ORDER BY date ASC`,
    [startDate, endDate]
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
