import { pool } from "./db";
import { recomputeRange } from "./recompute";
import { recomputeReadinessRange } from "./readiness-engine";
import crypto from "crypto";
import unzipper from "unzipper";
import { Readable } from "stream";

interface TakeoutImportResult {
  status: string;
  dateRange: { start: string; end: string } | null;
  daysAffected: number;
  rowsUpserted: number;
  rowsSkipped: number;
  recomputeRan: boolean;
  filesProcessed: number;
  parseDetails: Record<string, number>;
}

interface DayBucket {
  steps: number | null;
  energyBurnedKcal: number | null;
  zone1Min: number | null;
  zone2Min: number | null;
  zone3Min: number | null;
  belowZone1Min: number | null;
  activeZoneMinutes: number | null;
  restingHr: number | null;
  sleepMinutes: number | null;
}

function emptyBucket(): DayBucket {
  return {
    steps: null,
    energyBurnedKcal: null,
    zone1Min: null,
    zone2Min: null,
    zone3Min: null,
    belowZone1Min: null,
    activeZoneMinutes: null,
    restingHr: null,
    sleepMinutes: null,
  };
}

function parseFitbitDateTime(dt: string): string | null {
  const match = dt.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    let year = parseInt(match[3], 10);
    year = year < 50 ? 2000 + year : 1900 + year;
    const month = match[1].padStart(2, "0");
    const day = match[2].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const isoMatch = dt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return null;
}

function findFitbitGlobalExportDir(entries: Map<string, Buffer>): string | null {
  const knownPrefixes = ["steps-", "calories-", "heart_rate-", "time_in_heart_rate_zones-", "resting_heart_rate-", "sleep-"];

  const candidates = new Map<string, number>();

  for (const path of entries.keys()) {
    const parts = path.split("/");
    const filename = parts[parts.length - 1];
    if (knownPrefixes.some((p) => filename.startsWith(p)) && filename.endsWith(".json")) {
      const dir = parts.slice(0, -1).join("/");
      candidates.set(dir, (candidates.get(dir) || 0) + 1);
    }
  }

  if (candidates.size === 0) return null;

  let bestDir = "";
  let bestCount = 0;
  for (const [dir, count] of candidates.entries()) {
    if (count > bestCount) {
      bestDir = dir;
      bestCount = count;
    }
  }
  return bestDir;
}

