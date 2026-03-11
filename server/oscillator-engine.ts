import pool from "./db.js";

// ─── Androgen Oscillator Engine ───────────────────────────────────────────────
// Implements the 3-layer convergent rhythm model:
//   Layer A – Acute Readiness Oscillator   (50% of composite)
//   Layer B – Tissue-Resource Oscillator   (30% of composite)
//   Layer C – Endocrine-Seasonal Oscillator(20% of composite)
//
// COMPOSITE = 0.50·Acute + 0.30·Resource + 0.20·Seasonal
//
// Future inputs not yet in daily_log schema (will default to neutral):
//   - libido_drive_0_10  (Layer A: 10 pts → defaults to 5)
//   - pump_quality_0_10  (Layer B signal)
//   - sunlight_min       (Layer C signal)
//   - subjective_motivation_0_10 (Layer C signal)
// ─────────────────────────────────────────────────────────────────────────────

export interface OscillatorResult {
  date: string;
  composite: number | null;
  tier: string | null;
  acute: number | null;
  resource: number | null;
  seasonal: number | null;
  acuteComponents: AcuteComponents;
  resourceComponents: ResourceComponents;
  seasonalComponents: SeasonalComponents;
  prescription: DayPrescription;
  dataQuality: "full" | "partial" | "insufficient";
}

export interface AcuteComponents {
  // 25 pts: HRV today vs 7d mean (from vitals_daily / sleep_summary_daily)
  hrvRatio: number | null;       // today/7d – > 1.05 = great, < 0.85 = suppressed
  hrvPts: number;
  // 20 pts: RHR today vs 7d mean
  rhrDelta: number | null;       // 7d_mean - today (positive = good)
  rhrPts: number;
  // 20 pts: sleep duration
  sleepMin: number | null;
  sleepPts: number;
  // 10 pts: sleep regularity (bed-time deviation from 7d mean)
  bedtimeDeviationMin: number | null;
  regularityPts: number;
  // 10 pts: soreness/joint friction (pain_0_10 inverted)
  pain010: number | null;
  sorenessPts: number;
  // 10 pts: libido/drive (NOT YET TRACKED → default neutral 5 pts)
  // Future: libido_drive_0_10 in daily_log
  libidoPts: number;
  // 5 pts: bodyweight stability vs 7d mean
  bwDevLb: number | null;
  bwStabilityPts: number;
}

export interface ResourceComponents {
  // 25 pts: 7d average calories vs 2695 kcal target
  avgCalories7d: number | null;
  caloriePts: number;
  // 15 pts: dietary adherence proxy (meal_checklist coverage)
  adherence7d: number | null;
  adherencePts: number;
  // 20 pts: 14d bodyweight trend (stable lean gain expected)
  bwTrend14d: number | null;    // lb/week rate
  bwTrendPts: number;
  // 20 pts: 14d waist trend (stable or dropping)
  waistTrend14d: number | null; // in/week rate
  waistTrendPts: number;
  // 20 pts: FFM trend (stable or rising over 14d)
  ffmTrend14d: number | null;   // lb/week rate
  ffmTrendPts: number;
}

export interface SeasonalComponents {
  // 30 pts: 28d HRV trend vs 56d baseline
  hrv28Trend: number | null;    // pct delta (28d vs 56d mean)
  hrv28Pts: number;
  // 20 pts: 28d RHR trend vs 56d baseline
  rhr28Trend: number | null;
  rhr28Pts: number;
  // 20 pts: 28d waist:weight ratio stability
  waistWeightTrend: number | null;
  waistWeightPts: number;
  // 20 pts: 28d FFM trend (positive = gaining lean mass)
  ffm28Trend: number | null;
  ffm28Pts: number;
  // 10 pts: cardio variety (zone2/zone3 mix over 14d)
  cardioVarietyPts: number;
}

