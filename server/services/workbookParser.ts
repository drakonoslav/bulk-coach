/**
 * server/services/workbookParser.ts
 * NEW CANONICAL: Parses an Excel .xlsx buffer into sheet rows and normalized biolog rows.
 * Source of truth: the uploaded workbook buffer.
 * No fallback, no default values injected.
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

export type ParsedWorkbook = {
  sheetNames: string[];
  rowCounts: Record<string, number>;
  warnings: string[];
  sheets: Record<string, ParsedSheetRow[]>;
  biologRows: ParsedBiologRow[];
};

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

function extractBiologDate(row: Record<string, unknown>): {
  key: string | null;
  value: string | null;
} {
  const preferredKeys = ["date", "day", "log_date", "biolog_date", "entry_date"];
  const entries = Object.entries(row).map(([k, v]) => [normalizeKey(k), k, v] as const);

  for (const pref of preferredKeys) {
    const hit = entries.find(([nk, , v]) => nk === pref && isNonEmpty(v));
    if (hit) return { key: hit[1], value: toIsoDate(hit[2]) };
  }

  const fuzzy = entries.find(([nk, , v]) => nk.includes("date") && isNonEmpty(v));
  if (fuzzy) return { key: fuzzy[1], value: toIsoDate(fuzzy[2]) };

  return { key: null, value: null };
}

function extractPhase(row: Record<string, unknown>): {
  key: string | null;
  value: string | null;
} {
  const preferredKeys = ["phase", "biolog_phase", "today_bound_phase", "final_phase"];
  const entries = Object.entries(row).map(([k, v]) => [normalizeKey(k), k, v] as const);

  for (const pref of preferredKeys) {
    const hit = entries.find(([nk, , v]) => nk === pref && isNonEmpty(v));
    if (hit) return { key: hit[1], value: String(hit[2]).trim() };
  }

  const fuzzy = entries.find(([nk, , v]) => nk.includes("phase") && isNonEmpty(v));
  if (fuzzy) return { key: fuzzy[1], value: String(fuzzy[2]).trim() };

  return { key: null, value: null };
}

function parseSheetRows(sheet: XLSX.WorkSheet): ParsedSheetRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });
  return rows.map((raw, idx) => ({ rowIndex: idx + 2, raw }));
}

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

  return { sheetNames, rowCounts, warnings, sheets, biologRows };
}
