// ═══════════════════════════════════════════════════════════════════════════════
// BulkCoach Vitals API Routes (v1 Build Packet)
// GET /api/vitals/dashboard
// GET /api/vitals/recommendation
// GET /api/vitals/baseline
// PATCH /api/vitals/baseline
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Request, Response } from "express";
import { pool } from "../db.js";
import { computeOscillator } from "../oscillator-engine.js";
import { OscillatorClass, CycleWeekType, CardioMode, LiftMode, MacroDayType } from "./enums.js";
import { MACRO_TEMPLATES, MEAL_TIMING_TEMPLATES } from "./macro-templates.js";
import type { VitalsDashboardResponse } from "./interfaces.js";

const router = Router();

const getUserId = (req: Request): string => (req as any).userId || "local_default";

// ─── Cycle week type string → enum ────────────────────────────────────────────
function toCycleWeekType(s: string): CycleWeekType {
  const map: Record<string, CycleWeekType> = {
    Prime: CycleWeekType.PRIME,
    Overload: CycleWeekType.OVERLOAD,
    Peak: CycleWeekType.PEAK,
    Resensitize: CycleWeekType.RESENSITIZE,
  };
  return map[s] ?? CycleWeekType.PRIME;
}

function toOscillatorClass(s: string): OscillatorClass {
  const map: Record<string, OscillatorClass> = {
    "Peak": OscillatorClass.PEAK,
    "Strong Build": OscillatorClass.STRONG_BUILD,
    "Controlled Build": OscillatorClass.CONTROLLED_BUILD,
    "Reset": OscillatorClass.RESET,
    "Resensitize": OscillatorClass.RESENSITIZE,
  };
  return map[s] ?? OscillatorClass.CONTROLLED_BUILD;
}

