import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import { initDb, pool } from "./db";
import { recomputeRange } from "./recompute";
import { importFitbitCSV } from "./fitbit-import";
import { importFitbitTakeout, getDiagnosticsFromDB } from "./fitbit-takeout";
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

function avgOfThree(r1?: number, r2?: number, r3?: number): number | null {
  const vals = [r1, r2, r3].filter((v): v is number => v != null && !isNaN(v));
  if (vals.length < 3) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
}

export async function registerRoutes(app: Express): Promise<Server> {
  await initDb();

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
          adherence, performance_note, notes, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW()
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
        ],
      );

      await recomputeRange(b.day);

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
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const overwriteFields = req.body?.overwrite_fields === "true";
      const timezone = req.body?.timezone || "America/New_York";
      const result = await importFitbitTakeout(req.file.buffer, req.file.originalname, overwriteFields, timezone);
      res.json(result);
    } catch (err: unknown) {
      console.error("fitbit takeout import error:", err);
      const message = err instanceof Error ? err.message : "Import failed";
      res.status(500).json({ error: message });
    }
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
      res.json(result);
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
