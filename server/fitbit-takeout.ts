import { pool } from "./db";
import { recomputeRange } from "./recompute";
import { recomputeReadinessRange } from "./readiness-engine";
import crypto from "crypto";
import unzipper from "unzipper";
import { Readable } from "stream";

export interface TakeoutImportResult {
  status: string;
  dateRange: { start: string; end: string } | null;
  fitbitRootPrefix: string | null;
  filesParsed: number;
  daysAffected: number;
  daysInserted: number;
  daysUpdated: number;
  rowsSkipped: number;
  recomputeRan: boolean;
  parseDetails: Record<string, number>;
  filePatterns: string[];
}

interface DayBucket {
  steps: number | null;
  energyBurnedKcal: number | null;
  zone1Min: number | null;
  zone2Min: number | null;
  zone3Min: number | null;
  belowZone1Min: number | null;
  activeZoneMinutes: number | null;
  cardioMin: number | null;
  restingHr: number | null;
  sleepMinutes: number | null;
  hrv: number | null;
}

function emptyBucket(): DayBucket {
  return {
    steps: null, energyBurnedKcal: null,
    zone1Min: null, zone2Min: null, zone3Min: null, belowZone1Min: null,
    activeZoneMinutes: null, cardioMin: null,
    restingHr: null, sleepMinutes: null, hrv: null,
  };
}

function ensureBucket(buckets: Map<string, DayBucket>, date: string): DayBucket {
  if (!buckets.has(date)) buckets.set(date, emptyBucket());
  return buckets.get(date)!;
}

function extractDateFromISO(ts: string): string | null {
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseFitbitDateTime(dt: string): string | null {
  const match = dt.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    let year = parseInt(match[3], 10);
    year = year < 50 ? 2000 + year : 1900 + year;
    return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }
  return extractDateFromISO(dt);
}

function parseCSVRows(buf: Buffer): { headers: string[]; rows: string[][] } {
  let text = buf.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  return { headers, rows };
}

function colIdx(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const idx = headers.indexOf(n);
    if (idx !== -1) return idx;
  }
  return -1;
}

function findFitbitRoot(entryPaths: string[]): string | null {
  for (const p of entryPaths) {
    const idx = p.indexOf("/Fitbit/");
    if (idx !== -1) {
      return p.slice(0, idx) + "/Fitbit/";
    }
  }
  for (const p of entryPaths) {
    const lower = p.toLowerCase();
    const idx = lower.indexOf("/fitbit/");
    if (idx !== -1) {
      return p.slice(0, idx + 8);
    }
  }
  return null;
}

async function extractZipEntries(fileBuffer: Buffer): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  const stream = Readable.from(fileBuffer);
  const zip = stream.pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of zip) {
    const typedEntry = entry as unzipper.Entry;
    const entryPath = typedEntry.path;
    const type = typedEntry.type;

    if (type === "File" && (entryPath.endsWith(".json") || entryPath.endsWith(".csv"))) {
      const chunks: Buffer[] = [];
      for await (const chunk of typedEntry) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      entries.set(entryPath, Buffer.concat(chunks));
    } else {
      typedEntry.autodrain();
    }
  }

  return entries;
}

function parseStepsCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date", "datetime");
  const stepsCol = colIdx(headers, "steps", "value");
  if (tsCol === -1 || stepsCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const val = parseInt(row[stepsCol], 10);
    if (isNaN(val)) continue;
    const b = ensureBucket(buckets, date);
    b.steps = (b.steps || 0) + val;
    count++;
  }
  return count;
}

function parseCaloriesCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date", "datetime");
  const calCol = colIdx(headers, "calories", "kcal", "value");
  if (tsCol === -1 || calCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const val = parseFloat(row[calCol]);
    if (isNaN(val)) continue;
    const b = ensureBucket(buckets, date);
    b.energyBurnedKcal = Math.round((b.energyBurnedKcal || 0) + val);
    count++;
  }
  return count;
}

function parseCaloriesInZoneCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  const kcalCol = colIdx(headers, "kcal", "calories");
  if (tsCol === -1 || kcalCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const val = parseFloat(row[kcalCol]);
    if (isNaN(val)) continue;
    const b = ensureBucket(buckets, date);
    b.energyBurnedKcal = Math.round((b.energyBurnedKcal || 0) + val);
    count++;
  }
  return count;
}

function parseActiveMinutesCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  const lightCol = colIdx(headers, "light");
  const modCol = colIdx(headers, "moderate");
  const veryCol = colIdx(headers, "very");
  if (tsCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const light = lightCol !== -1 ? parseInt(row[lightCol], 10) || 0 : 0;
    const mod = modCol !== -1 ? parseInt(row[modCol], 10) || 0 : 0;
    const very = veryCol !== -1 ? parseInt(row[veryCol], 10) || 0 : 0;
    const b = ensureBucket(buckets, date);
    b.activeZoneMinutes = (b.activeZoneMinutes || 0) + mod + (2 * very);
    b.cardioMin = (b.cardioMin || 0) + mod + very;
    b.zone1Min = (b.zone1Min || 0) + light;
    b.zone2Min = (b.zone2Min || 0) + mod;
    b.zone3Min = (b.zone3Min || 0) + very;
    count++;
  }
  return count;
}

function parseTimeInZoneCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  const zoneCol = colIdx(headers, "heart rate zone type", "zone", "zone_type");
  if (tsCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const zoneType = (zoneCol !== -1 ? row[zoneCol] || "" : "").toUpperCase();
    const b = ensureBucket(buckets, date);
    if (zoneType.includes("LIGHT") || zoneType === "LIGHT") {
      b.zone1Min = (b.zone1Min || 0) + 1;
    } else if (zoneType.includes("MODERATE") || zoneType === "MODERATE" || zoneType.includes("CARDIO")) {
      b.zone2Min = (b.zone2Min || 0) + 1;
      b.activeZoneMinutes = (b.activeZoneMinutes || 0) + 1;
      b.cardioMin = (b.cardioMin || 0) + 1;
    } else if (zoneType.includes("VIGOROUS") || zoneType.includes("PEAK") || zoneType === "PEAK") {
      b.zone3Min = (b.zone3Min || 0) + 1;
      b.activeZoneMinutes = (b.activeZoneMinutes || 0) + 2;
      b.cardioMin = (b.cardioMin || 0) + 1;
    }
    count++;
  }
  return count;
}

function parseDailyRestingHrCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  const bpmCol = colIdx(headers, "beats per minute", "bpm", "resting_heart_rate", "value");
  if (tsCol === -1 || bpmCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const val = Math.round(parseFloat(row[bpmCol]));
    if (isNaN(val) || val <= 0) continue;
    ensureBucket(buckets, date).restingHr = val;
    count++;
  }
  return count;
}

function parseUserSleepsCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const sleepMinCol = colIdx(headers, "minutes_asleep", "minutesasleep");
  const endCol = colIdx(headers, "sleep_end", "end_time");
  if (sleepMinCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const mins = parseInt(row[sleepMinCol], 10);
    if (isNaN(mins) || mins <= 0) continue;
    let date: string | null = null;
    if (endCol !== -1 && row[endCol]) {
      date = extractDateFromISO(row[endCol]);
    }
    if (!date) {
      const startCol = colIdx(headers, "sleep_start", "start_time");
      if (startCol !== -1 && row[startCol]) {
        date = extractDateFromISO(row[startCol]);
      }
    }
    if (!date) continue;
    const b = ensureBucket(buckets, date);
    b.sleepMinutes = (b.sleepMinutes || 0) + mins;
    count++;
  }
  return count;
}

function parseSleepScoreCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  const rhrCol = colIdx(headers, "resting_heart_rate", "restingheartrate");
  if (tsCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const ts = row[tsCol];
    if (!ts) continue;
    let date: string | null = extractDateFromISO(ts);
    if (!date) {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    if (!date) continue;
    if (rhrCol !== -1 && row[rhrCol]) {
      const hr = parseInt(row[rhrCol], 10);
      if (!isNaN(hr) && hr > 0) {
        const b = ensureBucket(buckets, date);
        if (b.restingHr == null) b.restingHr = hr;
      }
    }
    count++;
  }
  return count;
}

function parseStepsJSON(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = parseInt(item.value, 10);
      if (isNaN(val)) continue;
      ensureBucket(buckets, date).steps = (ensureBucket(buckets, date).steps || 0) + val;
      count++;
    }
    return count;
  } catch { return 0; }
}

