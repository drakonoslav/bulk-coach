/**
 * server/services/workbookParser.ts
 * NEW CANONICAL: Parses an Excel .xlsx buffer into sheet rows,
 * normalized biolog rows, meal_line rows, meal_template rows,
 * drift_history rows, colony_coord rows, and threshold_lab rows.
 *
 * Source of truth: the uploaded workbook buffer.
 * No fallback. No default values injected. No native recomputation.
 */
import * as XLSX from "xlsx";

export const EXPECTED_SHEETS = [
  "biolog",
  "ingredients",
  "meal_lines",
  "meal_templates",
  "drift_history",
  "colony_coord",
  "threshold_lab",
] as const;

export type ExpectedSheet = (typeof EXPECTED_SHEETS)[number];

export type ParsedSheetRow = {
  rowIndex: number;
  raw: Record<string, unknown>;
};

export type ParsedBiologRow = {
  rowIndex: number;
  biologDate: string | null;
  phase: string | null;
  sourceDateKey: string | null;
  sourcePhaseKey: string | null;
  raw: Record<string, unknown>;
};

export type ParsedMealLineRow = {
  rowIndex: number;
  phase: string | null;
  mealTemplateId: string | null;
  lineNo: number | null;
  ingredientId: string | null;
  amountUnit: number | null;
  kcalLine: number | null;
  proteinLine: number | null;
  carbsLine: number | null;
  fatLine: number | null;
  raw: Record<string, unknown>;
};

export type ParsedMealTemplateRow = {
  rowIndex: number;
  phase: string | null;
  mealTemplateId: string | null;
  kcalSum: number | null;
  proteinSum: number | null;
  carbsSum: number | null;
  fatSum: number | null;
  raw: Record<string, unknown>;
};

export type ParsedDriftHistoryRow = {
  rowIndex: number;
  driftDate: string | null;
  phase: string | null;
  driftType: string | null;
  driftSource: string | null;
  confidence: string | null;
  weightedDriftScore: number | null;
  watchFlag: string | null;
  raw: Record<string, unknown>;
};

export type ParsedColonyCoordRow = {
  rowIndex: number;
  metric: string | null;
  value: string | null;
  threshold: string | null;
  status: string | null;
  recommendation: string | null;
  confidence: string | null;
  raw: Record<string, unknown>;
};

export type ParsedThresholdLabRow = {
  rowIndex: number;
  thresholdName: string | null;
  currentValue: string | null;
  suggestedValue: string | null;
  evidenceCount: number | null;
  notes: string | null;
  raw: Record<string, unknown>;
};