function findSleepScoreCSV(entries: Map<string, Buffer>): string | null {
  for (const path of entries.keys()) {
    const lower = path.toLowerCase();
    if (lower.includes("sleep") && lower.includes("score") && lower.endsWith(".csv")) {
      return path;
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

function parseStepsFile(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = parseInt(item.value, 10);
      if (isNaN(val)) continue;
      if (!buckets.has(date)) buckets.set(date, emptyBucket());
      const b = buckets.get(date)!;
      b.steps = (b.steps || 0) + val;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function parseCaloriesFile(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = parseFloat(item.value);
      if (isNaN(val)) continue;
      if (!buckets.has(date)) buckets.set(date, emptyBucket());
      const b = buckets.get(date)!;
      b.energyBurnedKcal = Math.round((b.energyBurnedKcal || 0) + val);
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function parseHeartRateZonesFile(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const zones = item.value?.valuesInZones;
      if (!zones) continue;

      if (!buckets.has(date)) buckets.set(date, emptyBucket());
      const b = buckets.get(date)!;

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
  } catch {
    return 0;
  }
}

function parseRestingHrFile(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = item.value?.value;
      if (val == null || val <= 0) continue;
      const hr = Math.round(parseFloat(val));
      if (isNaN(hr) || hr <= 0) continue;

      if (!buckets.has(date)) buckets.set(date, emptyBucket());
      buckets.get(date)!.restingHr = hr;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function parseSleepJsonFile(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const dateOfSleep = item.dateOfSleep;
      if (!dateOfSleep) continue;
      const date = dateOfSleep.match(/^\d{4}-\d{2}-\d{2}/) ? dateOfSleep.slice(0, 10) : null;
      if (!date) continue;
      const minutesAsleep = item.minutesAsleep;
      if (minutesAsleep == null) continue;
      const mins = parseInt(minutesAsleep, 10);
      if (isNaN(mins)) continue;

      if (!buckets.has(date)) buckets.set(date, emptyBucket());
      const b = buckets.get(date)!;
      b.sleepMinutes = (b.sleepMinutes || 0) + mins;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function parseSleepScoreCSV(buf: Buffer, buckets: Map<string, DayBucket>): number {
  try {
    let text = buf.toString("utf-8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return 0;

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const tsIdx = headers.findIndex((h) => h === "timestamp" || h === "date");
    const sleepIdx = headers.findIndex((h) => h.includes("total_sleep") || h.includes("duration"));
    const rhrIdx = headers.findIndex((h) => h.includes("resting_heart_rate") || h.includes("restingheartrate"));

    if (tsIdx === -1) return 0;

    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const tsRaw = cols[tsIdx];
      if (!tsRaw) continue;

      let date: string | null = null;
      if (/^\d{4}-\d{2}-\d{2}/.test(tsRaw)) {
        date = tsRaw.slice(0, 10);
      } else {
        const d = new Date(tsRaw);
        if (!isNaN(d.getTime())) {
          date = d.toISOString().slice(0, 10);
        }
      }
      if (!date) continue;

      if (!buckets.has(date)) buckets.set(date, emptyBucket());
      const b = buckets.get(date)!;

      if (sleepIdx !== -1 && cols[sleepIdx]) {
        const mins = parseInt(cols[sleepIdx], 10);
        if (!isNaN(mins) && mins > 0 && b.sleepMinutes == null) {
          b.sleepMinutes = mins;
        }
      }
      if (rhrIdx !== -1 && cols[rhrIdx]) {
        const hr = parseInt(cols[rhrIdx], 10);
        if (!isNaN(hr) && hr > 0 && b.restingHr == null) {
          b.restingHr = hr;
        }
      }
      count++;
    }
    return count;
  } catch {
    return 0;
  }
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
      dateRange: null,
      daysAffected: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      recomputeRan: false,
      filesProcessed: 0,
      parseDetails: {},
    };
  }

  const entries = await extractZipEntries(fileBuffer);

  const globalDir = findFitbitGlobalExportDir(entries);
  if (!globalDir && entries.size === 0) {
    return {
      status: "error",
      dateRange: null,
      daysAffected: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      recomputeRan: false,
      filesProcessed: 0,
      parseDetails: {},
    };
  }

  const buckets = new Map<string, DayBucket>();
  let filesProcessed = 0;
  const parseDetails: Record<string, number> = {
    steps: 0,
    calories: 0,
    heartRateZones: 0,
    restingHr: 0,
    sleep: 0,
    sleepScore: 0,
  };

  for (const [path, buf] of entries.entries()) {
    const filename = path.split("/").pop() || "";
    const dir = path.split("/").slice(0, -1).join("/");

    if (globalDir != null && dir !== globalDir) {
      if (!path.toLowerCase().includes("sleep") || !path.endsWith(".csv")) {
        continue;
      }
    }

    if (filename.startsWith("steps-") && filename.endsWith(".json")) {
      parseDetails.steps += parseStepsFile(buf, buckets);
      filesProcessed++;
    } else if (filename.startsWith("calories-") && filename.endsWith(".json")) {
      parseDetails.calories += parseCaloriesFile(buf, buckets);
      filesProcessed++;
    } else if (filename.startsWith("time_in_heart_rate_zones-") && filename.endsWith(".json")) {
      parseDetails.heartRateZones += parseHeartRateZonesFile(buf, buckets);
      filesProcessed++;
    } else if (filename.startsWith("resting_heart_rate-") && filename.endsWith(".json")) {
      parseDetails.restingHr += parseRestingHrFile(buf, buckets);
      filesProcessed++;
    } else if (filename.startsWith("sleep-") && filename.endsWith(".json")) {
      parseDetails.sleep += parseSleepJsonFile(buf, buckets);
      filesProcessed++;
    }
  }

  const sleepCSVPath = findSleepScoreCSV(entries);
  if (sleepCSVPath) {
    const buf = entries.get(sleepCSVPath)!;
    parseDetails.sleepScore += parseSleepScoreCSV(buf, buckets);
    filesProcessed++;
  }

  if (buckets.size === 0) {
    return {
      status: "no_data",
      dateRange: null,
      daysAffected: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      recomputeRan: false,
      filesProcessed,
      parseDetails,
    };
  }

  const sortedDates = Array.from(buckets.keys()).sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];

  let rowsUpserted = 0;
  let rowsSkipped = 0;

  for (const [date, b] of buckets.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      rowsSkipped++;
      continue;
    }

    const hasData = b.steps != null || b.energyBurnedKcal != null || b.activeZoneMinutes != null ||
      b.restingHr != null || b.sleepMinutes != null || b.zone1Min != null;

    if (!hasData) {
      rowsSkipped++;
      continue;
    }

    if (overwriteFields) {
      await pool.query(
        `INSERT INTO daily_log (day, steps, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr,
          zone1_min, zone2_min, zone3_min, below_zone1_min, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (day) DO UPDATE SET
           steps = $2,
           active_zone_minutes = $3,
           sleep_minutes = $4,
           energy_burned_kcal = $5,
           resting_hr = $6,
           zone1_min = $7,
           zone2_min = $8,
           zone3_min = $9,
           below_zone1_min = $10,
           updated_at = NOW()`,
        [date, b.steps, b.activeZoneMinutes, b.sleepMinutes, b.energyBurnedKcal, b.restingHr,
          b.zone1Min, b.zone2Min, b.zone3Min, b.belowZone1Min],
      );
    } else {
      await pool.query(
        `INSERT INTO daily_log (day, morning_weight_lb, steps, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr,
          zone1_min, zone2_min, zone3_min, below_zone1_min, updated_at)
         VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (day) DO UPDATE SET
           steps = COALESCE($2, daily_log.steps),
           active_zone_minutes = COALESCE($3, daily_log.active_zone_minutes),
           sleep_minutes = COALESCE($4, daily_log.sleep_minutes),
           energy_burned_kcal = COALESCE($5, daily_log.energy_burned_kcal),
           resting_hr = COALESCE($6, daily_log.resting_hr),
           zone1_min = COALESCE($7, daily_log.zone1_min),
           zone2_min = COALESCE($8, daily_log.zone2_min),
           zone3_min = COALESCE($9, daily_log.zone3_min),
           below_zone1_min = COALESCE($10, daily_log.below_zone1_min),
           updated_at = NOW()`,
        [date, b.steps, b.activeZoneMinutes, b.sleepMinutes, b.energyBurnedKcal, b.restingHr,
          b.zone1Min, b.zone2Min, b.zone3Min, b.belowZone1Min],
      );
    }

    rowsUpserted++;
  }

  let recomputeRan = false;
  if (minDate && maxDate) {
    await recomputeRangeSpan(minDate, maxDate);
    recomputeRan = true;
  }

  const importId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await pool.query(
    `INSERT INTO fitbit_takeout_imports (id, original_filename, sha256, timezone, date_range_start, date_range_end, days_affected, rows_upserted, rows_skipped)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [importId, originalFilename, sha256, timezone, minDate, maxDate, buckets.size, rowsUpserted, rowsSkipped],
  );

  return {
    status: "ok",
    dateRange: { start: minDate, end: maxDate },
    daysAffected: buckets.size,
    rowsUpserted,
    rowsSkipped,
    recomputeRan,
    filesProcessed,
    parseDetails,
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