function parseCaloriesJSON(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = parseFloat(item.value);
      if (isNaN(val)) continue;
      const b = ensureBucket(buckets, date);
      b.energyBurnedKcal = Math.round((b.energyBurnedKcal || 0) + val);
      count++;
    }
    return count;
  } catch { return 0; }
}

function parseHeartRateZonesJSON(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const zones = item.value?.valuesInZones;
      if (!zones) continue;
      const b = ensureBucket(buckets, date);
      const z1 = parseFloat(zones.IN_DEFAULT_ZONE_1) || 0;
      const z2 = parseFloat(zones.IN_DEFAULT_ZONE_2) || 0;
      const z3 = parseFloat(zones.IN_DEFAULT_ZONE_3) || 0;
      const below = parseFloat(zones.BELOW_DEFAULT_ZONE_1) || 0;
      b.zone1Min = (b.zone1Min || 0) + z1;
      b.zone2Min = (b.zone2Min || 0) + z2;
      b.zone3Min = (b.zone3Min || 0) + z3;
      b.belowZone1Min = (b.belowZone1Min || 0) + below;
      b.activeZoneMinutes = Math.round((b.zone2Min || 0) + 2 * (b.zone3Min || 0));
      count++;
    }
    return count;
  } catch { return 0; }
}

function parseRestingHrJSON(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = item.value?.value ?? item.value;
      if (val == null || val <= 0) continue;
      const hr = Math.round(parseFloat(val));
      if (isNaN(hr) || hr <= 0) continue;
      ensureBucket(buckets, date).restingHr = hr;
      count++;
    }
    return count;
  } catch { return 0; }
}

function parseSleepJSON(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      let date: string | null = null;
      if (item.endTime) date = parseFitbitDateTime(item.endTime);
      if (!date && item.dateOfSleep) date = item.dateOfSleep.match(/^\d{4}-\d{2}-\d{2}/) ? item.dateOfSleep.slice(0, 10) : null;
      if (!date) continue;
      const mins = item.minutesAsleep ?? item.duration;
      if (mins == null) continue;
      const minsVal = parseInt(mins, 10);
      if (isNaN(minsVal) || minsVal <= 0) continue;
      const b = ensureBucket(buckets, date);
      b.sleepMinutes = (b.sleepMinutes || 0) + minsVal;
      count++;
    }
    return count;
  } catch { return 0; }
}

