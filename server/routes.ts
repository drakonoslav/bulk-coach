import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { initDb, pool } from "./db";
import { recomputeRange } from "./recompute";
import { importFitbitCSV } from "./fitbit-import";
import { importFitbitTakeout, getDiagnosticsFromDB } from "./fitbit-takeout";
import { classifyDayRange } from "./day-classifier";
import { computeScheduleStability } from "./schedule-stability";
import {
  validateSleepSummaryInput,
  validateVitalsDailyInput,
  validateWorkoutSessionInput,
  validateHrSamples,
  validateRrIntervals,
  toUTCDateString,
  ensureUTCTimestamp,
} from "./validation";
import {
  getSleepSummaryRange,
  getVitalsDailyRange,
  getWorkoutSessions,
  getHrSamplesForSession,
  getRrIntervalsForSession,
  getHrvBaselineRange,
  upsertSleepSummary,
  upsertVitalsDaily,
  upsertWorkoutSession,
  batchUpsertHrSamples,
  batchUpsertRrIntervals,
  recomputeHrvBaselines,
  computeSessionStrain,
  computeSessionBiases,
  analyzeSessionHrv,
  DEFAULT_USER_ID,
  type SleepSummary,
  type VitalsDaily,
  type WorkoutSession,
  type WorkoutHrSample,
  type WorkoutRrInterval,
} from "./canonical-health";
import {
  compoundBudgetPoints,
  initWorkoutState,
  applyEvent,
  drainForSet,
  persistWorkoutEvent,
  getWorkoutEvents,
  type WorkoutEvent,
  type MuscleGroup,
} from "./workout-engine";
import {
  pickIsolationTargets,
  fallbackIsolation,
  getWeekStart,
  getWeeklyLoads,
  incrementMuscleLoad,
  getWeeklyLoadSummary,
  DEFAULT_WEEKLY_TARGETS,
  type ProgramContext,
} from "./muscle-planner";
import {
  parseSnapshotFile,
  importSnapshotAndDerive,
  getSnapshots,
  getSessions,
  getProxyData,
  getSessionBadges,
  getDataConfidence,
} from "./erection-engine";
import { exportBackup, importBackup } from "./backup";
import { computeDrift7d, computePrimaryDriver } from "./adherence-metrics";
import { computeRangeAdherence } from "./adherence-metrics-range";
import { computeSleepBlock, computeSleepTrending, getSleepPlanSettings, setSleepPlanSettings } from "./sleep-alignment";
import { computeCardioBlock } from "./cardio-regulation";
import { computeLiftBlock } from "./lift-regulation";
import {
  upsertCalorieDecision,
  getCalorieDecisions,
  chooseFinalCalorieDelta,
} from "./calorie-decisions-storage";
import {
  upsertContextEvent,
  updateContextEvent,
  deleteContextEvent,
  getContextEvents,
  getDistinctTags,
  markAdjustmentAttempted,
  computeContextLens,
  startEpisode,
  concludeEpisode,
  updateEpisode,
  getActiveEpisodes,
  getActiveEpisodesOnDay,
  getArchivedEpisodes,
  applyCarryForward,
  getArchives,
} from "./context-lens";
import { weeklyDelta, suggestCalorieAdjustment, type DailyEntry } from "../lib/coaching-engine";
import { classifyMode } from "../lib/structural-confidence";
import type { StrengthBaselines } from "../lib/strength-index";
import {
  computeReadiness,
  persistReadiness,
  recomputeReadinessRange,
  getReadiness,
  getReadinessRange,
  getTrainingTemplate,
  updateTrainingTemplate,
  getAnalysisStartDate,
  setAnalysisStartDate,
  getDataSufficiency,
} from "./readiness-engine";
import { computeAndUpsertHpa, getHpaForDate, getHpaRange } from "./hpa-engine";
import { bucketHpa, classifyHpaHrv, stateTooltip } from "./hpa-classifier";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const CHUNK_DIR = path.join("/tmp", "takeout_chunks");
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

const jobResults = new Map<string, { status: "processing" | "done" | "error"; result?: any; error?: string }>();

function requireAuth(req: Request, res: Response, next: Function) {
  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "Server missing API_KEY" });
  }
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).userId = 'local_default';
  next();
}

function requireAdmin(req: Request, res: Response, next: Function) {
  const userId = (req as any).userId;
  if (userId !== 'local_default') {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

const rateLimitMap = new Map<string, number[]>();

function rateLimit(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: Function) => {
    const key = `${req.path}:${(req as any).userId || 'anon'}`;
    const now = Date.now();
    const timestamps = (rateLimitMap.get(key) || []).filter(t => t > now - windowMs);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }
    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    next();
  };
}

const MAX_CHUNKS = 200;
const MAX_CHUNK_TOTAL_SIZE = 1073741824;

const TEXT_FIELDS = new Set([
  "day", "date", "sleep_start", "sleep_end", "performance_note", "notes",
  "cardio_fuel_note", "created_at", "updated_at", "recomputed_at",
  "source", "source_file", "timezone", "timezone_used", "session_id",
  "user_id", "id", "sha256", "original_filename", "import_id",
  "raw_start", "raw_end", "bucket_date", "suspicion_reason",
  "workout_type", "session_type_tag", "hrv_response_flag",
  "gate", "confidence_grade", "readiness_tier", "cortisol_flag",
  "type_lean", "exercise_bias", "sleep_source_mode",
  "priority", "reason", "mode",
]);

function avgOfThree(r1?: number, r2?: number, r3?: number): number | null {
  const vals = [r1, r2, r3].filter((v): v is number => v != null && !isNaN(v));
  if (vals.length < 3) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
}

