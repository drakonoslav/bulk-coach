/**
 * server/routes/upload.ts
 * NEW CANONICAL: POST /api/upload-workbook
 *
 * Truth written:
 *   workbook_snapshots       — snapshot metadata + active flag
 *   workbook_sheet_rows      — all sheet rows as raw JSONB
 *   biolog_rows              — normalized biolog sheet rows
 *   meal_line_rows           — normalized meal_lines sheet rows
 *   meal_template_rows       — normalized meal_templates sheet rows
 *
 * User scope: X-User-Id header — REQUIRED. No fallback. Fails loudly.
 * No AsyncStorage identity. No local_default fallback.
 * Provenance: every response includes _provenance block.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { pool, getDbProvenance } from "../db/pool.js";
import { parseWorkbookBuffer } from "../services/workbookParser.js";

export const uploadRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function requireUserId(req: Request): string {
  const userId = (req.headers["x-user-id"] as string | undefined)?.trim();
  if (!userId) {
    const err: any = new Error(
      "X-User-Id header is required. No anonymous or fallback uploads allowed."
    );
    err.statusCode = 400;
    throw err;
  }
  return userId;
}

uploadRouter.post(
  "/api/upload-workbook",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const dbProv = getDbProvenance();
    try {
      const userId = requireUserId(req);
      const file = (req as any).file;

      if (!file) {
        return res.status(400).json({
          error: "No file uploaded",
          _provenance: { db: dbProv, userId: null },
        });
      }

      const versionTag =
        typeof req.body?.versionTag === "string" && req.body.versionTag.trim() !== ""
          ? req.body.versionTag.trim()
          : null;

      const sha256 = crypto
        .createHash("sha256")
        .update(file.buffer)
        .digest("hex");

      const parsed = parseWorkbookBuffer(file.buffer);

      const client = await pool.connect();
      let workbookSnapshotId: string | number | null = null;
      let uploadedAt: string | null = null;

      try {
        await client.query("BEGIN");

        // Deactivate current active snapshot for this user
        await client.query(
          `UPDATE workbook_snapshots
           SET is_active = FALSE
           WHERE user_id = $1 AND is_active = TRUE`,
          [userId]
        );

        const snapshotInsert = await client.query(
          `INSERT INTO workbook_snapshots (
            user_id, filename, version_tag, is_active,
            sheet_names, row_counts, warnings,
            source_sha256, original_file_size_bytes
          )
          VALUES ($1,$2,$3,TRUE,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8)
          RETURNING id, uploaded_at`,
          [
            userId,
            file.originalname,
            versionTag,
            JSON.stringify(parsed.sheetNames),
            JSON.stringify(parsed.rowCounts),
            JSON.stringify(parsed.warnings),
            sha256,
            file.size,
          ]
        );

        workbookSnapshotId = snapshotInsert.rows[0].id;
        uploadedAt = snapshotInsert.rows[0].uploaded_at;

        // ── workbook_sheet_rows (all sheets, raw) ──────────────────────────────
        for (const [sheetName, rows] of Object.entries(parsed.sheets)) {
          for (const row of rows) {
            await client.query(
              `INSERT INTO workbook_sheet_rows (
                workbook_snapshot_id, sheet_name, row_index, raw_json
              ) VALUES ($1,$2,$3,$4::jsonb)
              ON CONFLICT (workbook_snapshot_id, sheet_name, row_index) DO NOTHING`,
              [workbookSnapshotId, sheetName, row.rowIndex, JSON.stringify(row.raw)]
            );
          }
        }

        // ── biolog_rows (normalized) ───────────────────────────────────────────
        for (const row of parsed.biologRows) {
          await client.query(
            `INSERT INTO biolog_rows (
              workbook_snapshot_id, row_index,
              biolog_date, phase,
              source_date_key, source_phase_key, raw_json
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
            ON CONFLICT (workbook_snapshot_id, row_index) DO NOTHING`,
            [
              workbookSnapshotId,
              row.rowIndex,
              row.biologDate,
              row.phase,
              row.sourceDateKey,
              row.sourcePhaseKey,
              JSON.stringify(row.raw),
            ]
          );
        }

        // ── meal_line_rows (normalized) ────────────────────────────────────────
        for (const row of parsed.mealLineRows) {
          await client.query(
            `INSERT INTO meal_line_rows (
              workbook_snapshot_id, row_index,
              phase, meal_template_id, line_no,
              ingredient_id, amount_unit,
              kcal_line, protein_line, carbs_line, fat_line,
              raw_json
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
            ON CONFLICT (workbook_snapshot_id, row_index) DO NOTHING`,
            [
              workbookSnapshotId,
              row.rowIndex,
              row.phase,
              row.mealTemplateId,
              row.lineNo,
              row.ingredientId,
              row.amountUnit,
              row.kcalLine,
              row.proteinLine,
              row.carbsLine,
              row.fatLine,
              JSON.stringify(row.raw),
            ]
          );
        }

        // ── meal_template_rows (normalized) ───────────────────────────────────
        for (const row of parsed.mealTemplateRows) {
          await client.query(
            `INSERT INTO meal_template_rows (
              workbook_snapshot_id, row_index,
              phase, meal_template_id,
              kcal_sum, protein_sum, carbs_sum, fat_sum,
              raw_json
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
            ON CONFLICT (workbook_snapshot_id, row_index) DO NOTHING`,
            [
              workbookSnapshotId,
              row.rowIndex,
              row.phase,
              row.mealTemplateId,
              row.kcalSum,
              row.proteinSum,
              row.carbsSum,
              row.fatSum,
              JSON.stringify(row.raw),
            ]
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      console.log(
        `[upload-workbook] user=${userId} snapshot=${workbookSnapshotId} ` +
          `sheets=${parsed.sheetNames.join(",")} ` +
          `biolog=${parsed.biologRows.length} ` +
          `meal_lines=${parsed.mealLineRows.length} ` +
          `meal_templates=${parsed.mealTemplateRows.length}`
      );

      return res.status(201).json({
        ok: true,
        workbookSnapshotId,
        uploadedAt,
        filename: file.originalname,
        versionTag,
        rowCounts: parsed.rowCounts,
        warnings: parsed.warnings,
        _provenance: {
          db: dbProv,
          userId,
          workbookSnapshotId,
          tablesWritten: [
            "workbook_snapshots",
            "workbook_sheet_rows",
            "biolog_rows",
            "meal_line_rows",
            "meal_template_rows",
          ],
          source: "uploaded_workbook",
        },
      });
    } catch (err: any) {
      console.error("[upload-workbook] error:", err.message);
      const status = err.statusCode || 500;
      return res.status(status).json({
        error: err.message || "Failed to upload workbook",
        _provenance: { db: dbProv },
      });
    }
  }
);
