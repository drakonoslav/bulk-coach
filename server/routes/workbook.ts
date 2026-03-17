/**
 * server/routes/workbook.ts
 * NEW CANONICAL: snapshot list, activate, delete
 *
 * Truth read/written: workbook_snapshots
 * User scope: X-User-Id header — REQUIRED. No fallback.
 * Provenance: every response includes _provenance block.
 */
import { Router, Request, Response } from "express";
import { pool, getDbProvenance } from "../db/pool.js";

export const workbookRouter = Router();

function requireUserId(req: Request): string {
  const userId = (req.headers["x-user-id"] as string | undefined)?.trim();
  if (!userId) {
    const err: any = new Error("X-User-Id header is required");
    err.statusCode = 400;
    throw err;
  }
  return userId;
}

function provenance(
  userId: string,
  snapshotId?: number | string | null,
  tables: string[] = ["workbook_snapshots"]
) {
  return {
    db: getDbProvenance(),
    userId,
    workbookSnapshotId: snapshotId ?? null,
    tablesRead: tables,
  };
}

// GET /api/snapshots — list all snapshots for user
workbookRouter.get("/api/snapshots", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const result = await pool.query(
      `SELECT id, user_id, filename, version_tag, uploaded_at, is_active,
              sheet_names, row_counts, warnings, source_sha256, original_file_size_bytes
       FROM workbook_snapshots
       WHERE user_id = $1
       ORDER BY uploaded_at DESC`,
      [userId]
    );
    return res.json({
      snapshots: result.rows,
      _provenance: provenance(userId),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: getDbProvenance() } });
  }
});

// GET /api/snapshots/active — get the active snapshot for user
workbookRouter.get("/api/snapshots/active", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const result = await pool.query(
      `SELECT id, user_id, filename, version_tag, uploaded_at, is_active,
              sheet_names, row_counts, warnings, source_sha256, original_file_size_bytes
       FROM workbook_snapshots
       WHERE user_id = $1 AND is_active = TRUE
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "No active snapshot. Upload a workbook first.",
        _provenance: provenance(userId, null),
      });
    }

    const snap = result.rows[0];
    return res.json({
      snapshot: snap,
      _provenance: provenance(userId, snap.id),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: getDbProvenance() } });
  }
});

// PATCH /api/snapshots/:id/activate — set a snapshot as active
workbookRouter.patch("/api/snapshots/:id/activate", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = parseInt(req.params.id, 10);
    if (Number.isNaN(snapshotId)) {
      return res.status(400).json({ error: "Invalid snapshot id" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE workbook_snapshots SET is_active = FALSE WHERE user_id = $1`,
        [userId]
      );
      const result = await client.query(
        `UPDATE workbook_snapshots
         SET is_active = TRUE
         WHERE id = $1 AND user_id = $2
         RETURNING id, filename, version_tag, uploaded_at`,
        [snapshotId, userId]
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          error: "Snapshot not found for this user",
          _provenance: provenance(userId, snapshotId),
        });
      }
      await client.query("COMMIT");
      const snap = result.rows[0];
      return res.json({
        ok: true,
        activatedSnapshot: snap,
        _provenance: provenance(userId, snap.id, ["workbook_snapshots"]),
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: getDbProvenance() } });
  }
});

// DELETE /api/snapshots/:id — delete a snapshot (cascades to sheet rows and biolog rows)
workbookRouter.delete("/api/snapshots/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = parseInt(req.params.id, 10);
    if (Number.isNaN(snapshotId)) {
      return res.status(400).json({ error: "Invalid snapshot id" });
    }
    const result = await pool.query(
      `DELETE FROM workbook_snapshots WHERE id = $1 AND user_id = $2 RETURNING id`,
      [snapshotId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Snapshot not found for this user",
        _provenance: provenance(userId, snapshotId),
      });
    }
    return res.json({
      ok: true,
      deletedId: snapshotId,
      _provenance: provenance(userId, snapshotId, [
        "workbook_snapshots",
        "workbook_sheet_rows",
        "biolog_rows",
      ]),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: getDbProvenance() } });
  }
});

// GET /api/snapshots/:id/sheets — list sheet names + row counts for a snapshot
workbookRouter.get("/api/snapshots/:id/sheets", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = parseInt(req.params.id, 10);
    const snap = await pool.query(
      `SELECT id, sheet_names, row_counts, warnings FROM workbook_snapshots
       WHERE id = $1 AND user_id = $2`,
      [snapshotId, userId]
    );
    if (snap.rows.length === 0) {
      return res.status(404).json({ error: "Snapshot not found" });
    }
    return res.json({
      snapshotId,
      sheetNames: snap.rows[0].sheet_names,
      rowCounts: snap.rows[0].row_counts,
      warnings: snap.rows[0].warnings,
      _provenance: provenance(userId, snapshotId, ["workbook_snapshots"]),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: getDbProvenance() } });
  }
});

// GET /api/snapshots/:id/rows/:sheet — paginated raw rows for a sheet
workbookRouter.get("/api/snapshots/:id/rows/:sheet", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = parseInt(req.params.id, 10);
    const sheetName = req.params.sheet;
    const limit = Math.min(Number(req.query.limit || 200), 1000);
    const offset = Number(req.query.offset || 0);

    // Verify ownership
    const snap = await pool.query(
      `SELECT id FROM workbook_snapshots WHERE id = $1 AND user_id = $2`,
      [snapshotId, userId]
    );
    if (snap.rows.length === 0) {
      return res.status(404).json({ error: "Snapshot not found for this user" });
    }

    const rows = await pool.query(
      `SELECT row_index, raw_json
       FROM workbook_sheet_rows
       WHERE workbook_snapshot_id = $1 AND sheet_name = $2
       ORDER BY row_index ASC
       LIMIT $3 OFFSET $4`,
      [snapshotId, sheetName, limit, offset]
    );

    return res.json({
      snapshotId,
      sheetName,
      rows: rows.rows,
      count: rows.rows.length,
      _provenance: provenance(userId, snapshotId, ["workbook_sheet_rows"]),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: { db: getDbProvenance() } });
  }
});
