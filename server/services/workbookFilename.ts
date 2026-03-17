/**
 * server/services/workbookFilename.ts
 * Parses the logbookMMDDYYYY.xlsx / .xlsm naming convention into a
 * calendar date for display and sorting convenience.
 *
 * AUTHORITY RULE: filename_date is cosmetic only.
 * snapshot_id + explicit is_active flag are the sole operational truth.
 * Never auto-activate based on filename alone.
 */

export type ParsedWorkbookFilename = {
  matched: boolean;
  filenameDate: string | null;
  basename: string;
};

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Supports filenames like:
 *   logbook03162026.xlsx   → { matched: true, filenameDate: "2026-03-16" }
 *   LOGBOOK03162026.xlsm   → { matched: true, filenameDate: "2026-03-16" }
 *   myfile.xlsx            → { matched: false, filenameDate: null }
 *   logbook99992026.xlsx   → { matched: false, filenameDate: null } (invalid date)
 *
 * Pattern: logbook MMDDYYYY .(xlsx|xlsm)  (case-insensitive)
 */
export function parseLogbookFilename(filename: string): ParsedWorkbookFilename {
  const basename = filename.split(/[\\/]/).pop() || filename;
  const match = basename.match(/^logbook(\d{2})(\d{2})(\d{4})\.(xlsx|xlsm)$/i);

  if (!match) {
    return { matched: false, filenameDate: null, basename };
  }

  const mm = Number(match[1]);
  const dd = Number(match[2]);
  const yyyy = Number(match[3]);

  if (!isValidDateParts(yyyy, mm, dd)) {
    return { matched: false, filenameDate: null, basename };
  }

  const month = String(mm).padStart(2, "0");
  const day = String(dd).padStart(2, "0");

  return {
    matched: true,
    filenameDate: `${yyyy}-${month}-${day}`,
    basename,
  };
}
