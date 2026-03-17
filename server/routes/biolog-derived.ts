/**
 * server/routes/biolog-derived.ts
 *
 * GET /api/biolog/derived
 *
 * Returns all biolog rows from the active workbook snapshot,
 * each enriched with canonical field mapping and derived physiological metrics.
 *
 * Truth: biolog_rows (FK → workbook_snapshots.is_active)
 * No daily_log reads. No legacy fallback. No inferred fields.
 * Requires X-User-Id header.
 */

import { Router } from "express";
import { pool, getDbProvenance } from "../db/pool.js";
import { deriveBiologRow } from "../services/biologDerived.js";

const router = Router();

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
    `SELECT id, filename, uploaded_at, version_tag
     FROM workbook_snapshots
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY uploaded_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

router.get("/api/biolog/derived", async (req: any, res: any) => {
  const dbProv = getDbProvenance();
  let userId: string | null = null;

  try {
    userId = requireUserId(req);
    const limit = Math.min(Number(req.query.limit || 200), 1000);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const phase = req.query.phase as string | undefined;

    const active = await getActiveSnapshot(userId);
    if (!active) {
      return res.status(404).json({
        error: "No active workbook snapshot for this user",
        _provenance: {
          db: dbProv,
          userId,
          activeWorkbookSnapshotId: null,
          tablesRead: ["workbook_snapshots", "biolog_rows"],
          source: "postgres",
        },
      });
    }

    let query = `
      SELECT
        row_index,
        biolog_date,
        phase,
        raw_json
      FROM biolog_rows
      WHERE workbook_snapshot_id = $1
    `;
    const params: (string | number)[] = [active.id];

    if (phase) {
      params.push(phase);
      query += ` AND phase = $${params.length}`;
    }

    query += ` ORDER BY biolog_date NULLS LAST, row_index ASC
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const rowsResult = await pool.query(query, params);

    return res.json({
      rows: rowsResult.rows.map((r) => {
        const derived = deriveBiologRow(r.raw_json || {});
        return {
          rowIndex: r.row_index,
          biologDate: r.biolog_date instanceof Date
            ? r.biolog_date.toISOString().slice(0, 10)
            : r.biolog_date,
          workbookPhase: r.phase,
          canonical: derived.canonical,
          derived: derived.derived,
        };
      }),
      total: rowsResult.rows.length,
      _provenance: {
        db: dbProv,
        userId,
        activeWorkbookSnapshotId: active.id,
        activeWorkbookFilename: active.filename,
        activeWorkbookVersionTag: active.version_tag,
        tablesRead: ["workbook_snapshots", "biolog_rows"],
        source: "postgres",
      },
    });
  } catch (err: any) {
    console.error("[biolog/derived] error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message || "Failed to load derived biolog rows",
      _provenance: {
        db: dbProv,
        userId,
        activeWorkbookSnapshotId: null,
        tablesRead: ["workbook_snapshots", "biolog_rows"],
        source: "postgres",
      },
    });
  }
});

export { router as biologDerivedRouter };
