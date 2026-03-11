import pool from "./db.js";

// ═══════════════════════════════════════════════════════════════════════════════
// BulkCoach Androgen Oscillator — v1 System Spec Implementation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Three nested layers, each 0–100, combined:
//   composite = 0.50·Acute + 0.30·Resource + 0.20·Seasonal
//
// 28-day monthly cycle (Prime → Overload → Peak → Resensitize)
// Hard-stop fatigue rule stack
// Zone 2/3 auto-switch logic
// Daily explanation text
//
// ── Data fields wired from existing schema ─────────────────────────────────
//   HRV, RHR, sleep → vitals_daily + sleep_summary_daily
//   Weight, waist, FFM, pain_0_10, actual_bed_time → daily_log
//   Zone2/3 minutes, training_load, bench_weight, calories_in → daily_log
//   Androgen proxy → androgen_proxy_daily
//
// ── Future schema fields (NOT in log form yet; DB columns will be added) ──
//   libido_score, motivation_score, mood_stability_score, mental_drive_score
//   joint_friction_score, soreness_score (distinct from pain_0_10), stress_load_score
//   morning_erection_score (already tracked via erection engine separately)
//   protein_g_actual, carbs_g_actual, fat_g_actual
//   protein_g_target, carbs_g_target, fat_g_target
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Personal baseline constants (v1 defaults) ───────────────────────────────
const HRV_YEAR_AVG  = 36;    // ms — update via /api/oscillator/calibrate (future)
const RHR_YEAR_AVG  = 60;    // bpm
const PROTEIN_FLOOR = 170;   // g/day minimum
const FAT_FLOOR_AVG = 55;    // g/day average floor
const DEFAULT_KCAL  = 2695;  // maintenance target

// Cycle anchor: 28-day rhythm starts here (day 1 = Prime Week day 1)
const CYCLE_ANCHOR = "2026-02-17";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AcuteComponents {
  hrvRatio: number | null;      // today / 7d mean
  hrvYearRatio: number | null;  // today / year avg
  hrvPts: number;               // 0–22
  rhrDelta: number | null;      // today - 7d mean (neg = better)
  rhrPts: number;               // 0–18
  sleepMin: number | null;
  sleepPts: number;             // 0–15
  sleepMidpointShiftMin: number | null;
  regularityPts: number;        // 0–8
  bwDeltaPct: number | null;    // abs % deviation from 7d mean
  bwStabilityPts: number;       // 0–5
  subjectiveDrivePts: number;   // 0–10 (defaults neutral if fields missing)
  jointSorenessPts: number;     // 0–10 (uses pain_0_10 proxy if specific fields missing)
  yesterdayLiftPts: number;     // 0–7
  yesterdayCardioPts: number;   // 0–5
  // Source data availability flags
  hasHrv: boolean;
  hasRhr: boolean;
  hasSleep: boolean;
  hasSubjective: boolean; // true when spec fields present (future)
}

export interface ResourceComponents {
  caloriePts: number;           // 0–10
  proteinPts: number;           // 0–12
  fatFloorPts: number;          // 0–12
  carbTimingPts: number;        // 0–10 (partial — proxied from adherence)
  weightTrendPts: number;       // 0–10
  waistTrendPts: number;        // 0–12
  ffmTrendPts: number;          // 0–12
  strengthTrendPts: number;     // 0–12
  cardioMonotonyPts: number;    // 0–10
  // Raw values
  avgCalories7d: number | null;
  avgProtein7d: number | null;  // null until protein_g_actual tracked
  avgFat7d: number | null;      // null until fat_g_actual tracked
  bwTrend14dLbPerWk: number | null;
  waistTrend14dInOver14d: number | null;
  ffmTrend14dLbPerWk: number | null;
  strengthTrendPct: number | null;
  zone2Days7d: number;
  zone3Days7d: number;
  easyDays7d: number;
}

export interface SeasonalComponents {
  hrv28Pts: number;             // 0–18
  rhr28Pts: number;             // 0–14
  sleepReg28Pts: number;        // 0–10
  waistWeightRelPts: number;    // 0–12
  ffm28Pts: number;             // 0–14
  deloadPts: number;            // 0–10
  monotonyPts: number;          // 0–8
  lightPts: number;             // 0–6  (defaults 3 until outdoor tracking available)
  motivationPts: number;        // 0–8  (defaults neutral until subjective fields logged)
  // Raw values
  hrv28PctChange: number | null;
  rhr28DeltaBpm: number | null;
  waistChange28d: number | null;
  weightChange28d: number | null;
  ffm28dChange: number | null;
}

export interface DayPrescription {
  dayType: "SURGE" | "BUILD" | "RESET" | "RESENSITIZE";
  cardioMode: "Zone 3" | "Zone 2" | "Walk / Easy";
  liftExpression: "Neural / Tension" | "Hypertrophy / Build" | "Pump / Moderate" | "Recovery / Mobility" | "Off";
  macroProteinG: number;
  macroCarbG: [number, number];
  macroFatG: [number, number];
  macroKcalApprox: number;
  mealTiming: {
    preCardioC: number;
    postCardioP: number; postCardioC: number; postCardioF: number;
    meal2P: number; meal2C: number; meal2F: number;
    preLiftP: number; preLiftC: number;
    postLiftP: number; postLiftC: number;
    finalP: number; finalC: string; finalF: string;
  };
}