export interface DayPrescription {
  dayType: "SURGE" | "BUILD" | "RESET" | "RESENSITIZE";
  cardioMode: "Zone 3" | "Zone 2" | "Walk / Easy";
  liftExpression: "Neural / Tension" | "Hypertrophy" | "Pump / Metabolic" | "Recovery / Mobility";
  macroProteinG: number;
  macroCarbG: [number, number];  // [min, max]
  macroFatG: [number, number];
  macroKcal: [number, number];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function linearScore(val: number, bad: number, good: number, maxPts: number): number {
  if (good === bad) return val >= good ? maxPts : 0;
  const t = (val - bad) / (good - bad);
  return Math.round(clamp(t, 0, 1) * maxPts);
}

// Simple linear regression slope (lb or unit per period)
function trendSlope(vals: (number | null)[]): number | null {
  const pts = vals.map((v, i) => v != null ? { x: i, y: v } : null).filter(Boolean) as { x: number; y: number }[];
  if (pts.length < 3) return null;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sx2 - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  return (n * sxy - sx * sy) / denom;
}

function rollingMean(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
}

// Parse "HH:MM" or "HH:MM:SS" bed time into minutes-since-midnight (handles post-midnight)
function bedTimeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  let m = parts[0] * 60 + parts[1];
  // Normalise post-midnight (e.g. 00:30 → 1470 so it's after 22:00)
  if (m < 8 * 60) m += 24 * 60;
  return m;
}

// ─── Layer A: Acute Readiness Score ──────────────────────────────────────────