export async function importFitbitTakeout(
  fileBuffer: Buffer,
  originalFilename: string,
  overwriteFields: boolean = false,
  timezone: string = "America/New_York",
): Promise<TakeoutImportResult> {
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  const { rows: existing } = await pool.query(
    `SELECT id FROM fitbit_takeout_imports WHERE sha256 = $1`,
    [sha256],
  );
  if (existing.length > 0) {
    return {
      status: "duplicate",
      dateRange: null, fitbitRootPrefix: null,
      filesParsed: 0, daysAffected: 0, daysInserted: 0, daysUpdated: 0,
      rowsSkipped: 0, recomputeRan: false, parseDetails: {}, filePatterns: [],
    };
  }

  console.log("[takeout] Extracting ZIP entries...");
  const entries = await extractZipEntries(fileBuffer);
  console.log(`[takeout] Found ${entries.size} files in ZIP`);

  const fitbitRoot = findFitbitRoot(Array.from(entries.keys()));
  if (!fitbitRoot) {
    return {
      status: "error",
      dateRange: null, fitbitRootPrefix: null,
      filesParsed: 0, daysAffected: 0, daysInserted: 0, daysUpdated: 0,
      rowsSkipped: 0, recomputeRan: false, parseDetails: {},
      filePatterns: [],
    };
  }

  console.log(`[takeout] Fitbit root: ${fitbitRoot}`);

  const buckets = new Map<string, DayBucket>();
  let filesParsed = 0;
  const filePatterns: string[] = [];
  const parseDetails: Record<string, number> = {
    stepsCSV: 0, stepsJSON: 0,
    caloriesCSV: 0, caloriesJSON: 0,
    caloriesInZoneCSV: 0,
    activeMinutesCSV: 0,
    timeInZoneCSV: 0, heartRateZonesJSON: 0,
    dailyRestingHrCSV: 0, restingHrJSON: 0,
    sleepScoreCSV: 0, userSleepsCSV: 0, sleepJSON: 0,
  };

  for (const [path, buf] of entries.entries()) {
    if (!path.startsWith(fitbitRoot)) continue;

    const relativePath = path.slice(fitbitRoot.length);
    const filename = path.split("/").pop() || "";
    const fnLower = filename.toLowerCase();

    if (fnLower.endsWith(".txt")) continue;

    if (fnLower.startsWith("steps_") && fnLower.endsWith(".csv")) {
      parseDetails.stepsCSV += parseStepsCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("steps_*.csv")) filePatterns.push("steps_*.csv");
    } else if (fnLower.startsWith("steps-") && fnLower.endsWith(".json")) {
      parseDetails.stepsJSON += parseStepsJSON(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("steps-*.json")) filePatterns.push("steps-*.json");
    } else if (fnLower.startsWith("calories_in_heart_rate_zone_") && fnLower.endsWith(".csv")) {
      parseDetails.caloriesInZoneCSV += parseCaloriesInZoneCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("calories_in_heart_rate_zone_*.csv")) filePatterns.push("calories_in_heart_rate_zone_*.csv");
    } else if (fnLower.startsWith("calories_") && fnLower.endsWith(".csv")) {
      parseDetails.caloriesCSV += parseCaloriesCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("calories_*.csv")) filePatterns.push("calories_*.csv");
    } else if (fnLower.startsWith("calories-") && fnLower.endsWith(".json")) {
      parseDetails.caloriesJSON += parseCaloriesJSON(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("calories-*.json")) filePatterns.push("calories-*.json");
    } else if (fnLower.startsWith("active_minutes_") && fnLower.endsWith(".csv")) {
      parseDetails.activeMinutesCSV += parseActiveMinutesCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("active_minutes_*.csv")) filePatterns.push("active_minutes_*.csv");
    } else if (fnLower.startsWith("time_in_heart_rate_zone_") && fnLower.endsWith(".csv")) {
      parseDetails.timeInZoneCSV += parseTimeInZoneCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("time_in_heart_rate_zone_*.csv")) filePatterns.push("time_in_heart_rate_zone_*.csv");
    } else if (fnLower === "daily_resting_heart_rate.csv") {
      parseDetails.dailyRestingHrCSV += parseDailyRestingHrCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("daily_resting_heart_rate.csv")) filePatterns.push("daily_resting_heart_rate.csv");
    } else if (fnLower.startsWith("time_in_heart_rate_zones-") && fnLower.endsWith(".json")) {
      parseDetails.heartRateZonesJSON += parseHeartRateZonesJSON(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("time_in_heart_rate_zones-*.json")) filePatterns.push("time_in_heart_rate_zones-*.json");
    } else if (fnLower.startsWith("resting_heart_rate-") && fnLower.endsWith(".json")) {
      parseDetails.restingHrJSON += parseRestingHrJSON(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("resting_heart_rate-*.json")) filePatterns.push("resting_heart_rate-*.json");
    } else if (fnLower.startsWith("sleep-") && fnLower.endsWith(".json")) {
      parseDetails.sleepJSON += parseSleepJSON(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("sleep-*.json")) filePatterns.push("sleep-*.json");
    } else if (fnLower === "sleep_score.csv" || (fnLower.includes("sleep") && fnLower.includes("score") && fnLower.endsWith(".csv"))) {
      parseDetails.sleepScoreCSV += parseSleepScoreCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("sleep_score.csv")) filePatterns.push("sleep_score.csv");
    } else if (fnLower.startsWith("usersleeps") && fnLower.endsWith(".csv")) {
      parseDetails.userSleepsCSV += parseUserSleepsCSV(buf, buckets);
      filesParsed++;
      if (!filePatterns.includes("UserSleeps_*.csv")) filePatterns.push("UserSleeps_*.csv");
    }
  }

  console.log(`[takeout] Parsed ${filesParsed} files, ${buckets.size} unique days`);
  console.log(`[takeout] Parse details:`, JSON.stringify(parseDetails));
  console.log(`[takeout] File patterns:`, filePatterns);

  if (buckets.size === 0) {
    return {
      status: "no_data",
      dateRange: null, fitbitRootPrefix: fitbitRoot,
      filesParsed, daysAffected: 0, daysInserted: 0, daysUpdated: 0,
      rowsSkipped: 0, recomputeRan: false, parseDetails, filePatterns,
    };
  }

  const sortedDates = Array.from(buckets.keys()).sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];

  const { rows: existingDays } = await pool.query(
    `SELECT day FROM daily_log WHERE day >= $1 AND day <= $2`,
    [minDate, maxDate],
  );
  const existingDaySet = new Set(existingDays.map((r) => r.day));

  let daysInserted = 0;
  let daysUpdated = 0;
  let rowsSkipped = 0;

  for (const [date, b] of buckets.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      rowsSkipped++;
      continue;
    }

    const hasData = b.steps != null || b.energyBurnedKcal != null || b.activeZoneMinutes != null ||
      b.restingHr != null || b.sleepMinutes != null || b.zone1Min != null || b.cardioMin != null;

    if (!hasData) {
      rowsSkipped++;
      continue;
    }

    const isExisting = existingDaySet.has(date);

    if (overwriteFields) {
      await pool.query(
        `INSERT INTO daily_log (day, steps, cardio_min, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr, hrv,
          zone1_min, zone2_min, zone3_min, below_zone1_min, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (day) DO UPDATE SET
           steps = $2, cardio_min = $3, active_zone_minutes = $4, sleep_minutes = $5,
           energy_burned_kcal = $6, resting_hr = $7, hrv = $8,
           zone1_min = $9, zone2_min = $10, zone3_min = $11, below_zone1_min = $12,
           updated_at = NOW()`,
        [date, b.steps, b.cardioMin, b.activeZoneMinutes, b.sleepMinutes, b.energyBurnedKcal, b.restingHr, b.hrv,
          b.zone1Min, b.zone2Min, b.zone3Min, b.belowZone1Min],
      );
    } else {
      await pool.query(
        `INSERT INTO daily_log (day, morning_weight_lb, steps, cardio_min, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr, hrv,
          zone1_min, zone2_min, zone3_min, below_zone1_min, updated_at)
         VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (day) DO UPDATE SET
           steps = COALESCE($2, daily_log.steps),
           cardio_min = COALESCE($3, daily_log.cardio_min),
           active_zone_minutes = COALESCE($4, daily_log.active_zone_minutes),
           sleep_minutes = COALESCE($5, daily_log.sleep_minutes),
           energy_burned_kcal = COALESCE($6, daily_log.energy_burned_kcal),
           resting_hr = COALESCE($7, daily_log.resting_hr),
           hrv = COALESCE($8, daily_log.hrv),
           zone1_min = COALESCE($9, daily_log.zone1_min),
           zone2_min = COALESCE($10, daily_log.zone2_min),
           zone3_min = COALESCE($11, daily_log.zone3_min),
           below_zone1_min = COALESCE($12, daily_log.below_zone1_min),
           updated_at = NOW()`,
        [date, b.steps, b.cardioMin, b.activeZoneMinutes, b.sleepMinutes, b.energyBurnedKcal, b.restingHr, b.hrv,
          b.zone1Min, b.zone2Min, b.zone3Min, b.belowZone1Min],
      );
    }

    if (isExisting) daysUpdated++;
    else daysInserted++;
  }

  let recomputeRan = false;
  if (minDate && maxDate) {
    await recomputeRangeSpan(minDate, maxDate);
    recomputeRan = true;
  }

  const importId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await pool.query(
    `INSERT INTO fitbit_takeout_imports (id, original_filename, sha256, timezone, fitbit_root_prefix,
      date_range_start, date_range_end, days_affected, rows_upserted, rows_skipped, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [importId, originalFilename, sha256, timezone, fitbitRoot, minDate, maxDate,
      daysInserted + daysUpdated, daysInserted + daysUpdated, rowsSkipped,
      `Patterns: ${filePatterns.join(", ")}`],
  );

  console.log(`[takeout] Import complete: ${daysInserted} inserted, ${daysUpdated} updated, ${rowsSkipped} skipped`);

  return {
    status: "ok",
    dateRange: { start: minDate, end: maxDate },
    fitbitRootPrefix: fitbitRoot,
    filesParsed,
    daysAffected: daysInserted + daysUpdated,
    daysInserted,
    daysUpdated,
    rowsSkipped,
    recomputeRan,
    parseDetails,
    filePatterns,
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

  recomputeReadinessRange(minDay).catch((err: unknown) =>
    console.error("readiness recompute after takeout:", err)
  );
}
