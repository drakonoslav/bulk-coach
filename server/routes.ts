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
import { computeSleepBlock, computeSleepTrending, getSleepPlanSettings, setSleepPlanSettings } from "./sleep-alignment";
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const CHUNK_DIR = path.join("/tmp", "takeout_chunks");
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

const jobResults = new Map<string, { status: "processing" | "done" | "error"; result?: any; error?: string }>();

function avgOfThree(r1?: number, r2?: number, r3?: number): number | null {
  const vals = [r1, r2, r3].filter((v): v is number => v != null && !isNaN(v));
  if (vals.length < 3) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
}

export async function registerRoutes(app: Express): Promise<Server> {
  await initDb();

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
      if (!b.day || !b.morningWeightLb) {
        return res.status(400).json({ error: "day and morningWeightLb required" });
      }

      const bfMorningPct = avgOfThree(b.bfMorningR1, b.bfMorningR2, b.bfMorningR3);
      const bfEveningPct = avgOfThree(b.bfEveningR1, b.bfEveningR2, b.bfEveningR3);

      await pool.query(
        `INSERT INTO daily_log (
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
          updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,NOW()
        )
        ON CONFLICT (day) DO UPDATE SET
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
          water_liters = EXCLUDED.water_liters,
          steps = EXCLUDED.steps,
          cardio_min = EXCLUDED.cardio_min,
          lift_done = EXCLUDED.lift_done,
          deload_week = EXCLUDED.deload_week,
          adherence = EXCLUDED.adherence,
          performance_note = EXCLUDED.performance_note,
          notes = EXCLUDED.notes,
          sleep_plan_bedtime = EXCLUDED.sleep_plan_bedtime,
          sleep_plan_wake = EXCLUDED.sleep_plan_wake,
          tossed_minutes = EXCLUDED.tossed_minutes,
          planned_bed_time = EXCLUDED.planned_bed_time,
          planned_wake_time = EXCLUDED.planned_wake_time,
          actual_bed_time = EXCLUDED.actual_bed_time,
          actual_wake_time = EXCLUDED.actual_wake_time,
          sleep_latency_min = EXCLUDED.sleep_latency_min,
          sleep_waso_min = EXCLUDED.sleep_waso_min,
          nap_minutes = EXCLUDED.nap_minutes,
          updated_at = NOW()`,
        [
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
        ],
      );

      await recomputeRange(b.day);

      computeSleepBlock(b.day).catch((err: unknown) =>
        console.error("sleep block compute error:", err)
      );

      recomputeReadinessRange(b.day).catch((err: unknown) =>
        console.error("readiness recompute error:", err)
      );

      res.json({ ok: true });
    } catch (err: unknown) {
      console.error("upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/logs", async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM daily_log ORDER BY day ASC`,
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
      const { rows } = await pool.query(
        `SELECT * FROM daily_log WHERE day = $1`,
        [req.params.day],
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
      await pool.query(`DELETE FROM daily_log WHERE day = $1`, [req.params.day]);
      await pool.query(`DELETE FROM dashboard_cache WHERE day = $1`, [req.params.day]);
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error("delete error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/dashboard", async (req: Request, res: Response) => {
    try {
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
                d.lean_gain_ratio_14d_roll, d.cardio_fuel_note
         FROM dashboard_cache d
         JOIN daily_log l ON l.day = d.day
         WHERE d.day BETWEEN $1 AND $2
         ORDER BY d.day ASC`,
        [start, end],
      );

      const mapped = rows.map(snakeToCamel);
      res.json(mapped);
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

      const overwriteFields = req.body?.overwrite_fields === "true";
      const result = await importFitbitCSV(req.file.buffer, req.file.originalname, overwriteFields);

      if (result.dateRange?.start) {
        recomputeReadinessRange(result.dateRange.start).catch((err: unknown) =>
          console.error("readiness recompute after fitbit:", err)
        );
      }

      res.json(result);
    } catch (err: unknown) {
      console.error("fitbit import error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  });

  app.get("/api/import/history", async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM fitbit_imports ORDER BY uploaded_at DESC LIMIT 10`,
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
      fs.writeFileSync(path.join(uploadDir, `chunk_${chunkIndex}`), req.file.buffer);
      const meta = JSON.parse(fs.readFileSync(path.join(uploadDir, "_meta.json"), "utf8"));
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

  app.get("/api/import/takeout_history", async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM fitbit_takeout_imports ORDER BY uploaded_at DESC LIMIT 10`,
      );
      res.json(rows.map(snakeToCamel));
    } catch (err: unknown) {
      console.error("takeout history error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/import/takeout_history/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await pool.query(`DELETE FROM fitbit_takeout_imports WHERE id = $1`, [id]);
      res.json({ status: "ok" });
    } catch (err: unknown) {
      console.error("delete takeout history error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/import/takeout_reset_hashes", async (_req: Request, res: Response) => {
    try {
      const { rowCount } = await pool.query(`DELETE FROM fitbit_takeout_imports`);
      res.json({ status: "ok", cleared: rowCount });
    } catch (err: unknown) {
      console.error("reset takeout hashes error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/import/history/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await pool.query(`DELETE FROM fitbit_imports WHERE id = $1`, [id]);
      res.json({ status: "ok" });
    } catch (err: unknown) {
      console.error("delete import history error:", err);
      res.status(500).json({ error: "Internal server error" });
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

      const parsed = parseSnapshotFile(req.file.buffer, req.file.originalname);
      const result = await importSnapshotAndDerive(parsed, sessionDate, req.file.originalname);

      recomputeReadinessRange(sessionDate).catch((err: unknown) =>
        console.error("readiness recompute after snapshot:", err)
      );

      res.json(result);
    } catch (err: unknown) {
      console.error("erection upload error:", err);
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/erection/snapshots", async (_req: Request, res: Response) => {
    try {
      const snapshots = await getSnapshots();
      res.json(snapshots);
    } catch (err: unknown) {
      console.error("snapshots error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/sessions", async (req: Request, res: Response) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const includeImputed = req.query.include_imputed !== "false";
      const sessions = await getSessions(from, to, includeImputed);
      res.json(sessions.map(snakeToCamel));
    } catch (err: unknown) {
      console.error("sessions error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/proxy", async (req: Request, res: Response) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const includeImputed = req.query.include_imputed === "true";
      const data = await getProxyData(from, to, includeImputed);
      res.json(data.map(snakeToCamel));
    } catch (err: unknown) {
      console.error("proxy error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/badges", async (_req: Request, res: Response) => {
    try {
      const badges = await getSessionBadges();
      res.json(badges);
    } catch (err: unknown) {
      console.error("badges error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/erection/confidence", async (_req: Request, res: Response) => {
    try {
      const confidence = await getDataConfidence();
      res.json(confidence);
    } catch (err: unknown) {
      console.error("confidence error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/readiness", async (req: Request, res: Response) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      let result = await getReadiness(date);
      if (!result) {
        result = await computeReadiness(date);
        await persistReadiness(result);
      }
      const sleepBlock = await computeSleepBlock(date);
      const sleepTrending = await computeSleepTrending(date);
      res.json({ ...result, sleepBlock, sleepTrending });
    } catch (err: unknown) {
      console.error("readiness error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/readiness/range", async (req: Request, res: Response) => {
    try {
      const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
      const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
      const results = await getReadinessRange(from, to);
      res.json(results);
    } catch (err: unknown) {
      console.error("readiness range error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/training/template", async (_req: Request, res: Response) => {
    try {
      const template = await getTrainingTemplate();
      res.json(template);
    } catch (err: unknown) {
      console.error("template get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/training/template", async (req: Request, res: Response) => {
    try {
      const { templateType, sessions } = req.body;
      if (!templateType || !Array.isArray(sessions)) {
        return res.status(400).json({ error: "templateType and sessions required" });
      }
      await updateTrainingTemplate(templateType, sessions);
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error("template update error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/settings/analysis-start-date", async (_req: Request, res: Response) => {
    try {
      const date = await getAnalysisStartDate();
      res.json({ analysisStartDate: date });
    } catch (err: unknown) {
      console.error("get analysis start date error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/settings/analysis-start-date", async (req: Request, res: Response) => {
    try {
      const { date } = req.body;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Valid date (YYYY-MM-DD) required" });
      }
      await setAnalysisStartDate(date);
      res.json({ ok: true, analysisStartDate: date });
    } catch (err: unknown) {
      console.error("set analysis start date error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/settings/rebaseline", async (req: Request, res: Response) => {
    try {
      const days = Number(req.body?.days) || 60;
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - days);
      const newStart = d.toISOString().slice(0, 10);
      await setAnalysisStartDate(newStart);

      const today = new Date().toISOString().slice(0, 10);
      recomputeReadinessRange(today).catch((err: unknown) =>
        console.error("readiness recompute after rebaseline:", err)
      );

      res.json({ ok: true, analysisStartDate: newStart, recomputeTriggered: true });
    } catch (err: unknown) {
      console.error("rebaseline error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/data-sufficiency", async (_req: Request, res: Response) => {
    try {
      const result = await getDataSufficiency();
      res.json(result);
    } catch (err: unknown) {
      console.error("data sufficiency error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/backup/export", async (_req: Request, res: Response) => {
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

  app.post("/api/backup/import", upload.single("file"), async (req: Request, res: Response) => {
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

  app.get("/api/sanity-check", async (req: Request, res: Response) => {
    try {
      const date = req.query.date as string;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
      }

      const { rows: logRows } = await pool.query(
        `SELECT day, steps, cardio_min, active_zone_minutes, sleep_minutes,
                energy_burned_kcal, resting_hr, hrv,
                zone1_min, zone2_min, zone3_min, below_zone1_min,
                morning_weight_lb, waist_in, sleep_start, sleep_end
         FROM daily_log WHERE day = $1`,
        [date],
      );
      const dailyLog = logRows[0] ? snakeToCamel(logRows[0]) : null;

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

      let readinessResult = null;
      try {
        readinessResult = await computeReadiness(date);
      } catch {}

      const { rows: storedReadiness } = await pool.query(
        `SELECT * FROM readiness_daily WHERE date = $1::date`,
        [date],
      );

      const sufficiency = await getDataSufficiency();

      const { rows: proxyRows } = await pool.query(
        `SELECT date::text, proxy_score, computed_with_imputed
         FROM androgen_proxy_daily WHERE date = $1::date`,
        [date],
      );

      res.json({
        date,
        section1_raw_imported: {
          fitbitSources,
          sleepBucketing: sleepBucketRows,
          conflicts: conflictRows,
        },
        section2_daily_log: dailyLog,
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
      const { date } = req.params;
      const { rows } = await pool.query(
        `SELECT * FROM sleep_import_diagnostics WHERE date = $1 OR bucket_date = $1 ORDER BY created_at DESC`,
        [date],
      );
      const { rows: validation } = await pool.query(
        `SELECT day, sleep_minutes FROM daily_log WHERE day = $1`,
        [date],
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
      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ error: "from and to required" });
      const { rows } = await pool.query(
        `SELECT day, sleep_minutes, sleep_start, sleep_end,
                sleep_start_local, sleep_end_local,
                sleep_plan_bedtime, sleep_plan_wake, tossed_minutes,
                sleep_efficiency, bedtime_deviation_min, wake_deviation_min, sleep_plan_alignment_score
         FROM daily_log
         WHERE day >= $1 AND day <= $2 AND sleep_minutes IS NOT NULL
         ORDER BY day ASC`,
        [from, to]
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

  app.get("/api/sleep-plan", async (_req: Request, res: Response) => {
    try {
      const settings = await getSleepPlanSettings();
      res.json(settings);
    } catch (err: unknown) {
      console.error("sleep-plan get error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/sleep-plan", async (req: Request, res: Response) => {
    try {
      const { bedtime, wake } = req.body;
      if (!bedtime || !wake) return res.status(400).json({ error: "bedtime and wake required" });
      await setSleepPlanSettings(bedtime, wake);
      res.json({ ok: true, bedtime, wake });
    } catch (err: unknown) {
      console.error("sleep-plan set error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/sleep-samples/:date", async (req: Request, res: Response) => {
    try {
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
         FROM daily_log WHERE day = $1`,
        [date],
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
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getVitalsDailyRange(start, end);
      res.json(rows);
    } catch (err) {
      console.error("canonical vitals error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/vitals", async (req: Request, res: Response) => {
    try {
      const v = req.body as VitalsDaily;
      if (!v.date || !v.source) {
        return res.status(400).json({ error: "date and source required" });
      }
      await upsertVitalsDaily(v);
      res.json({ ok: true, date: v.date });
    } catch (err) {
      console.error("canonical vitals upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/sleep", async (req: Request, res: Response) => {
    try {
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getSleepSummaryRange(start, end);
      res.json(rows);
    } catch (err) {
      console.error("canonical sleep error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/sleep", async (req: Request, res: Response) => {
    try {
      const s = req.body as SleepSummary;
      if (!s.date || s.total_sleep_minutes == null || !s.source) {
        return res.status(400).json({ error: "date, total_sleep_minutes, and source required" });
      }
      await upsertSleepSummary(s);
      res.json({ ok: true, date: s.date });
    } catch (err) {
      console.error("canonical sleep upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/workouts", async (req: Request, res: Response) => {
    try {
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getWorkoutSessions(start, end);
      res.json(rows);
    } catch (err) {
      console.error("canonical workouts error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts", async (req: Request, res: Response) => {
    try {
      const w = req.body as WorkoutSession;
      if (!w.session_id || !w.date || !w.start_ts || !w.source) {
        return res.status(400).json({ error: "session_id, date, start_ts, and source required" });
      }
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
      const sessionId = req.params.sessionId as string;
      const result = await analyzeSessionHrv(sessionId);
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
      const sessionId = req.params.sessionId as string;
      const rows = await getHrSamplesForSession(sessionId);
      res.json(rows);
    } catch (err) {
      console.error("canonical hr samples error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/:sessionId/hr", async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const samples = req.body as WorkoutHrSample[];
      if (!Array.isArray(samples)) {
        return res.status(400).json({ error: "expected array of hr samples" });
      }
      const tagged = samples.map(s => ({ ...s, session_id: sessionId }));
      const count = await batchUpsertHrSamples(tagged);
      res.json({ ok: true, count });
    } catch (err) {
      console.error("canonical hr samples upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/workouts/:sessionId/rr", async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const rows = await getRrIntervalsForSession(sessionId);
      res.json(rows);
    } catch (err) {
      console.error("canonical rr intervals error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/workouts/:sessionId/rr", async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const intervals = req.body as WorkoutRrInterval[];
      if (!Array.isArray(intervals)) {
        return res.status(400).json({ error: "expected array of rr intervals" });
      }
      const tagged = intervals.map(r => ({ ...r, session_id: sessionId }));
      const count = await batchUpsertRrIntervals(tagged);
      res.json({ ok: true, count });
    } catch (err) {
      console.error("canonical rr intervals upsert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/hrv-baseline", async (req: Request, res: Response) => {
    try {
      const start = (req.query.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
      const rows = await getHrvBaselineRange(start, end);
      res.json(rows);
    } catch (err) {
      console.error("canonical hrv baseline error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/canonical/hrv-baseline/recompute", async (req: Request, res: Response) => {
    try {
      const start = (req.body.start as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = (req.body.end as string) || new Date().toISOString().slice(0, 10);
      const count = await recomputeHrvBaselines(start, end);
      res.json({ ok: true, daysComputed: count });
    } catch (err) {
      console.error("canonical hrv recompute error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/canonical/summary", async (req: Request, res: Response) => {
    try {
      const { rows: vitalsCount } = await pool.query(`SELECT COUNT(*) as count FROM vitals_daily`);
      const { rows: sleepCount } = await pool.query(`SELECT COUNT(*) as count FROM sleep_summary_daily`);
      const { rows: workoutCount } = await pool.query(`SELECT COUNT(*) as count FROM workout_session`);
      const { rows: hrvCount } = await pool.query(`SELECT COUNT(*) as count FROM hrv_baseline_daily`);
      const { rows: sources } = await pool.query(
        `SELECT DISTINCT source FROM vitals_daily UNION SELECT DISTINCT source FROM sleep_summary_daily`
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
      const { readinessScore, sessionId, workoutType } = req.body;
      if (readinessScore == null || !sessionId) {
        return res.status(400).json({ error: "readinessScore and sessionId are required" });
      }
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      await upsertWorkoutSession({
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
      });
      const state = initWorkoutState(sessionId, readinessScore);
      await persistWorkoutEvent(sessionId, { t: Date.now(), type: "SESSION_START" }, state.cbpStart, state.cbpCurrent, 0);
      res.json(state);
    } catch (err) {
      console.error("workout start error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/workout/:sessionId/set", async (req: Request, res: Response) => {
    try {
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

      await persistWorkoutEvent(sessionId, event, cbpBefore, updatedState.cbpCurrent, drain);

      const today = new Date().toISOString().slice(0, 10);
      const weekStart = getWeekStart(today);
      await incrementMuscleLoad(muscle as MuscleGroup, weekStart, 1, (rpe ?? 7) >= 7);

      res.json(updatedState);
    } catch (err) {
      console.error("workout set error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/workout/:sessionId/events", async (req: Request, res: Response) => {
    try {
      const events = await getWorkoutEvents(req.params.sessionId as string);
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
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const weekStart = getWeekStart(date);
      const summary = await getWeeklyLoadSummary(weekStart);
      res.json({ weekStart, ...summary });
    } catch (err) {
      console.error("weekly load error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/muscle/isolation-targets", async (req: Request, res: Response) => {
    try {
      const { readinessScore, dayType, priority, count } = req.body;
      if (readinessScore == null || !dayType) {
        return res.status(400).json({ error: "readinessScore and dayType are required" });
      }
      const today = new Date().toISOString().slice(0, 10);
      const weekStart = getWeekStart(today);
      const loads = await getWeeklyLoads(weekStart);

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

  app.get("/api/data-sources", async (_req: Request, res: Response) => {
    try {
      const sourceCounts = await pool.query(`
        SELECT source, COUNT(*) as count, MAX(updated_at) as last_sync
        FROM workout_session
        GROUP BY source
      `);
      const vitalsCounts = await pool.query(`
        SELECT source, COUNT(*) as count, MAX(updated_at) as last_sync
        FROM vitals_daily
        GROUP BY source
      `);
      const sleepCounts = await pool.query(`
        SELECT source, COUNT(*) as count, MAX(updated_at) as last_sync
        FROM sleep_summary_daily
        GROUP BY source
      `);

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

  const httpServer = createServer(app);
  return httpServer;
}

function snakeToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    if (typeof val === "string" && !isNaN(Number(val)) && key !== "day" && key !== "sleep_start" && key !== "sleep_end" && key !== "performance_note" && key !== "notes" && key !== "cardio_fuel_note" && key !== "created_at" && key !== "updated_at" && key !== "recomputed_at") {
      result[camel] = val;
    } else {
      result[camel] = val;
    }
  }
  return result;
}