async function computeAcute(
  date: string,
  userId: string,
): Promise<{ score: number | null; components: AcuteComponents }> {
  // Fetch today's vitals
  const [vitalsToday, sleepToday, dailyToday, vitals7d, sleep7d, daily7d] = await Promise.all([
    pool.query(
      `SELECT hrv_rmssd_ms, resting_hr_bpm FROM vitals_daily
       WHERE user_id = $1 AND date = $2::date LIMIT 1`,
      [userId, date],
    ),
    pool.query(
      `SELECT total_sleep_minutes FROM sleep_summary_daily
       WHERE user_id = $1 AND date = $2::date LIMIT 1`,
      [userId, date],
    ),
    pool.query(
      `SELECT pain_0_10, actual_bed_time, morning_weight_lb FROM daily_log
       WHERE user_id = $1 AND day = $2::date LIMIT 1`,
      [userId, date],
    ),
    pool.query(
      `SELECT AVG(hrv_rmssd_ms)::numeric as hrv7, AVG(resting_hr_bpm)::numeric as rhr7
       FROM vitals_daily
       WHERE user_id = $1 AND date BETWEEN ($2::date - interval '7 days') AND ($2::date - interval '1 day')`,
      [userId, date],
    ),
    pool.query(
      `SELECT AVG(total_sleep_minutes)::numeric as sleep7
       FROM sleep_summary_daily
       WHERE user_id = $1 AND date BETWEEN ($2::date - interval '7 days') AND ($2::date - interval '1 day')`,
      [userId, date],
    ),
    pool.query(
      `SELECT actual_bed_time, morning_weight_lb FROM daily_log
       WHERE user_id = $1 AND day BETWEEN ($2::date - interval '7 days') AND ($2::date - interval '1 day')
       AND (actual_bed_time IS NOT NULL OR morning_weight_lb IS NOT NULL)`,
      [userId, date],
    ),
  ]);

  const hrv = vitalsToday.rows[0]?.hrv_rmssd_ms != null ? Number(vitalsToday.rows[0].hrv_rmssd_ms) : null;
  const rhr = vitalsToday.rows[0]?.resting_hr_bpm != null ? Number(vitalsToday.rows[0].resting_hr_bpm) : null;
  const sleepMin = sleepToday.rows[0]?.total_sleep_minutes != null ? Number(sleepToday.rows[0].total_sleep_minutes) : null;
  const pain010 = dailyToday.rows[0]?.pain_0_10 != null ? Number(dailyToday.rows[0].pain_0_10) : null;
  const bedTimeRaw = dailyToday.rows[0]?.actual_bed_time ?? null;
  const bwToday = dailyToday.rows[0]?.morning_weight_lb != null ? Number(dailyToday.rows[0].morning_weight_lb) : null;

  const hrv7 = vitals7d.rows[0]?.hrv7 != null ? Number(vitals7d.rows[0].hrv7) : null;
  const rhr7 = vitals7d.rows[0]?.rhr7 != null ? Number(vitals7d.rows[0].rhr7) : null;
  const sleep7 = sleep7d.rows[0]?.sleep7 != null ? Number(sleep7d.rows[0].sleep7) : null;

  // 7d bed-time mean
  const bedTimes7 = (daily7d.rows as any[]).map(r => bedTimeToMinutes(r.actual_bed_time)).filter((v): v is number => v != null);
  const bedTime7dMean = bedTimes7.length > 0 ? bedTimes7.reduce((s, n) => s + n, 0) / bedTimes7.length : null;
  const bedTimeToday = bedTimeToMinutes(bedTimeRaw);

  // 7d body-weight mean
  const bw7d = (daily7d.rows as any[]).map(r => r.morning_weight_lb != null ? Number(r.morning_weight_lb) : null).filter((v): v is number => v != null);
  const bw7Mean = bw7d.length > 0 ? bw7d.reduce((s, n) => s + n, 0) / bw7d.length : null;

  // ── HRV component (25 pts) ──
  let hrvRatio: number | null = null;
  let hrvPts = 0;
  if (hrv != null && hrv7 != null && hrv7 > 0) {
    hrvRatio = hrv / hrv7;
    // > 1.05 = 25 pts; 1.0 = 20 pts; 0.90 = 10 pts; < 0.80 = 0 pts
    hrvPts = linearScore(hrvRatio, 0.80, 1.10, 25);
  } else if (hrv != null) {
    // No 7d baseline yet — assume neutral
    hrvPts = 12;
  }

  // ── RHR component (20 pts) ──
  let rhrDelta: number | null = null;
  let rhrPts = 0;
  if (rhr != null && rhr7 != null) {
    rhrDelta = rhr7 - rhr; // positive = today lower than baseline = good
    // +3 bpm below = 20 pts; 0 = 12 pts; -4 bpm elevated = 0 pts
    rhrPts = linearScore(rhrDelta, -4, 3, 20);
  } else if (rhr != null) {
    rhrPts = 10;
  }

  // ── Sleep component (20 pts) ──
  let sleepPts = 0;
  if (sleepMin != null) {
    // ≥ 480 min (8h) = 20 pts; < 300 min (5h) = 0 pts
    sleepPts = linearScore(sleepMin, 300, 480, 20);
  } else if (sleep7 != null) {
    // Use 7d avg if today missing
    sleepPts = linearScore(sleep7, 300, 480, 20);
  }

  // ── Sleep regularity (10 pts) ──
  let bedtimeDeviationMin: number | null = null;
  let regularityPts = 5; // neutral default
  if (bedTimeToday != null && bedTime7dMean != null) {
    bedtimeDeviationMin = Math.abs(bedTimeToday - bedTime7dMean);
    // < 10 min = 10 pts; > 60 min = 0 pts
    regularityPts = linearScore(bedtimeDeviationMin, 60, 10, 10);
  }

  // ── Soreness (10 pts) — pain_0_10 inverted ──
  let sorenessPts = 5; // default neutral
  if (pain010 != null) {
    // pain 0 = no soreness = 10 pts; pain 10 = max soreness = 0 pts
    sorenessPts = Math.round(clamp((1 - pain010 / 10), 0, 1) * 10);
  }

  // ── Libido/drive (10 pts) — NOT YET TRACKED ──
  // Future: add libido_drive_0_10 to daily_log; for now default neutral
  const libidoPts = 5;

  // ── Bodyweight stability (5 pts) ──
  let bwDevLb: number | null = null;
  let bwStabilityPts = 3; // neutral default
  if (bwToday != null && bw7Mean != null) {
    bwDevLb = Math.abs(bwToday - bw7Mean);
    // < 0.5 lb = 5 pts; > 3 lb = 0 pts
    bwStabilityPts = linearScore(bwDevLb, 3, 0.5, 5);
  }

  const totalAcute = hrvPts + rhrPts + sleepPts + regularityPts + sorenessPts + libidoPts + bwStabilityPts;
  const hasData = hrv != null || rhr != null || sleepMin != null;

  return {
    score: hasData ? totalAcute : null,
    components: {
      hrvRatio, hrvPts,
      rhrDelta, rhrPts,
      sleepMin, sleepPts,
      bedtimeDeviationMin, regularityPts,
      pain010, sorenessPts,
      libidoPts,
      bwDevLb, bwStabilityPts,
    },
  };
}