export async function registerRoutes(app: Express): Promise<Server> {
  await initDb();

  setInterval(() => {
    try {
      if (!fs.existsSync(CHUNK_DIR)) return;
      const dirs = fs.readdirSync(CHUNK_DIR);
      const now = Date.now();
      for (const dir of dirs) {
        const metaPath = path.join(CHUNK_DIR, dir, "_meta.json");
        if (!fs.existsSync(metaPath)) {
          fs.rmSync(path.join(CHUNK_DIR, dir), { recursive: true, force: true });
          continue;
        }
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          if (meta.createdAt && now - meta.createdAt > 3600000) {
            fs.rmSync(path.join(CHUNK_DIR, dir), { recursive: true, force: true });
            console.log(`Cleaned up expired upload: ${dir}`);
          }
        } catch {
          fs.rmSync(path.join(CHUNK_DIR, dir), { recursive: true, force: true });
        }
      }
    } catch (err) {
      console.error("Chunk cleanup error:", err);
    }
  }, 900000);

  const getUserId = (req: Request): string =>
    (req as any).userId || 'local_default';

  const PUBLIC_PATHS = ["/privacy", "/terms", "/api/auth/fitbit/start", "/api/auth/fitbit/callback", "/api/auth/fitbit/status", "/api/auth/token"];

  app.use((req, res, next) => {
    if (PUBLIC_PATHS.some(p => req.path === p) || !req.path.startsWith("/api")) {
      return next();
    }
    requireAuth(req, res, next);
  });

  app.get("/api/auth/token", (_req: Request, res: Response) => {
    res.json({ token: process.env.API_KEY || "" });
  });

  app.get("/privacy", (_req: Request, res: Response) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Privacy Policy — BulkCoach-Drakonoslav</title>
<style>
  body { margin:0; padding:40px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:#0f1117; color:#e5e7eb; line-height:1.7; }
  .container { max-width:640px; margin:0 auto; }
  h1 { color:#00D4AA; font-size:28px; margin-bottom:8px; }
  h2 { color:#9CA3AF; font-size:14px; font-weight:400; margin-top:0; margin-bottom:32px; }
  h3 { color:#00D4AA; font-size:18px; margin-top:28px; }
  ul { padding-left:20px; }
  li { margin-bottom:6px; }
  .contact { margin-top:40px; padding-top:20px; border-top:1px solid #1f2937; color:#9CA3AF; font-size:14px; }
  a { color:#00D4AA; }
</style>
</head>
<body>
<div class="container">
  <h1>Privacy Policy</h1>
  <h2>BulkCoach-Drakonoslav</h2>
  <p>BulkCoach-Drakonoslav is a personal fitness analytics application.</p>
  <h3>Data We Access</h3>
  <p>This application may access Fitbit data including:</p>
  <ul>
    <li>Heart rate</li>
    <li>HRV (RMSSD)</li>
    <li>Sleep metrics</li>
    <li>Steps</li>
    <li>Calories</li>
    <li>Activity minutes</li>
  </ul>
  <h3>How Data Is Used</h3>
  <p>Data is used solely to:</p>
  <ul>
    <li>Generate readiness scores</li>
    <li>Track health trends</li>
    <li>Provide coaching recommendations</li>
  </ul>
  <h3>Data Storage</h3>
  <ul>
    <li>Data is stored securely in a private database.</li>
    <li>No data is sold.</li>
    <li>No data is shared with third parties.</li>
  </ul>
  <p>Users may disconnect Fitbit at any time to revoke access.</p>
  <div class="contact">Contact: Conrad — <a href="mailto:keeton.conrad@gmail.com">keeton.conrad@gmail.com</a></div>
</div>
</body>
</html>`);
  });

  app.get("/terms", (_req: Request, res: Response) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Terms of Service — BulkCoach-Drakonoslav</title>
<style>
  body { margin:0; padding:40px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:#0f1117; color:#e5e7eb; line-height:1.7; }
  .container { max-width:640px; margin:0 auto; }
  h1 { color:#00D4AA; font-size:28px; margin-bottom:8px; }
  h2 { color:#9CA3AF; font-size:14px; font-weight:400; margin-top:0; margin-bottom:32px; }
  ul { padding-left:20px; }
  li { margin-bottom:6px; }
  .contact { margin-top:40px; padding-top:20px; border-top:1px solid #1f2937; color:#9CA3AF; font-size:14px; }
  a { color:#00D4AA; }
</style>
</head>
<body>
<div class="container">
  <h1>Terms of Service</h1>
  <h2>BulkCoach-Drakonoslav</h2>
  <p>BulkCoach-Drakonoslav is a personal fitness tracking and analytics application.</p>
  <p>By using this application, you agree:</p>
  <ul>
    <li>The app provides informational health insights only.</li>
    <li>It is not medical advice.</li>
    <li>You are responsible for decisions regarding training and nutrition.</li>
  </ul>
  <p>The application may change features at any time.</p>
  <p>Use at your own discretion.</p>
  <div class="contact">Contact: Conrad — <a href="mailto:keeton.conrad@gmail.com">keeton.conrad@gmail.com</a></div>
</div>
</body>
</html>`);
  });

  app.post("/api/logs/upsert", async (req: Request, res: Response) => {
    try {
      const b = req.body;
      const userId = getUserId(req);
      if (!b.day || !b.morningWeightLb) {
        return res.status(400).json({ error: "day and morningWeightLb required" });
      }

      const bfMorningPct = avgOfThree(b.bfMorningR1, b.bfMorningR2, b.bfMorningR3);
      const bfEveningPct = avgOfThree(b.bfEveningR1, b.bfEveningR2, b.bfEveningR3);

      await pool.query(
        `INSERT INTO daily_log (
          user_id,
          day, morning_weight_lb, evening_weight_lb, waist_in,
          bf_morning_r1, bf_morning_r2, bf_morning_r3, bf_morning_pct,
          bf_evening_r1, bf_evening_r2, bf_evening_r3, bf_evening_pct,
          sleep_start, sleep_end, sleep_quality,
          water_liters, steps, cardio_min, lift_done, deload_week,
          adherence, performance_note, notes,
          sleep_plan_bedtime, sleep_plan_wake, tossed_minutes,
          planned_bed_time, planned_wake_time,
          actual_bed_time, actual_wake_time,
          sleep_latency_min, sleep_waso_min, nap_minutes,
          sleep_awake_min, sleep_rem_min, sleep_core_min, sleep_deep_min,
          sleep_source_mode,
          sleep_minutes, hrv, resting_hr,
          calories_in, training_load,
          cardio_start_time, cardio_end_time,
          lift_start_time, lift_end_time, lift_min, lift_working_min,
          zone1_min, zone2_min, zone3_min, zone4_min, zone5_min,
          lift_z1_min, lift_z2_min, lift_z3_min, lift_z4_min, lift_z5_min,
          fat_free_mass_lb,
          pushups_reps, pullups_reps, bench_reps, bench_weight_lb, ohp_reps, ohp_weight_lb,
          pain_0_10,
          meal_checklist,
          updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69,NOW()
        )
        ON CONFLICT (user_id, day) DO UPDATE SET
          morning_weight_lb = EXCLUDED.morning_weight_lb,
          evening_weight_lb = EXCLUDED.evening_weight_lb,
          waist_in = EXCLUDED.waist_in,
          bf_morning_r1 = EXCLUDED.bf_morning_r1,
          bf_morning_r2 = EXCLUDED.bf_morning_r2,
          bf_morning_r3 = EXCLUDED.bf_morning_r3,
          bf_morning_pct = EXCLUDED.bf_morning_pct,
          bf_evening_r1 = EXCLUDED.bf_evening_r1,
          bf_evening_r2 = EXCLUDED.bf_evening_r2,
          bf_evening_r3 = EXCLUDED.bf_evening_r3,
          bf_evening_pct = EXCLUDED.bf_evening_pct,
          sleep_start = EXCLUDED.sleep_start,
          sleep_end = EXCLUDED.sleep_end,
          sleep_quality = EXCLUDED.sleep_quality,
          water_liters = COALESCE(EXCLUDED.water_liters, daily_log.water_liters),
          steps = COALESCE(EXCLUDED.steps, daily_log.steps),
          cardio_min = COALESCE(EXCLUDED.cardio_min, daily_log.cardio_min),
          lift_done = EXCLUDED.lift_done,
          deload_week = EXCLUDED.deload_week,
          adherence = EXCLUDED.adherence,
          performance_note = COALESCE(EXCLUDED.performance_note, daily_log.performance_note),
          notes = COALESCE(EXCLUDED.notes, daily_log.notes),
          sleep_plan_bedtime = COALESCE(EXCLUDED.sleep_plan_bedtime, daily_log.sleep_plan_bedtime),
          sleep_plan_wake = COALESCE(EXCLUDED.sleep_plan_wake, daily_log.sleep_plan_wake),
          tossed_minutes = COALESCE(EXCLUDED.tossed_minutes, daily_log.tossed_minutes),
          planned_bed_time = COALESCE(EXCLUDED.planned_bed_time, daily_log.planned_bed_time),
          planned_wake_time = COALESCE(EXCLUDED.planned_wake_time, daily_log.planned_wake_time),
          actual_bed_time = COALESCE(EXCLUDED.actual_bed_time, daily_log.actual_bed_time),
          actual_wake_time = COALESCE(EXCLUDED.actual_wake_time, daily_log.actual_wake_time),
          sleep_latency_min = COALESCE(EXCLUDED.sleep_latency_min, daily_log.sleep_latency_min),
          sleep_waso_min = COALESCE(EXCLUDED.sleep_waso_min, daily_log.sleep_waso_min),
          nap_minutes = COALESCE(EXCLUDED.nap_minutes, daily_log.nap_minutes),
          sleep_awake_min = COALESCE(EXCLUDED.sleep_awake_min, daily_log.sleep_awake_min),
          sleep_rem_min = COALESCE(EXCLUDED.sleep_rem_min, daily_log.sleep_rem_min),
          sleep_core_min = COALESCE(EXCLUDED.sleep_core_min, daily_log.sleep_core_min),
          sleep_deep_min = COALESCE(EXCLUDED.sleep_deep_min, daily_log.sleep_deep_min),
          sleep_source_mode = EXCLUDED.sleep_source_mode,
          sleep_minutes = COALESCE(EXCLUDED.sleep_minutes, daily_log.sleep_minutes),
          hrv = COALESCE(EXCLUDED.hrv, daily_log.hrv),
          resting_hr = COALESCE(EXCLUDED.resting_hr, daily_log.resting_hr),
          calories_in = COALESCE(EXCLUDED.calories_in, daily_log.calories_in),
          training_load = COALESCE(EXCLUDED.training_load, daily_log.training_load),
          cardio_start_time = COALESCE(EXCLUDED.cardio_start_time, daily_log.cardio_start_time),
          cardio_end_time = COALESCE(EXCLUDED.cardio_end_time, daily_log.cardio_end_time),
          lift_start_time = COALESCE(EXCLUDED.lift_start_time, daily_log.lift_start_time),
          lift_end_time = COALESCE(EXCLUDED.lift_end_time, daily_log.lift_end_time),
          lift_min = COALESCE(EXCLUDED.lift_min, daily_log.lift_min),
          lift_working_min = COALESCE(EXCLUDED.lift_working_min, daily_log.lift_working_min),
          zone1_min = COALESCE(EXCLUDED.zone1_min, daily_log.zone1_min),
          zone2_min = COALESCE(EXCLUDED.zone2_min, daily_log.zone2_min),
          zone3_min = COALESCE(EXCLUDED.zone3_min, daily_log.zone3_min),
          zone4_min = COALESCE(EXCLUDED.zone4_min, daily_log.zone4_min),
          zone5_min = COALESCE(EXCLUDED.zone5_min, daily_log.zone5_min),
          lift_z1_min = COALESCE(EXCLUDED.lift_z1_min, daily_log.lift_z1_min),
          lift_z2_min = COALESCE(EXCLUDED.lift_z2_min, daily_log.lift_z2_min),
          lift_z3_min = COALESCE(EXCLUDED.lift_z3_min, daily_log.lift_z3_min),
          lift_z4_min = COALESCE(EXCLUDED.lift_z4_min, daily_log.lift_z4_min),
          lift_z5_min = COALESCE(EXCLUDED.lift_z5_min, daily_log.lift_z5_min),
          fat_free_mass_lb = COALESCE(EXCLUDED.fat_free_mass_lb, daily_log.fat_free_mass_lb),
          pushups_reps = COALESCE(EXCLUDED.pushups_reps, daily_log.pushups_reps),
          pullups_reps = COALESCE(EXCLUDED.pullups_reps, daily_log.pullups_reps),
          bench_reps = COALESCE(EXCLUDED.bench_reps, daily_log.bench_reps),
          bench_weight_lb = COALESCE(EXCLUDED.bench_weight_lb, daily_log.bench_weight_lb),
          ohp_reps = COALESCE(EXCLUDED.ohp_reps, daily_log.ohp_reps),
          ohp_weight_lb = COALESCE(EXCLUDED.ohp_weight_lb, daily_log.ohp_weight_lb),
          pain_0_10 = COALESCE(EXCLUDED.pain_0_10, daily_log.pain_0_10),
          meal_checklist = COALESCE(EXCLUDED.meal_checklist, daily_log.meal_checklist),
          updated_at = NOW()`,
        [
          userId,
          b.day,
          b.morningWeightLb,
          b.eveningWeightLb ?? null,
          b.waistIn ?? null,
          b.bfMorningR1 ?? null,
          b.bfMorningR2 ?? null,
          b.bfMorningR3 ?? null,
          bfMorningPct,
          b.bfEveningR1 ?? null,
          b.bfEveningR2 ?? null,
          b.bfEveningR3 ?? null,
          bfEveningPct,
          b.sleepStart ?? null,
          b.sleepEnd ?? null,
          b.sleepQuality ?? null,
          b.waterLiters ?? null,
          b.steps ?? null,
          b.cardioMin ?? null,
          b.liftDone ?? false,
          b.deloadWeek ?? false,
          b.adherence ?? null,
          b.performanceNote ?? null,
          b.notes ?? null,
          b.sleepPlanBedtime ?? null,
          b.sleepPlanWake ?? null,
          b.tossedMinutes ?? null,
          b.plannedBedTime ?? null,
          b.plannedWakeTime ?? null,
          b.actualBedTime ?? null,
          b.actualWakeTime ?? null,
          b.sleepLatencyMin ?? null,
          b.sleepWasoMin ?? null,
          b.napMinutes ?? null,
          b.sleepAwakeMin ?? null,
          b.sleepRemMin ?? null,
          b.sleepCoreMin ?? null,
          b.sleepDeepMin ?? null,
          b.sleepSourceMode ?? null,
          b.sleepMinutes ?? null,
          b.hrv ?? null,
          b.restingHr ?? null,
          b.caloriesIn ?? null,
          b.trainingLoad ?? null,
          b.cardioStartTime ?? null,
          b.cardioEndTime ?? null,
          b.liftStartTime ?? null,
          b.liftEndTime ?? null,
          b.liftMin ?? null,
          b.liftWorkingMin ?? null,
          b.zone1Min ?? null,
          b.zone2Min ?? null,
          b.zone3Min ?? null,
          b.zone4Min ?? null,
          b.zone5Min ?? null,
          b.liftZ1Min ?? null,
          b.liftZ2Min ?? null,
          b.liftZ3Min ?? null,
          b.liftZ4Min ?? null,
          b.liftZ5Min ?? null,
          b.fatFreeMassLb ?? null,
          b.pushupsReps ?? null,
          b.pullupsReps ?? null,
          b.benchReps ?? null,
          b.benchWeightLb ?? null,
          b.ohpReps ?? null,
          b.ohpWeightLb ?? null,
          b.pain010 ?? null,
          b.mealChecklist ? JSON.stringify(b.mealChecklist) : null,
        ],
      );

      const hasVitals = b.hrv != null || b.restingHr != null || b.steps != null || b.sleepMinutes != null;
      if (hasVitals) {
        await upsertVitalsDaily({
          date: b.day,
          user_id: userId,
          resting_hr_bpm: b.restingHr != null ? Number(b.restingHr) : null,
          hrv_rmssd_ms: b.hrv != null ? Number(b.hrv) : null,
          hrv_sdnn_ms: null,
          respiratory_rate_bpm: null,
          spo2_pct: null,
          skin_temp_delta_c: null,
          steps: b.steps != null ? Number(b.steps) : null,
          active_zone_minutes: b.activeZoneMinutes != null ? Number(b.activeZoneMinutes) : null,
          energy_burned_kcal: b.energyBurnedKcal != null ? Number(b.energyBurnedKcal) : null,
          zone1_min: b.zone1Min != null ? Number(b.zone1Min) : null,
          zone2_min: b.zone2Min != null ? Number(b.zone2Min) : null,
          zone3_min: b.zone3Min != null ? Number(b.zone3Min) : null,
          below_zone1_min: b.belowZone1Min != null ? Number(b.belowZone1Min) : null,
          source: "manual",
        });
      }

      const hasSleep = b.sleepMinutes != null || b.actualBedTime != null || b.actualWakeTime != null;
      if (hasSleep) {
        const sleepMin = b.sleepMinutes != null ? Number(b.sleepMinutes) : null;
        const latency = b.sleepLatencyMin != null ? Number(b.sleepLatencyMin) : null;
        const waso = b.sleepWasoMin != null ? Number(b.sleepWasoMin) : null;
        const timeInBed = sleepMin != null ? sleepMin + (latency ?? 0) + (waso ?? 0) : null;
        const efficiency = sleepMin != null && timeInBed != null && timeInBed > 0
          ? Math.round((sleepMin / timeInBed) * 100) : null;

        await upsertSleepSummary({
          date: b.day,
          user_id: userId,
          sleep_start: b.actualBedTime ?? b.sleepStart ?? null,
          sleep_end: b.actualWakeTime ?? b.sleepEnd ?? null,
          total_sleep_minutes: sleepMin ?? 0,
          time_in_bed_minutes: timeInBed,
          awake_minutes: waso,
          rem_minutes: null,
          deep_minutes: null,
          light_or_core_minutes: null,
          sleep_efficiency: efficiency,
          sleep_latency_min: latency,
          waso_min: waso,
          source: "manual",
        });
      }

      await recomputeRange(b.day, userId);

      recomputeReadinessRange(b.day, userId).catch((err: unknown) =>
        console.error("readiness recompute error:", err)
      );

      computeAndUpsertHpa(b.day, userId).catch((err: unknown) =>
        console.error("hpa compute error:", err)
      );

      const hasStrength = b.pushupsReps != null || b.pullupsReps != null || b.benchReps != null || b.ohpReps != null;
      if (hasStrength) {
        (async () => {
          try {
            const { rows: allRows } = await pool.query(
              `SELECT * FROM daily_log WHERE user_id = $1 ORDER BY day ASC`,
              [userId],
            );
            const allEntries = allRows.map(snakeToCamel);
            const sorted = [...allEntries].sort((a: any, b: any) => a.day.localeCompare(b.day));
            const first7 = sorted.slice(0, 7);
            const avgFn = (vals: number[]) => vals.length > 0 ? vals.reduce((s: number, v: number) => s + v, 0) / vals.length : null;
            const pushups = avgFn(first7.filter((e: any) => e.pushupsReps != null).map((e: any) => e.pushupsReps));
            const pullups = avgFn(first7.filter((e: any) => e.pullupsReps != null).map((e: any) => e.pullupsReps));
            const benchBarReps = avgFn(first7.filter((e: any) => e.benchReps != null && (e.benchWeightLb == null || e.benchWeightLb <= 45)).map((e: any) => e.benchReps));
            const ohpBarReps = avgFn(first7.filter((e: any) => e.ohpReps != null && (e.ohpWeightLb == null || e.ohpWeightLb <= 45)).map((e: any) => e.ohpReps));
            const exercises = [
              { name: "pushups", val: pushups, type: "reps" },
              { name: "pullups", val: pullups, type: "reps" },
              { name: "bench_bar_reps", val: benchBarReps, type: "reps" },
              { name: "ohp_bar_reps", val: ohpBarReps, type: "reps" },
            ];
            for (const ex of exercises) {
              if (ex.val != null) {
                await pool.query(
                  `INSERT INTO strength_baselines (user_id, exercise, baseline_value, baseline_type, computed_from_days, updated_at)
                   VALUES ($1, $2, $3, $4, $5, NOW())
                   ON CONFLICT (user_id, exercise) DO UPDATE SET
                     baseline_value = EXCLUDED.baseline_value,
                     baseline_type = EXCLUDED.baseline_type,
                     computed_from_days = EXCLUDED.computed_from_days,
                     updated_at = NOW()`,
                  [userId, ex.name, Math.round(ex.val * 10) / 10, ex.type, first7.length],
                );
              }
            }
          } catch (err) {
            console.error("auto-compute strength baselines error:", err);
          }
        })();
      }

      res.json({ ok: true });
    } catch (err: unknown) {
      console.error("upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/logs", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT * FROM daily_log WHERE user_id = $1 ORDER BY day ASC`,
        [userId],
      );
      const mapped = rows.map(snakeToCamel);
      res.json(mapped);
    } catch (err: unknown) {
      console.error("logs error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/logs/:day", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT * FROM daily_log WHERE day = $1 AND user_id = $2`,
        [req.params.day, userId],
      );
      if (rows.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(snakeToCamel(rows[0]));
    } catch (err: unknown) {
      console.error("log detail error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/logs/:day", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      await pool.query(`DELETE FROM daily_log WHERE day = $1 AND user_id = $2`, [req.params.day, userId]);
      await pool.query(`DELETE FROM dashboard_cache WHERE day = $1 AND user_id = $2`, [req.params.day, userId]);
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error("delete error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/logs/reset-adherence", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const result = await pool.query(
        `UPDATE daily_log SET adherence = NULL, updated_at = NOW() WHERE user_id = $1 AND adherence IS NOT NULL`,
        [userId],
      );
      res.json({ ok: true, rowsCleared: result.rowCount });
    } catch (err: unknown) {
      console.error("reset-adherence error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/androgen/manual", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { date, nocturnalCount, totalDurationMin, firmnessAvg } = req.body;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date required (YYYY-MM-DD)" });
      }
      if (nocturnalCount == null || nocturnalCount < 0) {
        return res.status(400).json({ error: "nocturnalCount required (>= 0)" });
      }
      const count = Number(nocturnalCount);
      const durMin = Number(totalDurationMin ?? 0);
      const firmness = firmnessAvg != null ? Number(firmnessAvg) : null;
      const durSec = Math.round(durMin * 60);

      const proxyScore =
        count * 20 +
        Math.min(durMin, 60) * 0.5 +
        (firmness != null ? firmness * 3 : 0);

      await pool.query(
        `INSERT INTO androgen_proxy_daily (user_id, date, proxy_score, computed_with_imputed, computed_at, nocturnal_count, duration_min, firmness_avg)
         VALUES ($1, $2, $3, false, NOW(), $4, $5, $6)
         ON CONFLICT (user_id, date, computed_with_imputed) DO UPDATE SET
           proxy_score = EXCLUDED.proxy_score,
           computed_at = NOW(),
           nocturnal_count = EXCLUDED.nocturnal_count,
           duration_min = EXCLUDED.duration_min,
           firmness_avg = EXCLUDED.firmness_avg`,
        [userId, date, proxyScore, count, durMin, firmness],
      );

      await pool.query(
        `INSERT INTO erection_sessions (user_id, date, nocturnal_erections, nocturnal_duration_seconds, is_imputed, updated_at)
         VALUES ($1, $2, $3, $4, false, NOW())
         ON CONFLICT (user_id, date) DO UPDATE SET
           nocturnal_erections = EXCLUDED.nocturnal_erections,
           nocturnal_duration_seconds = EXCLUDED.nocturnal_duration_seconds,
           is_imputed = false,
           updated_at = NOW()`,
        [userId, date, count, durSec],
      );

      res.json({ ok: true, proxyScore: Math.round(proxyScore * 100) / 100 });
    } catch (err: unknown) {
      console.error("androgen manual error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/androgen/manual/:date", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT date::text, proxy_score, computed_with_imputed, nocturnal_count, duration_min, firmness_avg
         FROM androgen_proxy_daily
         WHERE user_id = $1 AND date = $2`,
        [userId, req.params.date],
      );
      if (rows.length === 0) return res.json(null);
      res.json(rows[0]);
    } catch (err: unknown) {
      console.error("androgen manual get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/dashboard", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const start = (req.query.start as string) || "2020-01-01";
      const end = (req.query.end as string) || "2099-12-31";

      const { rows } = await pool.query(
        `SELECT d.day,
                l.morning_weight_lb, l.evening_weight_lb, l.waist_in,
                l.bf_morning_r1, l.bf_morning_r2, l.bf_morning_r3,
                l.bf_morning_pct,
                l.bf_evening_r1, l.bf_evening_r2, l.bf_evening_r3,
                l.bf_evening_pct,
                l.sleep_start, l.sleep_end, l.sleep_quality,
                l.water_liters, l.steps, l.cardio_min,
                l.lift_done, l.deload_week,
                l.adherence, l.performance_note, l.notes,
                d.lean_mass_lb, d.fat_mass_lb,
                d.weight_7d_avg, d.waist_7d_avg, d.lean_mass_7d_avg,
                d.lean_gain_ratio_14d_roll, d.cardio_fuel_note,
                l.fat_free_mass_lb,
                l.pushups_reps, l.pullups_reps,
                l.bench_reps, l.bench_weight_lb,
                l.ohp_reps, l.ohp_weight_lb
         FROM dashboard_cache d
         JOIN daily_log l ON l.day = d.day AND l.user_id = d.user_id
         WHERE d.user_id = $3 AND d.day BETWEEN $1 AND $2
         ORDER BY d.day ASC`,
        [start, end, userId],
      );

      const mapped = rows.map(snakeToCamel);

      let appliedCalorieDelta: number | null = null;
      let policySource: string | null = null;
      let modeInsightReason: string | null = null;
      let decisions14d: any[] = [];

      if (mapped.length >= 7) {
        try {
          const entries = mapped as unknown as DailyEntry[];
          const wkGain = weeklyDelta(entries) ?? 0;
          const weightDelta = suggestCalorieAdjustment(wkGain);

          const sbRes = await pool.query(
            `SELECT exercise, baseline_value FROM strength_baselines WHERE user_id = $1`,
            [userId],
          );
          const sbMap: Record<string, number> = {};
          for (const r of sbRes.rows) sbMap[r.exercise] = Number(r.baseline_value);
          const strengthBaselines: StrengthBaselines = {
            pushups: sbMap.pushups ?? null,
            pullups: sbMap.pullups ?? null,
            benchBarReps: sbMap.bench_bar_reps ?? null,
            ohpBarReps: sbMap.ohp_bar_reps ?? null,
          };

          const modeClass = classifyMode(entries, strengthBaselines);
          const final = chooseFinalCalorieDelta(
            weightDelta,
            modeClass.calorieAction.delta,
            modeClass.calorieAction.priority,
          );

          appliedCalorieDelta = final.delta;
          policySource = final.source;
          modeInsightReason = modeClass.calorieAction.reason;

          if (process.env.NODE_ENV !== "production") {
            console.log("[CALORIE POLICY DEBUG]", {
              wkGain,
              weightDelta,
              modeDelta: modeClass.calorieAction.delta,
              modePriority: modeClass.calorieAction.priority,
              applied: final.delta,
              source: final.source,
            });
          }

          const today = new Date().toISOString().slice(0, 10);
          await upsertCalorieDecision(userId, {
            day: today,
            deltaKcal: final.delta,
            source: final.source,
            priority: modeClass.calorieAction.priority,
            reason: final.source === "mode_override"
              ? modeClass.calorieAction.reason
              : "Weight policy (weekly rate)",
            wkGainLb: wkGain,
            mode: modeClass.mode,
          });

          decisions14d = await getCalorieDecisions(userId, 14);
        } catch (calcErr) {
          console.error("dashboard calorie calc error:", calcErr);
        }
      }

      res.json({
        entries: mapped,
        appliedCalorieDelta,
        policySource,
        modeInsightReason,
        decisions14d,
      });
    } catch (err: unknown) {
      console.error("dashboard error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/import/fitbit", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const userId = getUserId(req);

      const overwriteFields = req.body?.overwrite_fields === "true";
      const result = await importFitbitCSV(req.file.buffer, req.file.originalname, overwriteFields);

      if (result.dateRange?.start) {
        recomputeReadinessRange(result.dateRange.start, userId, result.dateRange?.end).catch((err: unknown) =>
          console.error("readiness recompute after fitbit:", err)
        );
      }

      res.json(result);
    } catch (err: unknown) {
      console.error("fitbit import error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  });

  app.get("/api/import/history", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT * FROM fitbit_imports WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 10`,
        [userId],
      );
      res.json(rows.map(snakeToCamel));
    } catch (err: unknown) {
      console.error("import history error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/import/fitbit_takeout", upload.single("file"), async (req: Request, res: Response) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const overwriteFields = req.body?.overwrite_fields === "true";
      const timezone = req.body?.timezone || "America/New_York";
      const force = req.body?.force === "true";
      const result = await importFitbitTakeout(req.file.buffer, req.file.originalname, overwriteFields, timezone, force);
      res.json(result);
    } catch (err: unknown) {
      console.error("fitbit takeout import error:", err);
      const message = err instanceof Error ? err.message : "Import failed";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/import/takeout_chunk_init", async (req: Request, res: Response) => {
    try {
      const { filename, totalChunks, fileSize } = req.body;
      if (!filename || !totalChunks) {
        return res.status(400).json({ error: "Missing filename or totalChunks" });
      }
      if (totalChunks > MAX_CHUNKS) {
        return res.status(400).json({ error: `Too many chunks (max ${MAX_CHUNKS})` });
      }
      if (fileSize && fileSize > MAX_CHUNK_TOTAL_SIZE) {
        return res.status(400).json({ error: `File too large (max 1 GB)` });
      }
      const uploadId = crypto.randomUUID();
      const uploadDir = path.join(CHUNK_DIR, uploadId);
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, "_meta.json"), JSON.stringify({
        filename, totalChunks, fileSize, receivedChunks: 0, createdAt: Date.now(),
      }));
      res.json({ uploadId, totalChunks });
    } catch (err: unknown) {
      console.error("chunk init error:", err);
      res.status(500).json({ error: "Failed to initialize upload" });
    }
  });

  app.post("/api/import/takeout_chunk_upload", upload.single("chunk"), async (req: Request, res: Response) => {
    try {
      const uploadId = req.body?.uploadId;
      const chunkIndex = parseInt(req.body?.chunkIndex, 10);
      if (!uploadId || isNaN(chunkIndex) || !req.file) {
        return res.status(400).json({ error: "Missing uploadId, chunkIndex, or chunk data" });
      }
      const uploadDir = path.join(CHUNK_DIR, uploadId);
      if (!fs.existsSync(uploadDir)) {
        return res.status(404).json({ error: "Upload session not found" });
      }
      const meta = JSON.parse(fs.readFileSync(path.join(uploadDir, "_meta.json"), "utf8"));
      if (chunkIndex >= meta.totalChunks) {
        return res.status(400).json({ error: `chunkIndex ${chunkIndex} exceeds totalChunks ${meta.totalChunks}` });
      }
      fs.writeFileSync(path.join(uploadDir, `chunk_${chunkIndex}`), req.file.buffer);
      meta.receivedChunks = (meta.receivedChunks || 0) + 1;
      fs.writeFileSync(path.join(uploadDir, "_meta.json"), JSON.stringify(meta));
      res.json({ received: chunkIndex, total: meta.totalChunks, done: meta.receivedChunks >= meta.totalChunks });
    } catch (err: unknown) {
      console.error("chunk upload error:", err);
      res.status(500).json({ error: "Failed to upload chunk" });
    }
  });

  app.post("/api/import/takeout_chunk_finalize", async (req: Request, res: Response) => {
    try {
      const { uploadId, overwrite_fields, timezone, force } = req.body;
      if (!uploadId) {
        return res.status(400).json({ error: "Missing uploadId" });
      }
      const uploadDir = path.join(CHUNK_DIR, uploadId);
      if (!fs.existsSync(uploadDir)) {
        return res.status(404).json({ error: "Upload session not found" });
      }
      const meta = JSON.parse(fs.readFileSync(path.join(uploadDir, "_meta.json"), "utf8"));
      for (let i = 0; i < meta.totalChunks; i++) {
        const chunkPath = path.join(uploadDir, `chunk_${i}`);
        if (!fs.existsSync(chunkPath)) {
          return res.status(400).json({ error: `Missing chunk ${i}` });
        }
      }

      const jobId = crypto.randomUUID();
      jobResults.set(jobId, { status: "processing" });

      res.json({ jobId, status: "processing" });

      (async () => {
        try {
          const chunks: Buffer[] = [];
          for (let i = 0; i < meta.totalChunks; i++) {
            chunks.push(fs.readFileSync(path.join(uploadDir, `chunk_${i}`)));
          }
          const fullBuffer = Buffer.concat(chunks);
          const overwriteFieldsBool = overwrite_fields === "true" || overwrite_fields === true;
          const tz = timezone || "America/New_York";
          const forceBool = force === "true" || force === true;
          const result = await importFitbitTakeout(fullBuffer, meta.filename, overwriteFieldsBool, tz, forceBool);
          fs.rmSync(uploadDir, { recursive: true, force: true });
          jobResults.set(jobId, { status: "done", result });
          setTimeout(() => jobResults.delete(jobId), 600000);
        } catch (err: unknown) {
          console.error("chunk finalize background error:", err);
          const message = err instanceof Error ? err.message : "Import failed";
          jobResults.set(jobId, { status: "error", error: message });
          fs.rmSync(uploadDir, { recursive: true, force: true });
          setTimeout(() => jobResults.delete(jobId), 600000);
        }
      })();
    } catch (err: unknown) {
      console.error("chunk finalize error:", err);
      res.status(500).json({ error: "Failed to start processing" });
    }
  });

  app.get("/api/import/takeout_job/:jobId", async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = jobResults.get(jobId as string);
    if (!job) {
      return res.status(404).json({ error: "Job not found or expired" });
    }
    res.json(job);
  });

  app.get("/api/import/takeout_history", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT * FROM fitbit_takeout_imports WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 10`,
        [userId],
      );
      res.json(rows.map(snakeToCamel));
    } catch (err: unknown) {
      console.error("takeout history error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/import/takeout_history/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await pool.query(`DELETE FROM fitbit_takeout_imports WHERE id = $1`, [id]);
      res.json({ status: "ok" });
    } catch (err: unknown) {
      console.error("delete takeout history error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/import/takeout_reset_hashes", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rowCount } = await pool.query(`DELETE FROM fitbit_takeout_imports`);
      res.json({ status: "ok", cleared: rowCount });
    } catch (err: unknown) {
      console.error("reset takeout hashes error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/import/history/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await pool.query(`DELETE FROM fitbit_imports WHERE id = $1`, [id]);
      res.json({ status: "ok" });
    } catch (err: unknown) {
      console.error("delete import history error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/import/healthkit/batch", async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const userId = getUserId(req);
      const timezone: string | null = body.timezone || null;

      const vitals = Array.isArray(body.vitals_daily) ? body.vitals_daily : [];
      const sleep = Array.isArray(body.sleep_summary_daily) ? body.sleep_summary_daily : [];
      const sessions = Array.isArray(body.workout_sessions) ? body.workout_sessions : [];
      const hrSamples = Array.isArray(body.workout_hr_samples) ? body.workout_hr_samples : [];

      const options = body.options || {};
      const recomputeHrv = options.recompute_hrv_baselines !== false;
      const recomputeReadinessOpt = options.recompute_readiness !== false;
      const analyzeSessionHrvOpt = options.analyze_session_hrv === true;

      const isDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
      const isIso = (s: unknown) => typeof s === "string" && !isNaN(new Date(s).getTime());

      const errors: string[] = [];

      let vitalsCount = 0;
      for (const v of vitals) {
        if (!isDate(v.date)) {
          errors.push(`vitals: invalid date "${v.date}"`);
          continue;
        }
        await upsertVitalsDaily({
          date: v.date,
          user_id: userId,
          resting_hr_bpm: v.resting_hr_bpm ?? null,
          hrv_rmssd_ms: v.hrv_rmssd_ms ?? null,
          hrv_sdnn_ms: v.hrv_sdnn_ms ?? null,
          respiratory_rate_bpm: v.respiratory_rate_bpm ?? null,
          spo2_pct: v.spo2_pct ?? null,
          skin_temp_delta_c: v.skin_temp_delta_c ?? null,
          steps: v.steps ?? null,
          active_zone_minutes: v.active_zone_minutes ?? null,
          energy_burned_kcal: v.energy_burned_kcal ?? null,
          zone1_min: v.zone1_min ?? null,
          zone2_min: v.zone2_min ?? null,
          zone3_min: v.zone3_min ?? null,
          below_zone1_min: v.below_zone1_min ?? null,
          source: "healthkit",
          timezone,
        });
        vitalsCount++;
      }

      let sleepCount = 0;
      for (const s of sleep) {
        if (!isDate(s.date)) {
          errors.push(`sleep: invalid date "${s.date}"`);
          continue;
        }
        if (s.total_sleep_minutes == null) {
          errors.push(`sleep: missing total_sleep_minutes for ${s.date}`);
          continue;
        }
        await upsertSleepSummary({
          date: s.date,
          user_id: userId,
          sleep_start: s.sleep_start ?? null,
          sleep_end: s.sleep_end ?? null,
          total_sleep_minutes: s.total_sleep_minutes,
          time_in_bed_minutes: s.time_in_bed_minutes ?? null,
          awake_minutes: s.awake_minutes ?? null,
          rem_minutes: s.rem_minutes ?? null,
          deep_minutes: s.deep_minutes ?? null,
          light_or_core_minutes: s.light_or_core_minutes ?? null,
          sleep_efficiency: s.sleep_efficiency ?? null,
          sleep_latency_min: s.sleep_latency_min ?? null,
          waso_min: s.waso_min ?? null,
          source: "healthkit",
          timezone,
        });
        sleepCount++;
      }

      let sessionCount = 0;
      for (const w of sessions) {
        if (!w.session_id || !isDate(w.date) || !isIso(w.start_ts)) {
          errors.push(`workout: invalid session (id=${w.session_id}, date=${w.date})`);
          continue;
        }
        const wt = (w.workout_type || "other") as "strength" | "cardio" | "hiit" | "flexibility" | "other";
        const { strainScore, typeTag } = computeSessionStrain(
          w.avg_hr ?? null, w.max_hr ?? null, w.duration_minutes ?? null, wt
        );
        const biases = computeSessionBiases(wt, w.avg_hr ?? null, w.max_hr ?? null, w.duration_minutes ?? null);

        await upsertWorkoutSession({
          session_id: w.session_id,
          user_id: userId,
          date: w.date,
          start_ts: w.start_ts,
          end_ts: w.end_ts ?? null,
          workout_type: wt,
          duration_minutes: w.duration_minutes ?? null,
          avg_hr: w.avg_hr ?? null,
          max_hr: w.max_hr ?? null,
          calories_burned: w.calories_burned ?? null,
          session_strain_score: w.session_strain_score ?? strainScore,
          session_type_tag: w.session_type_tag ?? typeTag,
          recovery_slope: null,
          strength_bias: w.strength_bias ?? biases.strength_bias,
          cardio_bias: w.cardio_bias ?? biases.cardio_bias,
          pre_session_rmssd: null,
          min_session_rmssd: null,
          post_session_rmssd: null,
          hrv_suppression_pct: null,
          hrv_rebound_pct: null,
          suppression_depth_pct: null,
          rebound_bpm_per_min: null,
          baseline_window_seconds: w.baseline_window_seconds ?? 120,
          time_to_recovery_sec: null,
          source: "healthkit",
          timezone,
        });
        sessionCount++;
      }

      let hrSampleCount = 0;
      if (hrSamples.length > 0) {
        const tagged = hrSamples
          .filter((s: any) => s.session_id && isIso(s.ts) && Number.isFinite(Number(s.hr_bpm)))
          .map((s: any) => ({
            session_id: s.session_id,
            user_id: userId,
            ts: s.ts,
            hr_bpm: Math.round(Number(s.hr_bpm)),
            source: "healthkit",
          }));
        hrSampleCount = await batchUpsertHrSamples(tagged, userId);
      }

      if (analyzeSessionHrvOpt) {
        for (const w of sessions) {
          if (w?.session_id) {
            analyzeSessionHrv(w.session_id, userId).catch(() => {});
          }
        }
      }

      const start = body.range?.start;
      const end = body.range?.end;

      if (recomputeHrv && start && end) {
        const hasHrv = vitals.some((v: any) => v.hrv_sdnn_ms != null || v.hrv_rmssd_ms != null);
        if (hasHrv) {
          try { await recomputeHrvBaselines(start, end, userId); } catch {}
        }
      }

      if (recomputeReadinessOpt && (start || sleep[0]?.date || vitals[0]?.date)) {
        const triggerStart = start || sleep[0]?.date || vitals[0]?.date;
        recomputeReadinessRange(triggerStart, userId, end).catch(() => {});
      }

      res.json({
        ok: true,
        counts: {
          vitals_daily: vitalsCount,
          sleep_summary_daily: sleepCount,
          workout_sessions: sessionCount,
          workout_hr_samples: hrSampleCount,
        },
        user_id: userId,
        timezone,
        ...(errors.length > 0 ? { warnings: errors } : {}),
      });
    } catch (err: any) {
      console.error("healthkit batch import error:", err);
      res.status(500).json({ error: err?.message || "Import failed" });
    }
  });

  const shiftDateStr = (d: string, offset: number): string => {
    const dt = new Date(d + "T12:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + offset);
    return dt.toISOString().slice(0, 10);
  };

  app.get("/api/import/fitbit/takeout/diagnostics", async (req: Request, res: Response) => {
    try {
      const date = req.query.date as string;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
      }
      const diagData = await getDiagnosticsFromDB(date);
      const { rows: dbRows } = await pool.query(
        `SELECT day, steps, cardio_min, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr, hrv,
          zone1_min, zone2_min, zone3_min, below_zone1_min, morning_weight_lb, waist_in, adherence, notes
         FROM daily_log WHERE day >= $1 AND day <= $2 ORDER BY day`,
        [shiftDateStr(date, -1), shiftDateStr(date, 1)],
      );
      diagData.dbValues = {};
      for (const row of dbRows) {
        (diagData.dbValues as Record<string, unknown>)[row.day] = snakeToCamel(row);
      }
      res.json(diagData);
    } catch (err: unknown) {
      console.error("diagnostics error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/erection/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const sessionDate = req.body?.session_date;
      if (!sessionDate || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
        return res.status(400).json({ error: "session_date required (YYYY-MM-DD)" });
      }

      const today = new Date().toISOString().slice(0, 10);
      if (sessionDate > today) {
        return res.status(400).json({ error: "sessionDate cannot be in the future" });
      }

      const userId = getUserId(req);
      const parsed = parseSnapshotFile(req.file.buffer, req.file.originalname);
      const result = await importSnapshotAndDerive(parsed, sessionDate, req.file.originalname, userId);

      recomputeReadinessRange(sessionDate, userId).catch((err: unknown) =>
        console.error("readiness recompute after snapshot:", err)
      );

      res.json(result);
    } catch (err: unknown) {
      console.error("erection upload error:", err);
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/erection/snapshots", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const snapshots = await getSnapshots(userId);
      res.json(snapshots);
    } catch (err: unknown) {
      console.error("snapshots error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/sessions", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const includeImputed = req.query.include_imputed !== "false";
      const sessions = await getSessions(from, to, includeImputed, userId);
      res.json(sessions.map(snakeToCamel));
    } catch (err: unknown) {
      console.error("sessions error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/proxy", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const includeImputed = req.query.include_imputed === "true";
      const data = await getProxyData(from, to, includeImputed, userId);
      res.json(data.map(snakeToCamel));
    } catch (err: unknown) {
      console.error("proxy error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/badges", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const badges = await getSessionBadges(userId);
      res.json(badges);
    } catch (err: unknown) {
      console.error("badges error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/confidence", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const confidence = await getDataConfidence(userId);
      res.json(confidence);
    } catch (err: unknown) {
      console.error("confidence error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/readiness", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      let result = await getReadiness(date, userId);
      if (!result) {
        result = await computeReadiness(date, userId);
        if (result.readinessScore > 0) {
          await persistReadiness(result, userId);
        }
      }
      const adhLookbackStart = (() => {
        const d = new Date(date + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() - 7);
        return d.toISOString().slice(0, 10);
      })();
      const [sleepBlock, sleepTrending, drift, rangeAdh, cardioBlock, liftBlock] = await Promise.all([
        computeSleepBlock(date, userId),
        computeSleepTrending(date, userId),
        computeDrift7d(date, userId),
        computeRangeAdherence(adhLookbackStart, date, userId),
        computeCardioBlock(date, userId),
        computeLiftBlock(date, userId),
      ]);
      let dayAdh = rangeAdh.get(date) ?? null;
      const hasCardioLift = dayAdh?.actualCardioMin != null || dayAdh?.actualLiftMin != null;
      if (!hasCardioLift) {
        const sortedDates = Array.from(rangeAdh.keys()).sort().reverse();
        for (const d of sortedDates) {
          const a = rangeAdh.get(d)!;
          if (a.actualCardioMin != null || a.actualLiftMin != null) {
            dayAdh = {
              ...(dayAdh ?? a),
              trainingOverrunMin: a.trainingOverrunMin,
              liftOverrunMin: a.liftOverrunMin,
              actualCardioMin: a.actualCardioMin,
              actualLiftMin: a.actualLiftMin,
              plannedCardioMin: a.plannedCardioMin,
              plannedLiftMin: a.plannedLiftMin,
            };
            break;
          }
        }
      }

      const sa = sleepBlock?.sleepAlignment;

      const schedStab = await computeScheduleStability(
        date,
        sa?.plannedBedTime ?? "21:45",
        sa?.plannedWakeTime ?? "05:30",
        userId,
      );

      const primaryDriver = computePrimaryDriver(
        sa?.shortfallMin ?? null,
        sa?.wakeDeviationMin ?? null,
        sa?.bedDeviationMin ?? null,
        result.deltas?.hrv_pct ?? null,
        result.deltas?.rhr_bpm ?? null,
        result.deltas?.proxy_pct ?? null,
        sleepBlock?.awakeInBedMin ?? null,
        sleepBlock?.awakeInBedDeltaMin ?? null,
      );

      const MEAL_CALORIES: Record<string, { kcal: number; label: string }> = {
        preCardio: { kcal: 104, label: "Pre-cardio" },
        postCardio: { kcal: 644, label: "Post-cardio" },
        midday: { kcal: 303, label: "Midday" },
        preLift: { kcal: 385, label: "Pre-lift" },
        postLift: { kcal: 268, label: "Post-lift" },
        evening: { kcal: 992, label: "Evening" },
      };
      const BASELINE_KCAL = 2696;

      const mealLogRow = await pool.query(
        `SELECT day, meal_checklist FROM daily_log WHERE day <= $1 AND user_id = $2 AND meal_checklist IS NOT NULL ORDER BY day DESC LIMIT 1`,
        [date, userId],
      );
      const rawChecklist = mealLogRow.rows[0]?.meal_checklist;
      const mealDay = mealLogRow.rows[0]?.day ?? null;
      const hasLogEntry = mealLogRow.rows.length > 0;
      const mealChecklist: Record<string, boolean> = rawChecklist ?? {};
      const mealKeys = Object.keys(MEAL_CALORIES);
      const mealsChecked = mealKeys.filter(k => mealChecklist[k]);
      const mealsTotal = mealKeys.length;
      const earnedKcal = mealsChecked.reduce((s, k) => s + MEAL_CALORIES[k].kcal, 0);
      const missedKcal = Math.max(0, BASELINE_KCAL - earnedKcal);
      const baselineHitPct = Math.round((earnedKcal / BASELINE_KCAL) * 100);
      const missedMeals = mealKeys
        .filter(k => !mealChecklist[k])
        .sort((a, b) => MEAL_CALORIES[b].kcal - MEAL_CALORIES[a].kcal);
      const biggestMiss = missedMeals.length > 0 ? MEAL_CALORIES[missedMeals[0]].label : null;

      const recoveryShapeChecks: string[] = [];
      if (schedStab.scheduledToday && schedStab.scheduleRecoveryScore == null) {
        recoveryShapeChecks.push(`SLEEP: scheduledToday=true but scheduleRecoveryScore is null`);
      }
      if (schedStab.scheduledToday && !schedStab.hasActualDataToday && (schedStab.scheduleRecoveryScore !== 0 || schedStab.recoveryConfidence !== "high")) {
        recoveryShapeChecks.push(`SLEEP: scheduledToday+noData but recoveryScore=${schedStab.scheduleRecoveryScore}, confidence=${schedStab.recoveryConfidence}`);
      }
      const cs = cardioBlock.scheduleStability;
      if (cs.scheduledToday && cs.recoveryScore == null) {
        recoveryShapeChecks.push(`CARDIO: scheduledToday=true but recoveryScore is null`);
      }
      if (cs.scheduledToday && !cs.hasActualDataToday && (cs.recoveryScore !== 0 || cs.recoveryConfidence !== "high")) {
        recoveryShapeChecks.push(`CARDIO: scheduledToday+noData but recoveryScore=${cs.recoveryScore}, confidence=${cs.recoveryConfidence}`);
      }
      const ls = liftBlock.scheduleStability;
      if (ls.scheduledToday && ls.recoveryScore == null) {
        recoveryShapeChecks.push(`LIFT: scheduledToday=true but recoveryScore is null`);
      }
      if (ls.scheduledToday && !ls.hasActualDataToday && (ls.recoveryScore !== 0 || ls.recoveryConfidence !== "high")) {
        recoveryShapeChecks.push(`LIFT: scheduledToday+noData but recoveryScore=${ls.recoveryScore}, confidence=${ls.recoveryConfidence}`);
      }
      if (recoveryShapeChecks.length > 0) {
        console.warn(`[recovery-shape-violation] date=${date}:`, recoveryShapeChecks.join("; "));
      }

      res.json({
        ...result,
        sleepBlock,
        sleepTrending,
        adherence: {
          alignmentScore: sa?.alignmentScore ?? null,
          bedDevMin: sa?.bedDeviationMin ?? null,
          wakeDevMin: sa?.wakeDeviationMin ?? null,
          bedtimeDriftLateNights7d: drift.bedtimeDriftLateNights7d,
          wakeDriftEarlyNights7d: drift.wakeDriftEarlyNights7d,
          measuredNights7d: drift.measuredNights7d,
          bedtimeDriftNote: drift.bedtimeDriftNote,
          wakeDriftNote: drift.wakeDriftNote,
          trainingOverrunMin: dayAdh?.trainingOverrunMin ?? null,
          liftOverrunMin: dayAdh?.liftOverrunMin ?? null,
          actualCardioMin: dayAdh?.actualCardioMin ?? null,
          plannedCardioMin: dayAdh?.plannedCardioMin ?? 40,
          actualLiftMin: dayAdh?.actualLiftMin ?? null,
          plannedLiftMin: dayAdh?.plannedLiftMin ?? 75,
          mealAdherence: hasLogEntry ? {
            mealsChecked: mealsChecked.length,
            mealsTotal,
            earnedKcal,
            missedKcal,
            baselineHitPct,
            biggestMiss,
            mealDay,
          } : null,
        },
        primaryDriver,
        scheduleStability: schedStab,
        cardioBlock,
        liftBlock,
        placeholders: {
          mealTimingTracked: false,
        },
      });
    } catch (err: unknown) {
      console.error("readiness error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/readiness_audit", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      const sleepBlock = await computeSleepBlock(date, userId);
      const sa = sleepBlock?.sleepAlignment ?? null;

      const plannedBed = sa?.plannedBedTime ?? "21:45";
      const plannedWake = sa?.plannedWakeTime ?? "05:30";
      const actualBed = sa?.observedBedLocal ?? null;
      const actualWake = sa?.observedWakeLocal ?? null;

      const toMin = (t: string): number => {
        const s = t.trim();
        const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (ampm) {
          let h = parseInt(ampm[1], 10);
          const m = parseInt(ampm[2], 10);
          const period = ampm[3].toUpperCase();
          if (period === "AM" && h === 12) h = 0;
          if (period === "PM" && h !== 12) h += 12;
          return h * 60 + m;
        }
        const iso = s.match(/T(\d{2}):(\d{2})/);
        if (iso) return parseInt(iso[1], 10) * 60 + parseInt(iso[2], 10);
        const hm = s.match(/^(\d{1,2}):(\d{2})/);
        if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
        return 0;
      };
      const circDelta = (act: number, plan: number) => {
        let d = act - plan;
        while (d > 720) d -= 1440;
        while (d < -720) d += 1440;
        return d;
      };

      const plannedBedMin = toMin(plannedBed);
      const plannedWakeMin = toMin(plannedWake);
      const actualBedMin = actualBed ? toMin(actualBed) : null;
      const actualWakeMin = actualWake ? toMin(actualWake) : null;

      const bedDevRaw = actualBedMin != null ? circDelta(actualBedMin, plannedBedMin) : null;
      const wakeDevRaw = actualWakeMin != null ? circDelta(actualWakeMin, plannedWakeMin) : null;

      const bedPenalty = bedDevRaw != null ? Math.abs(bedDevRaw) : null;
      const wakePenalty = wakeDevRaw != null ? Math.abs(wakeDevRaw) : null;
      const totalPenalty = bedPenalty != null && wakePenalty != null
        ? Math.max(0, Math.min(180, bedPenalty + wakePenalty)) : null;
      const alignScore = totalPenalty != null
        ? Math.round(100 - (totalPenalty * (100 / 180))) : null;

      const schedStab = await computeScheduleStability(date, plannedBed, plannedWake, userId);

      const { rows: driftRows } = await pool.query(
        `SELECT day, actual_bed_time, actual_wake_time
         FROM daily_log
         WHERE user_id = $1 AND day <= $2
           AND day >= ($2::date - 21)::text
           AND actual_bed_time IS NOT NULL
           AND actual_wake_time IS NOT NULL
         ORDER BY day DESC
         LIMIT 14`,
        [userId, date],
      );

      const allDays = driftRows.map((r: any) => {
        const bd = circDelta(toMin(r.actual_bed_time), plannedBedMin);
        const wd = circDelta(toMin(r.actual_wake_time), plannedWakeMin);
        const mag = (Math.abs(bd) + Math.abs(wd)) / 2;
        return { date: r.day, bedDevMin: Math.round(bd * 100) / 100, wakeDevMin: Math.round(wd * 100) / 100, driftMag: Math.round(mag * 100) / 100 };
      });
      const last7 = allDays.slice(0, 7);

      const stddevPop = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
      };

      const mags7 = last7.map(d => d.driftMag);
      const sd = mags7.length >= 4 ? stddevPop(mags7) : null;
      const consistencyScore = sd != null ? Math.max(0, Math.min(100, Math.round(100 * (1 - sd / 60)))) : null;

      const allSorted = [...allDays].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      let eventIdx = -1;
      for (let i = allSorted.length - 1; i >= 0; i--) {
        if (allSorted[i].driftMag >= 45) { eventIdx = i; break; }
      }

      let recoveryAudit: any;
      if (eventIdx === -1) {
        recoveryAudit = {
          eventDetection: { threshold: 45, scannedDays: allSorted.length, found: false },
          eventIdx: null, eventDate: null, eventSizeMin: null,
          postEventDays: [], kDaysUsed: null, postEventAvgDevMin: null,
          recoveryScore: null, confidence: null,
        };
      } else {
        const ev = allSorted[eventIdx];
        const available = allSorted.slice(eventIdx + 1);
        const follow = available.slice(0, Math.min(4, available.length));
        const k = follow.length;
        const avgFollow = k > 0 ? follow.reduce((s, d) => s + d.driftMag, 0) / k : null;
        const improvement = avgFollow != null ? (ev.driftMag - avgFollow) / ev.driftMag : null;
        const rScore = improvement != null ? Math.max(0, Math.min(100, Math.round(100 * improvement))) : null;
        const conf: "full" | "low" | null = k >= 4 ? "full" : "low";

        recoveryAudit = {
          eventDetection: { threshold: 45, scannedDays: allSorted.length, found: true },
          eventIdx, eventDate: ev.date, eventSizeMin: ev.driftMag,
          postEventDays: follow.map(d => ({ date: d.date, driftMag: d.driftMag })),
          kDaysUsed: k, postEventAvgDevMin: avgFollow != null ? Math.round(avgFollow * 100) / 100 : null,
          recoveryScore: rScore, confidence: conf,
        };
      }

      const effFrac = sleepBlock?.sleepEfficiencyFrac ?? null;
      const effPct = sleepBlock?.sleepEfficiencyPct ?? null;
      const contFrac = sleepBlock?.sleepContinuityFrac ?? null;
      const contPct = sleepBlock?.sleepContinuityPct ?? null;

      const unitInvariants = {
        efficiency: {
          frac: effFrac,
          pct: effPct,
          pctFromFrac: effFrac != null ? effFrac * 100 : null,
          delta: (effFrac != null && effPct != null) ? Math.abs(effPct - effFrac * 100) : null,
          pass: (effFrac != null && effPct != null) ? Math.abs(effPct - effFrac * 100) < 0.01 : null,
        },
        continuity: {
          frac: contFrac,
          pct: contPct,
          pctFromFrac: contFrac != null ? contFrac * 100 : null,
          delta: (contFrac != null && contPct != null) ? Math.abs(contPct - contFrac * 100) : null,
          pass: (contFrac != null && contPct != null) ? Math.abs(contPct - contFrac * 100) < 0.01 : null,
        },
      };

      const uiPayload = {
        sleepAlignment: sa,
        scheduleStability: schedStab,
        sleepBlock_continuity: sleepBlock?.sleepContinuityFrac ?? null,
        sleepBlock_adequacy: sleepBlock?.sleepAdequacyScore ?? null,
        sleepBlock_efficiency: sleepBlock?.sleepEfficiencyFrac ?? null,
        sleepBlock_plannedSleepMin: sleepBlock?.plannedSleepMin ?? null,
        sleepBlock_awakeInBedMin: sleepBlock?.awakeInBedMin ?? null,
      };

      const sources = sleepBlock?.sources ?? null;

      res.json({
        date,
        inputs: {
          plannedBed, plannedWake,
          plannedBedMin, plannedWakeMin,
          actualBed, actualWake,
          actualBedMin, actualWakeMin,
        },
        sources: sources ?? {
          planBed: { value: null, source: "none" },
          planWake: { value: null, source: "none" },
          actualBed: { value: null, source: "none" },
          actualWake: { value: null, source: "none" },
          dataDay: date,
          tib: { valueMin: null, method: "none" },
          tst: { valueMin: null, method: "none" },
        },
        deviations: {
          bedDevMin_circularWrap: bedDevRaw,
          wakeDevMin_circularWrap: wakeDevRaw,
          formula: "circularDelta = actual - planned; while >720 subtract 1440; while <-720 add 1440",
        },
        alignment: {
          bedPenaltyMin: bedPenalty,
          wakePenaltyMin: wakePenalty,
          totalPenaltyMin: totalPenalty,
          alignmentScore: alignScore,
          formula: "bedPenalty=abs(bedDev), wakePenalty=abs(wakeDev), total=clamp(bed+wake, 0, 180), score=round(100 - total×100/180)",
        },
        consistency: {
          last7days: last7,
          driftMags7d: mags7,
          sdMin: sd != null ? Math.round(sd * 100) / 100 : null,
          nDays: last7.length,
          consistencyScore,
          formula: "driftMag=(abs(bedDev)+abs(wakeDev))/2, sd=stddevPop(mags), score=clamp(round(100×(1-sd/60)), 0, 100)",
        },
        recovery: recoveryAudit,
        unitInvariants,
        uiPayload,
      });
    } catch (err: unknown) {
      console.error("readiness_audit error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/readiness/range", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
      const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
      const results = await getReadinessRange(from, to, userId);
      res.json(results);
    } catch (err: unknown) {
      console.error("readiness range error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/training/template", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const template = await getTrainingTemplate(userId);
      res.json(template);
    } catch (err: unknown) {
      console.error("template get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/training/template", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { templateType, sessions } = req.body;
      if (!templateType || !Array.isArray(sessions)) {
        return res.status(400).json({ error: "templateType and sessions required" });
      }
      await updateTrainingTemplate(templateType, sessions, userId);
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error("template update error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/hpa", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      let result = await getHpaForDate(date, userId);
      if (!result || result.hpaScore == null) {
        const computed = await computeAndUpsertHpa(date, userId);
        if (computed) {
          result = { hpaScore: computed.score, suppressionFlag: computed.suppressionFlag, drivers: computed.drivers };
        }
      }
      if (!result || result.hpaScore == null) {
        return res.json({ hpaScore: null, suppressionFlag: false, drivers: null, hpaBucket: null, stateLabel: null, stateTooltipText: null });
      }
      const hrvPct = result.drivers?.hrv?.pct ?? null;
      const { hpaBucket: bucket, stateLabel } = classifyHpaHrv(result.hpaScore, hrvPct ?? 0);
      const showState = result.hpaScore >= 40 || (hrvPct != null && hrvPct <= -0.08);
      res.json({
        ...result,
        hpaBucket: bucket,
        stateLabel: showState ? stateLabel : null,
        stateTooltipText: showState ? stateTooltip(stateLabel) : null,
      });
    } catch (err: unknown) {
      console.error("hpa get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/hpa/range", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
      const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
      const results = await getHpaRange(from, to, userId);
      res.json(results);
    } catch (err: unknown) {
      console.error("hpa range error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/hpa/compute", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { date } = req.body;
      if (!date) return res.status(400).json({ error: "date required" });
      const result = await computeAndUpsertHpa(date, userId);
      res.json(result || { score: null, suppressionFlag: false, drivers: null });
    } catch (err: unknown) {
      console.error("hpa compute error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/signals/chart", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const days = Math.min(Number(req.query.days) || 30, 180);
      const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
      const fromDate = new Date(to);
      fromDate.setDate(fromDate.getDate() - days + 1);
      const from = fromDate.toISOString().slice(0, 10);

      const [hpaRows, readinessRows, logRows, sbRes] = await Promise.all([
        getHpaRange(from, to, userId),
        getReadinessRange(from, to, userId),
        pool.query(
          `SELECT day, morning_weight_lb, pushups_reps, pullups_reps,
                  bench_reps, bench_weight_lb, ohp_reps, ohp_weight_lb,
                  fat_free_mass_lb
           FROM daily_log WHERE user_id = $1 AND day >= $2 AND day <= $3
           ORDER BY day ASC`,
          [userId, from, to],
        ),
        pool.query(
          `SELECT exercise, baseline_value FROM strength_baselines WHERE user_id = $1`,
          [userId],
        ),
      ]);

      const sbMap: Record<string, number> = {};
      for (const r of sbRes.rows) sbMap[r.exercise] = Number(r.baseline_value);
      const strengthBaselines: StrengthBaselines = {
        pushups: sbMap.pushups ?? null,
        pullups: sbMap.pullups ?? null,
        benchBarReps: sbMap.bench_bar_reps ?? null,
        ohpBarReps: sbMap.ohp_bar_reps ?? null,
      };

      const { strengthVelocityOverTime } = await import("../lib/strength-index");
      const entries = logRows.rows.map((r: any) => ({
        day: typeof r.day === "string" ? r.day : (r.day as Date).toISOString().slice(0, 10),
        morningWeightLb: Number(r.morning_weight_lb),
        pushupsReps: r.pushups_reps != null ? Number(r.pushups_reps) : undefined,
        pullupsReps: r.pullups_reps != null ? Number(r.pullups_reps) : undefined,
        benchReps: r.bench_reps != null ? Number(r.bench_reps) : undefined,
        benchWeightLb: r.bench_weight_lb != null ? Number(r.bench_weight_lb) : undefined,
        ohpReps: r.ohp_reps != null ? Number(r.ohp_reps) : undefined,
        ohpWeightLb: r.ohp_weight_lb != null ? Number(r.ohp_weight_lb) : undefined,
        fatFreeMassLb: r.fat_free_mass_lb != null ? Number(r.fat_free_mass_lb) : undefined,
      })) as DailyEntry[];
      const svOverTime = strengthVelocityOverTime(entries, strengthBaselines);

      const hpaMap = new Map(hpaRows.map(h => [h.date, h.hpaScore]));
      const readinessMap = new Map(readinessRows.map((r: any) => [r.date, {
        score: r.readinessScore,
        hrvDelta: r.hrvDelta,
      }]));
      const svMap = new Map(svOverTime.map(s => [s.day, s.pctPerWeek]));

      const allDates = new Set<string>();
      hpaRows.forEach(h => allDates.add(h.date));
      readinessRows.forEach((r: any) => allDates.add(r.date));
      svOverTime.forEach(s => allDates.add(s.day));

      const sortedDates = [...allDates].sort();
      const points = sortedDates.map(date => {
        const rd = readinessMap.get(date);
        return {
          date,
          hpa: hpaMap.get(date) ?? null,
          hrvDeltaPct: rd?.hrvDelta != null ? Math.round(rd.hrvDelta * 10000) / 100 : null,
          readiness: rd?.score ?? null,
          strengthVelocity: svMap.get(date) ?? null,
        };
      });

      res.json({ from, to, days, points });
    } catch (err: unknown) {
      console.error("signals chart error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/settings/analysis-start-date", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const date = await getAnalysisStartDate(userId);
      res.json({ analysisStartDate: date });
    } catch (err: unknown) {
      console.error("get analysis start date error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/settings/analysis-start-date", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { date } = req.body;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Valid date (YYYY-MM-DD) required" });
      }
      await setAnalysisStartDate(date, userId);
      res.json({ ok: true, analysisStartDate: date });
    } catch (err: unknown) {
      console.error("set analysis start date error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/settings/rebaseline", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const days = Number(req.body?.days) || 60;
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - days);
      const newStart = d.toISOString().slice(0, 10);
      await setAnalysisStartDate(newStart, userId);

      const today = new Date().toISOString().slice(0, 10);
      recomputeReadinessRange(today, userId).catch((err: unknown) =>
        console.error("readiness recompute after rebaseline:", err)
      );

      res.json({ ok: true, analysisStartDate: newStart, recomputeTriggered: true });
    } catch (err: unknown) {
      console.error("rebaseline error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/data-sufficiency", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const result = await getDataSufficiency(userId);
      res.json(result);
    } catch (err: unknown) {
      console.error("data sufficiency error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/backup/export", requireAdmin, rateLimit(60000, 5), async (_req: Request, res: Response) => {
    try {
      const payload = await exportBackup();
      const filename = `bulk-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.json(payload);
    } catch (err: unknown) {
      console.error("backup export error:", err);
      res.status(500).json({ error: "Export failed" });
    }
  });

  app.post("/api/backup/import", requireAdmin, rateLimit(60000, 3), upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const mode = (req.body?.mode === "replace" ? "replace" : "merge") as "merge" | "replace";
      const dryRun = req.body?.dry_run === "true";

      let data;
      try {
        data = JSON.parse(req.file.buffer.toString("utf-8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON file" });
      }

      if (!data.metadata) {
        return res.status(400).json({ error: "Invalid backup: missing metadata" });
      }

      const result = await importBackup(data, mode, dryRun);
      res.json(result);
    } catch (err: unknown) {
      console.error("backup import error:", err);
      const message = err instanceof Error ? err.message : "Import failed";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/backfill-canonical", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT day, hrv, resting_hr, steps, active_zone_minutes, energy_burned_kcal,
                zone1_min, zone2_min, zone3_min, below_zone1_min,
                sleep_minutes, actual_bed_time, actual_wake_time,
                sleep_latency_min, sleep_waso_min, sleep_start, sleep_end
         FROM daily_log WHERE user_id = $1 ORDER BY day ASC`,
        [userId]
      );

      let vitalsCount = 0;
      let sleepCount = 0;

      for (const r of rows) {
        const hasVitals = r.hrv != null || r.resting_hr != null || r.steps != null;
        if (hasVitals) {
          await upsertVitalsDaily({
            date: r.day,
            user_id: userId,
            resting_hr_bpm: r.resting_hr != null ? Number(r.resting_hr) : null,
            hrv_rmssd_ms: r.hrv != null ? Number(r.hrv) : null,
            hrv_sdnn_ms: null,
            respiratory_rate_bpm: null,
            spo2_pct: null,
            skin_temp_delta_c: null,
            steps: r.steps != null ? Number(r.steps) : null,
            active_zone_minutes: r.active_zone_minutes != null ? Number(r.active_zone_minutes) : null,
            energy_burned_kcal: r.energy_burned_kcal != null ? Number(r.energy_burned_kcal) : null,
            zone1_min: r.zone1_min != null ? Number(r.zone1_min) : null,
            zone2_min: r.zone2_min != null ? Number(r.zone2_min) : null,
            zone3_min: r.zone3_min != null ? Number(r.zone3_min) : null,
            below_zone1_min: r.below_zone1_min != null ? Number(r.below_zone1_min) : null,
            source: "manual",
          });
          vitalsCount++;
        }

        const hasSleep = r.sleep_minutes != null || r.actual_bed_time != null || r.actual_wake_time != null;
        if (hasSleep) {
          const sleepMin = r.sleep_minutes != null ? Number(r.sleep_minutes) : null;
          const latency = r.sleep_latency_min != null ? Number(r.sleep_latency_min) : null;
          const waso = r.sleep_waso_min != null ? Number(r.sleep_waso_min) : null;
          const timeInBed = sleepMin != null ? sleepMin + (latency ?? 0) + (waso ?? 0) : null;
          const efficiency = sleepMin != null && timeInBed != null && timeInBed > 0
            ? Math.round((sleepMin / timeInBed) * 100) : null;

          await upsertSleepSummary({
            date: r.day,
            user_id: userId,
            sleep_start: r.actual_bed_time ?? r.sleep_start ?? null,
            sleep_end: r.actual_wake_time ?? r.sleep_end ?? null,
            total_sleep_minutes: sleepMin ?? 0,
            time_in_bed_minutes: timeInBed,
            awake_minutes: waso,
            rem_minutes: null,
            deep_minutes: null,
            light_or_core_minutes: null,
            sleep_efficiency: efficiency,
            sleep_latency_min: latency,
            waso_min: waso,
            source: "manual",
          });
          sleepCount++;
        }
      }

      res.json({ status: "ok", logsProcessed: rows.length, vitalsWritten: vitalsCount, sleepWritten: sleepCount });
    } catch (err: unknown) {
      console.error("backfill-canonical error:", err);
      res.status(500).json({ error: "Backfill failed" });
    }
  });

  app.post("/api/reset-database", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const confirm = req.body?.confirm;
      if (confirm !== "RESET_ALL_DATA") {
        return res.status(400).json({ error: "Must send { confirm: 'RESET_ALL_DATA' } to proceed" });
      }

      const userScopedTables = [
        "daily_log",
        "dashboard_cache",
        "erection_sessions",
        "erection_summary_snapshots",
        "androgen_proxy_daily",
        "vitals_daily",
        "sleep_summary_daily",
        "hrv_baseline_daily",
        "readiness_daily",
        "workout_session",
        "workout_hr_samples",
        "workout_rr_intervals",
        "workout_events",
        "muscle_weekly_load",
        "fitbit_imports",
        "fitbit_takeout_imports",
      ];

      const globalTables = [
        "fitbit_import_conflicts",
        "fitbit_import_file_contributions",
        "fitbit_daily_sources",
        "fitbit_sleep_bucketing",
        "sleep_import_diagnostics",
      ];

      const counts: Record<string, number> = {};
      for (const table of userScopedTables) {
        const result = await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
        counts[table] = result.rowCount ?? 0;
      }
      for (const table of globalTables) {
        const result = await pool.query(`DELETE FROM ${table}`);
        counts[table] = result.rowCount ?? 0;
      }

      const totalDeleted = Object.values(counts).reduce((sum, c) => sum + c, 0);
      console.log(`[RESET] User ${userId} wiped ${totalDeleted} rows across ${userScopedTables.length + globalTables.length} tables`);

      res.json({ status: "ok", totalDeleted, counts });
    } catch (err: unknown) {
      console.error("reset-database error:", err);
      res.status(500).json({ error: "Reset failed" });
    }
  });

  app.get("/api/sanity-check", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const date = req.query.date as string;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
      }

      const { rows: logRows } = await pool.query(
        `SELECT day, steps, cardio_min, active_zone_minutes, sleep_minutes,
                energy_burned_kcal, resting_hr, hrv,
                zone1_min, zone2_min, zone3_min, below_zone1_min,
                morning_weight_lb, waist_in, sleep_start, sleep_end,
                actual_bed_time, actual_wake_time, planned_bed_time, planned_wake_time,
                sleep_awake_min, sleep_rem_min, sleep_core_min, sleep_deep_min,
                sleep_latency_min, sleep_waso_min, nap_minutes
         FROM daily_log WHERE day = $1 AND user_id = $2`,
        [date, userId],
      );
      const dailyLog = logRows[0] ? snakeToCamel(logRows[0]) : null;

      const { rows: canonSleepRows } = await pool.query(
        `SELECT date, sleep_start, sleep_end, total_sleep_minutes, time_in_bed_minutes,
                sleep_efficiency, awake_minutes, rem_minutes, deep_minutes, light_or_core_minutes,
                sleep_latency_min, waso_min, source
         FROM sleep_summary_daily WHERE date = $1 AND user_id = $2`,
        [date, userId],
      );
      const canonSleep = canonSleepRows[0] ? snakeToCamel(canonSleepRows[0]) : null;

      let sleepBlockResult = null;
      try {
        sleepBlockResult = await computeSleepBlock(date, userId);
      } catch {}


      const { rows: sourceRows } = await pool.query(
        `SELECT metric, source, file_path, rows_consumed, value
         FROM fitbit_daily_sources WHERE date = $1 ORDER BY metric`,
        [date],
      );
      const fitbitSources: Record<string, unknown> = {};
      for (const r of sourceRows) {
        fitbitSources[r.metric] = {
          source: r.source,
          filePath: r.file_path,
          rowsConsumed: r.rows_consumed,
          value: r.value != null ? parseFloat(r.value) : null,
        };
      }

      const { rows: sleepBucketRows } = await pool.query(
        `SELECT sleep_end_raw, sleep_end_local, bucket_date, minutes, source
         FROM fitbit_sleep_bucketing WHERE date = $1`,
        [date],
      );

      const { rows: conflictRows } = await pool.query(
        `SELECT metric, csv_value, json_value, chosen_source
         FROM fitbit_import_conflicts WHERE date = $1`,
        [date],
      );

      const saBlock = sleepBlockResult?.sleepAlignment;
      let schedStabResult = null;
      try {
        schedStabResult = await computeScheduleStability(
          date,
          saBlock?.plannedBedTime ?? "21:45",
          saBlock?.plannedWakeTime ?? "05:30",
          userId,
        );
      } catch {}

      let readinessResult = null;
      try {
        readinessResult = await computeReadiness(date, userId);
      } catch {}

      const { rows: storedReadiness } = await pool.query(
        `SELECT * FROM readiness_daily WHERE date = $1::date AND user_id = $2`,
        [date, userId],
      );

      const sufficiency = await getDataSufficiency(userId);

      const { rows: proxyRows } = await pool.query(
        `SELECT date::text, proxy_score, computed_with_imputed
         FROM androgen_proxy_daily WHERE date = $1::date AND user_id = $2`,
        [date, userId],
      );

      res.json({
        date,
        section1_raw_imported: {
          fitbitSources,
          sleepBucketing: sleepBucketRows,
          conflicts: conflictRows,
        },
        section2_daily_log: dailyLog,
        section2b_canonical_sleep: canonSleep,
        section2c_sleep_block: sleepBlockResult ? {
          sleepAdequacyScore: sleepBlockResult.sleepAdequacyScore,
          sleepEfficiencyFrac: sleepBlockResult.sleepEfficiencyFrac,
          sleepEfficiencyPct: sleepBlockResult.sleepEfficiencyPct,
          sleepEfficiencyEst: sleepBlockResult.sleepEfficiencyEst,
          sleepContinuityFrac: sleepBlockResult.sleepContinuityFrac,
          sleepContinuityPct: sleepBlockResult.sleepContinuityPct,
          continuityDenominator: sleepBlockResult.continuityDenominator,
          unitInvariants: {
            efficiency: {
              delta: (sleepBlockResult.sleepEfficiencyFrac != null && sleepBlockResult.sleepEfficiencyPct != null)
                ? Math.abs(sleepBlockResult.sleepEfficiencyPct - sleepBlockResult.sleepEfficiencyFrac * 100) : null,
              pass: (sleepBlockResult.sleepEfficiencyFrac != null && sleepBlockResult.sleepEfficiencyPct != null)
                ? Math.abs(sleepBlockResult.sleepEfficiencyPct - sleepBlockResult.sleepEfficiencyFrac * 100) < 0.01 : null,
            },
            continuity: {
              delta: (sleepBlockResult.sleepContinuityFrac != null && sleepBlockResult.sleepContinuityPct != null)
                ? Math.abs(sleepBlockResult.sleepContinuityPct - sleepBlockResult.sleepContinuityFrac * 100) : null,
              pass: (sleepBlockResult.sleepContinuityFrac != null && sleepBlockResult.sleepContinuityPct != null)
                ? Math.abs(sleepBlockResult.sleepContinuityPct - sleepBlockResult.sleepContinuityFrac * 100) < 0.01 : null,
            },
          },
          plannedSleepMin: sleepBlockResult.plannedSleepMin,
          estimatedSleepMin: sleepBlockResult.estimatedSleepMin,
          timeInBedMin: sleepBlockResult.timeInBedMin,
          awakeInBedMin: sleepBlockResult.awakeInBedMin,
          fitbitSleepMinutes: sleepBlockResult.fitbitSleepMinutes,
          remMin: sleepBlockResult.remMin,
          deepMin: sleepBlockResult.deepMin,
          coreMin: sleepBlockResult.coreMin,
          awakeMin: sleepBlockResult.awakeMin,
          sleepAlignment: sleepBlockResult.sleepAlignment,
        } : null,
        section2d_schedule_stability: schedStabResult,
        section3_readiness_live: readinessResult ? {
          score: readinessResult.readinessScore,
          tier: readinessResult.readinessTier,
          confidence: readinessResult.confidenceGrade,
          cortisolFlag: readinessResult.cortisolFlag,
          signals: {
            hrv: { val7d: readinessResult.hrv7d, val28d: readinessResult.hrv28d, delta: readinessResult.hrvDelta },
            rhr: { val7d: readinessResult.rhr7d, val28d: readinessResult.rhr28d, delta: readinessResult.rhrDelta },
            sleep: { val7d: readinessResult.sleep7d, val28d: readinessResult.sleep28d, delta: readinessResult.sleepDelta },
            proxy: { val7d: readinessResult.proxy7d, val28d: readinessResult.proxy28d, delta: readinessResult.proxyDelta },
          },
          typeLean: readinessResult.typeLean,
          exerciseBias: readinessResult.exerciseBias,
          drivers: readinessResult.drivers,
          deltas: readinessResult.deltas,
          analysisStartDate: readinessResult.analysisStartDate,
          daysInWindow: readinessResult.daysInWindow,
          gate: readinessResult.gate,
        } : null,
        section4_stored_readiness: storedReadiness[0] ? snakeToCamel(storedReadiness[0]) : null,
        section5_sufficiency: sufficiency,
        section6_proxy: proxyRows[0] ? {
          proxyScore: parseFloat(proxyRows[0].proxy_score),
          computedWithImputed: proxyRows[0].computed_with_imputed,
        } : null,
      });
    } catch (err: unknown) {
      console.error("sanity-check error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/sleep-diagnostics/:date", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { date } = req.params;
      const { rows } = await pool.query(
        `SELECT * FROM sleep_import_diagnostics WHERE date = $1 OR bucket_date = $1 ORDER BY created_at DESC`,
        [date],
      );
      const { rows: validation } = await pool.query(
        `SELECT day, sleep_minutes FROM daily_log WHERE day = $1 AND user_id = $2`,
        [date, userId],
      );
      res.json({
        date,
        diagnosticRows: rows,
        dailyLogSleepMinutes: validation[0]?.sleep_minutes ?? null,
        bucketRule: "wake_date_local_time",
        notes: [
          "CSV: bucket = parseUTCTimestampToLocalDate(sleep_end, end_utc_offset) — uses row timestamp, NOT filename date",
          "JSON: bucket = parseFitbitEndTimeToWakeDate(endTime, timezone) — uses endTime field, NOT filename date",
          "Normal range: 240-600 min. Suspicious: <180 or >900 min.",
        ],
      });
    } catch (err: unknown) {
      console.error("sleep-diagnostics error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/sleep-alignment", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ error: "from and to required" });
      const { rows } = await pool.query(
        `SELECT day, sleep_minutes, sleep_start, sleep_end,
                sleep_start_local, sleep_end_local,
                sleep_plan_bedtime, sleep_plan_wake, tossed_minutes,
                sleep_efficiency, bedtime_deviation_min, wake_deviation_min, sleep_plan_alignment_score
         FROM daily_log
         WHERE day >= $1 AND day <= $2 AND user_id = $3 AND sleep_minutes IS NOT NULL
         ORDER BY day ASC`,
        [from, to, userId]
      );
      res.json(rows.map(r => ({
        day: r.day,
        sleepMinutes: r.sleep_minutes,
        sleepStart: r.sleep_start,
        sleepEnd: r.sleep_end,
        sleepStartLocal: r.sleep_start_local,
        sleepEndLocal: r.sleep_end_local,
        sleepPlanBedtime: r.sleep_plan_bedtime,
        sleepPlanWake: r.sleep_plan_wake,
        tossedMinutes: r.tossed_minutes,
        sleepEfficiency: r.sleep_efficiency != null ? parseFloat(r.sleep_efficiency) : null,
        bedtimeDeviationMin: r.bedtime_deviation_min,
        wakeDeviationMin: r.wake_deviation_min,
        alignmentScore: r.sleep_plan_alignment_score != null ? parseFloat(r.sleep_plan_alignment_score) : null,
      })));
    } catch (err: unknown) {
      console.error("sleep-alignment error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/sleep-plan", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const settings = await getSleepPlanSettings(userId);
      res.json(settings);
    } catch (err: unknown) {
      console.error("sleep-plan get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/sleep-plan", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { bedtime, wake } = req.body;
      if (!bedtime || !wake) return res.status(400).json({ error: "bedtime and wake required" });
      await setSleepPlanSettings(bedtime, wake, userId);
      res.json({ ok: true, bedtime, wake });
    } catch (err: unknown) {
      console.error("sleep-plan set error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/cardio-schedule", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT key, value FROM app_settings WHERE user_id = $1 AND key IN ('cardio_schedule_start', 'cardio_schedule_end', 'cardio_schedule_type')`,
        [userId]
      );
      const map = new Map<string, string>();
      for (const r of rows) map.set(r.key, r.value);
      res.json({
        start: map.get("cardio_schedule_start") || "06:00",
        end: map.get("cardio_schedule_end") || "06:40",
        type: map.get("cardio_schedule_type") || "Zone 2 Rebounder",
        plannedMin: (() => {
          const s = map.get("cardio_schedule_start") || "06:00";
          const e = map.get("cardio_schedule_end") || "06:40";
          const [sh, sm] = s.split(":").map(Number);
          const [eh, em] = e.split(":").map(Number);
          let d = (eh * 60 + em) - (sh * 60 + sm);
          if (d < 0) d += 1440;
          return d;
        })(),
      });
    } catch (err: unknown) {
      console.error("cardio-schedule get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/cardio-schedule", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { start, end, type } = req.body;
      if (!start || !end) return res.status(400).json({ error: "start and end times required" });
      const keys = [
        { key: "cardio_schedule_start", value: start },
        { key: "cardio_schedule_end", value: end },
        { key: "cardio_schedule_type", value: type || "Zone 2 Rebounder" },
      ];
      for (const { key, value } of keys) {
        await pool.query(
          `INSERT INTO app_settings (user_id, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, key) DO UPDATE SET value = $3`,
          [userId, key, value]
        );
      }
      res.json({ ok: true, start, end, type: type || "Zone 2 Rebounder" });
    } catch (err: unknown) {
      console.error("cardio-schedule set error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/lift-schedule", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT key, value FROM app_settings WHERE user_id = $1 AND key IN ('lift_schedule_start', 'lift_schedule_end', 'lift_schedule_type')`,
        [userId]
      );
      const map = new Map<string, string>();
      for (const r of rows) map.set(r.key, r.value);
      res.json({
        start: map.get("lift_schedule_start") || "17:00",
        end: map.get("lift_schedule_end") || "18:15",
        type: map.get("lift_schedule_type") || "Lift Session",
        plannedMin: (() => {
          const s = map.get("lift_schedule_start") || "17:00";
          const e = map.get("lift_schedule_end") || "18:15";
          const [sh, sm] = s.split(":").map(Number);
          const [eh, em] = e.split(":").map(Number);
          let d = (eh * 60 + em) - (sh * 60 + sm);
          if (d < 0) d += 1440;
          return d;
        })(),
      });
    } catch (err: unknown) {
      console.error("lift-schedule get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/lift-schedule", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { start, end, type } = req.body;
      if (!start || !end) return res.status(400).json({ error: "start and end times required" });
      const keys = [
        { key: "lift_schedule_start", value: start },
        { key: "lift_schedule_end", value: end },
        { key: "lift_schedule_type", value: type || "Lift Session" },
      ];
      for (const { key, value } of keys) {
        await pool.query(
          `INSERT INTO app_settings (user_id, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, key) DO UPDATE SET value = $3`,
          [userId, key, value]
        );
      }
      res.json({ ok: true, start, end, type: type || "Lift Session" });
    } catch (err: unknown) {
      console.error("lift-schedule set error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/sleep-samples/:date", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { date } = req.params;

      const { rows: csvRows } = await pool.query(
        `SELECT id, import_id, date, raw_start, raw_end, minutes_asleep,
                bucket_date, timezone_used, source_file, is_segment,
                is_main_sleep, suspicious, suspicion_reason, created_at
         FROM sleep_import_diagnostics
         WHERE date = $1 OR bucket_date = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [date],
      );

      const { rows: bucketRows } = await pool.query(
        `SELECT sleep_end_raw, sleep_end_local, bucket_date, minutes, source
         FROM fitbit_sleep_bucketing WHERE date = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [date],
      );

      const { rows: dailyLogRow } = await pool.query(
        `SELECT day, sleep_minutes, sleep_start, sleep_end,
                sleep_start_local, sleep_end_local,
                sleep_plan_bedtime, sleep_plan_wake, tossed_minutes,
                sleep_efficiency, bedtime_deviation_min, wake_deviation_min,
                sleep_plan_alignment_score
         FROM daily_log WHERE day = $1 AND user_id = $2`,
        [date, userId],
      );

      const csvSampleHeaders = [
        "id", "import_id", "date", "raw_start", "raw_end", "minutes_asleep",
        "bucket_date", "timezone_used", "source_file", "is_segment",
        "is_main_sleep", "suspicious", "suspicion_reason",
      ];

      const csvSamples = csvRows.map(r => ({
        headerRow: csvSampleHeaders.join(","),
        dataRow: csvSampleHeaders.map(h => r[h] ?? "").join(","),
        parsed: r,
      }));

      res.json({
        date,
        csvSamples,
        bucketingRecords: bucketRows,
        dailyLogState: dailyLogRow[0] ? snakeToCamel(dailyLogRow[0]) : null,
        bucketRule: "wake_date_local_time",
        fieldSelection: {
          sleepMinutes: "fitbit_sleep_bucketing.minutes (CSV-preferred, COALESCE preserves manual entries)",
          sleepStart: "CSV: start_time column; JSON: startTime field",
          sleepEnd: "CSV: end_time column; JSON: endTime field",
          timezone: "CSV: end_utc_offset parsed; JSON: timezone field from timeZone",
          bucket: "wake-date in LOCAL time (not UTC)",
        },
        parsingNotes: [
          "CSV monthly shard: sleep_*.csv — end_time + end_utc_offset -> local wake date",
          "JSON daily file: sleep-*.json — endTime + timezone -> local wake date",
          "CSV takes priority when both sources exist (COALESCE upsert)",
          "Segments (is_segment=true) are skipped; only main sleep used",
          "Normal range: 240-600 min. Suspicious: <180 or >900 min flagged",
        ],
      });
    } catch (err: unknown) {
      console.error("sleep-samples error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Fitbit OAuth 2.0 ───────────────────────────────────────────
  const FITBIT_AUTH_URL = "https://www.fitbit.com/oauth2/authorize";
  const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";
  const FITBIT_SCOPES = "activity heartrate sleep profile";
  const oauthStates = new Map<string, number>();

  function fitbitBasicAuth(): string {
    const id = process.env.FITBIT_CLIENT_ID ?? "";
    const secret = process.env.FITBIT_CLIENT_SECRET ?? "";
    return Buffer.from(`${id}:${secret}`).toString("base64");
  }

  async function refreshFitbitTokenIfNeeded(userId = 1): Promise<string | null> {
    const row = (await pool.query(
      `SELECT access_token, refresh_token, expires_at FROM fitbit_oauth_tokens WHERE user_id = $1`,
      [userId]
    )).rows[0];
    if (!row) return null;
    const now = Math.floor(Date.now() / 1000);
    if (row.expires_at > now + 60) return row.access_token;
    try {
      const resp = await fetch(FITBIT_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${fitbitBasicAuth()}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: row.refresh_token,
        }),
      });
      if (!resp.ok) {
        console.error("Fitbit token refresh failed:", await resp.text());
        return null;
      }
      const data = await resp.json() as {
        access_token: string; refresh_token: string;
        expires_in: number; scope: string; token_type: string;
      };
      const expiresAt = now + data.expires_in;
      await pool.query(
        `UPDATE fitbit_oauth_tokens
         SET access_token = $1, refresh_token = $2, expires_at = $3,
             scope = $4, token_type = $5, updated_at = NOW()
         WHERE user_id = $6`,
        [data.access_token, data.refresh_token, expiresAt, data.scope, data.token_type, userId]
      );
      return data.access_token;
    } catch (err) {
      console.error("Fitbit token refresh error:", err);
      return null;
    }
  }

  app.get("/api/auth/fitbit/start", (_req: Request, res: Response) => {
    const clientId = process.env.FITBIT_CLIENT_ID;
    const redirectUri = process.env.FITBIT_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return res.status(500).json({ error: "Fitbit OAuth not configured" });
    }
    const state = crypto.randomBytes(16).toString("hex");
    oauthStates.set(state, Date.now());
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: FITBIT_SCOPES,
      state,
    });
    res.redirect(`${FITBIT_AUTH_URL}?${params.toString()}`);
  });

  app.get("/api/auth/fitbit/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string };
      if (!state || !oauthStates.has(state)) {
        return res.status(400).send("Invalid or missing state parameter");
      }
      oauthStates.delete(state);
      if (!code) {
        return res.status(400).send("Missing authorization code");
      }
      const redirectUri = process.env.FITBIT_REDIRECT_URI ?? "";
      const resp = await fetch(FITBIT_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${fitbitBasicAuth()}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        console.error("Fitbit token exchange failed:", body);
        return res.status(502).send("Failed to exchange code for tokens");
      }
      const data = await resp.json() as {
        access_token: string; refresh_token: string;
        expires_in: number; scope: string; token_type: string; user_id: string;
      };
      const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
      await pool.query(
        `INSERT INTO fitbit_oauth_tokens (user_id, access_token, refresh_token, expires_at, scope, token_type, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           access_token = $1, refresh_token = $2, expires_at = $3,
           scope = $4, token_type = $5, updated_at = NOW()`,
        [data.access_token, data.refresh_token, expiresAt, data.scope, data.token_type]
      );
      res.redirect("/?fitbit=connected");
    } catch (err) {
      console.error("Fitbit callback error:", err);
      res.status(500).send("Internal server error during OAuth callback");
    }
  });

  app.get("/api/auth/fitbit/status", async (_req: Request, res: Response) => {
    try {
      const row = (await pool.query(
        `SELECT expires_at, scope, updated_at FROM fitbit_oauth_tokens WHERE user_id = 1`
      )).rows[0];
      if (!row) {
        return res.json({ connected: false });
      }
      const now = Math.floor(Date.now() / 1000);
      res.json({
        connected: true,
        expired: row.expires_at <= now,
        lastRefresh: row.updated_at,
        scope: row.scope,
      });
    } catch (err) {
      console.error("Fitbit status error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/fitbit/disconnect", async (_req: Request, res: Response) => {
    try {
      await pool.query(`DELETE FROM fitbit_oauth_tokens WHERE user_id = 1`);
      res.json({ ok: true });
    } catch (err) {
      console.error("Fitbit disconnect error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Canonical Health API ──

  app.get("/api/canonical/vitals", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getVitalsDailyRange(start, end, userId);
      res.json(rows);
    } catch (err) {
      console.error("canonical vitals error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/vitals", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const v = req.body as VitalsDaily;
      if (!v.date || !v.source) {
        return res.status(400).json({ error: "date and source required" });
      }
      v.user_id = userId;
      await upsertVitalsDaily(v);
      res.json({ ok: true, date: v.date });
    } catch (err) {
      console.error("canonical vitals upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/sleep", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getSleepSummaryRange(start, end, userId);
      res.json(rows);
    } catch (err) {
      console.error("canonical sleep error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/sleep", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const s = req.body as SleepSummary;
      if (!s.date || s.total_sleep_minutes == null || !s.source) {
        return res.status(400).json({ error: "date, total_sleep_minutes, and source required" });
      }
      s.user_id = userId;
      await upsertSleepSummary(s);
      res.json({ ok: true, date: s.date });
    } catch (err) {
      console.error("canonical sleep upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/workouts", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getWorkoutSessions(start, end, userId);
      res.json(rows);
    } catch (err) {
      console.error("canonical workouts error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const w = req.body as WorkoutSession;
      if (!w.session_id || !w.date || !w.start_ts || !w.source) {
        return res.status(400).json({ error: "session_id, date, start_ts, and source required" });
      }
      w.user_id = userId;
      const { strainScore, typeTag } = computeSessionStrain(
        w.avg_hr, w.max_hr, w.duration_minutes, w.workout_type || "other"
      );
      w.session_strain_score = w.session_strain_score ?? strainScore;
      w.session_type_tag = w.session_type_tag ?? typeTag;
      const biases = computeSessionBiases(w.workout_type || "other", w.avg_hr, w.max_hr, w.duration_minutes);
      w.strength_bias = w.strength_bias ?? biases.strength_bias;
      w.cardio_bias = w.cardio_bias ?? biases.cardio_bias;
      w.pre_session_rmssd = w.pre_session_rmssd ?? null;
      w.suppression_depth_pct = w.suppression_depth_pct ?? null;
      w.rebound_bpm_per_min = w.rebound_bpm_per_min ?? null;
      w.baseline_window_seconds = w.baseline_window_seconds ?? 120;
      await upsertWorkoutSession(w);
      res.json({ ok: true, session_id: w.session_id, strain: strainScore, typeTag, ...biases });
    } catch (err) {
      console.error("canonical workout upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/:sessionId/analyze-hrv", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sessionId = req.params.sessionId as string;
      const result = await analyzeSessionHrv(sessionId, userId);
      res.json({ ok: true, session_id: sessionId, ...result });
    } catch (err: any) {
      console.error("session hrv analysis error:", err);
      if (err.message?.includes("not found")) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/workouts/:sessionId/hr", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sessionId = req.params.sessionId as string;
      const rows = await getHrSamplesForSession(sessionId, userId);
      res.json(rows);
    } catch (err) {
      console.error("canonical hr samples error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/:sessionId/hr", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sessionId = req.params.sessionId as string;
      const samples = req.body as WorkoutHrSample[];
      if (!Array.isArray(samples)) {
        return res.status(400).json({ error: "expected array of hr samples" });
      }
      const tagged = samples.map(s => ({ ...s, session_id: sessionId }));
      const count = await batchUpsertHrSamples(tagged, userId);
      res.json({ ok: true, count });
    } catch (err) {
      console.error("canonical hr samples upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/workouts/:sessionId/rr", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sessionId = req.params.sessionId as string;
      const rows = await getRrIntervalsForSession(sessionId, userId);
      res.json(rows);
    } catch (err) {
      console.error("canonical rr intervals error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/:sessionId/rr", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sessionId = req.params.sessionId as string;
      const intervals = req.body as WorkoutRrInterval[];
      if (!Array.isArray(intervals)) {
        return res.status(400).json({ error: "expected array of rr intervals" });
      }
      const tagged = intervals.map(r => ({ ...r, session_id: sessionId }));
      const count = await batchUpsertRrIntervals(tagged, userId);
      res.json({ ok: true, count });
    } catch (err) {
      console.error("canonical rr intervals upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/hrv-baseline", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getHrvBaselineRange(start, end, userId);
      res.json(rows);
    } catch (err) {
      console.error("canonical hrv baseline error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/hrv-baseline/recompute", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const start = (req.body.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.body.end as string) || new Date().toISOString().slice(0, 10);
      const count = await recomputeHrvBaselines(start, end, userId);
      res.json({ ok: true, daysComputed: count });
    } catch (err) {
      console.error("canonical hrv recompute error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Phase 2 spec-exact endpoints ───

  app.post("/api/canonical/sleep/upsert", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const p = req.body;
      if (!p.date || p.total_sleep_minutes == null || !p.source) {
        return res.status(400).json({ error: "date, total_sleep_minutes, and source required" });
      }
      const validation = validateSleepSummaryInput(p);
      if (!validation.ok) {
        return res.status(400).json({ error: "Validation failed", details: validation.errors });
      }
      const s: SleepSummary = {
        user_id: userId,
        date: p.date,
        sleep_start: p.sleep_start ? ensureUTCTimestamp(p.sleep_start) : null,
        sleep_end: p.sleep_end ? ensureUTCTimestamp(p.sleep_end) : null,
        total_sleep_minutes: p.total_sleep_minutes,
        time_in_bed_minutes: p.time_in_bed_minutes ?? null,
        awake_minutes: p.awake_minutes ?? null,
        rem_minutes: p.rem_minutes ?? null,
        deep_minutes: p.deep_minutes ?? null,
        light_or_core_minutes: p.light_or_core_minutes ?? null,
        sleep_efficiency: p.sleep_efficiency ?? null,
        sleep_latency_min: p.sleep_latency_min ?? null,
        waso_min: p.waso_min ?? null,
        source: p.source,
        timezone: p.timezone ?? null,
      };
      await upsertSleepSummary(s);
      res.json({ ok: true, date: s.date, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error("sleep upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/vitals/upsert", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const p = req.body;
      if (!p.date || !p.source) {
        return res.status(400).json({ error: "date and source required" });
      }
      const validation = validateVitalsDailyInput(p);
      if (!validation.ok) {
        return res.status(400).json({ error: "Validation failed", details: validation.errors });
      }
      const v: VitalsDaily = {
        user_id: userId,
        date: p.date,
        resting_hr_bpm: p.resting_hr ?? null,
        hrv_rmssd_ms: p.hrv_rmssd_ms ?? null,
        hrv_sdnn_ms: p.hrv_sdnn_ms ?? null,
        respiratory_rate_bpm: p.respiratory_rate ?? null,
        spo2_pct: p.spo2 ?? null,
        skin_temp_delta_c: null,
        steps: p.steps ?? null,
        active_zone_minutes: null,
        energy_burned_kcal: p.active_energy_kcal ?? null,
        zone1_min: null,
        zone2_min: null,
        zone3_min: null,
        below_zone1_min: null,
        source: p.source,
        timezone: p.timezone ?? null,
      };
      await upsertVitalsDaily(v);
      if (v.hrv_sdnn_ms != null || v.hrv_rmssd_ms != null) {
        try { await recomputeHrvBaselines(v.date, v.date, userId); } catch {}
      }
      res.json({ ok: true, date: v.date, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error("vitals upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/upsert-session", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const p = req.body;
      if (!p.session_id || !p.start_ts || !p.source) {
        return res.status(400).json({ error: "session_id, start_ts, and source are required" });
      }
      const validation = validateWorkoutSessionInput(p);
      if (!validation.ok) {
        return res.status(400).json({ error: "Validation failed", details: validation.errors });
      }
      const wt = p.workout_type || "other";
      const derivedDate = p.date || toUTCDateString(p.start_ts, p.timezone);
      const w: WorkoutSession = {
        user_id: userId,
        session_id: p.session_id,
        date: derivedDate,
        start_ts: ensureUTCTimestamp(p.start_ts),
        end_ts: p.end_ts ? ensureUTCTimestamp(p.end_ts) : null,
        workout_type: wt,
        duration_minutes: p.end_ts && p.start_ts
          ? Math.round((new Date(p.end_ts).getTime() - new Date(p.start_ts).getTime()) / 60000 * 10) / 10
          : null,
        avg_hr: null,
        max_hr: null,
        calories_burned: p.calories_burned ?? null,
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
        baseline_window_seconds: 120,
        time_to_recovery_sec: null,
        source: p.source,
        timezone: p.timezone ?? null,
      };
      if (p.end_ts) {
        const { strainScore, typeTag } = computeSessionStrain(null, null, w.duration_minutes, wt);
        w.session_strain_score = strainScore;
        w.session_type_tag = typeTag;
        const biases = computeSessionBiases(wt, null, null, w.duration_minutes);
        w.strength_bias = biases.strength_bias;
        w.cardio_bias = biases.cardio_bias;
      }
      await upsertWorkoutSession(w);
      res.json({ ok: true, session_id: w.session_id } as { ok: true; session_id: string });
    } catch (err) {
      console.error("workout session upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/hr-samples/upsert-bulk", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const p = req.body;
      if (!p.session_id || !p.source || !Array.isArray(p.samples)) {
        return res.status(400).json({ error: "session_id, source, and samples[] required" });
      }
      const validation = validateHrSamples(p.samples);
      if (!validation.ok) {
        return res.status(400).json({ error: "Validation failed", details: validation.errors.slice(0, 10) });
      }
      const tagged: WorkoutHrSample[] = p.samples.map((s: any) => ({
        session_id: p.session_id,
        ts: ensureUTCTimestamp(s.ts),
        hr_bpm: s.hr_bpm,
        source: p.source,
      }));
      const count = await batchUpsertHrSamples(tagged, userId);
      res.json({ ok: true, session_id: p.session_id, inserted_or_updated: count });
    } catch (err) {
      console.error("hr samples bulk upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/rr-intervals/upsert-bulk", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const p = req.body;
      if (!p.session_id || !p.source || !Array.isArray(p.intervals)) {
        return res.status(400).json({ error: "session_id, source, and intervals[] required" });
      }
      const validation = validateRrIntervals(p.intervals);
      if (!validation.ok) {
        return res.status(400).json({ error: "Validation failed", details: validation.errors.slice(0, 10) });
      }
      const tagged: WorkoutRrInterval[] = p.intervals.map((r: any) => ({
        session_id: p.session_id,
        ts: ensureUTCTimestamp(r.ts),
        rr_ms: r.rr_ms,
        source: p.source,
      }));
      const count = await batchUpsertRrIntervals(tagged, userId);
      res.json({ ok: true, session_id: p.session_id, inserted_or_updated: count });
    } catch (err) {
      console.error("rr intervals bulk upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── End Phase 2 endpoints ───

  app.get("/api/canonical/summary", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows: vitalsCount } = await pool.query(`SELECT COUNT(*) as count FROM vitals_daily WHERE user_id = $1`, [userId]);
      const { rows: sleepCount } = await pool.query(`SELECT COUNT(*) as count FROM sleep_summary_daily WHERE user_id = $1`, [userId]);
      const { rows: workoutCount } = await pool.query(`SELECT COUNT(*) as count FROM workout_session WHERE user_id = $1`, [userId]);
      const { rows: hrvCount } = await pool.query(`SELECT COUNT(*) as count FROM hrv_baseline_daily WHERE user_id = $1`, [userId]);
      const { rows: sources } = await pool.query(
        `SELECT DISTINCT source FROM vitals_daily WHERE user_id = $1 UNION SELECT DISTINCT source FROM sleep_summary_daily WHERE user_id = $1`,
        [userId],
      );
      res.json({
        vitals_days: Number(vitalsCount[0].count),
        sleep_days: Number(sleepCount[0].count),
        workout_sessions: Number(workoutCount[0].count),
        hrv_baseline_days: Number(hrvCount[0].count),
        sources: sources.map((s: any) => s.source).filter(Boolean),
      });
    } catch (err) {
      console.error("canonical summary error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Workout Engine API ──

  app.post("/api/workout/start", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { readinessScore, sessionId, workoutType } = req.body;
      if (readinessScore == null || !sessionId) {
        return res.status(400).json({ error: "readinessScore and sessionId are required" });
      }
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      await upsertWorkoutSession({
        user_id: userId,
        session_id: sessionId,
        date: dateStr,
        start_ts: now.toISOString(),
        end_ts: null,
        workout_type: workoutType || "strength",
        duration_minutes: null,
        avg_hr: null,
        max_hr: null,
        calories_burned: null,
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
        source: "app",
        timezone: null,
      });
      const state = initWorkoutState(sessionId, readinessScore);
      await persistWorkoutEvent(sessionId, { t: Date.now(), type: "SESSION_START" }, state.cbpStart, state.cbpCurrent, 0, userId);
      res.json({ ...state, start_ts: now.toISOString() });
    } catch (err) {
      console.error("workout start error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/workout/:sessionId/set", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sessionId = req.params.sessionId as string;
      const { muscle, rpe, isCompound, cbpCurrent, compoundSets, isolationSets, phase, strainPoints } = req.body;
      if (!muscle) return res.status(400).json({ error: "muscle is required" });

      const state = {
        session_id: sessionId,
        phase: phase || "COMPOUND" as const,
        cbpStart: cbpCurrent ?? 100,
        cbpCurrent: cbpCurrent ?? 100,
        strainPoints: strainPoints ?? 0,
        compoundSets: compoundSets ?? 0,
        isolationSets: isolationSets ?? 0,
        setLog: [],
      };

      const event: WorkoutEvent = {
        t: Date.now(),
        type: "SET_COMPLETE",
        muscle: muscle as MuscleGroup,
        rpe: rpe ?? undefined,
        isCompound: isCompound ?? (state.phase === "COMPOUND"),
      };

      const cbpBefore = state.cbpCurrent;
      const updatedState = applyEvent(state, event);
      const drain = cbpBefore - updatedState.cbpCurrent;

      await persistWorkoutEvent(sessionId, event, cbpBefore, updatedState.cbpCurrent, drain, userId);

      const today = new Date().toISOString().slice(0, 10);
      const weekStart = getWeekStart(today);
      await incrementMuscleLoad(muscle as MuscleGroup, weekStart, 1, (rpe ?? 7) >= 7, userId);

      res.json(updatedState);
    } catch (err) {
      console.error("workout set error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/workout/:sessionId/next-prompt", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sessionId = req.params.sessionId as string;
      const events = await getWorkoutEvents(sessionId, userId);

      let phase: "COMPOUND" | "ISOLATION" = "COMPOUND";
      let cbpCurrent = 100;
      let cbpStart = 100;
      let compoundSets = 0;
      let isolationSets = 0;
      let readinessScore = 75;

      for (const ev of events) {
        if (ev.cbp_after != null) cbpCurrent = ev.cbp_after;
        if (ev.cbp_before != null && ev.event_type === "SESSION_START") {
          cbpStart = ev.cbp_before;
          readinessScore = Math.round(100 * Math.pow(ev.cbp_before / 100, 1 / 1.4));
        }
      }

      const setEvents = events.filter((e: any) => e.event_type === "SET_COMPLETE");
      compoundSets = setEvents.filter((e: any) => {
        try { return JSON.parse(e.event_data || "{}").isCompound; } catch { return false; }
      }).length;
      isolationSets = setEvents.length - compoundSets;

      if (cbpCurrent <= 25 || (compoundSets >= 8 && cbpCurrent <= 40)) {
        phase = "ISOLATION";
      }

      const today = new Date().toISOString().slice(0, 10);
      const weekStart = getWeekStart(today);
      const loads = await getWeeklyLoads(weekStart, userId);

      const ctx: ProgramContext = {
        dayType: "FULL_BODY",
        priority: [],
        weeklyTargetSets: DEFAULT_WEEKLY_TARGETS,
      };
      const targets = pickIsolationTargets(readinessScore, loads, ctx, 3);

      let promptTitle: string;
      let promptBody: string;
      let recommendedMuscles: string[];
      let stopRule: string | undefined;

      if (phase === "COMPOUND") {
        const setsLeft = Math.max(1, Math.floor(cbpCurrent / 10));
        promptTitle = "Compounds available";
        promptBody = `You have budget for ~${setsLeft} more compound sets. Focus on large muscle groups for maximum stimulus.`;
        const compoundOptions: MuscleGroup[] = ["chest_upper", "chest_mid", "back_lats", "back_upper", "quads", "hamstrings", "glutes"];
        const deficits = compoundOptions
          .map(m => ({ m, deficit: (DEFAULT_WEEKLY_TARGETS[m] || 10) - (loads[m] || 0) }))
          .sort((a, b) => b.deficit - a.deficit);
        recommendedMuscles = deficits.slice(0, 3).map(d => d.m);
        if (cbpCurrent <= 40) {
          stopRule = `CBP is low (${Math.round(cbpCurrent)}). Switch to isolation after next set if RPE >= 8.`;
        }
      } else {
        promptTitle = "Isolation phase";
        promptBody = `Compound budget depleted. Focus on isolation movements to fill weekly volume gaps.`;
        recommendedMuscles = targets.length > 0 ? targets : ["biceps", "triceps", "delts_side"];
        stopRule = `End session if total strain feels excessive or RPE consistently >= 9.`;
      }

      res.json({
        phase,
        prompt_title: promptTitle,
        prompt_body: promptBody,
        recommended_muscles: recommendedMuscles,
        stop_rule: stopRule,
        cbp_current: Math.round(cbpCurrent),
        cbp_start: cbpStart,
        compound_sets: compoundSets,
        isolation_sets: isolationSets,
      });
    } catch (err) {
      console.error("next-prompt error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/workout/:sessionId/events", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const events = await getWorkoutEvents(req.params.sessionId as string, userId);
      res.json(events);
    } catch (err) {
      console.error("workout events error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/workout/cbp", async (req: Request, res: Response) => {
    try {
      const { readinessScore } = req.body;
      if (readinessScore == null) return res.status(400).json({ error: "readinessScore is required" });
      const cbp = compoundBudgetPoints(readinessScore);
      res.json({ readinessScore, compoundBudgetPoints: cbp });
    } catch (err) {
      console.error("cbp error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Muscle Planner API ──

  app.get("/api/muscle/weekly-load", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const weekStart = getWeekStart(date);
      const summary = await getWeeklyLoadSummary(weekStart, userId);
      res.json({ weekStart, ...summary });
    } catch (err) {
      console.error("weekly load error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/muscle/isolation-targets", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { readinessScore, dayType, priority, count } = req.body;
      if (readinessScore == null || !dayType) {
        return res.status(400).json({ error: "readinessScore and dayType are required" });
      }
      const today = new Date().toISOString().slice(0, 10);
      const weekStart = getWeekStart(today);
      const loads = await getWeeklyLoads(weekStart, userId);

      const ctx: ProgramContext = {
        dayType: dayType,
        priority: priority || [],
        weeklyTargetSets: DEFAULT_WEEKLY_TARGETS,
      };

      const targets = pickIsolationTargets(readinessScore, loads, ctx, count || 3);
      const fallback = fallbackIsolation(dayType);

      res.json({ targets, fallback, weekStart, currentLoads: loads, readinessScore });
    } catch (err) {
      console.error("isolation targets error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/muscle/targets", async (_req: Request, res: Response) => {
    res.json(DEFAULT_WEEKLY_TARGETS);
  });

  app.get("/api/day-state", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const start = req.query.start as string;
      const end = req.query.end as string;
      if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return res.status(400).json({ error: "start query param required (YYYY-MM-DD)" });
      }
      if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return res.status(400).json({ error: "end query param required (YYYY-MM-DD)" });
      }
      const [marks, adherenceMap] = await Promise.all([
        classifyDayRange(start, end, userId),
        computeRangeAdherence(start, end, userId),
      ]);
      const enriched = marks.map((m: any) => {
        const adh = adherenceMap.get(m.date);
        return {
          ...m,
          adherence: adh ?? {
            bedtimeDriftLateNights7d: 0,
            bedtimeDriftMeasuredNights7d: 0,
            wakeDriftEarlyNights7d: 0,
            wakeDriftMeasuredNights7d: 0,
            trainingAdherenceScore: null,
            trainingAdherenceAvg7d: null,
            trainingOverrunMin: null,
            liftOverrunMin: null,
            actualCardioMin: null,
            plannedCardioMin: 40,
            actualLiftMin: null,
            plannedLiftMin: 75,
            mealTimingAdherenceScore: null,
            mealTimingAdherenceAvg7d: null,
            mealTimingTracked: false,
          },
        };
      });
      res.json(enriched);
    } catch (err: unknown) {
      console.error("day-state error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/data-sources", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const sourceCounts = await pool.query(`
        SELECT source, COUNT(*) as count, MAX(updated_at) as last_sync
        FROM workout_session
        WHERE user_id = $1
        GROUP BY source
      `, [userId]);
      const vitalsCounts = await pool.query(`
        SELECT source, COUNT(*) as count, MAX(updated_at) as last_sync
        FROM vitals_daily
        WHERE user_id = $1
        GROUP BY source
      `, [userId]);
      const sleepCounts = await pool.query(`
        SELECT source, COUNT(*) as count, MAX(updated_at) as last_sync
        FROM sleep_summary_daily
        WHERE user_id = $1
        GROUP BY source
      `, [userId]);

      const sources: Record<string, { workouts: number; vitals: number; sleep: number; lastSync: string | null }> = {};
      for (const row of sourceCounts.rows) {
        if (!sources[row.source]) sources[row.source] = { workouts: 0, vitals: 0, sleep: 0, lastSync: null };
        sources[row.source].workouts = parseInt(row.count);
        if (row.last_sync) sources[row.source].lastSync = row.last_sync;
      }
      for (const row of vitalsCounts.rows) {
        if (!sources[row.source]) sources[row.source] = { workouts: 0, vitals: 0, sleep: 0, lastSync: null };
        const vs = sources[row.source]!;
        vs.vitals = parseInt(row.count);
        if (row.last_sync && (!vs.lastSync || row.last_sync > vs.lastSync))
          vs.lastSync = row.last_sync;
      }
      for (const row of sleepCounts.rows) {
        if (!sources[row.source]) sources[row.source] = { workouts: 0, vitals: 0, sleep: 0, lastSync: null };
        const ss = sources[row.source]!;
        ss.sleep = parseInt(row.count);
        if (row.last_sync && (!ss.lastSync || row.last_sync > ss.lastSync))
          ss.lastSync = row.last_sync;
      }

      const adapters = [
        { id: "fitbit", name: "Fitbit", status: sources["fitbit"] ? "connected" : "available", ...sources["fitbit"] },
        { id: "healthkit", name: "Apple Health", status: sources["healthkit"] ? "connected" : "requires_build", ...sources["healthkit"] },
        { id: "polar", name: "Polar", status: sources["polar"] || sources["polar_ble"] ? "connected" : "requires_build",
          workouts: (sources["polar"]?.workouts ?? 0) + (sources["polar_ble"]?.workouts ?? 0),
          vitals: (sources["polar"]?.vitals ?? 0) + (sources["polar_ble"]?.vitals ?? 0),
          sleep: (sources["polar"]?.sleep ?? 0) + (sources["polar_ble"]?.sleep ?? 0),
          lastSync: sources["polar"]?.lastSync ?? sources["polar_ble"]?.lastSync ?? null,
        },
        { id: "manual", name: "Manual Entry", status: "connected",
          workouts: sources["manual"]?.workouts ?? sources["smoke_test"]?.workouts ?? sources["unknown"]?.workouts ?? 0,
          vitals: sources["manual"]?.vitals ?? sources["unknown"]?.vitals ?? 0,
          sleep: sources["manual"]?.sleep ?? sources["unknown"]?.sleep ?? 0,
          lastSync: sources["manual"]?.lastSync ?? sources["unknown"]?.lastSync ?? null,
        },
      ];

      res.json({ ok: true, sources: adapters });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Macro Presets API ──

  app.get("/api/presets", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT * FROM macro_presets WHERE user_id = $1 ORDER BY name ASC`,
        [userId]
      );
      res.json(rows.map(snakeToCamel));
    } catch (err) {
      console.error("presets list error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/presets/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT * FROM macro_presets WHERE user_id = $1 AND id = $2`,
        [userId, req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Preset not found" });
      res.json(snakeToCamel(rows[0]));
    } catch (err) {
      console.error("preset detail error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/presets", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const p = req.body;
      if (!p.id || !p.name || p.calories == null) {
        return res.status(400).json({ error: "id, name, and calories required" });
      }
      await pool.query(
        `INSERT INTO macro_presets (id, user_id, name, locked, calories, protein_g, carbs_g, fat_g, items, adjust_priority, cardio_fuel, checklist, meal_slots)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (user_id, id) DO UPDATE SET
           name = EXCLUDED.name,
           calories = EXCLUDED.calories,
           protein_g = EXCLUDED.protein_g,
           carbs_g = EXCLUDED.carbs_g,
           fat_g = EXCLUDED.fat_g,
           items = EXCLUDED.items,
           adjust_priority = EXCLUDED.adjust_priority,
           cardio_fuel = EXCLUDED.cardio_fuel,
           checklist = EXCLUDED.checklist,
           meal_slots = EXCLUDED.meal_slots,
           updated_at = NOW()
         WHERE macro_presets.locked = FALSE`,
        [
          p.id, userId, p.name, p.locked ?? false,
          p.calories, p.protein_g ?? 0, p.carbs_g ?? 0, p.fat_g ?? 0,
          JSON.stringify(p.items ?? {}),
          JSON.stringify(p.adjust_priority ?? []),
          JSON.stringify(p.cardio_fuel ?? {}),
          JSON.stringify(p.checklist ?? []),
          JSON.stringify(p.meal_slots ?? []),
        ]
      );
      res.json({ ok: true, id: p.id });
    } catch (err) {
      console.error("preset upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/presets/load-file", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const presetPath = req.body.path || "presets/conrad_v1.json";
      const fullPath = path.resolve(presetPath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: `Preset file not found: ${presetPath}` });
      }
      const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      await pool.query(
        `INSERT INTO macro_presets (id, user_id, name, locked, calories, protein_g, carbs_g, fat_g, items, adjust_priority, cardio_fuel, checklist, meal_slots)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (user_id, id) DO UPDATE SET
           name = EXCLUDED.name, locked = EXCLUDED.locked,
           calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g,
           carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
           items = EXCLUDED.items, adjust_priority = EXCLUDED.adjust_priority,
           cardio_fuel = EXCLUDED.cardio_fuel, checklist = EXCLUDED.checklist,
           meal_slots = EXCLUDED.meal_slots, updated_at = NOW()`,
        [
          data.id, userId, data.name, data.locked ?? false,
          data.calories, data.protein_g ?? 0, data.carbs_g ?? 0, data.fat_g ?? 0,
          JSON.stringify(data.items ?? {}),
          JSON.stringify(data.adjust_priority ?? []),
          JSON.stringify(data.cardio_fuel ?? {}),
          JSON.stringify(data.checklist ?? []),
          JSON.stringify(data.meal_slots ?? []),
        ]
      );
      res.json({ ok: true, id: data.id, name: data.name, locked: data.locked });
    } catch (err) {
      console.error("preset load error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/presets/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rowCount } = await pool.query(
        `DELETE FROM macro_presets WHERE user_id = $1 AND id = $2 AND locked = FALSE`,
        [userId, req.params.id]
      );
      if (rowCount === 0) return res.status(400).json({ error: "Preset not found or is locked" });
      res.json({ ok: true });
    } catch (err) {
      console.error("preset delete error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/strength/baselines", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { rows } = await pool.query(
        `SELECT exercise, baseline_value, baseline_type, computed_from_days, updated_at
         FROM strength_baselines WHERE user_id = $1`,
        [userId],
      );
      const baselines: Record<string, any> = {};
      for (const r of rows) {
        baselines[r.exercise] = {
          value: r.baseline_value,
          type: r.baseline_type,
          computedFromDays: r.computed_from_days,
          updatedAt: r.updated_at,
        };
      }
      res.json({ ok: true, baselines });
    } catch (err) {
      console.error("strength baselines fetch error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/strength/baselines/compute", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const maxDays = req.body.maxDays ?? 7;
      const { rows } = await pool.query(
        `SELECT * FROM daily_log WHERE user_id = $1 ORDER BY day ASC`,
        [userId],
      );
      const entries = rows.map(snakeToCamel);

      const sorted = [...entries].sort((a: any, b: any) => a.day.localeCompare(b.day));
      const recent = sorted.slice(0, maxDays);

      const avg = (vals: number[]) => vals.length > 0 ? vals.reduce((s: number, v: number) => s + v, 0) / vals.length : null;
      const pushups = avg(recent.filter((e: any) => e.pushupsReps != null).map((e: any) => e.pushupsReps));
      const pullups = avg(recent.filter((e: any) => e.pullupsReps != null).map((e: any) => e.pullupsReps));
      const benchBarReps = avg(recent.filter((e: any) => e.benchReps != null && (e.benchWeightLb == null || e.benchWeightLb <= 45)).map((e: any) => e.benchReps));
      const ohpBarReps = avg(recent.filter((e: any) => e.ohpReps != null && (e.ohpWeightLb == null || e.ohpWeightLb <= 45)).map((e: any) => e.ohpReps));

      const exercises: Array<{ name: string; val: number | null }> = [
        { name: "pushups", val: pushups },
        { name: "pullups", val: pullups },
        { name: "bench_bar_reps", val: benchBarReps },
        { name: "ohp_bar_reps", val: ohpBarReps },
      ];

      for (const ex of exercises) {
        if (ex.val != null) {
          const rounded = Math.round(ex.val * 10) / 10;
          await pool.query(
            `INSERT INTO strength_baselines (user_id, exercise, baseline_value, baseline_type, computed_from_days, updated_at)
             VALUES ($1, $2, $3, 'reps', $4, NOW())
             ON CONFLICT (user_id, exercise) DO UPDATE SET
               baseline_value = EXCLUDED.baseline_value,
               computed_from_days = EXCLUDED.computed_from_days,
               updated_at = NOW()`,
            [userId, ex.name, rounded, maxDays],
          );
        }
      }

      res.json({
        ok: true,
        baselines: {
          pushups: pushups != null ? Math.round(pushups * 10) / 10 : null,
          pullups: pullups != null ? Math.round(pullups * 10) / 10 : null,
          benchBarReps: benchBarReps != null ? Math.round(benchBarReps * 10) / 10 : null,
          ohpBarReps: ohpBarReps != null ? Math.round(ohpBarReps * 10) / 10 : null,
        },
        computedFromDays: maxDays,
        dataPoints: recent.length,
      });
    } catch (err) {
      console.error("strength baselines compute error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Calorie Decisions (applied delta audit log) ──

  app.post("/api/calorie-decisions/upsert", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { day, deltaKcal, source, priority, reason, wkGainLb, mode } = req.body;
      if (!day || typeof day !== "string") {
        return res.status(400).json({ ok: false, error: "day required" });
      }
      if (typeof deltaKcal !== "number") {
        return res.status(400).json({ ok: false, error: "deltaKcal required" });
      }
      if (source !== "weight_only" && source !== "mode_override") {
        return res.status(400).json({ ok: false, error: "invalid source" });
      }
      if (priority !== "high" && priority !== "medium" && priority !== "low") {
        return res.status(400).json({ ok: false, error: "invalid priority" });
      }
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ ok: false, error: "reason required" });
      }
      await upsertCalorieDecision(userId, {
        day,
        deltaKcal,
        source,
        priority,
        reason,
        wkGainLb: wkGainLb ?? null,
        mode: mode ?? null,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("calorie-decisions upsert error:", err);
      res.status(500).json({ ok: false, error: "Failed to upsert calorie decision" });
    }
  });

  app.get("/api/calorie-decisions", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const days = parseInt(String(req.query.days ?? 14), 10);
      const decisions = await getCalorieDecisions(userId, days);
      res.json({ ok: true, decisions });
    } catch (err) {
      console.error("calorie-decisions fetch error:", err);
      res.status(500).json({ ok: false, error: "Failed to fetch calorie decisions" });
    }
  });

  // ───── Context Lens routes ─────

  app.post("/api/context-events", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { day, tag, intensity, label, notes, adjustmentAttempted, adjustmentAttemptedDay } = req.body;
      if (!day || !tag) {
        return res.status(400).json({ ok: false, error: "day and tag are required" });
      }
      const event = await upsertContextEvent(
        { day, tag, intensity, label, notes, adjustmentAttempted, adjustmentAttemptedDay },
        userId,
      );
      res.json({ ok: true, event });
    } catch (err) {
      console.error("context-events create error:", err);
      res.status(500).json({ ok: false, error: "Failed to create context event" });
    }
  });

  app.put("/api/context-events/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id" });
      const event = await updateContextEvent(id, req.body, userId);
      if (!event) return res.status(404).json({ ok: false, error: "Not found" });
      res.json({ ok: true, event });
    } catch (err) {
      console.error("context-events update error:", err);
      res.status(500).json({ ok: false, error: "Failed to update context event" });
    }
  });

  app.delete("/api/context-events/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id" });
      const ok = await deleteContextEvent(id, userId);
      res.json({ ok });
    } catch (err) {
      console.error("context-events delete error:", err);
      res.status(500).json({ ok: false, error: "Failed to delete context event" });
    }
  });

  app.get("/api/context-events", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const tag = req.query.tag as string | undefined;
      const day = req.query.day as string | undefined;
      const from = day || (req.query.from as string | undefined);
      const to = day || (req.query.to as string | undefined);
      const events = await getContextEvents(userId, { tag, from, to });
      res.json({ ok: true, events });
    } catch (err) {
      console.error("context-events list error:", err);
      res.status(500).json({ ok: false, error: "Failed to list context events" });
    }
  });

  app.get("/api/context-events/tags", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const tags = await getDistinctTags(userId);
      res.json({ ok: true, tags });
    } catch (err) {
      console.error("context-events tags error:", err);
      res.status(500).json({ ok: false, error: "Failed to get tags" });
    }
  });

  app.post("/api/context-events/adjustment", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { tag, day } = req.body;
      if (!tag || !day) return res.status(400).json({ ok: false, error: "tag and day required" });
      await markAdjustmentAttempted(tag, day, userId);
      res.json({ ok: true });
    } catch (err) {
      console.error("context-events adjustment error:", err);
      res.status(500).json({ ok: false, error: "Failed to mark adjustment" });
    }
  });

  app.get("/api/context-lens", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const tag = req.query.tag as string;
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      if (!tag) return res.status(400).json({ ok: false, error: "tag query param required" });
      const result = await computeContextLens(tag, date, userId);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("context-lens error:", err);
      res.status(500).json({ ok: false, error: "Failed to compute context lens" });
    }
  });

  // ───── Context Lens Episode routes ─────

  app.post("/api/context-lens/episodes/start", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { tag, startDay, intensity, label, notes } = req.body;
      if (!tag || !startDay) return res.status(400).json({ ok: false, error: "tag and startDay required" });
      const episode = await startEpisode({ tag, startDay, intensity, label, notes }, userId);
      res.json({ ok: true, episode });
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        return res.status(409).json({ ok: false, error: err.message });
      }
      console.error("episode start error:", err);
      res.status(500).json({ ok: false, error: "Failed to start episode" });
    }
  });

  app.post("/api/context-lens/episodes/:id/conclude", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = parseInt(req.params.id);
      const { endDay } = req.body;
      if (!endDay) return res.status(400).json({ ok: false, error: "endDay required" });
      const episode = await concludeEpisode(id, endDay, userId);
      if (!episode) return res.status(404).json({ ok: false, error: "Episode not found or already concluded" });
      res.json({ ok: true, episode });
    } catch (err) {
      console.error("episode conclude error:", err);
      res.status(500).json({ ok: false, error: "Failed to conclude episode" });
    }
  });

  app.put("/api/context-lens/episodes/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = parseInt(req.params.id);
      const { intensity, label, notes } = req.body;
      const episode = await updateEpisode(id, { intensity, label, notes }, userId);
      if (!episode) return res.status(404).json({ ok: false, error: "Episode not found" });
      res.json({ ok: true, episode });
    } catch (err) {
      console.error("episode update error:", err);
      res.status(500).json({ ok: false, error: "Failed to update episode" });
    }
  });

  app.get("/api/context-lens/episodes/active", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const day = req.query.day as string | undefined;
      const episodes = day ? await getActiveEpisodesOnDay(day, userId) : await getActiveEpisodes(userId);
      res.json({ ok: true, episodes });
    } catch (err) {
      console.error("episodes active error:", err);
      res.status(500).json({ ok: false, error: "Failed to get active episodes" });
    }
  });

  app.get("/api/context-lens/episodes/archive", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const tag = req.query.tag as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const episodes = await getArchivedEpisodes(userId, { tag, limit });
      res.json({ ok: true, episodes });
    } catch (err) {
      console.error("episodes archive error:", err);
      res.status(500).json({ ok: false, error: "Failed to get archived episodes" });
    }
  });

  app.post("/api/context-lens/episodes/apply-today", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const day = (req.query.day as string) || new Date().toISOString().slice(0, 10);
      const events = await applyCarryForward(day, userId);
      res.json({ ok: true, events });
    } catch (err) {
      console.error("apply-today error:", err);
      res.status(500).json({ ok: false, error: "Failed to apply carry-forward" });
    }
  });

  app.get("/api/context-lens/archives", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const tag = req.query.tag as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const archives = await getArchives(userId, { tag, limit });
      res.json({ ok: true, archives });
    } catch (err) {
      console.error("lens archives error:", err);
      res.status(500).json({ ok: false, error: "Failed to get lens archives" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

function snakeToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    if (typeof val === "string" && !TEXT_FIELDS.has(key) && val !== "" && !isNaN(Number(val)) && isFinite(Number(val))) {
      result[camel] = Number(val);
    } else {
      result[camel] = val;
    }
  }
  return result;
}