export interface OscillatorResult {
  date: string;
  cycleDay28: number;
  cycleWeek: "Prime" | "Overload" | "Peak" | "Resensitize";
  composite: number | null;
  ocs_class: "Peak" | "Strong Build" | "Controlled Build" | "Reset" | "Resensitize" | null;
  tier: string | null;
  acute: number | null;
  resource: number | null;
  seasonal: number | null;
  acuteComponents: AcuteComponents;
  resourceComponents: ResourceComponents;
  seasonalComponents: SeasonalComponents;
  prescription: DayPrescription;
  hardStopFatigue: boolean;
  hardStopReasons: string[];
  zone2Count7d: number;
  zone3Count7d: number;
  easyCount7d: number;
  explanationText: string;
  dataQuality: "full" | "partial" | "insufficient";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function trendSlope(vals: (number | null)[]): number | null {
  const pts = vals
    .map((v, i) => v != null ? { x: i, y: v } : null)
    .filter((p): p is { x: number; y: number } => p !== null);
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

function mean(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
}

function bedTimeToMin(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  let m = parts[0] * 60 + parts[1];
  if (m < 6 * 60) m += 24 * 60; // normalise past midnight
  return m;
}

// 28-day cycle computation
function computeCycleDay(dateStr: string): { day: number; week: "Prime" | "Overload" | "Peak" | "Resensitize" } {
  const anchor = new Date(CYCLE_ANCHOR + "T00:00:00Z");
  const target = new Date(dateStr + "T00:00:00Z");
  const diffDays = Math.round((target.getTime() - anchor.getTime()) / 86400000);
  const day = ((diffDays % 28) + 28) % 28 + 1; // 1–28
  const week = day <= 7 ? "Prime" : day <= 14 ? "Overload" : day <= 21 ? "Peak" : "Resensitize";
  return { day, week };
}

// ─── Acute Score ─────────────────────────────────────────────────────────────

async function computeAcute(date: string, userId: string): Promise<{ score: number; components: AcuteComponents }> {
  const prev = new Date(date + "T00:00:00Z");
  prev.setDate(prev.getDate() - 1);
  const yesterday = prev.toISOString().slice(0, 10);

  const [
    vitalsToday, vitals7d, sleepToday, sleep7d,
    logToday, log7d, logYesterday,
  ] = await Promise.all([
    pool.query(
      `SELECT hrv_rmssd_ms, resting_hr_bpm FROM vitals_daily
       WHERE user_id=$1 AND date=$2::date LIMIT 1`, [userId, date]),
    pool.query(
      `SELECT AVG(hrv_rmssd_ms)::numeric as hrv7, AVG(resting_hr_bpm)::numeric as rhr7
       FROM vitals_daily
       WHERE user_id=$1 AND date BETWEEN ($2::date-interval '7 days') AND ($2::date-interval '1 day')`,
      [userId, date]),
    pool.query(
      `SELECT total_sleep_minutes, sleep_midpoint_minutes FROM sleep_summary_daily
       WHERE user_id=$1 AND date=$2::date LIMIT 1`, [userId, date]),
    pool.query(
      `SELECT AVG(total_sleep_minutes)::numeric as sleep7,
              AVG(sleep_midpoint_minutes)::numeric as mid7
       FROM sleep_summary_daily
       WHERE user_id=$1 AND date BETWEEN ($2::date-interval '7 days') AND ($2::date-interval '1 day')`,
      [userId, date]),
    pool.query(
      `SELECT morning_weight_lb, actual_bed_time, pain_0_10,
              libido_score, motivation_score, mood_stability_score,
              mental_drive_score, joint_friction_score, soreness_score
       FROM daily_log WHERE user_id=$1 AND day=$2::date LIMIT 1`, [userId, date]),
    pool.query(
      `SELECT morning_weight_lb FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date-interval '7 days') AND ($2::date-interval '1 day')
         AND morning_weight_lb IS NOT NULL`, [userId, date]),
    pool.query(
      `SELECT training_load, zone2_min, zone3_min, lift_skipped, cardio_skipped
       FROM daily_log WHERE user_id=$1 AND day=$2::date LIMIT 1`, [userId, yesterday]),
  ]);

  const hrv = vitalsToday.rows[0]?.hrv_rmssd_ms != null ? Number(vitalsToday.rows[0].hrv_rmssd_ms) : null;
  const rhr = vitalsToday.rows[0]?.resting_hr_bpm != null ? Number(vitalsToday.rows[0].resting_hr_bpm) : null;
  const hrv7 = vitals7d.rows[0]?.hrv7 != null ? Number(vitals7d.rows[0].hrv7) : null;
  const rhr7 = vitals7d.rows[0]?.rhr7 != null ? Number(vitals7d.rows[0].rhr7) : null;

  const sleepMin = sleepToday.rows[0]?.total_sleep_minutes != null ? Number(sleepToday.rows[0].total_sleep_minutes) : null;
  const midpointToday = sleepToday.rows[0]?.sleep_midpoint_minutes != null ? Number(sleepToday.rows[0].sleep_midpoint_minutes) : null;
  const sleep7val = sleep7d.rows[0]?.sleep7 != null ? Number(sleep7d.rows[0].sleep7) : null;
  const mid7 = sleep7d.rows[0]?.mid7 != null ? Number(sleep7d.rows[0].mid7) : null;

  const bwToday = logToday.rows[0]?.morning_weight_lb != null ? Number(logToday.rows[0].morning_weight_lb) : null;
  const pain010 = logToday.rows[0]?.pain_0_10 != null ? Number(logToday.rows[0].pain_0_10) : null;
  const bedTimeToday = bedTimeToMin(logToday.rows[0]?.actual_bed_time ?? null);

  // Subjective spec fields (future — default neutral when null)
  const libidoRaw = logToday.rows[0]?.libido_score != null ? Number(logToday.rows[0].libido_score) : null;
  const motivRaw = logToday.rows[0]?.motivation_score != null ? Number(logToday.rows[0].motivation_score) : null;
  const moodRaw = logToday.rows[0]?.mood_stability_score != null ? Number(logToday.rows[0].mood_stability_score) : null;
  const driveRaw = logToday.rows[0]?.mental_drive_score != null ? Number(logToday.rows[0].mental_drive_score) : null;
  const jointRaw = logToday.rows[0]?.joint_friction_score != null ? Number(logToday.rows[0].joint_friction_score) : null;
  const sorenessRaw = logToday.rows[0]?.soreness_score != null ? Number(logToday.rows[0].soreness_score) : null;

  // Yesterday's strain
  const yestTrainingLoad = logYesterday.rows[0]?.training_load != null ? Number(logYesterday.rows[0].training_load) : null;
  const yestZ3 = logYesterday.rows[0]?.zone3_min != null ? Number(logYesterday.rows[0].zone3_min) : 0;
  const yestZ2 = logYesterday.rows[0]?.zone2_min != null ? Number(logYesterday.rows[0].zone2_min) : 0;
  const liftSkipped = logYesterday.rows[0]?.lift_skipped === true;
  const cardioSkipped = logYesterday.rows[0]?.cardio_skipped === true;

  // 7d BW mean
  const bw7d = (log7d.rows as any[]).map(r => Number(r.morning_weight_lb));
  const bw7mean = bw7d.length > 0 ? bw7d.reduce((s, n) => s + n, 0) / bw7d.length : null;

  // Bed-time 7d mean (from vitals/sleep data, fallback to logToday bed time)
  const bedTime7dMean = mid7; // use midpoint as regularity proxy

  // ── A. HRV score (0–22) ──
  let hrvRatio: number | null = null;
  let hrvYearRatio: number | null = null;
  let hrvPts = 11; // neutral default
  const hasHrv = hrv != null;
  if (hrv != null && hrv7 != null && hrv7 > 0) {
    hrvRatio = hrv / hrv7;
    hrvYearRatio = HRV_YEAR_AVG > 0 ? hrv / HRV_YEAR_AVG : null;
    if      (hrvRatio >= 1.10) hrvPts = 22;
    else if (hrvRatio >= 1.03) hrvPts = 19;
    else if (hrvRatio >= 0.97) hrvPts = 15;
    else if (hrvRatio >= 0.90) hrvPts = 9;
    else                        hrvPts = 4;
    // year ratio adjustment
    if (hrvYearRatio != null) {
      if (hrvYearRatio > 1.15) hrvPts = Math.min(22, hrvPts + 1);
      if (hrvYearRatio < 0.85) hrvPts = Math.max(0, hrvPts - 1);
    }
  }

  // ── B. RHR score (0–18) ──
  let rhrDelta: number | null = null;
  let rhrPts = 9; // neutral
  const hasRhr = rhr != null;
  if (rhr != null && rhr7 != null) {
    rhrDelta = rhr - rhr7; // positive = elevated (bad)
    if      (rhrDelta <= -3) rhrPts = 18;
    else if (rhrDelta <= -1) rhrPts = 16;
    else if (rhrDelta <= 1)  rhrPts = 13;
    else if (rhrDelta <= 3)  rhrPts = 8;
    else if (rhrDelta <= 5)  rhrPts = 4;
    else                      rhrPts = 1;
    // year adj
    if (rhr <= RHR_YEAR_AVG - 3) rhrPts = Math.min(18, rhrPts + 1);
    if (rhr >= RHR_YEAR_AVG + 5) rhrPts = Math.max(0, rhrPts - 1);
  }

  // ── C. Sleep quantity (0–15) ──
  let sleepPts = 7;
  const hasSleep = sleepMin != null;
  const effectiveSleep = sleepMin ?? sleep7val;
  if (effectiveSleep != null) {
    if      (effectiveSleep >= 450 && effectiveSleep <= 510) sleepPts = 15;
    else if (effectiveSleep >= 420 || effectiveSleep <= 540) sleepPts = 12;
    else if (effectiveSleep >= 390) sleepPts = 8;
    else if (effectiveSleep >= 360) sleepPts = 4;
    else                             sleepPts = 1;
  }

  // ── D. Sleep regularity via midpoint shift (0–8) ──
  let sleepMidpointShiftMin: number | null = null;
  let regularityPts = 4;
  if (midpointToday != null && mid7 != null) {
    sleepMidpointShiftMin = Math.abs(midpointToday - mid7);
    if      (sleepMidpointShiftMin <= 20) regularityPts = 8;
    else if (sleepMidpointShiftMin <= 40) regularityPts = 6;
    else if (sleepMidpointShiftMin <= 60) regularityPts = 4;
    else if (sleepMidpointShiftMin <= 90) regularityPts = 2;
    else                                   regularityPts = 0;
  } else if (bedTimeToday != null && bedTime7dMean != null) {
    // fallback: use bedtime deviation from mid7 proxy
    sleepMidpointShiftMin = Math.abs(bedTimeToday - bedTime7dMean);
    if (sleepMidpointShiftMin <= 20) regularityPts = 8;
    else if (sleepMidpointShiftMin <= 45) regularityPts = 5;
    else regularityPts = 2;
  }

  // ── E. Bodyweight stability (0–5) ──
  let bwDeltaPct: number | null = null;
  let bwStabilityPts = 3;
  if (bwToday != null && bw7mean != null && bw7mean > 0) {
    bwDeltaPct = Math.abs((bwToday - bw7mean) / bw7mean) * 100;
    if      (bwDeltaPct <= 0.4)  bwStabilityPts = 5;
    else if (bwDeltaPct <= 0.8)  bwStabilityPts = 4;
    else if (bwDeltaPct <= 1.2)  bwStabilityPts = 2;
    else                          bwStabilityPts = 0;
  }

  // ── F. Subjective drive/libido (0–10) ──
  // Spec: avg of libido(1-5→0-10), erection(0-3→0-10), motivation(1-5→0-10), drive(1-5→0-10)
  const hasSubjective = libidoRaw != null || motivRaw != null || driveRaw != null;
  let subjectiveDrivePts = 5; // neutral default (spec says 10 possible, mid = 5)
  if (hasSubjective) {
    const components: number[] = [];
    if (libidoRaw != null) components.push((libidoRaw - 1) / 4 * 10);
    if (motivRaw != null)  components.push((motivRaw - 1) / 4 * 10);
    if (driveRaw != null)  components.push((driveRaw - 1) / 4 * 10);
    if (moodRaw != null)   components.push((moodRaw - 1) / 4 * 10);
    if (components.length > 0) {
      subjectiveDrivePts = Math.round(clamp(components.reduce((s, n) => s + n, 0) / components.length, 0, 10));
    }
  }

  // ── G. Joint/soreness (0–10) ──
  // Spec: reverse-coded soreness_score + joint_friction_score
  let jointSorenessPts = 5; // neutral
  if (jointRaw != null || sorenessRaw != null || pain010 != null) {
    if (jointRaw != null && sorenessRaw != null) {
      // Both present: spec fields
      const jScore = (5 - jointRaw) / 4 * 10;   // 1=10pts, 5=0pts
      const sScore = (5 - sorenessRaw) / 4 * 10;
      jointSorenessPts = Math.round(clamp((jScore + sScore) / 2, 0, 10));
    } else if (pain010 != null) {
      // Fallback: pain_0_10 inverted
      jointSorenessPts = Math.round(clamp((1 - pain010 / 10) * 10, 0, 10));
    }
  }

  // ── H. Yesterday lift strain (0–7) ──
  let yesterdayLiftPts = 4; // neutral
  if (liftSkipped) {
    yesterdayLiftPts = 7;
  } else if (yestTrainingLoad != null) {
    if      (yestTrainingLoad <= 35) yesterdayLiftPts = 7;
    else if (yestTrainingLoad <= 55) yesterdayLiftPts = 5;
    else if (yestTrainingLoad <= 70) yesterdayLiftPts = 3;
    else                              yesterdayLiftPts = 1;
  }

  // ── I. Yesterday cardio strain (0–5) ──
  let yesterdayCardioPts = 4; // default zone 2
  if (cardioSkipped || (yestZ2 === 0 && yestZ3 === 0)) {
    yesterdayCardioPts = 5; // recovery / easy
  } else if (yestZ3 > 40) {
    yesterdayCardioPts = 2; // zone 3 full
  } else if (yestZ3 > 0) {
    yesterdayCardioPts = 3; // zone 3 short
  } else if (yestZ2 > 0) {
    yesterdayCardioPts = 4; // zone 2
  }

  const totalAcute = clamp(
    hrvPts + rhrPts + sleepPts + regularityPts + bwStabilityPts +
    subjectiveDrivePts + jointSorenessPts + yesterdayLiftPts + yesterdayCardioPts,
    0, 100,
  );

  return {
    score: totalAcute,
    components: {
      hrvRatio, hrvYearRatio, hrvPts,
      rhrDelta, rhrPts,
      sleepMin, sleepPts,
      sleepMidpointShiftMin, regularityPts,
      bwDeltaPct, bwStabilityPts,
      subjectiveDrivePts,
      jointSorenessPts,
      yesterdayLiftPts,
      yesterdayCardioPts,
      hasHrv, hasRhr, hasSleep, hasSubjective,
    },
  };
}

// ─── Resource Score ───────────────────────────────────────────────────────────

async function computeResource(date: string, userId: string): Promise<{ score: number; components: ResourceComponents }> {
  const [calRows, bwRows, waistRows, ffmRows, strengthRows, cardioRows] = await Promise.all([
    pool.query(
      `SELECT calories_in, adherence, protein_g_actual, carbs_g_actual, fat_g_actual,
              protein_g_target, carbs_g_target, fat_g_target, kcal_target
       FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date-interval '6 days') AND $2::date
       ORDER BY day`, [userId, date]),
    pool.query(
      `SELECT morning_weight_lb FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date-interval '13 days') AND $2::date
         AND morning_weight_lb IS NOT NULL ORDER BY day`, [userId, date]),
    pool.query(
      `SELECT waist_in FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date-interval '13 days') AND $2::date
         AND waist_in IS NOT NULL ORDER BY day`, [userId, date]),
    pool.query(
      `SELECT fat_free_mass_lb FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date-interval '13 days') AND $2::date
         AND fat_free_mass_lb IS NOT NULL ORDER BY day`, [userId, date]),
    pool.query(
      `SELECT bench_weight_lb, ohp_weight_lb, day::text FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date-interval '27 days') AND $2::date
         AND (bench_weight_lb IS NOT NULL OR ohp_weight_lb IS NOT NULL)
       ORDER BY day`, [userId, date]),
    pool.query(
      `SELECT zone2_min, zone3_min, cardio_skipped FROM daily_log
       WHERE user_id=$1 AND day BETWEEN ($2::date-interval '6 days') AND $2::date
       ORDER BY day`, [userId, date]),
  ]);

  // ── A. Calorie adherence (0–10) ──
  const calNums = (calRows.rows as any[]).filter(r => r.calories_in != null).map(r => Number(r.calories_in));
  const avgCalories7d = calNums.length > 0 ? calNums.reduce((s, n) => s + n, 0) / calNums.length : null;
  let caloriePts = 5;
  if (avgCalories7d != null) {
    const ratio = avgCalories7d / DEFAULT_KCAL;
    if      (ratio >= 0.97 && ratio <= 1.03) caloriePts = 10;
    else if (ratio >= 0.94 || ratio <= 1.06) caloriePts = 8;
    else if (ratio >= 0.90 || ratio <= 1.10) caloriePts = 5;
    else                                       caloriePts = 2;
  }

  // ── B. Protein adequacy (0–12) ──
  const protNums = (calRows.rows as any[]).filter(r => r.protein_g_actual != null).map(r => Number(r.protein_g_actual));
  const avgProtein7d = protNums.length > 0 ? protNums.reduce((s, n) => s + n, 0) / protNums.length : null;
  let proteinPts = 6; // neutral
  if (avgProtein7d != null) {
    if      (avgProtein7d >= 170 && avgProtein7d <= 180) proteinPts = 12;
    else if (avgProtein7d >= 160 || avgProtein7d <= 190) proteinPts = 9;
    else if (avgProtein7d >= 145) proteinPts = 5;
    else                           proteinPts = 1;
  }

  // ── C. Fat floor adherence (0–12) ──
  const fatNums = (calRows.rows as any[]).filter(r => r.fat_g_actual != null).map(r => Number(r.fat_g_actual));
  const avgFat7d = fatNums.length > 0 ? fatNums.reduce((s, n) => s + n, 0) / fatNums.length : null;
  let fatFloorPts = 6; // neutral
  if (avgFat7d != null) {
    const highFatDays = fatNums.filter(f => f >= 75).length;
    const lowFatDays  = fatNums.filter(f => f <= 50).length;
    const oscillation = highFatDays >= 2 && lowFatDays >= 2;
    if      (avgFat7d >= FAT_FLOOR_AVG && oscillation) fatFloorPts = 12;
    else if (avgFat7d >= FAT_FLOOR_AVG)                 fatFloorPts = 9;
    else if (avgFat7d >= 50)                             fatFloorPts = 6;
    else                                                  fatFloorPts = 2;
  }

  // ── D. Carb timing (0–10) — proxied from dietary adherence until per-meal tracking ──
  const adhNums = (calRows.rows as any[]).filter(r => r.adherence != null).map(r => Number(r.adherence));
  const avgAdherence7d = adhNums.length > 0 ? adhNums.reduce((s, n) => s + n, 0) / adhNums.length : null;
  let carbTimingPts = 5;
  if (avgAdherence7d != null) {
    if      (avgAdherence7d >= 0.90) carbTimingPts = 10;
    else if (avgAdherence7d >= 0.80) carbTimingPts = 8;
    else if (avgAdherence7d >= 0.65) carbTimingPts = 5;
    else                              carbTimingPts = 2;
  }

  // ── E. Weight trend (0–10) ──
  const bwVals = (bwRows.rows as any[]).map(r => Number(r.morning_weight_lb));
  const bwSlope = trendSlope(bwVals);
  const bwTrend14dLbPerWk = bwSlope != null ? bwSlope * 7 : null;
  let weightTrendPts = 5;
  if (bwTrend14dLbPerWk != null) {
    if      (bwTrend14dLbPerWk >= 0.10 && bwTrend14dLbPerWk <= 0.50) weightTrendPts = 10;
    else if (bwTrend14dLbPerWk >= 0    && bwTrend14dLbPerWk <= 0.09) weightTrendPts = 8;
    else if (bwTrend14dLbPerWk <= 0.80) weightTrendPts = 6; // 0.51–0.80
    else if (bwTrend14dLbPerWk < -0.10) weightTrendPts = 4; // negative
    else                                  weightTrendPts = 3; // >0.80
  }

  // ── F. Waist trend (0–12) ──
  const waistVals = (waistRows.rows as any[]).map(r => Number(r.waist_in));
  const waistSlope = trendSlope(waistVals);
  const waistTrend14dInOver14d = waistSlope != null ? waistSlope * 14 : null;
  let waistTrendPts = 6;
  if (waistTrend14dInOver14d != null) {
    if      (waistTrend14dInOver14d <= 0.10)  waistTrendPts = 12;
    else if (waistTrend14dInOver14d <= 0.25)  waistTrendPts = 9;
    else if (waistTrend14dInOver14d <= 0.40)  waistTrendPts = 6;
    else                                        waistTrendPts = 2;
  } else if (waistVals.length > 0) {
    // Stale waist data — cap at 8
    waistTrendPts = Math.min(8, waistTrendPts);
  }

  // ── G. FFM trend (0–12) ──
  const ffmVals = (ffmRows.rows as any[]).map(r => Number(r.fat_free_mass_lb));
  const ffmSlope = trendSlope(ffmVals);
  const ffmTrend14dLbPerWk = ffmSlope != null ? ffmSlope * 7 : null;
  let ffmTrendPts = 6;
  if (ffmTrend14dLbPerWk != null) {
    if      (ffmTrend14dLbPerWk >= 0.20)                ffmTrendPts = 12;
    else if (ffmTrend14dLbPerWk >= 0.05)                ffmTrendPts = 9;
    else if (ffmTrend14dLbPerWk >= 0)                   ffmTrendPts = 7;
    else if (ffmTrend14dLbPerWk >= -0.20)               ffmTrendPts = 3;
    else                                                  ffmTrendPts = 1;
  }

  // ── H. Strength trend (0–12) ──
  // Use bench + OHP composite index averaged over 14d windows
  let strengthTrendPct: number | null = null;
  let strengthTrendPts = 6;
  if (strengthRows.rows.length >= 4) {
    const half = Math.floor(strengthRows.rows.length / 2);
    const recent = (strengthRows.rows as any[]).slice(half).map(r =>
      [r.bench_weight_lb, r.ohp_weight_lb].filter(v => v != null).map(Number)
    ).flat();
    const older = (strengthRows.rows as any[]).slice(0, half).map(r =>
      [r.bench_weight_lb, r.ohp_weight_lb].filter(v => v != null).map(Number)
    ).flat();
    const recentAvg = recent.length > 0 ? recent.reduce((s, n) => s + n, 0) / recent.length : null;
    const olderAvg  = older.length > 0  ? older.reduce((s, n) => s + n, 0)  / older.length  : null;
    if (recentAvg != null && olderAvg != null && olderAvg > 0) {
      strengthTrendPct = (recentAvg - olderAvg) / olderAvg;
      if      (strengthTrendPct > 0.02)  strengthTrendPts = 12;
      else if (strengthTrendPct >= 0)    strengthTrendPts = 9;
      else if (strengthTrendPct >= -0.02) strengthTrendPts = 6;
      else                                strengthTrendPts = 2;
    }
  }

  // ── I. Cardio monotony (0–10) ──
  const z2Days = (cardioRows.rows as any[]).filter(r => (Number(r.zone2_min) > 5) && (Number(r.zone3_min) < 5)).length;
  const z3Days = (cardioRows.rows as any[]).filter(r => Number(r.zone3_min) > 5).length;
  const easyDays = (cardioRows.rows as any[]).filter(r =>
    (Number(r.zone2_min) <= 5) && (Number(r.zone3_min) <= 5) && !r.cardio_skipped
  ).length;
  const totalCardio = z2Days + z3Days + easyDays;
  let cardioMonotonyPts = 5;
  if (totalCardio > 0) {
    // Ideal: 3/3/1 or close
    const z3Ratio = z3Days / 7;
    const z2Ratio = z2Days / 7;
    if (Math.abs(z3Days - 3) <= 1 && Math.abs(z2Days - 3) <= 1) cardioMonotonyPts = 10;
    else if (z3Days >= 5 || z2Days >= 5) cardioMonotonyPts = 4; // monotonous
    else if (totalCardio === 7 && z3Days === 7) cardioMonotonyPts = 1;
    else cardioMonotonyPts = 7;
  }

  const totalResource = clamp(
    caloriePts + proteinPts + fatFloorPts + carbTimingPts +
    weightTrendPts + waistTrendPts + ffmTrendPts + strengthTrendPts + cardioMonotonyPts,
    0, 100,
  );

  return {
    score: totalResource,
    components: {
      caloriePts, proteinPts, fatFloorPts, carbTimingPts,
      weightTrendPts, waistTrendPts, ffmTrendPts, strengthTrendPts, cardioMonotonyPts,
      avgCalories7d, avgProtein7d, avgFat7d,
      bwTrend14dLbPerWk, waistTrend14dInOver14d, ffmTrend14dLbPerWk,
      strengthTrendPct,
      zone2Days7d: z2Days, zone3Days7d: z3Days, easyDays7d: easyDays,
    },
  };
}

// ─── Seasonal Score ───────────────────────────────────────────────────────────

async function computeSeasonal(date: string, userId: string): Promise<{ score: number; components: SeasonalComponents }> {
  const [hrv28, hrv56, rhr28, rhr56, bwWaist28, bwWaist56, ffm28, ffm56, liftPatterns, cardio28] = await Promise.all([
    pool.query(`SELECT AVG(hrv_rmssd_ms)::numeric as v FROM vitals_daily
                WHERE user_id=$1 AND date BETWEEN ($2::date-interval '28 days') AND $2::date`,
      [userId, date]),
    pool.query(`SELECT AVG(hrv_rmssd_ms)::numeric as v FROM vitals_daily
                WHERE user_id=$1 AND date BETWEEN ($2::date-interval '56 days') AND ($2::date-interval '29 days')`,
      [userId, date]),
    pool.query(`SELECT AVG(resting_hr_bpm)::numeric as v FROM vitals_daily
                WHERE user_id=$1 AND date BETWEEN ($2::date-interval '28 days') AND $2::date`,
      [userId, date]),
    pool.query(`SELECT AVG(resting_hr_bpm)::numeric as v FROM vitals_daily
                WHERE user_id=$1 AND date BETWEEN ($2::date-interval '56 days') AND ($2::date-interval '29 days')`,
      [userId, date]),
    pool.query(`SELECT AVG(morning_weight_lb)::numeric as bw, AVG(waist_in)::numeric as waist
                FROM daily_log WHERE user_id=$1
                  AND day BETWEEN ($2::date-interval '28 days') AND $2::date`, [userId, date]),
    pool.query(`SELECT AVG(morning_weight_lb)::numeric as bw, AVG(waist_in)::numeric as waist
                FROM daily_log WHERE user_id=$1
                  AND day BETWEEN ($2::date-interval '56 days') AND ($2::date-interval '29 days')`, [userId, date]),
    pool.query(`SELECT fat_free_mass_lb FROM daily_log
                WHERE user_id=$1 AND day BETWEEN ($2::date-interval '28 days') AND $2::date
                  AND fat_free_mass_lb IS NOT NULL ORDER BY day`, [userId, date]),
    pool.query(`SELECT fat_free_mass_lb FROM daily_log
                WHERE user_id=$1 AND day BETWEEN ($2::date-interval '56 days') AND ($2::date-interval '29 days')
                  AND fat_free_mass_lb IS NOT NULL ORDER BY day`, [userId, date]),
    pool.query(`SELECT lift_skipped, zone3_min, zone2_min FROM daily_log
                WHERE user_id=$1 AND day BETWEEN ($2::date-interval '27 days') AND $2::date`, [userId, date]),
    pool.query(`SELECT zone2_min, zone3_min FROM daily_log
                WHERE user_id=$1 AND day BETWEEN ($2::date-interval '27 days') AND $2::date
                  AND (zone2_min > 0 OR zone3_min > 0)`, [userId, date]),
  ]);

  // ── A. HRV 28d trend (0–18) ──
  const hrv28val = hrv28.rows[0]?.v != null ? Number(hrv28.rows[0].v) : null;
  const hrv56val = hrv56.rows[0]?.v != null ? Number(hrv56.rows[0].v) : null;
  let hrv28PctChange: number | null = null;
  let hrv28Pts = 9;
  if (hrv28val != null && hrv56val != null && hrv56val > 0) {
    hrv28PctChange = (hrv28val - hrv56val) / hrv56val;
    if      (hrv28PctChange > 0.08)  hrv28Pts = 18;
    else if (hrv28PctChange >= 0.03) hrv28Pts = 15;
    else if (hrv28PctChange >= -0.02) hrv28Pts = 11;
    else if (hrv28PctChange >= -0.07) hrv28Pts = 6;
    else                               hrv28Pts = 2;
  }

  // ── B. RHR 28d trend (0–14) ──
  const rhr28val = rhr28.rows[0]?.v != null ? Number(rhr28.rows[0].v) : null;
  const rhr56val = rhr56.rows[0]?.v != null ? Number(rhr56.rows[0].v) : null;
  let rhr28DeltaBpm: number | null = null;
  let rhr28Pts = 7;
  if (rhr28val != null && rhr56val != null) {
    rhr28DeltaBpm = rhr28val - rhr56val; // neg = improving
    if      (rhr28DeltaBpm <= -3) rhr28Pts = 14;
    else if (rhr28DeltaBpm <= -1) rhr28Pts = 11;
    else if (rhr28DeltaBpm <= 0)  rhr28Pts = 8;
    else if (rhr28DeltaBpm <= 2)  rhr28Pts = 4;
    else                           rhr28Pts = 1;
  }

  // ── C. Sleep regularity 28d trend (0–10) ──
  // Approximate: compare 28d mean midpoint deviation vs older; default neutral if no data
  const sleepReg28Pts = 6; // TODO: wire to midpoint deviation trend when historical data accumulates

  // ── D. Waist:weight relationship (0–12) ──
  const bw28 = bwWaist28.rows[0]?.bw != null ? Number(bwWaist28.rows[0].bw) : null;
  const waist28 = bwWaist28.rows[0]?.waist != null ? Number(bwWaist28.rows[0].waist) : null;
  const bw56val = bwWaist56.rows[0]?.bw != null ? Number(bwWaist56.rows[0].bw) : null;
  const waist56val = bwWaist56.rows[0]?.waist != null ? Number(bwWaist56.rows[0].waist) : null;
  let waistChange28d: number | null = null;
  let weightChange28d: number | null = null;
  let waistWeightRelPts = 6;
  if (bw28 != null && bw56val != null && waist28 != null && waist56val != null) {
    weightChange28d = bw28 - bw56val;
    waistChange28d = waist28 - waist56val;
    const waistPerLb = Math.abs(weightChange28d) > 0.5 ? waistChange28d / weightChange28d : null;
    if (weightChange28d > 0 && waistChange28d <= 0)        waistWeightRelPts = 12; // gaining weight, waist stable/down
    else if (waistPerLb != null && waistPerLb <= 0.1)      waistWeightRelPts = 9;  // slight waist with BW gain
    else if (waistChange28d > 0.25)                         waistWeightRelPts = 2;  // waist rising without productive BW
    else                                                      waistWeightRelPts = 5;
  }

  // ── E. FFM 28d trend (0–14) ──
  const ffm28vals = (ffm28.rows as any[]).map(r => Number(r.fat_free_mass_lb));
  const ffm56vals = (ffm56.rows as any[]).map(r => Number(r.fat_free_mass_lb));
  const ffm28mean = ffm28vals.length > 0 ? ffm28vals.reduce((s, n) => s + n, 0) / ffm28vals.length : null;
  const ffm56mean = ffm56vals.length > 0 ? ffm56vals.reduce((s, n) => s + n, 0) / ffm56vals.length : null;
  let ffm28dChange: number | null = null;
  let ffm28Pts = 7;
  if (ffm28mean != null && ffm56mean != null) {
    ffm28dChange = ffm28mean - ffm56mean;
    if      (ffm28dChange > 0.5)  ffm28Pts = 14;
    else if (ffm28dChange > 0.1)  ffm28Pts = 11;
    else if (ffm28dChange >= 0)   ffm28Pts = 8;
    else                           ffm28Pts = 3;
  }

  // ── F. Deload compliance (0–10) ──
  // Detect: any rolling 7-day window in last 28d where lift_skipped >= 3 days
  const liftRows = liftPatterns.rows as any[];
  let deloadPts = 1; // default: no deload
  if (liftRows.length >= 7) {
    for (let i = 0; i <= liftRows.length - 7; i++) {
      const window = liftRows.slice(i, i + 7);
      const skipped = window.filter(r => r.lift_skipped === true).length;
      const z3low = window.filter(r => Number(r.zone3_min ?? 0) < 10).length;
      if (skipped >= 3) { deloadPts = 10; break; }
      if (skipped >= 2 && z3low >= 5) { deloadPts = 6; break; }
      if (skipped >= 1 && z3low >= 4) { deloadPts = Math.max(deloadPts, 3); }
    }
  }

  // ── G. Training monotony index (0–8) ──
  const z2D28 = (cardio28.rows as any[]).filter(r => Number(r.zone2_min) > 5 && Number(r.zone3_min) < 5).length;
  const z3D28 = (cardio28.rows as any[]).filter(r => Number(r.zone3_min) > 5).length;
  const total28 = z2D28 + z3D28;
  let monotonyPts = 4;
  if (total28 > 7) {
    const z3Frac = z3D28 / total28;
    if (z3Frac >= 0.3 && z3Frac <= 0.6) monotonyPts = 8;    // healthy variation
    else if (z3Frac >= 0.15) monotonyPts = 5;                 // moderate variation
    else monotonyPts = 1;                                       // flat/monotonous
  }

  // ── H. Light/outdoor (0–6) — default until outdoor tracking wired ──
  const lightPts = 3; // neutral; future: sunlight_min from daily_log

  // ── I. Motivation/virility trend (0–8) — future subjective fields ──
  const motivationPts = 4; // neutral until libido/motivation trend tracked

  const totalSeasonal = clamp(
    hrv28Pts + rhr28Pts + sleepReg28Pts + waistWeightRelPts + ffm28Pts +
    deloadPts + monotonyPts + lightPts + motivationPts,
    0, 100,
  );

  return {
    score: totalSeasonal,
    components: {
      hrv28Pts, rhr28Pts, sleepReg28Pts, waistWeightRelPts, ffm28Pts,
      deloadPts, monotonyPts, lightPts, motivationPts,
      hrv28PctChange, rhr28DeltaBpm,
      waistChange28d, weightChange28d, ffm28dChange,
    },
  };
}

// ─── Hard-stop fatigue rule stack ────────────────────────────────────────────

function evaluateHardStop(
  acute: AcuteComponents,
  composite: number,
  hrv7: number | null,
  hrv: number | null,
  rhr7: number | null,
  rhr: number | null,
  sleepMin: number | null,
): { flag: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (hrv != null && hrv7 != null && hrv7 > 0 && hrv / hrv7 < 0.90) {
    reasons.push("HRV < 90% of 7d average");
  }
  if (rhr != null && rhr7 != null && rhr - rhr7 > 4) {
    reasons.push(`RHR ${Math.round(rhr - rhr7)}+ bpm above 7d avg`);
  }
  if (sleepMin != null && sleepMin < 360) {
    reasons.push(`Sleep only ${Math.round(sleepMin / 60 * 10) / 10}h (< 6h)`);
  }
  if (acute.jointSorenessPts <= 2) {
    reasons.push("High joint/soreness load");
  }
  if (composite < 55) {
    reasons.push("OCS < 55");
  }

  return { flag: reasons.length >= 1 && composite < 55, reasons };
}

// ─── Zone 2/3 auto-switch rule stack ─────────────────────────────────────────

function selectCardioMode(
  composite: number,
  hardStop: boolean,
  zone3Count7d: number,
  zone2Count7d: number,
  hrv7: number | null,
  hrv: number | null,
  rhr7: number | null,
  rhr: number | null,
  cycleDay: number,
): "Zone 3" | "Zone 2" | "Walk / Easy" {
  // Hard stop: recovery
  if (hardStop) return composite < 40 ? "Walk / Easy" : "Zone 2";

  // Rule 1: fatigue overrides by signal
  const hrvSuppressed = hrv != null && hrv7 != null && hrv7 > 0 && hrv / hrv7 < 0.90;
  const rhrElevated = rhr != null && rhr7 != null && rhr - rhr7 > 4;
  if (hrvSuppressed || rhrElevated) return "Zone 2";

  // Rule 5: resensitize week (days 22–28) — cap Zone 3 to max 1
  const inResensitizeWeek = cycleDay >= 22;
  if (inResensitizeWeek && zone3Count7d >= 1) return "Zone 2";

  // Rule 2: protect weekly balance — 3 Zone 3 already done
  if (zone3Count7d >= 3 && composite < 90) return "Zone 2";

  // Rule 3: prevent monotony — last cardio sessions same zone (handled by zone count check)

  // Rule 4 + OCS-based
  if (composite >= 85 && zone3Count7d < 3) return "Zone 3";
  if (composite >= 70) return zone3Count7d < 3 ? "Zone 3" : "Zone 2";
  if (composite >= 55) return "Zone 2";
  if (composite >= 40) return "Zone 2";
  return "Walk / Easy";
}

// ─── Prescription mapping ─────────────────────────────────────────────────────

const MEAL_TEMPLATES: Record<string, DayPrescription["mealTiming"]> = {
  SURGE: {
    preCardioC: 30,
    postCardioP: 40, postCardioC: 90,  postCardioF: 10,
    meal2P: 30,      meal2C: 60,        meal2F: 10,
    preLiftP: 25,    preLiftC: 80,
    postLiftP: 45,   postLiftC: 110,
    finalP: 35,      finalC: "20",      finalF: "10",
  },
  BUILD: {
    preCardioC: 30,
    postCardioP: 40, postCardioC: 75,  postCardioF: 10,
    meal2P: 30,      meal2C: 55,        meal2F: 10,
    preLiftP: 25,    preLiftC: 65,
    postLiftP: 45,   postLiftC: 85,
    finalP: 35,      finalC: "rem",     finalF: "rem",
  },
  RESET: {
    preCardioC: 22,
    postCardioP: 40, postCardioC: 60,  postCardioF: 15,
    meal2P: 30,      meal2C: 45,        meal2F: 15,
    preLiftP: 25,    preLiftC: 45,
    postLiftP: 45,   postLiftC: 55,
    finalP: 35,      finalC: "30–40",  finalF: "30+",
  },
  RESENSITIZE: {
    preCardioC: 0,
    postCardioP: 40, postCardioC: 45,  postCardioF: 15,
    meal2P: 30,      meal2C: 35,        meal2F: 20,
    preLiftP: 20,    preLiftC: 30,
    postLiftP: 40,   postLiftC: 40,
    finalP: 45,      finalC: "20–25",  finalF: "40+",
  },
};

function buildPrescription(
  composite: number,
  hardStop: boolean,
  cardioMode: "Zone 3" | "Zone 2" | "Walk / Easy",
  acuteSoreness: number,
  acuteRhr: number,
): DayPrescription {
  let dayType: DayPrescription["dayType"];
  let liftExpression: DayPrescription["liftExpression"];

  if (hardStop || composite < 40) {
    dayType = "RESENSITIZE";
    liftExpression = "Off";
  } else if (composite < 55) {
    dayType = "RESET";
    liftExpression = "Recovery / Mobility";
  } else if (composite < 70) {
    dayType = acuteRhr > 2 || acuteSoreness <= 3 ? "RESET" : "BUILD";
    liftExpression = "Pump / Moderate";
  } else if (composite < 85) {
    dayType = "BUILD";
    liftExpression = "Hypertrophy / Build";
  } else {
    dayType = "SURGE";
    liftExpression = "Neural / Tension";
  }

  const templates: Record<DayPrescription["dayType"], Omit<DayPrescription, "dayType" | "cardioMode" | "liftExpression" | "mealTiming">> = {
    SURGE:        { macroProteinG: 175, macroCarbG: [385, 395], macroFatG: [38, 42], macroKcalApprox: 2700 },
    BUILD:        { macroProteinG: 175, macroCarbG: [340, 355], macroFatG: [53, 57], macroKcalApprox: 2640 },
    RESET:        { macroProteinG: 175, macroCarbG: [285, 295], macroFatG: [78, 82], macroKcalApprox: 2640 },
    RESENSITIZE:  { macroProteinG: 175, macroCarbG: [245, 255], macroFatG: [88, 92], macroKcalApprox: 2580 },
  };

  return {
    dayType,
    cardioMode,
    liftExpression,
    ...templates[dayType],
    mealTiming: MEAL_TEMPLATES[dayType],
  };
}

// ─── Explanation text ─────────────────────────────────────────────────────────

function buildExplanation(
  composite: number,
  acute: AcuteComponents,
  resource: ResourceComponents,
  seasonal: SeasonalComponents,
  prescription: DayPrescription,
  hardStop: boolean,
  hardStopReasons: string[],
  cycleDay: number,
  cycleWeek: string,
): string {
  const parts: string[] = [];

  if (hardStop) {
    parts.push(`⚠️ Hard stop: ${hardStopReasons[0]}.`);
  }

  if (acute.hasHrv && acute.hrvRatio != null) {
    parts.push(acute.hrvRatio >= 1.05 ? "HRV above trend" : acute.hrvRatio < 0.90 ? "HRV suppressed" : "HRV near baseline");
  }
  if (acute.hasRhr && acute.rhrDelta != null) {
    parts.push(acute.rhrDelta <= -1 ? "RHR below baseline" : acute.rhrDelta >= 3 ? "RHR elevated" : "RHR stable");
  }
  if (acute.hasSleep) {
    const h = acute.sleepMin != null ? Math.round(acute.sleepMin / 60 * 10) / 10 : null;
    parts.push(h != null ? (h >= 7.5 ? `Sleep adequate (${h}h)` : h >= 6.5 ? `Sleep short (${h}h)` : `Sleep insufficient (${h}h)`) : "sleep data unavailable");
  }

  if (resource.zone3Days7d + resource.zone2Days7d > 0) {
    parts.push(`Z2/Z3 this week: ${resource.zone2Days7d}/${resource.zone3Days7d}`);
  }

  parts.push(`Cycle day ${cycleDay} (${cycleWeek})`);
  parts.push(`→ ${prescription.dayType} + ${prescription.liftExpression} + ${prescription.cardioMode}`);

  return parts.join(". ") + ".";
}

// ─── OCS classification ───────────────────────────────────────────────────────

function ocsClass(composite: number): "Peak" | "Strong Build" | "Controlled Build" | "Reset" | "Resensitize" {
  if (composite >= 85) return "Peak";
  if (composite >= 70) return "Strong Build";
  if (composite >= 55) return "Controlled Build";
  if (composite >= 40) return "Reset";
  return "Resensitize";
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function computeOscillator(date: string, userId: string): Promise<OscillatorResult> {
  const { day: cycleDay28, week: cycleWeek } = computeCycleDay(date);

  const [acuteResult, resourceResult, seasonalResult, vitals7dRef, sleepTodayRef] = await Promise.all([
    computeAcute(date, userId),
    computeResource(date, userId),
    computeSeasonal(date, userId),
    pool.query(`SELECT AVG(hrv_rmssd_ms)::numeric as hrv7, AVG(resting_hr_bpm)::numeric as rhr7
                FROM vitals_daily WHERE user_id=$1
                  AND date BETWEEN ($2::date-interval '7 days') AND ($2::date-interval '1 day')`,
      [userId, date]),
    pool.query(`SELECT total_sleep_minutes FROM sleep_summary_daily
                WHERE user_id=$1 AND date=$2::date LIMIT 1`, [userId, date]),
  ]);

  const hrv7ref = vitals7dRef.rows[0]?.hrv7 != null ? Number(vitals7dRef.rows[0].hrv7) : null;
  const rhr7ref = vitals7dRef.rows[0]?.rhr7 != null ? Number(vitals7dRef.rows[0].rhr7) : null;
  const hrv  = acuteResult.components.hrvRatio != null && hrv7ref != null ? acuteResult.components.hrvRatio * hrv7ref : null;
  const rhr  = acuteResult.components.rhrDelta != null && rhr7ref != null ? rhr7ref + acuteResult.components.rhrDelta : null;
  const sleepMinForHardStop = sleepTodayRef.rows[0]?.total_sleep_minutes != null ? Number(sleepTodayRef.rows[0].total_sleep_minutes) : null;

  const acute = acuteResult.score;
  const resource = resourceResult.score;
  const seasonal = seasonalResult.score;

  const composite = Math.round(0.50 * acute + 0.30 * resource + 0.20 * seasonal);

  // Zone distribution from resource
  const zone2Count7d = resourceResult.components.zone2Days7d;
  const zone3Count7d = resourceResult.components.zone3Days7d;
  const easyCount7d  = resourceResult.components.easyDays7d;

  const { flag: hardStopFatigue, reasons: hardStopReasons } = evaluateHardStop(
    acuteResult.components, composite, hrv7ref, hrv, rhr7ref, rhr, sleepMinForHardStop,
  );

  const cardioMode = selectCardioMode(
    composite, hardStopFatigue, zone3Count7d, zone2Count7d,
    hrv7ref, hrv, rhr7ref, rhr, cycleDay28,
  );

  const prescription = buildPrescription(
    composite, hardStopFatigue, cardioMode,
    acuteResult.components.jointSorenessPts,
    acuteResult.components.rhrDelta ?? 0,
  );

  const explanationText = buildExplanation(
    composite, acuteResult.components, resourceResult.components,
    seasonalResult.components, prescription, hardStopFatigue, hardStopReasons,
    cycleDay28, cycleWeek,
  );

  const hasPhysio = acuteResult.components.hasHrv || acuteResult.components.hasSleep;
  const hasBody   = resourceResult.components.bwTrend14dLbPerWk != null || resourceResult.components.avgCalories7d != null;
  const hasSeasonal = seasonalResult.components.hrv28PctChange != null || seasonalResult.components.ffm28dChange != null;

  const dataQuality: "full" | "partial" | "insufficient" =
    hasPhysio && hasBody && hasSeasonal ? "full" :
    hasPhysio || hasBody ? "partial" : "insufficient";

  return {
    date,
    cycleDay28,
    cycleWeek,
    composite,
    ocs_class: ocsClass(composite),
    tier: ocsClass(composite),
    acute,
    resource,
    seasonal,
    acuteComponents: acuteResult.components,
    resourceComponents: resourceResult.components,
    seasonalComponents: seasonalResult.components,
    prescription,
    hardStopFatigue,
    hardStopReasons,
    zone2Count7d,
    zone3Count7d,
    easyCount7d,
    explanationText,
    dataQuality,
  };
}