// ─── Layer B: Tissue-Resource Score ──────────────────────────────────────────

async function computeResource(
  date: string,
  userId: string,
): Promise<{ score: number | null; components: ResourceComponents }> {
  const [calRes, bwRes, waistRes, ffmRes] = await Promise.all([
    pool.query(
      `SELECT day::text, calories_in, adherence FROM daily_log
       WHERE user_id = $1 AND day BETWEEN ($2::date - interval '6 days') AND $2::date
       ORDER BY day`,
      [userId, date],
    ),
    pool.query(
      `SELECT day::text, morning_weight_lb FROM daily_log
       WHERE user_id = $1 AND day BETWEEN ($2::date - interval '13 days') AND $2::date
         AND morning_weight_lb IS NOT NULL
       ORDER BY day`,
      [userId, date],
    ),
    pool.query(
      `SELECT day::text, waist_in FROM daily_log
       WHERE user_id = $1 AND day BETWEEN ($2::date - interval '13 days') AND $2::date
         AND waist_in IS NOT NULL
       ORDER BY day`,
      [userId, date],
    ),
    pool.query(
      `SELECT day::text, fat_free_mass_lb FROM daily_log
       WHERE user_id = $1 AND day BETWEEN ($2::date - interval '13 days') AND $2::date
         AND fat_free_mass_lb IS NOT NULL
       ORDER BY day`,
      [userId, date],
    ),
  ]);

  const TARGET_CALORIES = 2695;

  // ── Calorie adequacy (25 pts) ──
  const calorieRows = calRes.rows.filter((r: any) => r.calories_in != null);
  const avgCalories7d = calorieRows.length > 0
    ? calorieRows.reduce((s: number, r: any) => s + Number(r.calories_in), 0) / calorieRows.length
    : null;
  let caloriePts = 12; // neutral default
  if (avgCalories7d != null) {
    const ratio = avgCalories7d / TARGET_CALORIES;
    // 0.97–1.05 = 25 pts (optimal); < 0.80 = 0 pts; > 1.10 = 15 pts (surplus ok but reduced)
    if (ratio >= 0.97 && ratio <= 1.05) caloriePts = 25;
    else if (ratio > 1.05) caloriePts = linearScore(ratio, 1.20, 1.05, 25);
    else caloriePts = linearScore(ratio, 0.80, 0.97, 25);
  }

  // ── Dietary adherence (15 pts) — from adherence field (0–1) ──
  const adherenceRows = calRes.rows.filter((r: any) => r.adherence != null);
  const adherence7d = adherenceRows.length > 0
    ? adherenceRows.reduce((s: number, r: any) => s + Number(r.adherence), 0) / adherenceRows.length
    : null;
  let adherencePts = 8; // neutral
  if (adherence7d != null) {
    // 1.0 = 15 pts; 0.7 = 0 pts
    adherencePts = linearScore(adherence7d, 0.7, 1.0, 15);
  }

  // ── 14d Bodyweight trend (20 pts) ──
  const bwVals = bwRes.rows.map((r: any) => r.morning_weight_lb != null ? Number(r.morning_weight_lb) : null);
  const bwSlope = trendSlope(bwVals); // lb per day
  let bwTrend14d: number | null = bwSlope != null ? bwSlope * 7 : null; // lb/week
  let bwTrendPts = 10; // neutral
  if (bwTrend14d != null) {
    // Ideal lean gain: +0.25 to +0.75 lb/week
    // Too fast (>1.5 lb/week = fat gain likely) or losing (< -0.5) = bad
    if (bwTrend14d >= 0.15 && bwTrend14d <= 1.0) bwTrendPts = 20;
    else if (bwTrend14d > 1.0) bwTrendPts = linearScore(bwTrend14d, 2.5, 1.0, 20);
    else bwTrendPts = linearScore(bwTrend14d, -1.0, 0.15, 20);
  }

  // ── 14d Waist trend (20 pts) ──
  const waistVals = waistRes.rows.map((r: any) => r.waist_in != null ? Number(r.waist_in) : null);
  const waistSlope = trendSlope(waistVals);
  let waistTrend14d: number | null = waistSlope != null ? waistSlope * 7 : null; // in/week
  let waistTrendPts = 10; // neutral
  if (waistTrend14d != null) {
    // Ideal: flat or dropping (≤ 0)
    // +0.1 in/week: ok; > +0.2 in/week: poor; < -0.1: excellent
    if (waistTrend14d <= 0) waistTrendPts = 20;
    else if (waistTrend14d <= 0.1) waistTrendPts = 16;
    else waistTrendPts = linearScore(waistTrend14d, 0.4, 0.1, 16);
  }

  // ── 14d FFM trend (20 pts) ──
  const ffmVals = ffmRes.rows.map((r: any) => r.fat_free_mass_lb != null ? Number(r.fat_free_mass_lb) : null);
  const ffmSlope = trendSlope(ffmVals);
  let ffmTrend14d: number | null = ffmSlope != null ? ffmSlope * 7 : null; // lb/week
  let ffmTrendPts = 10; // neutral
  if (ffmTrend14d != null) {
    // > +0.2 lb/week = excellent; 0 = ok; negative = concerning
    if (ffmTrend14d >= 0.2) ffmTrendPts = 20;
    else if (ffmTrend14d >= 0) ffmTrendPts = linearScore(ffmTrend14d, 0, 0.2, 20);
    else ffmTrendPts = linearScore(ffmTrend14d, -1.0, 0, 20);
  }

  const totalResource = caloriePts + adherencePts + bwTrendPts + waistTrendPts + ffmTrendPts;
  const hasData = avgCalories7d != null || bwVals.some(v => v != null);

  return {
    score: hasData ? totalResource : null,
    components: {
      avgCalories7d, caloriePts,
      adherence7d, adherencePts,
      bwTrend14d, bwTrendPts,
      waistTrend14d, waistTrendPts,
      ffmTrend14d, ffmTrendPts,
    },
  };
}

