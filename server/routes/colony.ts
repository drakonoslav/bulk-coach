/**
 * server/routes/colony.ts
 * NEW CANONICAL: GET /api/colony
 *
 * Truth read:
 *   colony_metric_rows   — normalized colony_coord rows (keyed to active workbook_snapshot_id)
 *   drift_event_rows     — normalized drift_history rows
 *   threshold_lab_rows   — normalized threshold_lab rows
 *
 * User scope: X-User-Id header — REQUIRED. No fallback.
 * No runtime-derived colony state. Workbook sheets are the only authority.
 * Provenance: every response includes _provenance block.
 */
import { Router, Request, Response } from "express";
import { pool, getDbProvenance } from "../db/pool.js";

export const colonyRouter = Router();

function requireUserId(req: Request): string {
  const userId = (req.headers["x-user-id"] as string | undefined)?.trim();
  if (!userId) {
    const err: any = new Error("X-User-Id header is required");
    err.statusCode = 400;
    throw err;
  }
  return userId;
}

async function getActiveSnapshot(userId: string) {
  const result = await pool.query(
    `SELECT id, filename, uploaded_at, version_tag
     FROM workbook_snapshots
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY uploaded_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

// GET /api/colony — reads from dedicated normalized colony tables
colonyRouter.get("/api/colony", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const active = await getActiveSnapshot(userId);

    const tablesRead = [
      "workbook_snapshots",
      "colony_metric_rows",
      "drift_event_rows",
      "threshold_lab_rows",
    ];

    if (!active) {
      return res.status(404).json({
        error: "No active workbook snapshot for this user",
        _provenance: {
          db: dbProv,
          userId,
          activeWorkbookSnapshotId: null,
          tablesRead,
          source: "postgres",
        },
      });
    }

    const [coordResult, driftResult, labResult] = await Promise.all([
      pool.query(
        `SELECT
           row_index,
           metric,
           metric_value,
           threshold_value,
           status,
           recommendation,
           confidence,
           raw_json
         FROM colony_metric_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY row_index ASC`,
        [active.id]
      ),
      pool.query(
        `SELECT
           row_index,
           drift_date,
           phase,
           drift_type,
           drift_source,
           confidence,
           weighted_drift_score,
           watch_flag,
           raw_json
         FROM drift_event_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY drift_date DESC NULLS LAST, row_index DESC`,
        [active.id]
      ),
      pool.query(
        `SELECT
           row_index,
           threshold_name,
           current_value,
           suggested_value,
           evidence_count,
           notes,
           raw_json
         FROM threshold_lab_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY row_index ASC`,
        [active.id]
      ),
    ]);

    return res.json({
      colonyCoord: coordResult.rows.map((r) => ({
        rowIndex: r.row_index,
        metric: r.metric,
        value: r.metric_value,
        threshold: r.threshold_value,
        status: r.status,
        recommendation: r.recommendation,
        confidence: r.confidence,
        raw: r.raw_json,
      })),
      driftHistory: driftResult.rows.map((r) => ({
        rowIndex: r.row_index,
        date: r.drift_date ? new Date(r.drift_date).toISOString().slice(0, 10) : null,
        phase: r.phase,
        driftType: r.drift_type,
        driftSource: r.drift_source,
        confidence: r.confidence,
        weightedDriftScore:
          r.weighted_drift_score !== null ? Number(r.weighted_drift_score) : null,
        watchFlag: r.watch_flag,
        raw: r.raw_json,
      })),
      thresholdLab: labResult.rows.map((r) => ({
        rowIndex: r.row_index,
        thresholdName: r.threshold_name,
        currentValue: r.current_value,
        suggestedValue: r.suggested_value,
        evidenceCount: r.evidence_count !== null ? Number(r.evidence_count) : null,
        notes: r.notes,
        raw: r.raw_json,
      })),
      _provenance: {
        db: dbProv,
        userId,
        activeWorkbookSnapshotId: active.id,
        activeWorkbookFilename: active.filename,
        activeWorkbookVersionTag: active.version_tag,
        tablesRead,
        source: "postgres",
      },
    });
  } catch (err: any) {
    console.error("[colony] error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message || "Failed to load colony state",
      _provenance: {
        db: dbProv,
        userId: null,
        activeWorkbookSnapshotId: null,
        tablesRead: [
          "workbook_snapshots",
          "colony_metric_rows",
          "drift_event_rows",
          "threshold_lab_rows",
        ],
        source: "postgres",
      },
    });
  }
});