export type ParsedWorkbook = {
  sheetNames: string[];
  rowCounts: Record<string, number>;
  warnings: string[];
  sheets: Record<string, ParsedSheetRow[]>;
  biologRows: ParsedBiologRow[];
  mealLineRows: ParsedMealLineRow[];
  mealTemplateRows: ParsedMealTemplateRow[];
  driftHistoryRows: ParsedDriftHistoryRow[];
  colonyCoordRows: ParsedColonyCoordRow[];
  thresholdLabRows: ParsedThresholdLabRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

function isNonEmpty(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function toIsoDate(value: unknown): string | null {
  if (!isNonEmpty(value)) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  const mdY = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdY) {
    const mm = mdY[1].padStart(2, "0");
    const dd = mdY[2].padStart(2, "0");
    const yyyy = mdY[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function toNumber(value: unknown): number | null {
  if (!isNonEmpty(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value).replace(/,/g, "").trim();
  if (raw === "") return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function getByPreferredKeys(
  row: Record<string, unknown>,
  preferredKeys: string[]
): { key: string | null; value: unknown } {
  const entries = Object.entries(row).map(([k, v]) => [normalizeKey(k), k, v] as const);

  for (const pref of preferredKeys) {
    const hit = entries.find(([nk, , v]) => nk === pref && isNonEmpty(v));
    if (hit) return { key: hit[1], value: hit[2] };
  }

  return { key: null, value: null };
}

function getByFuzzyIncludes(
  row: Record<string, unknown>,
  includesAny: string[]
): { key: string | null; value: unknown } {
  const entries = Object.entries(row).map(([k, v]) => [normalizeKey(k), k, v] as const);
  const hit = entries.find(
    ([nk, , v]) => includesAny.some((frag) => nk.includes(frag)) && isNonEmpty(v)
  );
  if (hit) return { key: hit[1], value: hit[2] };
  return { key: null, value: null };
}

function extractBiologDate(row: Record<string, unknown>): {
  key: string | null;
  value: string | null;
} {
  const preferred = getByPreferredKeys(row, [
    "date", "day", "log_date", "biolog_date", "entry_date",
  ]);
  if (preferred.key) return { key: preferred.key, value: toIsoDate(preferred.value) };

  const fuzzy = getByFuzzyIncludes(row, ["date"]);
  return { key: fuzzy.key, value: toIsoDate(fuzzy.value) };
}

function extractPhase(row: Record<string, unknown>): {
  key: string | null;
  value: string | null;
} {
  const preferred = getByPreferredKeys(row, [
    "phase", "biolog_phase", "today_bound_phase", "final_phase",
  ]);
  if (preferred.key) {
    return { key: preferred.key, value: String(preferred.value).trim() };
  }

  const fuzzy = getByFuzzyIncludes(row, ["phase"]);
  return {
    key: fuzzy.key,
    value: isNonEmpty(fuzzy.value) ? String(fuzzy.value).trim() : null,
  };
}

function parseSheetRows(sheet: XLSX.WorkSheet): ParsedSheetRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });
  return rows.map((raw, idx) => ({ rowIndex: idx + 2, raw }));
}

// ─── meal_lines extractor ─────────────────────────────────────────────────────

function extractMealLineRow(row: ParsedSheetRow): ParsedMealLineRow {
  const phase = extractPhase(row.raw).value;

  const mealTemplateInfo = getByPreferredKeys(row.raw, [
    "meal_template_id", "meal_template", "meal_id",
  ]);
  const lineNoInfo = getByPreferredKeys(row.raw, [
    "line_no", "line", "line_number",
  ]);
  const ingredientInfo = getByPreferredKeys(row.raw, [
    "ingredient_id", "ingredient", "food_id",
  ]);
  const amountInfo = getByPreferredKeys(row.raw, [
    "amount_unit", "amount", "qty", "quantity",
  ]);
  const kcalInfo = getByPreferredKeys(row.raw, [
    "kcal_line", "kcal", "calories_line", "calories",
  ]);
  const proteinInfo = getByPreferredKeys(row.raw, ["protein_line", "protein"]);
  const carbsInfo = getByPreferredKeys(row.raw, [
    "carbs_line", "carbs", "carb_line", "carb",
  ]);
  const fatInfo = getByPreferredKeys(row.raw, ["fat_line", "fat"]);

  return {
    rowIndex: row.rowIndex,
    phase,
    mealTemplateId: isNonEmpty(mealTemplateInfo.value)
      ? String(mealTemplateInfo.value).trim()
      : null,
    lineNo: toNumber(lineNoInfo.value),
    ingredientId: isNonEmpty(ingredientInfo.value)
      ? String(ingredientInfo.value).trim()
      : null,
    amountUnit: toNumber(amountInfo.value),
    kcalLine: toNumber(kcalInfo.value),
    proteinLine: toNumber(proteinInfo.value),
    carbsLine: toNumber(carbsInfo.value),
    fatLine: toNumber(fatInfo.value),
    raw: row.raw,
  };
}

// ─── meal_templates extractor ─────────────────────────────────────────────────

function extractMealTemplateRow(row: ParsedSheetRow): ParsedMealTemplateRow {
  const phase = extractPhase(row.raw).value;

  const mealTemplateInfo = getByPreferredKeys(row.raw, [
    "meal_template_id", "meal_template", "meal_id",
  ]);
  const kcalInfo = getByPreferredKeys(row.raw, [
    "kcal_sum", "kcal", "calories_sum", "calories",
  ]);
  const proteinInfo = getByPreferredKeys(row.raw, ["protein_sum", "protein"]);
  const carbsInfo = getByPreferredKeys(row.raw, [
    "carbs_sum", "carbs", "carb_sum", "carb",
  ]);
  const fatInfo = getByPreferredKeys(row.raw, ["fat_sum", "fat"]);

  return {
    rowIndex: row.rowIndex,
    phase,
    mealTemplateId: isNonEmpty(mealTemplateInfo.value)
      ? String(mealTemplateInfo.value).trim()
      : null,
    kcalSum: toNumber(kcalInfo.value),
    proteinSum: toNumber(proteinInfo.value),
    carbsSum: toNumber(carbsInfo.value),
    fatSum: toNumber(fatInfo.value),
    raw: row.raw,
  };
}

// ─── drift_history extractor ──────────────────────────────────────────────────

function extractDriftHistoryRow(row: ParsedSheetRow): ParsedDriftHistoryRow {
  const dateInfo = getByPreferredKeys(row.raw, ["date", "drift_date", "log_date"]);
  const phase = extractPhase(row.raw).value;

  const driftTypeInfo = getByPreferredKeys(row.raw, ["drift_type", "type"]);
  const driftSourceInfo = getByPreferredKeys(row.raw, ["drift_source", "source"]);
  const confidenceInfo = getByPreferredKeys(row.raw, ["confidence"]);
  const weightedInfo = getByPreferredKeys(row.raw, [
    "weighted_drift_score", "drift_score",
  ]);
  const watchInfo = getByPreferredKeys(row.raw, [
    "watch_flag", "watch", "review_flag",
  ]);

  return {
    rowIndex: row.rowIndex,
    driftDate: toIsoDate(dateInfo.value),
    phase,
    driftType: isNonEmpty(driftTypeInfo.value) ? String(driftTypeInfo.value).trim() : null,
    driftSource: isNonEmpty(driftSourceInfo.value) ? String(driftSourceInfo.value).trim() : null,
    confidence: isNonEmpty(confidenceInfo.value) ? String(confidenceInfo.value).trim() : null,
    weightedDriftScore: toNumber(weightedInfo.value),
    watchFlag: isNonEmpty(watchInfo.value) ? String(watchInfo.value).trim() : null,
    raw: row.raw,
  };
}

// ─── colony_coord extractor ───────────────────────────────────────────────────

function extractColonyCoordRow(row: ParsedSheetRow): ParsedColonyCoordRow {
  const metricInfo = getByPreferredKeys(row.raw, ["metric", "metric_name"]);
  const valueInfo = getByPreferredKeys(row.raw, ["value", "metric_value"]);
  const thresholdInfo = getByPreferredKeys(row.raw, ["threshold", "threshold_value"]);
  const statusInfo = getByPreferredKeys(row.raw, ["status"]);
  const recommendationInfo = getByPreferredKeys(row.raw, [
    "recommendation", "candidate_fix",
  ]);
  const confidenceInfo = getByPreferredKeys(row.raw, ["confidence"]);

  return {
    rowIndex: row.rowIndex,
    metric: isNonEmpty(metricInfo.value) ? String(metricInfo.value).trim() : null,
    value: isNonEmpty(valueInfo.value) ? String(valueInfo.value).trim() : null,
    threshold: isNonEmpty(thresholdInfo.value) ? String(thresholdInfo.value).trim() : null,
    status: isNonEmpty(statusInfo.value) ? String(statusInfo.value).trim() : null,
    recommendation: isNonEmpty(recommendationInfo.value)
      ? String(recommendationInfo.value).trim()
      : null,
    confidence: isNonEmpty(confidenceInfo.value) ? String(confidenceInfo.value).trim() : null,
    raw: row.raw,
  };
}

// ─── threshold_lab extractor ──────────────────────────────────────────────────

function extractThresholdLabRow(row: ParsedSheetRow): ParsedThresholdLabRow {
  const thresholdNameInfo = getByPreferredKeys(row.raw, [
    "threshold_name", "metric", "threshold",
  ]);
  const currentValueInfo = getByPreferredKeys(row.raw, ["current_value", "current"]);
  const suggestedValueInfo = getByPreferredKeys(row.raw, [
    "suggested_value", "suggested",
  ]);
  const evidenceInfo = getByPreferredKeys(row.raw, [
    "evidence_count", "evidence", "count",
  ]);
  const notesInfo = getByPreferredKeys(row.raw, ["notes", "note"]);

  return {
    rowIndex: row.rowIndex,
    thresholdName: isNonEmpty(thresholdNameInfo.value)
      ? String(thresholdNameInfo.value).trim()
      : null,
    currentValue: isNonEmpty(currentValueInfo.value)
      ? String(currentValueInfo.value).trim()
      : null,
    suggestedValue: isNonEmpty(suggestedValueInfo.value)
      ? String(suggestedValueInfo.value).trim()
      : null,
    evidenceCount: toNumber(evidenceInfo.value),
    notes: isNonEmpty(notesInfo.value) ? String(notesInfo.value).trim() : null,
    raw: row.raw,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseWorkbookBuffer(buffer: Buffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheetNames = wb.SheetNames;
  const warnings: string[] = [];
  const rowCounts: Record<string, number> = {};
  const sheets: Record<string, ParsedSheetRow[]> = {};

  for (const expected of EXPECTED_SHEETS) {
    if (!wb.Sheets[expected]) {
      warnings.push(`Missing expected sheet: ${expected}`);
    }
  }

  for (const sheetName of sheetNames) {
    const rows = parseSheetRows(wb.Sheets[sheetName]);
    sheets[sheetName] = rows;
    rowCounts[sheetName] = rows.length;
  }

  const biologRows: ParsedBiologRow[] = (sheets["biolog"] || []).map((row) => {
    const dateInfo = extractBiologDate(row.raw);
    const phaseInfo = extractPhase(row.raw);
    return {
      rowIndex: row.rowIndex,
      biologDate: dateInfo.value,
      phase: phaseInfo.value,
      sourceDateKey: dateInfo.key,
      sourcePhaseKey: phaseInfo.key,
      raw: row.raw,
    };
  });

  const mealLineRows = (sheets["meal_lines"] || []).map(extractMealLineRow);
  const mealTemplateRows = (sheets["meal_templates"] || []).map(extractMealTemplateRow);
  const driftHistoryRows = (sheets["drift_history"] || []).map(extractDriftHistoryRow);
  const colonyCoordRows = (sheets["colony_coord"] || []).map(extractColonyCoordRow);
  const thresholdLabRows = (sheets["threshold_lab"] || []).map(extractThresholdLabRow);

  return {
    sheetNames,
    rowCounts,
    warnings,
    sheets,
    biologRows,
    mealLineRows,
    mealTemplateRows,
    driftHistoryRows,
    colonyCoordRows,
    thresholdLabRows,
  };
}