// ─── Layer C: Endocrine-Seasonal Score ───────────────────────────────────────

async function computeSeasonal(
  date: string,
  userId: string,
): Promise<{ score: number | null; components: SeasonalComponents }> {
  const [hrv28Res, hrv56Res, rhr28Res, rhr56Res, bwWaist28Res, ffm28Res, cardioRes] = await Promise.all([
    pool.query(
      `SELECT AVG(hrv_rmssd_ms)::numeric as hrv28
       FROM vitals_daily WHERE user_id=$1
         AND date BETWEEN ($2::date - interval '28 days') AND $2::date`,
      [userId, date],
    ),
    pool.query(
      `SELECT AVG(hrv_rmssd_ms)::numeric as hrv56
       FROM vitals_daily WHERE user_id=$1
         AND date BETWEEN ($2::date - interval '56 days') AND ($2::date - interval '29 days')`,
      [userId, date],
    ),
    pool.query(
      `SELECT AVG(resting_hr_bpm)::numeric as rhr28
       FROM vitals_daily WHERE user_id=$1
         AND date BETWEEN ($2::date - interval '28 days') AND $2::date`,
      [userId, date],
    ),
    pool.query(
      `SELECT AVG(resting_hr_bpm)::numeric as rhr56
       FROM vitals_daily WHERE user_id=$1
         AND date BETWEEN ($2::date - interval '56 days') AND ($2::date - interval '29 days')`,
      [userId, date],
    ),
    pool.query(
      `SELECT day::text, morning_weight_lb, waist_in FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date - interval '27 days') AND $2::date
         AND morning_weight_lb IS NOT NULL AND waist_in IS NOT NULL
       ORDER BY day`,
      [userId, date],
    ),
    pool.query(
      `SELECT day::text, fat_free_mass_lb FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date - interval '27 days') AND $2::date
         AND fat_free_mass_lb IS NOT NULL
       ORDER BY day`,
      [userId, date],
    ),
    pool.query(
      `SELECT SUM(zone2_min) as z2, SUM(zone3_min) as z3
       FROM daily_log WHERE user_id=$1
         AND day BETWEEN ($2::date - interval '13 days') AND $2::date`,
      [userId, date],
    ),
  ]);

  // ── 28d HRV trend (30 pts) ──
  const hrv28 = hrv28Res.rows[0]?.hrv28 != null ? Number(hrv28Res.rows[0].hrv28) : null;
  const hrv56 = hrv56Res.rows[0]?.hrv56 != null ? Number(hrv56Res.rows[0].hrv56) : null;
  let hrv28Trend: number | null = null;
  let hrv28Pts = 15; // neutral
  if (hrv28 != null && hrv56 != null && hrv56 > 0) {
    hrv28Trend = (hrv28 - hrv56) / hrv56; // pct change
    // +5% or more = great; 0% = neutral 15; -10% = 0 pts
    hrv28Pts = linearScore(hrv28Trend, -0.10, 0.05, 30);
  }

  // ── 28d RHR trend (20 pts) ──
  const rhr28 = rhr28Res.rows[0]?.rhr28 != null ? Number(rhr28Res.rows[0].rhr28) : null;
  const rhr56 = rhr56Res.rows[0]?.rhr56 != null ? Number(rhr56Res.rows[0].rhr56) : null;
  let rhr28Trend: number | null = null;
  let rhr28Pts = 10; // neutral
  if (rhr28 != null && rhr56 != null && rhr56 > 0) {
    rhr28Trend = (rhr56 - rhr28) / rhr56; // positive = RHR dropping = good
    rhr28Pts = linearScore(rhr28Trend, -0.05, 0.05, 20);
  }

  // ── 28d Waist:Weight trend (20 pts) ──
  const wwRows = bwWaist28Res.rows as any[];
  let waistWeightTrend: number | null = null;
  let waistWeightPts = 10; // neutral
  if (wwRows.length >= 4) {
    const wwRatios = wwRows.map(r => Number(r.waist_in) / Number(r.morning_weight_lb));
    const wwSlope = trendSlope(wwRatios);
    waistWeightTrend = wwSlope != null ? wwSlope * 28 : null;
    if (waistWeightTrend != null) {
      // Ratio dropping (fat loss / waist shrink relative to weight) = good
      if (waistWeightTrend <= 0) waistWeightPts = 20;
      else waistWeightPts = linearScore(waistWeightTrend, 0.02, 0, 20);
    }
  }

  // ── 28d FFM trend (20 pts) ──
  const ffmRows = ffm28Res.rows as any[];
  const ffmVals28 = ffmRows.map(r => r.fat_free_mass_lb != null ? Number(r.fat_free_mass_lb) : null);
  const ffmSlope28 = trendSlope(ffmVals28);
  const ffm28Trend = ffmSlope28 != null ? ffmSlope28 * 28 : null; // lb change over 28d
  let ffm28Pts = 10; // neutral
  if (ffm28Trend != null) {
    // +0.5 lb or more over 28d = 20 pts; flat = 10 pts; -1 lb = 0 pts
    if (ffm28Trend >= 0.5) ffm28Pts = 20;
    else if (ffm28Trend >= 0) ffm28Pts = linearScore(ffm28Trend, 0, 0.5, 20);
    else ffm28Pts = linearScore(ffm28Trend, -1.5, 0, 20);
  }

  // ── Cardio variety (10 pts) ──
  const z2 = Number(cardioRes.rows[0]?.z2 ?? 0);
  const z3 = Number(cardioRes.rows[0]?.z3 ?? 0);
  let cardioVarietyPts = 5; // neutral
  if (z2 + z3 > 30) {
    // Ideal: z3/(z2+z3) between 0.3 and 0.6
    const z3Ratio = z3 / (z2 + z3);
    if (z3Ratio >= 0.3 && z3Ratio <= 0.6) cardioVarietyPts = 10;
    else if (z3Ratio >= 0.15 && z3Ratio < 0.3) cardioVarietyPts = 7;
    else if (z3Ratio > 0.6) cardioVarietyPts = 6;
    else cardioVarietyPts = 3; // all zone 2 or no cardio data
  }

  const totalSeasonal = hrv28Pts + rhr28Pts + waistWeightPts + ffm28Pts + cardioVarietyPts;
  const hasData = hrv28 != null || rhr28 != null || ffmVals28.some(v => v != null);

  return {
    score: hasData ? totalSeasonal : null,
    components: {
      hrv28Trend, hrv28Pts,
      rhr28Trend, rhr28Pts,
      waistWeightTrend, waistWeightPts,
      ffm28Trend, ffm28Pts,
      cardioVarietyPts,
    },
  };
}