// ─── GET /api/vitals/dashboard ────────────────────────────────────────────────
// Full VitalsDashboardResponse — today's values, trends, scores, recommendation, breakdowns
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);

    const osc = await computeOscillator(date, userId);

    // Load today's raw log values for the "today" section
    const [logRow, vitalsRow, sleepRow] = await Promise.all([
      pool.query(
        `SELECT morning_weight_lb, bf_morning_pct AS body_fat_pct, fat_free_mass_lb, waist_in,
                calories_in, protein_g_actual, carbs_g_actual, fat_g_actual
         FROM daily_log WHERE user_id=$1 AND day::date=$2::date LIMIT 1`,
        [userId, date]
      ),
      pool.query(
        `SELECT resting_hr_bpm, hrv_rmssd_ms FROM vitals_daily
         WHERE user_id=$1 AND date=$2::date LIMIT 1`,
        [userId, date]
      ),
      pool.query(
        `SELECT total_sleep_minutes FROM sleep_summary_daily
         WHERE user_id=$1 AND date=$2::date LIMIT 1`,
        [userId, date]
      ),
    ]);

    const log = logRow.rows[0] ?? {};
    const vitals = vitalsRow.rows[0] ?? {};
    const sleep = sleepRow.rows[0] ?? {};

    const macroDayTypeEnum = osc.prescription.macroDayTypeEnum as MacroDayType;
    const macroTargets = MACRO_TEMPLATES[macroDayTypeEnum] ?? MACRO_TEMPLATES[MacroDayType.BUILD];
    const mealTimingTargets = MEAL_TIMING_TEMPLATES[macroDayTypeEnum] ?? MEAL_TIMING_TEMPLATES[MacroDayType.BUILD];

    const response: VitalsDashboardResponse = {
      date,
      userId,
      scores: {
        acute: osc.acute ?? 0,
        resource: osc.resource ?? 0,
        seasonal: osc.seasonal ?? 0,
        composite: osc.composite ?? 0,
        oscillatorClass: toOscillatorClass(osc.ocs_class ?? "Controlled Build"),
      },
      today: {
        bodyWeightLb: log.morning_weight_lb != null ? Number(log.morning_weight_lb) : null,
        bodyFatPct: log.body_fat_pct != null ? Number(log.body_fat_pct) : null,
        fatFreeMassLb: log.fat_free_mass_lb != null ? Number(log.fat_free_mass_lb) : null,
        waistAtNavelIn: log.waist_in != null ? Number(log.waist_in) : null,
        restingHrBpm: vitals.resting_hr_bpm != null ? Number(vitals.resting_hr_bpm) : null,
        hrvMs: vitals.hrv_rmssd_ms != null ? Number(vitals.hrv_rmssd_ms) : null,
        sleepDurationMin: sleep.total_sleep_minutes != null ? Number(sleep.total_sleep_minutes) : null,
        kcalActual: log.calories_in != null ? Number(log.calories_in) : null,
        proteinGActual: log.protein_g_actual != null ? Number(log.protein_g_actual) : null,
        carbsGActual: log.carbs_g_actual != null ? Number(log.carbs_g_actual) : null,
        fatGActual: log.fat_g_actual != null ? Number(log.fat_g_actual) : null,
      },
      trends: {
        weightTrend14dLbPerWeek: osc.resourceComponents.bwTrend14dLbPerWk,
        ffmTrend14dLbPerWeek: osc.resourceComponents.ffmTrend14dLbPerWk,
        strengthTrend14dPct: osc.resourceComponents.strengthTrendPct != null
          ? osc.resourceComponents.strengthTrendPct * 100
          : null,
        waistChange14dIn: osc.resourceComponents.waistTrend14dInOver14d,
        hrv28dAvg: null,
        rhr28dAvg: null,
      },
      weeklyDistribution: {
        zone2Count7d: osc.zone2Count7d,
        zone3Count7d: osc.zone3Count7d,
        recoveryCount7d: osc.easyCount7d,
        neuralLiftCount7d: 0,
      },
      recommendation: {
        cardioMode: (osc.prescription.cardioModeEnum as CardioMode) ?? CardioMode.ZONE_2,
        liftMode: (osc.prescription.liftModeEnum as LiftMode) ?? LiftMode.PUMP,
        macroDayType: macroDayTypeEnum,
        macroTargets,
        mealTimingTargets,
        reasoning: osc.reasoning,
      },
      breakdowns: osc.breakdowns,
      flags: {
        hardStopFatigue: osc.hardStopFatigue,
        lowSleep: osc.acuteComponents.sleepMin != null ? osc.acuteComponents.sleepMin < 360 : false,
        elevatedRhr: osc.acuteComponents.rhrDelta != null ? osc.acuteComponents.rhrDelta > 4 : false,
        suppressedHrv: osc.acuteComponents.hrvRatio != null ? osc.acuteComponents.hrvRatio < 0.90 : false,
        cardioMonotony: Math.max(osc.zone2Count7d, osc.zone3Count7d, osc.easyCount7d) >= 5,
        monthlyResensitizeOverride: osc.cycleDay28 >= 22,
      },
      cycleDay28: osc.cycleDay28,
      cycleWeekType: toCycleWeekType(osc.cycleWeek),
      explanationText: osc.explanationText,
      dataQuality: osc.dataQuality,
    };

    res.json({ ok: true, data: response });
  } catch (err: any) {
    console.error("[vitals/dashboard] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vitals/recommendation ──────────────────────────────────────────
// Full VitalsDailyRecommendationResponse with reasoning[], flag breakdown, macro + meal timing
router.get("/recommendation", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);

    const osc = await computeOscillator(date, userId);

    const macroDayTypeEnum = osc.prescription.macroDayTypeEnum as MacroDayType;
    const macroTargets = MACRO_TEMPLATES[macroDayTypeEnum] ?? MACRO_TEMPLATES[MacroDayType.BUILD];
    const mealTimingTargets = MEAL_TIMING_TEMPLATES[macroDayTypeEnum] ?? MEAL_TIMING_TEMPLATES[MacroDayType.BUILD];

    const response = {
      date,
      userId,
      recommendation: {
        date,
        cycleDay28: osc.cycleDay28,
        cycleWeekType: toCycleWeekType(osc.cycleWeek),
        scores: {
          acuteScore: osc.acute ?? 0,
          resourceScore: osc.resource ?? 0,
          seasonalScore: osc.seasonal ?? 0,
          compositeScore: osc.composite ?? 0,
          oscillatorClass: toOscillatorClass(osc.ocs_class ?? "Controlled Build"),
        },
        flags: {
          hardStopFatigue: osc.hardStopFatigue,
          lowSleep: osc.acuteComponents.sleepMin != null ? osc.acuteComponents.sleepMin < 360 : false,
          elevatedRhr: osc.acuteComponents.rhrDelta != null ? osc.acuteComponents.rhrDelta > 4 : false,
          suppressedHrv: osc.acuteComponents.hrvRatio != null ? osc.acuteComponents.hrvRatio < 0.90 : false,
          cardioMonotony: Math.max(osc.zone2Count7d, osc.zone3Count7d, osc.easyCount7d) >= 5,
          monthlyResensitizeOverride: osc.cycleDay28 >= 22,
        },
        recommendedCardioMode: (osc.prescription.cardioModeEnum as CardioMode) ?? CardioMode.ZONE_2,
        recommendedLiftMode: (osc.prescription.liftModeEnum as LiftMode) ?? LiftMode.PUMP,
        recommendedMacroDayType: macroDayTypeEnum,
        macroTargets,
        mealTimingTargets,
        reasoning: osc.reasoning,
      },
      scoreBreakdowns: osc.breakdowns,
    };

    res.json({ ok: true, data: response });
  } catch (err: any) {
    console.error("[vitals/recommendation] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vitals/baseline ─────────────────────────────────────────────────
// Returns the stored personal baseline constants for the user
router.get("/baseline", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const row = await pool.query(
      `SELECT hrv_year_avg, rhr_year_avg, body_weight_setpoint_lb, waist_setpoint_in,
              protein_floor_g, fat_floor_avg_g, default_kcal
       FROM user_vitals_baseline WHERE user_id=$1 LIMIT 1`,
      [userId]
    );
    if (row.rows.length === 0) {
      return res.json({
        ok: true,
        data: {
          hrvYearAvg: 36, rhrYearAvg: 60,
          bodyWeightSetpointLb: 156, waistSetpointIn: 31.5,
          proteinFloorG: 170, fatFloorAvgG: 55, defaultKcal: 2695,
        },
      });
    }
    const r = row.rows[0];
    res.json({
      ok: true,
      data: {
        hrvYearAvg: r.hrv_year_avg != null ? Number(r.hrv_year_avg) : null,
        rhrYearAvg: r.rhr_year_avg != null ? Number(r.rhr_year_avg) : null,
        bodyWeightSetpointLb: r.body_weight_setpoint_lb != null ? Number(r.body_weight_setpoint_lb) : null,
        waistSetpointIn: r.waist_setpoint_in != null ? Number(r.waist_setpoint_in) : null,
        proteinFloorG: Number(r.protein_floor_g),
        fatFloorAvgG: Number(r.fat_floor_avg_g),
        defaultKcal: Number(r.default_kcal),
      },
    });
  } catch (err: any) {
    console.error("[vitals/baseline] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/vitals/baseline ───────────────────────────────────────────────
// Update personal baseline constants
router.patch("/baseline", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const {
      hrvYearAvg, rhrYearAvg, bodyWeightSetpointLb, waistSetpointIn,
      proteinFloorG, fatFloorAvgG, defaultKcal,
    } = req.body;

    await pool.query(
      `INSERT INTO user_vitals_baseline
         (user_id, hrv_year_avg, rhr_year_avg, body_weight_setpoint_lb, waist_setpoint_in,
          protein_floor_g, fat_floor_avg_g, default_kcal, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         hrv_year_avg             = COALESCE($2, user_vitals_baseline.hrv_year_avg),
         rhr_year_avg             = COALESCE($3, user_vitals_baseline.rhr_year_avg),
         body_weight_setpoint_lb  = COALESCE($4, user_vitals_baseline.body_weight_setpoint_lb),
         waist_setpoint_in        = COALESCE($5, user_vitals_baseline.waist_setpoint_in),
         protein_floor_g          = COALESCE($6, user_vitals_baseline.protein_floor_g),
         fat_floor_avg_g          = COALESCE($7, user_vitals_baseline.fat_floor_avg_g),
         default_kcal             = COALESCE($8, user_vitals_baseline.default_kcal),
         updated_at               = NOW()`,
      [userId, hrvYearAvg, rhrYearAvg, bodyWeightSetpointLb, waistSetpointIn,
       proteinFloorG, fatFloorAvgG, defaultKcal]
    );

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[vitals/baseline PATCH] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
