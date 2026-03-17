/**
 * server/routes/nutrition.ts
 * NEW CANONICAL: GET /api/nutrition
 *
 * Truth read: workbook_sheet_rows WHERE sheet_name IN ('meal_lines','meal_templates','ingredients')
 *             from the active workbook_snapshot.
 * User scope: X-User-Id header — REQUIRED. No fallback.
 * No macro-templates.ts defaults. No daily_log reads.
 * Provenance: every response includes _provenance block.
 */
import { Router, Request, Response } from "express";
import { pool, getDbProvenance } from "../db/pool.js";

export const nutritionRouter = Router();

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
     FROM workbook_sheet_rows
     WHERE workbook_snapshot_id = $1 AND sheet_name = $2
     ORDER BY row_index ASC
     LIMIT $3`,
    [snapshotId, sheetName, limit]
  );
  return result.rows;
}

// GET /api/nutrition/meal-lines
nutritionRouter.get("/api/nutrition/meal-lines", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);
    const rows = await getSheetRows(snapshotId, "meal_lines");
    return res.json({
      sheet: "meal_lines",
      rows,
      count: rows.length,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["workbook_sheet_rows"],
        sheetName: "meal_lines",
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message, _provenance: { db: dbProv } });
  }
});

// GET /api/nutrition/meal-templates
nutritionRouter.get("/api/nutrition/meal-templates", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);
    const rows = await getSheetRows(snapshotId, "meal_templates");
    return res.json({
      sheet: "meal_templates",
      rows,
      count: rows.length,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["workbook_sheet_rows"],
        sheetName: "meal_templates",
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message, _provenance: { db: dbProv } });
  }
});

// GET /api/nutrition/ingredients
nutritionRouter.get("/api/nutrition/ingredients", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);
    const rows = await getSheetRows(snapshotId, "ingredients");
    return res.json({
      sheet: "ingredients",
      rows,
      count: rows.length,
      _provenance: {
        db: dbProv,
        userId,
        workbookSnapshotId: snapshotId,
        tablesRead: ["workbook_sheet_rows"],
        sheetName: "ingredients",
        source: "workbook_snapshot",
      },
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message, _provenance: { db: dbProv } });
  }
});
