import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { initDb, pool } from "./db";
import { recomputeRange } from "./recompute";

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
          b.adherence ?? 1.0,
          b.performanceNote ?? null,
          b.notes ?? null,
        ],
      );

      await recomputeRange(b.day);

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