// ─── Prescription mapping ────────────────────────────────────────────────────

function prescriptionFromComposite(composite: number): DayPrescription {
  if (composite >= 85) return {
    dayType: "SURGE",
    cardioMode: "Zone 3",
    liftExpression: "Neural / Tension",
    macroProteinG: 175,
    macroCarbG: [380, 410],
    macroFatG: [35, 45],
    macroKcal: [2700, 2780],
  };
  if (composite >= 70) return {
    dayType: "BUILD",
    cardioMode: "Zone 3",
    liftExpression: "Hypertrophy",
    macroProteinG: 175,
    macroCarbG: [330, 350],
    macroFatG: [50, 60],
    macroKcal: [2650, 2720],
  };
  if (composite >= 55) return {
    dayType: "RESET",
    cardioMode: "Zone 2",
    liftExpression: "Pump / Metabolic",
    macroProteinG: 175,
    macroCarbG: [260, 290],
    macroFatG: [75, 85],
    macroKcal: [2650, 2720],
  };
  if (composite >= 40) return {
    dayType: "RESET",
    cardioMode: "Zone 2",
    liftExpression: "Recovery / Mobility",
    macroProteinG: 175,
    macroCarbG: [240, 265],
    macroFatG: [80, 90],
    macroKcal: [2600, 2680],
  };
  return {
    dayType: "RESENSITIZE",
    cardioMode: "Walk / Easy",
    liftExpression: "Recovery / Mobility",
    macroProteinG: 175,
    macroCarbG: [220, 250],
    macroFatG: [85, 95],
    macroKcal: [2550, 2650],
  };
}

