import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { pool } from "./db.js";
import { buildProvenance, getActiveWorkbook } from "./provenance.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const EXPECTED_SHEETS = [
  "biolog",
  "ingredients",
  "meal_lines",
  "meal_templates",
  "drift_history",
  "colony_coord",
  "threshold_lab",
] as const;

function getUserId(req: any): string {
  return (req.headers["x-user-id"] as string) || "local_default";
}

// POST /api/workbooks/upload
router.post("/upload", upload.single("file"), async (req: any, res: any) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });

  const userId = getUserId(req);
  const versionTag: string | null = req.body?.versionTag || null;

  try {
    const wb = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
    const sheetsFound: string[] = wb.SheetNames;
    const rowCounts: Record<string, number> = {};
    const missing: string[] = [];
    const warnings: string[] = [];

    for (const s of EXPECTED_SHEETS) {
      if (!wb.Sheets[s]) missing.push(s);
    }
    if (missing.length) warnings.push(`Missing sheets: ${missing.join(", ")}`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const versionRes = await client.query(
        `INSERT INTO workbook_versions (user_id, filename, version_tag, sheets_found, row_counts)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, file.originalname, versionTag, sheetsFound, JSON.stringify({})]
      );
      const workbookId: number = versionRes.rows[0].id;

      for (const sheetName of EXPECTED_SHEETS) {
        if (!wb.Sheets[sheetName]) continue;
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, {
          defval: null,
          raw: false,
        });
        rowCounts[sheetName] = rows.length;

        for (let i = 0; i < rows.length; i++) {
          await client.query(
            `INSERT INTO workbook_sheet_rows (workbook_id, sheet_name, row_index, raw_json)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (workbook_id, sheet_name, row_index)
             DO UPDATE SET raw_json = EXCLUDED.raw_json`,
            [workbookId, sheetName, i, JSON.stringify(rows[i])]
          );
        }
      }

      await client.query(
        `UPDATE workbook_versions SET row_counts = $1 WHERE id = $2`,
        [JSON.stringify(rowCounts), workbookId]
      );

      await client.query("COMMIT");
      res.json({ workbookId, sheetsFound, rowCounts, warnings });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("workbook upload error:", err);
    res.status(500).json({ error: "Failed to parse workbook" });
  }
});

// GET /api/workbooks — list versions for current user
router.get("/", async (req: any, res: any) => {
  const userId = getUserId(req);
  const [result, provenance] = await Promise.all([
    pool.query(
      `SELECT id, filename, version_tag, uploaded_at, sheets_found, row_counts, is_active
       FROM workbook_versions WHERE user_id = $1 ORDER BY uploaded_at DESC`,
      [userId]
    ),
    buildProvenance(userId, ["workbook_versions"]),
  ]);
  res.json({ versions: result.rows, _provenance: provenance });
});

// GET /api/workbooks/:id/sheet/:sheetName — paginated raw rows
router.get("/:id/sheet/:sheetName", async (req: any, res: any) => {
  const userId = getUserId(req);
  const { id, sheetName } = req.params;
  const limit = Math.min(parseInt((req.query.limit as string) || "500"), 1000);
  const offset = parseInt((req.query.offset as string) || "0");

  const ver = await pool.query(
    `SELECT id FROM workbook_versions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!ver.rows.length) return res.status(404).json({ error: "Not found" });

  const [rows, cnt] = await Promise.all([
    pool.query(
      `SELECT row_index, raw_json FROM workbook_sheet_rows
       WHERE workbook_id = $1 AND sheet_name = $2
       ORDER BY row_index LIMIT $3 OFFSET $4`,
      [id, sheetName, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) FROM workbook_sheet_rows WHERE workbook_id = $1 AND sheet_name = $2`,
      [id, sheetName]
    ),
  ]);

  res.json({
    rows: rows.rows.map((r) => r.raw_json),
    total: parseInt(cnt.rows[0].count),
  });
});

// GET /api/workbooks/:id/summary — aggregated view for the 4 display panels
router.get("/:id/summary", async (req: any, res: any) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const ver = await pool.query(
    `SELECT * FROM workbook_versions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!ver.rows.length) return res.status(404).json({ error: "Not found" });

  const fetch = async (sheet: string, limit = 200) => {
    const r = await pool.query(
      `SELECT raw_json FROM workbook_sheet_rows
       WHERE workbook_id = $1 AND sheet_name = $2
       ORDER BY row_index LIMIT $3`,
      [id, sheet, limit]
    );
    return r.rows.map((x) => x.raw_json);
  };

  const [biolog, ingredients, mealLines, mealTemplates, driftHistory, colonies, thresholds] =
    await Promise.all([
      fetch("biolog"),
      fetch("ingredients"),
      fetch("meal_lines"),
      fetch("meal_templates"),
      fetch("drift_history"),
      fetch("colony_coord"),
      fetch("threshold_lab"),
    ]);

  // Derive current phase: last biolog row that has a "phase" key (case-insensitive)
  let currentPhase: Record<string, any> | null = null;
  for (let i = biolog.length - 1; i >= 0; i--) {
    const row = biolog[i] as Record<string, any>;
    const phaseKey = Object.keys(row).find((k) =>
      k.toLowerCase().includes("phase")
    );
    if (phaseKey && row[phaseKey]) {
      currentPhase = row;
      break;
    }
  }

  const provenance = await buildProvenance(userId, [
    "workbook_versions",
    "workbook_sheet_rows",
  ]);

  res.json({
    workbook: ver.rows[0],
    currentPhase,
    biolog,
    ingredients,
    mealLines,
    mealTemplates,
    driftHistory,
    colonies,
    thresholds,
    _provenance: provenance,
  });
});

// PATCH /api/workbooks/:id/activate — mark this snapshot as the active canonical source
router.patch("/:id/activate", async (req: any, res: any) => {
  const userId = getUserId(req);
  const { id } = req.params;

  const ver = await pool.query(
    `SELECT id, filename, version_tag FROM workbook_versions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!ver.rows.length) return res.status(404).json({ error: "Not found" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Deactivate all others for this user
    await client.query(
      `UPDATE workbook_versions SET is_active = false WHERE user_id = $1`,
      [userId]
    );
    // Activate the target
    await client.query(
      `UPDATE workbook_versions SET is_active = true WHERE id = $1`,
      [id]
    );
    await client.query("COMMIT");

    const provenance = await buildProvenance(userId, ["workbook_versions"]);
    res.json({
      ok: true,
      active_workbook_id: parseInt(id),
      filename: ver.rows[0].filename,
      version_tag: ver.rows[0].version_tag,
      _provenance: provenance,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/workbooks/:id — remove a version + all its rows
router.delete("/:id", async (req: any, res: any) => {
  const userId = getUserId(req);
  const { id } = req.params;
  const ver = await pool.query(
    `SELECT id FROM workbook_versions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!ver.rows.length) return res.status(404).json({ error: "Not found" });
  await pool.query(`DELETE FROM workbook_versions WHERE id = $1`, [id]);
  res.json({ ok: true });
});

export default router;
