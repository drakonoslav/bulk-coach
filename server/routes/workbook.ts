/**
 * server/routes/workbook.ts
 * NEW CANONICAL: snapshot list, active, activate, delete, raw-sheet access
 *
 * Truth read/written: workbook_snapshots only (never workbook_versions).
 * User scope: X-User-Id header — REQUIRED. No fallback.
 * Provenance: every response includes _provenance block.
 *
 * ROUTES:
 *   GET  /api/snapshots               — list all snapshots for user
 *   GET  /api/snapshots/active        — get the active snapshot (returns activeSnapshot key)
 *   PATCH /api/workbooks/:id/activate — activate a snapshot (canonical frontend contract)
 *   PATCH /api/snapshots/:id/activate — alias kept for backward compat
 *   DELETE /api/snapshots/:id         — cascade delete
 *   GET  /api/snapshots/:id/sheets    — sheet metadata
 *   GET  /api/snapshots/:id/rows/:sheet — paginated raw rows
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

function prov(
  userId: string,
  activeSnapshotId?: number | null,
  tables: string[] = ["workbook_snapshots"]
) {
  return {
    db: getDbProvenance(),
    userId,
    activeWorkbookSnapshotId: activeSnapshotId ?? null,
    tablesRead: tables,
    source: "postgres",
  };
}

function provErr(tables: string[] = ["workbook_snapshots"]) {
  return {
    db: getDbProvenance(),
    userId: null,
    activeWorkbookSnapshotId: null,
    tablesRead: tables,
    source: "postgres",
  };
}

function rowToSnapshot(row: any) {
  // filename_date comes back as a Date object from pg; serialize as YYYY-MM-DD string
  let filenameDate: string | null = null;
  if (row.filename_date) {
    if (row.filename_date instanceof Date) {
      filenameDate = row.filename_date.toISOString().slice(0, 10);
    } else if (typeof row.filename_date === "string") {
      filenameDate = row.filename_date.slice(0, 10);
    }
  }
  return {
    id: row.id,
    filename: row.filename,
    filenameDate,
    versionTag: row.version_tag ?? null,
    uploadedAt: row.uploaded_at,
    isActive: row.is_active,
    rowCounts: row.row_counts || {},
    warnings: row.warnings || [],
  };
}

// ── GET /api/snapshots ─────────────────────────────────────────────────────────
workbookRouter.get("/api/snapshots", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const result = await pool.query(
      `SELECT id, filename, filename_date, version_tag, uploaded_at, is_active,
              row_counts, warnings
       FROM workbook_snapshots
       WHERE user_id = $1
       ORDER BY
         is_active DESC,
         COALESCE(filename_date, uploaded_at::date) DESC,
         uploaded_at DESC`,
      [userId]
    );

    const activeId = result.rows.find((r) => r.is_active)?.id ?? null;

    return res.json({
      snapshots: result.rows.map(rowToSnapshot),
      _provenance: prov(userId, activeId),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: provErr() });
  }
});

// ── GET /api/snapshots/active ─────────────────────────────────────────────────
// Returns { activeSnapshot: WorkbookSnapshot, _provenance }
// NOTE: key is "activeSnapshot", not "snapshot" — matches frontend contract.
workbookRouter.get("/api/snapshots/active", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const result = await pool.query(
      `SELECT id, filename, filename_date, version_tag, uploaded_at, is_active,
              row_counts, warnings
       FROM workbook_snapshots
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY uploaded_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "No active workbook snapshot. Upload and activate a workbook first.",
        _provenance: prov(userId, null),
      });
    }

    const row = result.rows[0];
    return res.json({
      activeSnapshot: rowToSnapshot(row),
      _provenance: prov(userId, row.id),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: provErr() });
  }
});

// ── PATCH /api/workbooks/:id/activate ─────────────────────────────────────────
// Canonical frontend contract route.
// Returns { ok, activatedSnapshotId, _provenance }
async function handleActivate(req: Request, res: Response) {
  const client = await pool.connect();
  try {
    const userId = requireUserId(req);
    const snapshotId = Number(req.params.id);

    if (!Number.isFinite(snapshotId)) {
      return res.status(400).json({
        error: "Invalid workbook snapshot id",
        _provenance: prov(userId, null),
      });
    }

    await client.query("BEGIN");

    const owned = await client.query(
      `SELECT id FROM workbook_snapshots WHERE id = $1 AND user_id = $2`,
      [snapshotId, userId]
    );

    if (owned.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Workbook snapshot not found for this user",
        _provenance: prov(userId, null),
      });
    }

    await client.query(
      `UPDATE workbook_snapshots SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );

    await client.query(
      `UPDATE workbook_snapshots SET is_active = TRUE WHERE id = $1 AND user_id = $2`,
      [snapshotId, userId]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      activatedSnapshotId: snapshotId,
      _provenance: prov(userId, snapshotId),
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: provErr() });
  } finally {
    client.release();
  }
}

// Both route paths point to the same handler
workbookRouter.patch("/api/workbooks/:id/activate", handleActivate);
workbookRouter.patch("/api/snapshots/:id/activate", handleActivate);

// ── DELETE /api/snapshots/:id ─────────────────────────────────────────────────
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
        _provenance: prov(userId, snapshotId),
      });
    }
    return res.json({
      ok: true,
      deletedId: snapshotId,
      _provenance: {
        ...prov(userId, null),
        tablesRead: ["workbook_snapshots", "workbook_sheet_rows", "biolog_rows"],
      },
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: provErr() });
  }
});

// ── GET /api/snapshots/:id/sheets ─────────────────────────────────────────────
workbookRouter.get("/api/snapshots/:id/sheets", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = parseInt(req.params.id, 10);
    const snap = await pool.query(
      `SELECT id, sheet_names, row_counts, warnings
       FROM workbook_snapshots WHERE id = $1 AND user_id = $2`,
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
      _provenance: prov(userId, snapshotId),
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message, _provenance: provErr() });
  }
});

// ── GET /api/snapshots/:id/rows/:sheet ───────────────────────────────────────
workbookRouter.get(
  "/api/snapshots/:id/rows/:sheet",
  async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req);
      const snapshotId = parseInt(req.params.id, 10);
      const sheetName = req.params.sheet;
      const limit = Math.min(Number(req.query.limit || 200), 1000);
      const offset = Number(req.query.offset || 0);

      const snap = await pool.query(
        `SELECT id FROM workbook_snapshots WHERE id = $1 AND user_id = $2`,
        [snapshotId, userId]
      );
      if (snap.rows.length === 0) {
        return res.status(404).json({ error: "Snapshot not found for this user" });
      }

      const rows = await pool.query(
        `SELECT row_index, raw_json
         FROM snapshot_sheet_rows
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
        _provenance: { ...prov(userId, snapshotId), tablesRead: ["snapshot_sheet_rows"] },
      });
    } catch (err: any) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message, _provenance: provErr() });
    }
  }
);
