/**
 * server/routes/biolog.ts
 * NEW CANONICAL: GET /api/biolog
 *
 * Truth read: biolog_rows (keyed to active workbook_snapshot_id)
 * User scope: X-User-Id header — REQUIRED. No fallback.
 * No daily_log reads. No legacy data.
 * Provenance: every response includes _provenance block.
 */
import { Router, Request, Response } from "express";
import { pool, getDbProvenance } from "../db/pool.js";

export const biologRouter = Router();

function requireUserId(req: Request): string {
  const userId = (req.headers["x-user-id"] as string | undefined)?.trim();
  if (!userId) {
    const err: any = new Error("X-User-Id header is required");
    err.statusCode = 400;
    throw err;
  }
  return userId;
}

async function getActiveSnapshotId(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT id FROM workbook_snapshots WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
    [userId]
  );
  if (result.rows.length === 0) {
    const err: any = new Error(
      "No active workbook snapshot. Upload and activate a workbook first."
    );
    err.statusCode = 404;
    throw err;
  }
  return result.rows[0].id;
}

// GET /api/biolog — all biolog rows from the active snapshot
biologRouter.get("/api/biolog", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit = Math.min(Number(req.query.limit || 500), 2000);
    const offset = Number(req.query.offset || 0);
    const phase = req.query.phase as string | undefined;

    let query = `
      SELECT id, row_index, biolog_date, phase,
             source_date_key, source_phase_key, raw_json
      FROM biolog_rows
      WHERE workbook_snapshot_id = $1
    `;
    const params: (string | number)[] = [snapshotId];

    if (phase) {
      params.push(phase);
      query += ` AND phase = $${params.length}`;
    }

    query += ` ORDER BY biolog_date ASC NULLS LAST, row_index ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return res.json({
      rows: result.rows,
      count: result.rows.length,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["biolog_rows"],
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      _provenance: { db: dbProv },
    });
  }
});

// GET /api/biolog/phases — distinct phases from active snapshot
biologRouter.get("/api/biolog/phases", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const result = await pool.query(
      `SELECT DISTINCT phase, COUNT(*) as row_count
       FROM biolog_rows
       WHERE workbook_snapshot_id = $1 AND phase IS NOT NULL
       GROUP BY phase
       ORDER BY phase`,
      [snapshotId]
    );

    return res.json({
      phases: result.rows,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["biolog_rows"],
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: dbProv } });
  }
});

// GET /api/biolog/latest — most recent biolog row by date from active snapshot
biologRouter.get("/api/biolog/latest", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const result = await pool.query(
      `SELECT id, row_index, biolog_date, phase, raw_json
       FROM biolog_rows
       WHERE workbook_snapshot_id = $1
       ORDER BY biolog_date DESC NULLS LAST, row_index DESC
       LIMIT 1`,
      [snapshotId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "No biolog rows in active snapshot",
        _provenance: {
          db: dbProv,
          userId,
          workbookSnapshotId: snapshotId,
          tablesRead: ["biolog_rows"],
        },
      });
    }

    return res.json({
      row: result.rows[0],
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["biolog_rows"],
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: dbProv } });
  }
});
