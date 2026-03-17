/**
 * server/routes/nutrition.ts
 * NEW CANONICAL: GET /api/nutrition/*
 *
 * Truth read:
 *   meal_line_rows      — normalized meal lines (keyed to active workbook_snapshot_id)
 *   meal_template_rows  — normalized meal templates (keyed to active workbook_snapshot_id)
 *   workbook_sheet_rows — raw ingredients sheet (keyed to active workbook_snapshot_id)
 *
 * User scope: X-User-Id header — REQUIRED. No fallback. No local_default.
 * No AsyncStorage identity. No legacy daily_log reads.
 * No native nutrition recomputation — workbook-derived truth only.
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

function prov(
  userId: string,
  snapshotId: number | null,
  tablesRead: string[],
  extra?: Record<string, unknown>
) {
  return {
    db: getDbProvenance(),
    userId,
    workbookSnapshotId: snapshotId,
    tablesRead,
    source: "workbook_snapshot",
    ...extra,
  };
}

// ── GET /api/nutrition/meal-lines ──────────────────────────────────────────────
// Returns normalized meal_line_rows from the active snapshot.
// Optional query params: phase, meal_template_id, limit, offset
nutritionRouter.get("/api/nutrition/meal-lines", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit  = Math.min(Number(req.query.limit  || 1000), 5000);
    const offset = Number(req.query.offset || 0);
    const phase  = req.query.phase as string | undefined;
    const templateId = req.query.meal_template_id as string | undefined;

    const params: unknown[] = [snapshotId];
    let where = "WHERE workbook_snapshot_id = $1";

    if (phase) {
      params.push(phase);
      where += ` AND phase = $${params.length}`;
    }
    if (templateId) {
      params.push(templateId);
      where += ` AND meal_template_id = $${params.length}`;
    }

    params.push(limit, offset);

    const result = await pool.query(
      `SELECT id, row_index, phase, meal_template_id, line_no,
              ingredient_id, amount_unit,
              kcal_line, protein_line, carbs_line, fat_line,
              raw_json
       FROM meal_line_rows
       ${where}
       ORDER BY meal_template_id NULLS LAST, line_no NULLS LAST, row_index ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      rows: result.rows,
      count: result.rows.length,
      _provenance: prov(userId, snapshotId, ["meal_line_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      _provenance: { db: dbProv },
    });
  }
});

// ── GET /api/nutrition/meal-templates ─────────────────────────────────────────
// Returns normalized meal_template_rows from the active snapshot.
// Optional query params: phase, meal_template_id, limit, offset
nutritionRouter.get("/api/nutrition/meal-templates", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit  = Math.min(Number(req.query.limit  || 500), 2000);
    const offset = Number(req.query.offset || 0);
    const phase  = req.query.phase as string | undefined;
    const templateId = req.query.meal_template_id as string | undefined;

    const params: unknown[] = [snapshotId];
    let where = "WHERE workbook_snapshot_id = $1";

    if (phase) {
      params.push(phase);
      where += ` AND phase = $${params.length}`;
    }
    if (templateId) {
      params.push(templateId);
      where += ` AND meal_template_id = $${params.length}`;
    }

    params.push(limit, offset);

    const result = await pool.query(
      `SELECT id, row_index, phase, meal_template_id,
              kcal_sum, protein_sum, carbs_sum, fat_sum,
              raw_json
       FROM meal_template_rows
       ${where}
       ORDER BY phase NULLS LAST, meal_template_id NULLS LAST, row_index ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      rows: result.rows,
      count: result.rows.length,
      _provenance: prov(userId, snapshotId, ["meal_template_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      _provenance: { db: dbProv },
    });
  }
});

// ── GET /api/nutrition/ingredients ───────────────────────────────────────────
// Returns raw ingredients sheet rows from workbook_sheet_rows.
// (Ingredients are not yet normalized into their own table — raw only for now.)
nutritionRouter.get("/api/nutrition/ingredients", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit  = Math.min(Number(req.query.limit  || 500), 2000);
    const offset = Number(req.query.offset || 0);

    const result = await pool.query(
      `SELECT row_index, raw_json
       FROM workbook_sheet_rows
       WHERE workbook_snapshot_id = $1 AND sheet_name = 'ingredients'
       ORDER BY row_index ASC
       LIMIT $2 OFFSET $3`,
      [snapshotId, limit, offset]
    );

    return res.json({
      sheet: "ingredients",
      rows: result.rows,
      count: result.rows.length,
      _provenance: prov(userId, snapshotId, ["workbook_sheet_rows"], { sheetName: "ingredients" }),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      _provenance: { db: dbProv },
    });
  }
});

// ── GET /api/nutrition/summary ────────────────────────────────────────────────
// Aggregated totals per template from meal_template_rows.
// Groups by phase + meal_template_id. No native computation — reads stored values.
nutritionRouter.get("/api/nutrition/summary", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const phase = req.query.phase as string | undefined;

    const params: unknown[] = [snapshotId];
    let where = "WHERE workbook_snapshot_id = $1";

    if (phase) {
      params.push(phase);
      where += ` AND phase = $${params.length}`;
    }

    // Aggregated template summary — reads stored kcal_sum/protein_sum etc.
    const templates = await pool.query(
      `SELECT phase, meal_template_id,
              kcal_sum, protein_sum, carbs_sum, fat_sum,
              row_index
       FROM meal_template_rows
       ${where}
       ORDER BY phase NULLS LAST, meal_template_id NULLS LAST`,
      params
    );

    // Total line counts per template
    const lineCounts = await pool.query(
      `SELECT meal_template_id, COUNT(*) AS line_count,
              SUM(kcal_line) AS total_kcal,
              SUM(protein_line) AS total_protein,
              SUM(carbs_line) AS total_carbs,
              SUM(fat_line) AS total_fat
       FROM meal_line_rows
       ${where}
       GROUP BY meal_template_id`,
      params
    );

    const lineMap: Record<string, any> = {};
    for (const row of lineCounts.rows) {
      lineMap[row.meal_template_id ?? "__null__"] = row;
    }

    return res.json({
      templates: templates.rows,
      lineSums: lineCounts.rows,
      _provenance: prov(userId, snapshotId, ["meal_template_rows", "meal_line_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      _provenance: { db: dbProv },
    });
  }
});

// ── GET /api/nutrition ────────────────────────────────────────────────────────
// Combined: meal_templates + meal_lines + ingredients (raw) in one call.
nutritionRouter.get("/api/nutrition", async (req: Request, res: Response) => {
  const dbProv = getDbProvenance();
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const [templates, lines, ingredients] = await Promise.all([
      pool.query(
        `SELECT row_index, phase, meal_template_id,
                kcal_sum, protein_sum, carbs_sum, fat_sum, raw_json
         FROM meal_template_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY phase NULLS LAST, meal_template_id, row_index`,
        [snapshotId]
      ),
      pool.query(
        `SELECT row_index, phase, meal_template_id, line_no,
                ingredient_id, amount_unit,
                kcal_line, protein_line, carbs_line, fat_line, raw_json
         FROM meal_line_rows
         WHERE workbook_snapshot_id = $1
         ORDER BY meal_template_id, line_no NULLS LAST, row_index`,
        [snapshotId]
      ),
      pool.query(
        `SELECT row_index, raw_json
         FROM workbook_sheet_rows
         WHERE workbook_snapshot_id = $1 AND sheet_name = 'ingredients'
         ORDER BY row_index`,
        [snapshotId]
      ),
    ]);

    return res.json({
      mealTemplates: { rows: templates.rows, count: templates.rows.length },
      mealLines: { rows: lines.rows, count: lines.rows.length },
      ingredients: { rows: ingredients.rows, count: ingredients.rows.length },
      _provenance: prov(userId, snapshotId, [
        "meal_template_rows",
        "meal_line_rows",
        "workbook_sheet_rows",
      ]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      _provenance: { db: dbProv },
    });
  }
});