function tierLabel(composite: number): string {
  if (composite >= 85) return "Peak Anabolic";
  if (composite >= 70) return "Strong Build";
  if (composite >= 55) return "Controlled Output";
  if (composite >= 40) return "Low-Stress Volume";
  return "Recovery / Resensitize";
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function computeOscillator(date: string, userId: string): Promise<OscillatorResult> {
  const [acuteResult, resourceResult, seasonalResult] = await Promise.all([
    computeAcute(date, userId),
    computeResource(date, userId),
    computeSeasonal(date, userId),
  ]);

  const acute = acuteResult.score;
  const resource = resourceResult.score;
  const seasonal = seasonalResult.score;

  // Fill nulls with neutral 50 for composite, but track data quality
  const acuteN = acute ?? 50;
  const resourceN = resource ?? 50;
  const seasonalN = seasonal ?? 50;

  const hasAny = acute != null || resource != null || seasonal != null;
  const composite = hasAny ? Math.round(0.50 * acuteN + 0.30 * resourceN + 0.20 * seasonalN) : null;

  const dataQuality: "full" | "partial" | "insufficient" =
    !hasAny ? "insufficient" :
    (acute != null && resource != null && seasonal != null) ? "full" : "partial";

  const prescription = composite != null ? prescriptionFromComposite(composite) : prescriptionFromComposite(50);

  return {
    date,
    composite,
    tier: composite != null ? tierLabel(composite) : null,
    acute,
    resource,
    seasonal,
    acuteComponents: acuteResult.components,
    resourceComponents: resourceResult.components,
    seasonalComponents: seasonalResult.components,
    prescription,
    dataQuality,
  };
}
