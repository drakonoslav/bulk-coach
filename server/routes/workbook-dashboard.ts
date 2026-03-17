/**
 * server/routes/workbook-dashboard.ts
 *
 * GET /api/workbook/dashboard
 *
 * Workbook-driven cockpit. Returns one unified payload from the active snapshot:
 *   - active workbook identity + provenance
 *   - latest biolog row (canonical + derived)
 *   - workbook phase (canonical — NOT recomputed here)
 *   - nutrition summary for that phase
 *   - colony summary (coord, recent drift, thresholds)
 *
 * Truth: workbook_snapshots + biolog_rows + meal_template_rows
 *        + colony_metric_rows + drift_event_rows + threshold_lab_rows
 *
 * Rules:
 *   - workbook phase_rec remains canonical; no replacement computed here
 *   - no AsyncStorage or daily_log reads
 *   - no legacy dashboard logic
 *   - requires X-User-Id header
 *   - all responses include _provenance
 */

import { Router } from "express";
import { pool, getDbProvenance } from "../db/pool.js";
import { deriveBiologRow } from "../services/biologDerived.js";

const router = Router();

const TABLES_READ = [
  "workbook_snapshots",
  "biolog_rows",
  "meal_template_rows",
  "colony_metric_rows",
  "drift_event_rows",
  "threshold_lab_rows",
];

function requireUserId(req: any): string {
  const userId = (req.headers["x-user-id"] as string | undefined)?.trim();
  if (!userId) {
    const err: any = new Error("x-user-id header is required");
    err.statusCode = 400;
    throw err;
  }
  return userId;
}

