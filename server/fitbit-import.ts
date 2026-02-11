import { pool } from "./db";
import { recomputeRange } from "./recompute";
import crypto from "crypto";

const HEADER_ALIASES: Record<string, string> = {
  date: "date",
  day: "date",
  steps: "steps",
  active_zone_minutes: "active_zone_minutes",
  activezoneminutes: "active_zone_minutes",
  "active zone minutes": "active_zone_minutes",
  cardio_minutes: "cardio_minutes",
  cardiominutes: "cardio_minutes",
  "cardio minutes": "cardio_minutes",
  cardio_min: "cardio_minutes",
  sleep_minutes: "sleep_minutes",
  sleepminutes: "sleep_minutes",
  "sleep minutes": "sleep_minutes",
  energy_burned_kcal: "energy_burned_kcal",
  energyburnedkcal: "energy_burned_kcal",
  "energy burned kcal": "energy_burned_kcal",
  calories_burned: "energy_burned_kcal",
  caloriesburned: "energy_burned_kcal",
  "calories burned": "energy_burned_kcal",
  resting_hr: "resting_hr",
  restinghr: "resting_hr",
  "resting hr": "resting_hr",
  resting_heart_rate: "resting_hr",
  restingheartrate: "resting_hr",
  "resting heart rate": "resting_hr",
  hrv: "hrv",
  heart_rate_variability: "hrv",
};

interface ImportResult {
  status: string;
  dateRange: { start: string; end: string } | null;
  rowsImported: number;
  rowsUpserted: number;
  rowsSkipped: number;
  recomputeRan: boolean;
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
}

function normalizeHeader(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_ ]/g, "").trim();
  return HEADER_ALIASES[cleaned] || cleaned;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function parseIntOrNull(s: string | undefined): number | null {
  if (!s || s.trim() === "") return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

export async function importFitbitCSV(
  fileBuffer: Buffer,
  originalFilename: string,
  overwriteFields: boolean = false,
): Promise<ImportResult> {
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  const { rows: existing } = await pool.query(
    `SELECT id FROM fitbit_imports WHERE sha256 = $1`,
    [sha256],
  );
  if (existing.length > 0) {
    return {
      status: "duplicate",
      dateRange: null,
      rowsImported: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      recomputeRan: false,
    };
  }

  let text = fileBuffer.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = parseCSV(text);
  if (rows.length < 2) {
    return {
      status: "error",
      dateRange: null,
      rowsImported: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      recomputeRan: false,
    };
  }

  const headerRow = rows[0];
  const normalizedHeaders = headerRow.map(normalizeHeader);
  const dateIdx = normalizedHeaders.indexOf("date");
  if (dateIdx === -1) {
    return {
      status: "error",
      dateRange: null,
      rowsImported: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      recomputeRan: false,
    };
  }

  const colMap: Record<string, number> = {};
  for (let i = 0; i < normalizedHeaders.length; i++) {
    colMap[normalizedHeaders[i]] = i;
  }

  let rowsImported = 0;
  let rowsUpserted = 0;
  let rowsSkipped = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    const dateVal = row[dateIdx]?.trim();
    if (!dateVal || !isValidDate(dateVal)) {
      rowsSkipped++;
      continue;
    }

    const get = (col: string) => row[colMap[col]] ?? "";
    const steps = parseIntOrNull(get("steps"));
    const cardioMin = parseIntOrNull(get("cardio_minutes"));
    const activeZoneMin = parseIntOrNull(get("active_zone_minutes"));
    const sleepMin = parseIntOrNull(get("sleep_minutes"));
    const energyBurned = parseIntOrNull(get("energy_burned_kcal"));
    const restingHr = parseIntOrNull(get("resting_hr"));
    const hrv = parseIntOrNull(get("hrv"));

    if (overwriteFields) {
      await pool.query(
        `INSERT INTO daily_log (day, steps, cardio_min, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr, hrv, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (day) DO UPDATE SET
           steps = $2,
           cardio_min = $3,
           active_zone_minutes = $4,
           sleep_minutes = $5,
           energy_burned_kcal = $6,
           resting_hr = $7,
           hrv = $8,
           updated_at = NOW()`,
        [dateVal, steps, cardioMin, activeZoneMin, sleepMin, energyBurned, restingHr, hrv],
      );
    } else {
      await pool.query(
        `INSERT INTO daily_log (day, morning_weight_lb, steps, cardio_min, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr, hrv, updated_at)
         VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (day) DO UPDATE SET
           steps = COALESCE($2, daily_log.steps),
           cardio_min = COALESCE($3, daily_log.cardio_min),
           active_zone_minutes = COALESCE($4, daily_log.active_zone_minutes),
           sleep_minutes = COALESCE($5, daily_log.sleep_minutes),
           energy_burned_kcal = COALESCE($6, daily_log.energy_burned_kcal),
           resting_hr = COALESCE($7, daily_log.resting_hr),
           hrv = COALESCE($8, daily_log.hrv),
           updated_at = NOW()`,
        [dateVal, steps, cardioMin, activeZoneMin, sleepMin, energyBurned, restingHr, hrv],
      );
    }

    rowsUpserted++;
    rowsImported++;

    if (!minDate || dateVal < minDate) minDate = dateVal;
    if (!maxDate || dateVal > maxDate) maxDate = dateVal;
  }

  let recomputeRan = false;
  if (minDate && maxDate) {
    await recomputeRangeSpan(minDate, maxDate);
    recomputeRan = true;
  }

  const importId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await pool.query(
    `INSERT INTO fitbit_imports (id, original_filename, sha256, date_range_start, date_range_end, rows_imported, rows_upserted, rows_skipped)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [importId, originalFilename, sha256, minDate, maxDate, rowsImported, rowsUpserted, rowsSkipped],
  );

  return {
    status: "ok",
    dateRange: minDate && maxDate ? { start: minDate, end: maxDate } : null,
    rowsImported,
    rowsUpserted,
    rowsSkipped,
    recomputeRan,
  };
}

async function recomputeRangeSpan(minDay: string, maxDay: string): Promise<void> {
  const start = new Date(minDay + "T00:00:00Z");
  const end = new Date(maxDay + "T00:00:00Z");
  const current = new Date(start);

  while (current <= end) {
    const dayStr = current.toISOString().slice(0, 10);
    await recomputeRange(dayStr);
    current.setUTCDate(current.getUTCDate() + 7);
  }
  await recomputeRange(maxDay);
}
