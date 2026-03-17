/**
 * server/routes/nutrition.ts
 * NEW CANONICAL: GET /api/nutrition/*
 *
 * Truth read:
 *   meal_line_rows      — normalized meal lines (keyed to active workbook_snapshot_id)
 *   meal_template_rows  — normalized meal templates (keyed to active workbook_snapshot_id)
 *   snapshot_sheet_rows — raw ingredients sheet (keyed to active workbook_snapshot_id)
 *
 * User scope: X-User-Id header — REQUIRED. No fallback. No local_default.
 * No AsyncStorage identity. No legacy daily_log reads.
 * No native nutrition recomputation — workbook-derived truth only.
 * Provenance: every response includes provenance block matching ApiProvenance shape.
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

function makeProv(
  userId: string,
  snapshotId: number | null,
  tablesRead: string[]
) {
  return {
    db: getDbProvenance(),
    userId,
    activeWorkbookSnapshotId: snapshotId,
    tablesRead,
    source: "postgres",
  };
}

// ── GET /api/nutrition/summary ────────────────────────────────────────────────
// Without ?phase  → NutritionSummaryAllPhasesResponse: {phases, provenance}
// With ?phase=X   → NutritionSummaryForPhaseResponse: {phase, templateRows, totals, provenance}
nutritionRouter.get("/api/nutrition/summary", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);
    const phase = (req.query.phase as string | undefined)?.trim() || null;

    if (phase) {
      // Single-phase summary
      const templates = await pool.query(
        `SELECT row_index, phase, meal_template_id,
                kcal_sum, protein_sum, carbs_sum, fat_sum, raw_json
         FROM meal_template_rows
         WHERE workbook_snapshot_id = $1 AND phase = $2
         ORDER BY meal_template_id NULLS LAST, row_index ASC`,
        [snapshotId, phase]
      );

      const templateRows = templates.rows.map((r) => ({
        rowIndex: r.row_index,
        phase: r.phase,
        mealTemplateId: r.meal_template_id,
        kcalSum: r.kcal_sum !== null ? Number(r.kcal_sum) : null,
        proteinSum: r.protein_sum !== null ? Number(r.protein_sum) : null,
        carbsSum: r.carbs_sum !== null ? Number(r.carbs_sum) : null,
        fatSum: r.fat_sum !== null ? Number(r.fat_sum) : null,
        raw: r.raw_json,
      }));

      const totals = {
        kcal: templateRows.reduce((s, r) => s + (r.kcalSum ?? 0), 0),
        protein: templateRows.reduce((s, r) => s + (r.proteinSum ?? 0), 0),
        carbs: templateRows.reduce((s, r) => s + (r.carbsSum ?? 0), 0),
        fat: templateRows.reduce((s, r) => s + (r.fatSum ?? 0), 0),
      };

      return res.json({
        phase,
        templateRows,
        totals,
        provenance: makeProv(userId, snapshotId, ["workbook_snapshots", "meal_template_rows"]),
      });
    }

    // All-phases summary — one row per distinct phase
    const allPhases = await pool.query(
      `SELECT phase,
              SUM(kcal_sum)    AS kcal,
              SUM(protein_sum) AS protein,
              SUM(carbs_sum)   AS carbs,
              SUM(fat_sum)     AS fat
       FROM meal_template_rows
       WHERE workbook_snapshot_id = $1
       GROUP BY phase
       ORDER BY phase NULLS LAST`,
      [snapshotId]
    );

    const phases = allPhases.rows.map((r) => ({
      phase: r.phase,
      kcal: r.kcal !== null ? Number(r.kcal) : 0,
      protein: r.protein !== null ? Number(r.protein) : 0,
      carbs: r.carbs !== null ? Number(r.carbs) : 0,
      fat: r.fat !== null ? Number(r.fat) : 0,
    }));

    return res.json({
      phases,
      provenance: makeProv(userId, snapshotId, ["workbook_snapshots", "meal_template_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      provenance: { db: getDbProvenance(), userId: null, activeWorkbookSnapshotId: null, tablesRead: [], source: "postgres" },
    });
  }
});

// ── GET /api/nutrition ────────────────────────────────────────────────────────
// Returns NutritionMealLinesResponse: {rows, total, provenance}
// Optional query params: phase, mealTemplateId, limit, offset
nutritionRouter.get("/api/nutrition", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit = Math.min(Number(req.query.limit || 1000), 5000);
    const offset = Number(req.query.offset || 0);
    const phase = (req.query.phase as string | undefined)?.trim() || null;
    const mealTemplateId = (req.query.mealTemplateId as string | undefined)?.trim() || null;

    const params: unknown[] = [snapshotId];
    let where = "WHERE workbook_snapshot_id = $1";

    if (phase) {
      params.push(phase);
      where += ` AND phase = $${params.length}`;
    }
    if (mealTemplateId) {
      params.push(mealTemplateId);
      where += ` AND meal_template_id = $${params.length}`;
    }

    params.push(limit, offset);

    const result = await pool.query(
      `SELECT row_index, phase, meal_template_id, line_no,
              ingredient_id, amount_unit,
              kcal_line, protein_line, carbs_line, fat_line,
              raw_json
       FROM meal_line_rows
       ${where}
       ORDER BY meal_template_id NULLS LAST, line_no NULLS LAST, row_index ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const rows = result.rows.map((r) => ({
      rowIndex: r.row_index,
      phase: r.phase,
      mealTemplateId: r.meal_template_id,
      lineNo: r.line_no !== null ? Number(r.line_no) : null,
      ingredientId: r.ingredient_id,
      amountUnit: r.amount_unit !== null ? Number(r.amount_unit) : null,
      kcalLine: r.kcal_line !== null ? Number(r.kcal_line) : null,
      proteinLine: r.protein_line !== null ? Number(r.protein_line) : null,
      carbsLine: r.carbs_line !== null ? Number(r.carbs_line) : null,
      fatLine: r.fat_line !== null ? Number(r.fat_line) : null,
      raw: r.raw_json,
    }));

    return res.json({
      rows,
      total: rows.length,
      provenance: makeProv(userId, snapshotId, ["workbook_snapshots", "meal_line_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      provenance: { db: getDbProvenance(), userId: null, activeWorkbookSnapshotId: null, tablesRead: [], source: "postgres" },
    });
  }
});

// ── GET /api/nutrition/meal-lines ──────────────────────────────────────────────
// Retained for internal use. Optional query params: phase, meal_template_id, limit, offset
nutritionRouter.get("/api/nutrition/meal-lines", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit = Math.min(Number(req.query.limit || 1000), 5000);
    const offset = Number(req.query.offset || 0);
    const phase = req.query.phase as string | undefined;
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
      _provenance: makeProv(userId, snapshotId, ["meal_line_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── GET /api/nutrition/meal-templates ─────────────────────────────────────────
nutritionRouter.get("/api/nutrition/meal-templates", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit = Math.min(Number(req.query.limit || 500), 2000);
    const offset = Number(req.query.offset || 0);
    const phase = req.query.phase as string | undefined;
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
      _provenance: makeProv(userId, snapshotId, ["meal_template_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── GET /api/nutrition/ingredients ───────────────────────────────────────────
nutritionRouter.get("/api/nutrition/ingredients", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const snapshotId = await getActiveSnapshotId(userId);

    const limit = Math.min(Number(req.query.limit || 500), 2000);
    const offset = Number(req.query.offset || 0);

    const result = await pool.query(
      `SELECT row_index, raw_json
       FROM snapshot_sheet_rows
       WHERE workbook_snapshot_id = $1 AND sheet_name = 'ingredients'
       ORDER BY row_index ASC
       LIMIT $2 OFFSET $3`,
      [snapshotId, limit, offset]
    );

    return res.json({
      sheet: "ingredients",
      rows: result.rows,
      count: result.rows.length,
      _provenance: makeProv(userId, snapshotId, ["snapshot_sheet_rows"]),
    });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});
