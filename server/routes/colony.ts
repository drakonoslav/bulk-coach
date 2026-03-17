/**
 * server/routes/colony.ts
 * NEW CANONICAL: GET /api/colony
 *
 * Truth read: snapshot_sheet_rows WHERE sheet_name IN ('colony_coord','drift_history','threshold_lab')
 *             from the active workbook_snapshot.
 * User scope: X-User-Id header — REQUIRED. No fallback.
 * No runtime-derived colony state. Colony_coord workbook sheet is the only authority.
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

async function getSheetRows(snapshotId: number, sheetName: string, limit = 500) {
  const result = await pool.query(
    `SELECT row_index, raw_json
     FROM snapshot_sheet_rows
     WHERE workbook_snapshot_id = $1 AND sheet_name = $2
     ORDER BY row_index ASC
     LIMIT $3`,
    [snapshotId, sheetName, limit]
  );
  return result.rows;
}

// GET /api/colony/coords — colony_coord sheet
colonyRouter.get("/api/colony/coords", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);
    const rows = await getSheetRows(snapshotId, "colony_coord");
    return res.json({
      sheet: "colony_coord",
      rows,
      count: rows.length,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["snapshot_sheet_rows"],
        sheetName: "colony_coord",
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message, _provenance: { db: dbProv } });
  }
});

// GET /api/colony/drift — drift_history sheet
colonyRouter.get("/api/colony/drift", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);
    const rows = await getSheetRows(snapshotId, "drift_history");
    return res.json({
      sheet: "drift_history",
      rows,
      count: rows.length,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["snapshot_sheet_rows"],
        sheetName: "drift_history",
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message, _provenance: { db: dbProv } });
  }
});

// GET /api/colony/thresholds — threshold_lab sheet
colonyRouter.get("/api/colony/thresholds", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);
    const rows = await getSheetRows(snapshotId, "threshold_lab");
    return res.json({
      sheet: "threshold_lab",
      rows,
      count: rows.length,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["snapshot_sheet_rows"],
        sheetName: "threshold_lab",
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message, _provenance: { db: dbProv } });
  }
});

// GET /api/colony — combined summary from all colony sheets
colonyRouter.get("/api/colony", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const [coords, drift, thresholds] = await Promise.all([
      getSheetRows(snapshotId, "colony_coord"),
      getSheetRows(snapshotId, "drift_history"),
      getSheetRows(snapshotId, "threshold_lab"),
    ]);

    return res.json({
      coords: { rows: coords, count: coords.length },
      drift: { rows: drift, count: drift.length },
      thresholds: { rows: thresholds, count: thresholds.length },
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["snapshot_sheet_rows"],
        sheetsRead: ["colony_coord", "drift_history", "threshold_lab"],
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message, _provenance: { db: dbProv } });
  }
});