async function getActiveSnapshot(userId: string) {
  const result = await pool.query(
    `SELECT id, filename, filename_date, uploaded_at, version_tag
     FROM workbook_snapshots
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY uploaded_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

router.get("/api/workbook/dashboard", async (req: any, res: any) => {
  const dbProv = getDbProvenance();
  let userId: string | null = null;

  try {
    userId = requireUserId(req);
    const active = await getActiveSnapshot(userId);

    if (!active) {
      return res.status(404).json({
        error: "No active workbook snapshot for this user",
        _provenance: {
          db: dbProv,
          userId,
          activeWorkbookSnapshotId: null,
          tablesRead: TABLES_READ,
          source: "postgres",
        },
      });
    }

    // ── 1: Latest biolog row from active workbook ──────────────────────────
    const biologResult = await pool.query(
      `SELECT row_index, biolog_date, phase, raw_json
       FROM biolog_rows
       WHERE workbook_snapshot_id = $1
       ORDER BY biolog_date DESC NULLS LAST, row_index DESC
       LIMIT 1`,
      [active.id]
    );

    const latestBiolog = biologResult.rows[0] || null;
    const derivedBiolog = latestBiolog
      ? deriveBiologRow(latestBiolog.raw_json || {})
      : null;

    const workbookPhase: string | null = latestBiolog?.phase || null;

    const biologDate =
      latestBiolog?.biolog_date instanceof Date
        ? latestBiolog.biolog_date.toISOString().slice(0, 10)
        : latestBiolog?.biolog_date ?? null;

    // ── 2: Nutrition summary for workbook phase ────────────────────────────
    let nutritionSummary: {
      phase: string;
      kcal: number;
      protein: number;
      carbs: number;
      fat: number;
    } | null = null;
    let nutritionTemplateRows: unknown[] = [];

    if (workbookPhase) {
      const [totalsResult, templatesResult] = await Promise.all([
        pool.query(
          `SELECT
             COALESCE(SUM(kcal_sum), 0) AS kcal_total,
             COALESCE(SUM(protein_sum), 0) AS protein_total,
             COALESCE(SUM(carbs_sum), 0) AS carbs_total,
             COALESCE(SUM(fat_sum), 0) AS fat_total
           FROM meal_template_rows
           WHERE workbook_snapshot_id = $1 AND phase = $2`,
          [active.id, workbookPhase]
        ),
        pool.query(
          `SELECT row_index, phase, meal_template_id,
                  kcal_sum, protein_sum, carbs_sum, fat_sum, raw_json
           FROM meal_template_rows
           WHERE workbook_snapshot_id = $1 AND phase = $2
           ORDER BY meal_template_id NULLS LAST, row_index ASC`,
          [active.id, workbookPhase]
        ),
      ]);

      const t = totalsResult.rows[0];
      nutritionSummary = {
        phase: workbookPhase,
        kcal: Number(t.kcal_total),
        protein: Number(t.protein_total),
        carbs: Number(t.carbs_total),
        fat: Number(t.fat_total),
      };

      nutritionTemplateRows = templatesResult.rows.map((r) => ({
        rowIndex: r.row_index,
        phase: r.phase,
        mealTemplateId: r.meal_template_id,
        kcalSum: r.kcal_sum !== null ? Number(r.kcal_sum) : null,
        proteinSum: r.protein_sum !== null ? Number(r.protein_sum) : null,
        carbsSum: r.carbs_sum !== null ? Number(r.carbs_sum) : null,
        fatSum: r.fat_sum !== null ? Number(r.fat_sum) : null,
        raw: r.raw_json,
      }));
    }

    // ── 3: Colony summary from active workbook ─────────────────────────────
    const [colonyResult, driftResult, thresholdResult] = await Promise.all([
      pool.query(
        `SELECT row_index, metric, metric_value, threshold_value,
                status, recommendation, confidence, raw_json
         FROM colony_metric_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY row_index ASC`,
        [active.id]
      ),
      pool.query(
        `SELECT row_index, drift_date, phase, drift_type, drift_source,
                confidence, weighted_drift_score, watch_flag, raw_json
         FROM drift_event_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY drift_date DESC NULLS LAST, row_index DESC
         LIMIT 10`,
        [active.id]
      ),
      pool.query(
        `SELECT row_index, threshold_name, current_value, suggested_value,
                evidence_count, notes, raw_json
         FROM threshold_lab_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY row_index ASC`,
        [active.id]
      ),
    ]);

    const colonyCoord = colonyResult.rows.map((r) => ({
      rowIndex: r.row_index,
      metric: r.metric,
      value: r.metric_value,
      threshold: r.threshold_value,
      status: r.status,
      recommendation: r.recommendation,
      confidence: r.confidence,
      raw: r.raw_json,
    }));

    const recentDriftHistory = driftResult.rows.map((r) => ({
      rowIndex: r.row_index,
      date: r.drift_date instanceof Date
        ? r.drift_date.toISOString().slice(0, 10)
        : r.drift_date,
      phase: r.phase,
      driftType: r.drift_type,
      driftSource: r.drift_source,
      confidence: r.confidence,
      weightedDriftScore:
        r.weighted_drift_score !== null ? Number(r.weighted_drift_score) : null,
      watchFlag: r.watch_flag,
      raw: r.raw_json,
    }));

    const thresholdLab = thresholdResult.rows.map((r) => ({
      rowIndex: r.row_index,
      thresholdName: r.threshold_name,
      currentValue: r.current_value,
      suggestedValue: r.suggested_value,
      evidenceCount: r.evidence_count !== null ? Number(r.evidence_count) : null,
      notes: r.notes,
      raw: r.raw_json,
    }));

    // ── 4: Colony summary counts ───────────────────────────────────────────
    const unstableCount = colonyCoord.filter((r) =>
      String(r.status || "").toLowerCase().includes("unstable")
    ).length;

    const alertCount = colonyCoord.filter((r) =>
      String(r.status || "").toLowerCase().includes("alert")
    ).length;

    const watchCount = recentDriftHistory.filter((r) => {
      const flag = String(r.watchFlag || "").toLowerCase();
      return (
        flag.includes("watch") ||
        flag.includes("review") ||
        flag === "1" ||
        flag === "true"
      );
    }).length;

    return res.json({
      activeWorkbook: {
        id: active.id,
        filename: active.filename,
        filenameDate: active.filename_date instanceof Date
          ? active.filename_date.toISOString().slice(0, 10)
          : active.filename_date,
        uploadedAt: active.uploaded_at,
        versionTag: active.version_tag,
      },

      biolog: latestBiolog
        ? {
            rowIndex: latestBiolog.row_index,
            biologDate,
            workbookPhase,
            canonical: derivedBiolog?.canonical ?? null,
            derived: derivedBiolog?.derived ?? null,
          }
        : null,

      nutrition: {
        summary: nutritionSummary,
        templateRows: nutritionTemplateRows,
      },

      colony: {
        summary: {
          colonyMetricCount: colonyCoord.length,
          recentDriftCount: recentDriftHistory.length,
          thresholdLabCount: thresholdLab.length,
          unstableCount,
          alertCount,
          watchCount,
        },
        colonyCoord,
        recentDriftHistory,
        thresholdLab,
      },

      _provenance: {
        db: dbProv,
        userId,
        activeWorkbookSnapshotId: active.id,
        activeWorkbookFilename: active.filename,
        activeWorkbookVersionTag: active.version_tag,
        tablesRead: TABLES_READ,
        source: "postgres",
      },
    });
  } catch (err: any) {
    console.error("[workbook/dashboard] error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message || "Failed to load workbook dashboard",
      _provenance: {
        db: dbProv,
        userId,
        activeWorkbookSnapshotId: null,
        tablesRead: TABLES_READ,
        source: "postgres",
      },
    });
  }
});

export { router as workbookDashboardRouter };
