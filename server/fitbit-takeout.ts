import { pool } from "./db";
import { recomputeRange } from "./recompute";
import { recomputeReadinessRange } from "./readiness-engine";
import crypto from "crypto";
import unzipper from "unzipper";
import { Readable } from "stream";

type Metric = "steps" | "calories" | "activeMinutes" | "zones" | "restingHr" | "sleep";

export interface TakeoutImportResult {
  status: string;
  dateRange: { start: string; end: string } | null;
  fitbitRootPrefix: string | null;
  filesParsed: number;
  filesSeen: number;
  daysAffected: number;
  daysInserted: number;
  daysUpdated: number;
  rowsSkipped: number;
  recomputeRan: boolean;
  parseDetails: Record<string, number>;
  filePatterns: string[];
  conflictsDetected: ConflictEntry[];
  rowsPerDayDistribution: Record<string, { min: number; max: number; median: number }>;
  timezoneUsed: string;
  sleepBucketRule: string;
  importSummary: ImportSummary;
}

interface ConflictEntry {
  date: string;
  metric: Metric;
  csvValue: number;
  jsonValue: number;
  resolution: string;
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

interface SleepBucketEntry {
  sleep_end_raw: string;
  sleep_end_local: string;
  bucket_date: string;
  minutes: number;
  source: "csv" | "json";
}

interface DiagnosticDay {
  rawFiles: Record<Metric, string[]>;
  rawRowCounts: Record<Metric, number>;
  computedValues: Partial<DayBucket>;
  source: Record<Metric, "csv" | "json" | "both" | "none">;
  sleepBucketing: SleepBucketEntry[];
}

interface ImportSummary {
  days_with_csv: number;
  days_with_json: number;
  days_with_both: number;
  conflicts_count: number;
}

let lastDiagnostics: Map<string, DiagnosticDay> | null = null;
let lastTimezone: string = "America/New_York";
let lastFitbitRoot: string | null = null;
let lastImportSummary: ImportSummary | null = null;

export function getDiagnostics(date: string): {
  date: string;
  diagnostics: DiagnosticDay | null;
  neighbors: Record<string, DiagnosticDay | null>;
  timezoneUsed: string;
  fitbitRootPrefix: string | null;
  sleepBucketRule: string;
  importSummary: ImportSummary | null;
  dbValues: Record<string, unknown> | null;
} {
  const diag = lastDiagnostics?.get(date) ?? null;
  const prev = lastDiagnostics?.get(shiftDate(date, -1)) ?? null;
  const next = lastDiagnostics?.get(shiftDate(date, 1)) ?? null;
  return {
    date,
    diagnostics: diag,
    neighbors: { [shiftDate(date, -1)]: prev, [shiftDate(date, 1)]: next },
    timezoneUsed: lastTimezone,
    fitbitRootPrefix: lastFitbitRoot,
    sleepBucketRule: "wake_date: sleep_end (UTC) + offset → local datetime → DATE(local) = bucket_date. Multiple segments on same wake-date are summed.",
    importSummary: lastImportSummary,
    dbValues: null,
  };
}

function shiftDate(d: string, offset: number): string {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

function emptyBucket(): DayBucket {
  return {
    steps: null, energyBurnedKcal: null,
    zone1Min: null, zone2Min: null, zone3Min: null, belowZone1Min: null,
    activeZoneMinutes: null, cardioMin: null,
    restingHr: null, sleepMinutes: null, hrv: null,
  };
}

function emptyDiagnostic(): DiagnosticDay {
  return {
    rawFiles: { steps: [], calories: [], activeMinutes: [], zones: [], restingHr: [], sleep: [] },
    rawRowCounts: { steps: 0, calories: 0, activeMinutes: 0, zones: 0, restingHr: 0, sleep: 0 },
    computedValues: {},
    source: { steps: "none", calories: "none", activeMinutes: "none", zones: "none", restingHr: "none", sleep: "none" },
    sleepBucketing: [],
  };
}

function ensureBucket(buckets: Map<string, DayBucket>, date: string): DayBucket {
  if (!buckets.has(date)) buckets.set(date, emptyBucket());
  return buckets.get(date)!;
}

function ensureDiag(diags: Map<string, DiagnosticDay>, date: string): DiagnosticDay {
  if (!diags.has(date)) diags.set(date, emptyDiagnostic());
  return diags.get(date)!;
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

function parseFitbitEndTimeToWakeDate(endTime: string, tz: string): string | null {
  const isoMatch = endTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return parseFitbitDateTime(endTime);
}

function parseUTCTimestampToLocalDate(utcTs: string, offsetStr: string): string | null {
  const m = utcTs.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return extractDateFromISO(utcTs);
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  if (isNaN(dt.getTime())) return extractDateFromISO(utcTs);
  if (offsetStr && offsetStr !== "+00:00") {
    const offMatch = offsetStr.match(/^([+-])(\d{2}):(\d{2})$/);
    if (offMatch) {
      const sign = offMatch[1] === "+" ? 1 : -1;
      const offMinutes = sign * (parseInt(offMatch[2]) * 60 + parseInt(offMatch[3]));
      dt.setUTCMinutes(dt.getUTCMinutes() + offMinutes);
    }
  }
  return dt.toISOString().slice(0, 10);
}

function applyOffsetToTimestamp(utcTs: string, offsetStr: string): string {
  const m = utcTs.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return utcTs;
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  if (isNaN(dt.getTime())) return utcTs;
  if (offsetStr && offsetStr !== "+00:00") {
    const offMatch = offsetStr.match(/^([+-])(\d{2}):(\d{2})$/);
    if (offMatch) {
      const sign = offMatch[1] === "+" ? 1 : -1;
      const offMinutes = sign * (parseInt(offMatch[2]) * 60 + parseInt(offMatch[3]));
      dt.setUTCMinutes(dt.getUTCMinutes() + offMinutes);
    }
  }
  return dt.toISOString().replace("T", " ").slice(0, 19);
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
    if (idx !== -1) return p.slice(0, idx) + "/Fitbit/";
  }
  for (const p of entryPaths) {
    const lower = p.toLowerCase();
    const idx = lower.indexOf("/fitbit/");
    if (idx !== -1) return p.slice(0, idx + 8);
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

function trackRowsPerDay(dist: Record<string, number[]>, key: string, dayCounts: Map<string, number>): void {
  if (!dist[key]) dist[key] = [];
  for (const count of dayCounts.values()) {
    dist[key].push(count);
  }
}

function computeDistribution(vals: number[]): { min: number; max: number; median: number } {
  if (vals.length === 0) return { min: 0, max: 0, median: 0 };
  vals.sort((a, b) => a - b);
  return { min: vals[0], max: vals[vals.length - 1], median: vals[Math.floor(vals.length / 2)] };
}

function parseStepsCSV(
  buf: Buffer, buckets: Map<string, DayBucket>, diags: Map<string, DiagnosticDay>,
  filename: string, rowDist: Record<string, number[]>,
): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date", "datetime");
  const stepsCol = colIdx(headers, "steps", "value");
  if (tsCol === -1 || stepsCol === -1) return 0;
  let count = 0;
  const dayCounts = new Map<string, number>();
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const val = parseInt(row[stepsCol], 10);
    if (isNaN(val)) continue;
    const b = ensureBucket(buckets, date);
    b.steps = (b.steps || 0) + val;
    const d = ensureDiag(diags, date);
    if (!d.rawFiles.steps.includes(filename)) d.rawFiles.steps.push(filename);
    d.rawRowCounts.steps++;
    d.source.steps = "csv";
    dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
    count++;
  }
  trackRowsPerDay(rowDist, "stepsCSV", dayCounts);
  return count;
}

function parseCaloriesCSV(
  buf: Buffer, buckets: Map<string, DayBucket>, diags: Map<string, DiagnosticDay>,
  filename: string, rowDist: Record<string, number[]>,
): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date", "datetime");
  const calCol = colIdx(headers, "calories", "kcal", "value");
  if (tsCol === -1 || calCol === -1) return 0;
  let count = 0;
  const dayCounts = new Map<string, number>();
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const val = parseFloat(row[calCol]);
    if (isNaN(val)) continue;
    const b = ensureBucket(buckets, date);
    b.energyBurnedKcal = Math.round((b.energyBurnedKcal || 0) + val);
    const d = ensureDiag(diags, date);
    if (!d.rawFiles.calories.includes(filename)) d.rawFiles.calories.push(filename);
    d.rawRowCounts.calories++;
    d.source.calories = "csv";
    dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
    count++;
  }
  trackRowsPerDay(rowDist, "caloriesCSV", dayCounts);
  return count;
}

function parseActiveMinutesCSV(
  buf: Buffer, buckets: Map<string, DayBucket>, diags: Map<string, DiagnosticDay>,
  filename: string, rowDist: Record<string, number[]>,
): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  const lightCol = colIdx(headers, "light");
  const modCol = colIdx(headers, "moderate");
  const veryCol = colIdx(headers, "very");
  if (tsCol === -1) return 0;
  let count = 0;
  const dayCounts = new Map<string, number>();
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
    const d = ensureDiag(diags, date);
    if (!d.rawFiles.activeMinutes.includes(filename)) d.rawFiles.activeMinutes.push(filename);
    d.rawRowCounts.activeMinutes++;
    d.source.activeMinutes = "csv";
    dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
    count++;
  }
  trackRowsPerDay(rowDist, "activeMinutesCSV", dayCounts);
  return count;
}

function parseTimeInZoneCSV(
  buf: Buffer, buckets: Map<string, DayBucket>, diags: Map<string, DiagnosticDay>,
  filename: string, rowDist: Record<string, number[]>,
): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  const zoneCol = colIdx(headers, "heart rate zone type", "zone", "zone_type");
  if (tsCol === -1) return 0;
  let count = 0;
  const dayCounts = new Map<string, number>();
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
    const d = ensureDiag(diags, date);
    if (!d.rawFiles.zones.includes(filename)) d.rawFiles.zones.push(filename);
    d.rawRowCounts.zones++;
    d.source.zones = "csv";
    dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
    count++;
  }
  trackRowsPerDay(rowDist, "timeInZoneCSV", dayCounts);
  return count;
}

function parseCaloriesInZoneCSV(
  buf: Buffer, diags: Map<string, DiagnosticDay>, filename: string,
): number {
  const { headers, rows } = parseCSVRows(buf);
  const tsCol = colIdx(headers, "timestamp", "date");
  if (tsCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const date = extractDateFromISO(row[tsCol] || "");
    if (!date) continue;
    const d = ensureDiag(diags, date);
    if (!d.rawFiles.zones.includes(filename)) d.rawFiles.zones.push(filename);
    count++;
  }
  return count;
}

function parseDailyRestingHrCSV(
  buf: Buffer, buckets: Map<string, DayBucket>, diags: Map<string, DiagnosticDay>,
  filename: string,
): number {
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
    const d = ensureDiag(diags, date);
    if (!d.rawFiles.restingHr.includes(filename)) d.rawFiles.restingHr.push(filename);
    d.rawRowCounts.restingHr++;
    d.source.restingHr = "csv";
    count++;
  }
  return count;
}

function parseUserSleepsCSV(
  buf: Buffer, buckets: Map<string, DayBucket>, diags: Map<string, DiagnosticDay>,
  filename: string,
): number {
  const { headers, rows } = parseCSVRows(buf);
  const sleepMinCol = colIdx(headers, "minutes_asleep", "minutesasleep");
  const endCol = colIdx(headers, "sleep_end", "end_time");
  const endOffsetCol = colIdx(headers, "end_utc_offset");
  if (sleepMinCol === -1) return 0;
  let count = 0;
  for (const row of rows) {
    const mins = parseInt(row[sleepMinCol], 10);
    if (isNaN(mins) || mins <= 0) continue;
    let date: string | null = null;
    const sleepEndRaw = endCol !== -1 ? row[endCol] || "" : "";
    const offsetStr = endOffsetCol !== -1 ? row[endOffsetCol] || "+00:00" : "+00:00";
    if (sleepEndRaw) {
      date = parseUTCTimestampToLocalDate(sleepEndRaw, offsetStr);
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
    const d = ensureDiag(diags, date);
    if (!d.rawFiles.sleep.includes(filename)) d.rawFiles.sleep.push(filename);
    d.rawRowCounts.sleep++;
    d.source.sleep = "csv";
    const sleepEndLocal = sleepEndRaw ? applyOffsetToTimestamp(sleepEndRaw, offsetStr) : sleepEndRaw;
    d.sleepBucketing.push({
      sleep_end_raw: sleepEndRaw,
      sleep_end_local: sleepEndLocal,
      bucket_date: date,
      minutes: mins,
      source: "csv",
    });
    count++;
  }
  return count;
}

function parseSleepScoreCSV(
  buf: Buffer, buckets: Map<string, DayBucket>, diags: Map<string, DiagnosticDay>,
  filename: string,
): number {
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
        const diag = ensureDiag(diags, date);
        if (!diag.rawFiles.restingHr.includes(filename)) diag.rawFiles.restingHr.push(filename);
        if (diag.source.restingHr === "none") diag.source.restingHr = "csv";
      }
    }
    count++;
  }
  return count;
}

function parseStepsJSON(
  buf: Buffer, csvDays: Set<string>, buckets: Map<string, DayBucket>,
  diags: Map<string, DiagnosticDay>, filename: string, conflicts: ConflictEntry[],
  rowDist: Record<string, number[]>,
): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    const jsonDayTotals = new Map<string, number>();
    const dayCounts = new Map<string, number>();
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = parseInt(item.value, 10);
      if (isNaN(val)) continue;
      jsonDayTotals.set(date, (jsonDayTotals.get(date) || 0) + val);
      dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
      count++;
    }
    trackRowsPerDay(rowDist, "stepsJSON", dayCounts);
    for (const [date, total] of jsonDayTotals) {
      const d = ensureDiag(diags, date);
      if (!d.rawFiles.steps.includes(filename)) d.rawFiles.steps.push(filename);
      if (csvDays.has(date)) {
        const csvVal = buckets.get(date)?.steps ?? 0;
        conflicts.push({ date, metric: "steps", csvValue: csvVal, jsonValue: total, resolution: "csv_preferred" });
        continue;
      }
      const b = ensureBucket(buckets, date);
      b.steps = (b.steps || 0) + total;
      d.rawRowCounts.steps += dayCounts.get(date) || 0;
      d.source.steps = d.source.steps === "csv" ? "both" : "json";
    }
    return count;
  } catch { return 0; }
}

function parseCaloriesJSON(
  buf: Buffer, csvDays: Set<string>, buckets: Map<string, DayBucket>,
  diags: Map<string, DiagnosticDay>, filename: string, conflicts: ConflictEntry[],
  rowDist: Record<string, number[]>,
): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    const jsonDayTotals = new Map<string, number>();
    const dayCounts = new Map<string, number>();
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const val = parseFloat(item.value);
      if (isNaN(val)) continue;
      jsonDayTotals.set(date, (jsonDayTotals.get(date) || 0) + val);
      dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
      count++;
    }
    trackRowsPerDay(rowDist, "caloriesJSON", dayCounts);
    for (const [date, total] of jsonDayTotals) {
      const d = ensureDiag(diags, date);
      if (!d.rawFiles.calories.includes(filename)) d.rawFiles.calories.push(filename);
      if (csvDays.has(date)) {
        const csvVal = buckets.get(date)?.energyBurnedKcal ?? 0;
        conflicts.push({ date, metric: "calories", csvValue: csvVal, jsonValue: Math.round(total), resolution: "csv_preferred" });
        continue;
      }
      const b = ensureBucket(buckets, date);
      b.energyBurnedKcal = Math.round((b.energyBurnedKcal || 0) + total);
      d.rawRowCounts.calories += dayCounts.get(date) || 0;
      d.source.calories = d.source.calories === "csv" ? "both" : "json";
    }
    return count;
  } catch { return 0; }
}

function parseHeartRateZonesJSON(
  buf: Buffer, csvDays: Set<string>, buckets: Map<string, DayBucket>,
  diags: Map<string, DiagnosticDay>, filename: string, conflicts: ConflictEntry[],
): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      const date = parseFitbitDateTime(item.dateTime);
      if (!date) continue;
      const zones = item.value?.valuesInZones;
      if (!zones) continue;
      const d = ensureDiag(diags, date);
      if (!d.rawFiles.zones.includes(filename)) d.rawFiles.zones.push(filename);
      if (csvDays.has(date)) {
        conflicts.push({ date, metric: "zones", csvValue: buckets.get(date)?.zone2Min ?? 0, jsonValue: parseFloat(zones.IN_DEFAULT_ZONE_2) || 0, resolution: "csv_preferred" });
        continue;
      }
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
      d.rawRowCounts.zones++;
      d.source.zones = d.source.zones === "csv" ? "both" : "json";
      count++;
    }
    return count;
  } catch { return 0; }
}

function parseRestingHrJSON(
  buf: Buffer, csvDays: Set<string>, buckets: Map<string, DayBucket>,
  diags: Map<string, DiagnosticDay>, filename: string, conflicts: ConflictEntry[],
): number {
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
      const d = ensureDiag(diags, date);
      if (!d.rawFiles.restingHr.includes(filename)) d.rawFiles.restingHr.push(filename);
      if (csvDays.has(date)) {
        conflicts.push({ date, metric: "restingHr", csvValue: buckets.get(date)?.restingHr ?? 0, jsonValue: hr, resolution: "csv_preferred" });
        continue;
      }
      ensureBucket(buckets, date).restingHr = hr;
      d.rawRowCounts.restingHr++;
      d.source.restingHr = d.source.restingHr === "csv" ? "both" : "json";
      count++;
    }
    return count;
  } catch { return 0; }
}

function parseSleepJSON(
  buf: Buffer, csvDays: Set<string>, buckets: Map<string, DayBucket>,
  diags: Map<string, DiagnosticDay>, filename: string, conflicts: ConflictEntry[],
  tz: string,
): number {
  try {
    const data = JSON.parse(buf.toString("utf-8"));
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      let date: string | null = null;
      const endTimeRaw = item.endTime || "";
      if (endTimeRaw) {
        date = parseFitbitEndTimeToWakeDate(endTimeRaw, tz);
      }
      if (!date && item.dateOfSleep) {
        date = item.dateOfSleep.match(/^\d{4}-\d{2}-\d{2}/) ? item.dateOfSleep.slice(0, 10) : null;
      }
      if (!date) continue;
      const mins = item.minutesAsleep;
      if (mins == null) continue;
      const minsVal = parseInt(mins, 10);
      if (isNaN(minsVal) || minsVal <= 0) continue;
      const d = ensureDiag(diags, date);
      if (!d.rawFiles.sleep.includes(filename)) d.rawFiles.sleep.push(filename);
      d.sleepBucketing.push({
        sleep_end_raw: endTimeRaw,
        sleep_end_local: endTimeRaw,
        bucket_date: date,
        minutes: minsVal,
        source: "json",
      });
      if (csvDays.has(date)) {
        conflicts.push({ date, metric: "sleep", csvValue: buckets.get(date)?.sleepMinutes ?? 0, jsonValue: minsVal, resolution: "csv_preferred" });
        continue;
      }
      const b = ensureBucket(buckets, date);
      b.sleepMinutes = (b.sleepMinutes || 0) + minsVal;
      d.rawRowCounts.sleep++;
      d.source.sleep = d.source.sleep === "csv" ? "both" : "json";
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
  lastTimezone = timezone;
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  const { rows: existing } = await pool.query(
    `SELECT id FROM fitbit_takeout_imports WHERE sha256 = $1`,
    [sha256],
  );
  if (existing.length > 0) {
    return {
      status: "duplicate",
      dateRange: null, fitbitRootPrefix: null,
      filesParsed: 0, filesSeen: 0, daysAffected: 0, daysInserted: 0, daysUpdated: 0,
      rowsSkipped: 0, recomputeRan: false, parseDetails: {}, filePatterns: [],
      conflictsDetected: [], rowsPerDayDistribution: {},
      timezoneUsed: timezone, sleepBucketRule: "wake_date",
      importSummary: { days_with_csv: 0, days_with_json: 0, days_with_both: 0, conflicts_count: 0 },
    };
  }

  console.log("[takeout] Extracting ZIP entries...");
  const entries = await extractZipEntries(fileBuffer);
  console.log(`[takeout] Found ${entries.size} files in ZIP`);

  const fitbitRoot = findFitbitRoot(Array.from(entries.keys()));
  lastFitbitRoot = fitbitRoot;
  if (!fitbitRoot) {
    return {
      status: "error_no_fitbit_root",
      dateRange: null, fitbitRootPrefix: null,
      filesParsed: 0, filesSeen: entries.size, daysAffected: 0, daysInserted: 0, daysUpdated: 0,
      rowsSkipped: 0, recomputeRan: false, parseDetails: {}, filePatterns: [],
      conflictsDetected: [], rowsPerDayDistribution: {},
      timezoneUsed: timezone, sleepBucketRule: "wake_date",
      importSummary: { days_with_csv: 0, days_with_json: 0, days_with_both: 0, conflicts_count: 0 },
    };
  }

  console.log(`[takeout] Fitbit root: ${fitbitRoot}`);

  const csvBuckets = new Map<string, DayBucket>();
  const diags = new Map<string, DiagnosticDay>();
  const conflicts: ConflictEntry[] = [];
  let filesParsed = 0;
  let filesSeen = 0;
  const filePatterns: string[] = [];
  const rowDistRaw: Record<string, number[]> = {};

  const parseDetails: Record<string, number> = {
    stepsCSV: 0, stepsJSON: 0,
    caloriesCSV: 0, caloriesJSON: 0,
    caloriesInZoneCSV: 0,
    activeMinutesCSV: 0,
    timeInZoneCSV: 0, heartRateZonesJSON: 0,
    dailyRestingHrCSV: 0, restingHrJSON: 0,
    sleepScoreCSV: 0, userSleepsCSV: 0, sleepJSON: 0,
  };

  const csvStepsDays = new Set<string>();
  const csvCaloriesDays = new Set<string>();
  const csvActiveMinDays = new Set<string>();
  const csvZonesDays = new Set<string>();
  const csvRestingHrDays = new Set<string>();
  const csvSleepDays = new Set<string>();

  const csvFiles: Array<{ path: string; filename: string; fnLower: string; buf: Buffer }> = [];
  const jsonFiles: Array<{ path: string; filename: string; fnLower: string; buf: Buffer }> = [];

  for (const [path, buf] of entries.entries()) {
    if (!path.startsWith(fitbitRoot)) continue;
    const filename = path.split("/").pop() || "";
    const fnLower = filename.toLowerCase();
    if (fnLower.endsWith(".txt")) continue;
    filesSeen++;
    if (fnLower.endsWith(".csv")) csvFiles.push({ path, filename, fnLower, buf });
    else if (fnLower.endsWith(".json")) jsonFiles.push({ path, filename, fnLower, buf });
  }

  for (const { filename, fnLower, buf } of csvFiles) {
    if (fnLower.startsWith("steps_") && fnLower.endsWith(".csv")) {
      const beforeDays = new Set(csvBuckets.keys());
      parseDetails.stepsCSV += parseStepsCSV(buf, csvBuckets, diags, filename, rowDistRaw);
      for (const d of csvBuckets.keys()) { if (csvBuckets.get(d)!.steps != null) csvStepsDays.add(d); }
      filesParsed++;
      if (!filePatterns.includes("steps_*.csv")) filePatterns.push("steps_*.csv");
    } else if (fnLower.startsWith("calories_in_heart_rate_zone_") && fnLower.endsWith(".csv")) {
      parseDetails.caloriesInZoneCSV += parseCaloriesInZoneCSV(buf, diags, filename);
      filesParsed++;
      if (!filePatterns.includes("calories_in_heart_rate_zone_*.csv")) filePatterns.push("calories_in_heart_rate_zone_*.csv");
    } else if (fnLower.startsWith("calories_") && fnLower.endsWith(".csv")) {
      parseDetails.caloriesCSV += parseCaloriesCSV(buf, csvBuckets, diags, filename, rowDistRaw);
      for (const d of csvBuckets.keys()) { if (csvBuckets.get(d)!.energyBurnedKcal != null) csvCaloriesDays.add(d); }
      filesParsed++;
      if (!filePatterns.includes("calories_*.csv")) filePatterns.push("calories_*.csv");
    } else if (fnLower.startsWith("active_minutes_") && fnLower.endsWith(".csv")) {
      parseDetails.activeMinutesCSV += parseActiveMinutesCSV(buf, csvBuckets, diags, filename, rowDistRaw);
      for (const d of csvBuckets.keys()) { if (csvBuckets.get(d)!.activeZoneMinutes != null) csvActiveMinDays.add(d); }
      filesParsed++;
      if (!filePatterns.includes("active_minutes_*.csv")) filePatterns.push("active_minutes_*.csv");
    } else if (fnLower.startsWith("time_in_heart_rate_zone_") && fnLower.endsWith(".csv")) {
      parseDetails.timeInZoneCSV += parseTimeInZoneCSV(buf, csvBuckets, diags, filename, rowDistRaw);
      for (const d of csvBuckets.keys()) { if (csvBuckets.get(d)!.zone2Min != null) csvZonesDays.add(d); }
      filesParsed++;
      if (!filePatterns.includes("time_in_heart_rate_zone_*.csv")) filePatterns.push("time_in_heart_rate_zone_*.csv");
    } else if (fnLower === "daily_resting_heart_rate.csv") {
      parseDetails.dailyRestingHrCSV += parseDailyRestingHrCSV(buf, csvBuckets, diags, filename);
      for (const d of csvBuckets.keys()) { if (csvBuckets.get(d)!.restingHr != null) csvRestingHrDays.add(d); }
      filesParsed++;
      if (!filePatterns.includes("daily_resting_heart_rate.csv")) filePatterns.push("daily_resting_heart_rate.csv");
    } else if (fnLower === "sleep_score.csv" || (fnLower.includes("sleep") && fnLower.includes("score") && fnLower.endsWith(".csv"))) {
      parseDetails.sleepScoreCSV += parseSleepScoreCSV(buf, csvBuckets, diags, filename);
      for (const d of csvBuckets.keys()) { if (csvBuckets.get(d)!.restingHr != null) csvRestingHrDays.add(d); }
      filesParsed++;
      if (!filePatterns.includes("sleep_score.csv")) filePatterns.push("sleep_score.csv");
    } else if (fnLower.startsWith("usersleeps") && fnLower.endsWith(".csv")) {
      parseDetails.userSleepsCSV += parseUserSleepsCSV(buf, csvBuckets, diags, filename);
      for (const d of csvBuckets.keys()) { if (csvBuckets.get(d)!.sleepMinutes != null) csvSleepDays.add(d); }
      filesParsed++;
      if (!filePatterns.includes("UserSleeps_*.csv")) filePatterns.push("UserSleeps_*.csv");
    }
  }

  console.log(`[takeout] CSV pass done: ${filesParsed} files, ${csvBuckets.size} days`);
  console.log(`[takeout] CSV coverage: steps=${csvStepsDays.size}d, cal=${csvCaloriesDays.size}d, azm=${csvActiveMinDays.size}d, zones=${csvZonesDays.size}d, rhr=${csvRestingHrDays.size}d, sleep=${csvSleepDays.size}d`);

  for (const { filename, fnLower, buf } of jsonFiles) {
    if (fnLower.startsWith("steps-") && fnLower.endsWith(".json")) {
      parseDetails.stepsJSON += parseStepsJSON(buf, csvStepsDays, csvBuckets, diags, filename, conflicts, rowDistRaw);
      filesParsed++;
      if (!filePatterns.includes("steps-*.json")) filePatterns.push("steps-*.json");
    } else if (fnLower.startsWith("calories-") && fnLower.endsWith(".json")) {
      parseDetails.caloriesJSON += parseCaloriesJSON(buf, csvCaloriesDays, csvBuckets, diags, filename, conflicts, rowDistRaw);
      filesParsed++;
      if (!filePatterns.includes("calories-*.json")) filePatterns.push("calories-*.json");
    } else if (fnLower.startsWith("time_in_heart_rate_zones-") && fnLower.endsWith(".json")) {
      parseDetails.heartRateZonesJSON += parseHeartRateZonesJSON(buf, csvZonesDays, csvBuckets, diags, filename, conflicts);
      filesParsed++;
      if (!filePatterns.includes("time_in_heart_rate_zones-*.json")) filePatterns.push("time_in_heart_rate_zones-*.json");
    } else if (fnLower.startsWith("resting_heart_rate-") && fnLower.endsWith(".json")) {
      parseDetails.restingHrJSON += parseRestingHrJSON(buf, csvRestingHrDays, csvBuckets, diags, filename, conflicts);
      filesParsed++;
      if (!filePatterns.includes("resting_heart_rate-*.json")) filePatterns.push("resting_heart_rate-*.json");
    } else if (fnLower.startsWith("sleep-") && fnLower.endsWith(".json")) {
      parseDetails.sleepJSON += parseSleepJSON(buf, csvSleepDays, csvBuckets, diags, filename, conflicts, timezone);
      filesParsed++;
      if (!filePatterns.includes("sleep-*.json")) filePatterns.push("sleep-*.json");
    }
  }

  for (const [date, b] of csvBuckets) {
    const d = ensureDiag(diags, date);
    d.computedValues = { ...b };
  }

  lastDiagnostics = diags;

  let daysWithCsv = 0, daysWithJson = 0, daysWithBoth = 0;
  for (const [, d] of diags) {
    const metrics: Metric[] = ["steps", "calories", "activeMinutes", "zones", "restingHr", "sleep"];
    let hasCsv = false, hasJson = false;
    for (const m of metrics) {
      if (d.source[m] === "csv") hasCsv = true;
      if (d.source[m] === "json") hasJson = true;
      if (d.source[m] === "both") { hasCsv = true; hasJson = true; }
    }
    if (hasCsv && hasJson) daysWithBoth++;
    else if (hasCsv) daysWithCsv++;
    else if (hasJson) daysWithJson++;
  }
  lastImportSummary = {
    days_with_csv: daysWithCsv,
    days_with_json: daysWithJson,
    days_with_both: daysWithBoth,
    conflicts_count: conflicts.length,
  };

  console.log(`[takeout] Total parsed: ${filesParsed} files, ${csvBuckets.size} unique days, ${conflicts.length} conflicts resolved (CSV preferred)`);
  console.log(`[takeout] Import summary: csv_only=${daysWithCsv}, json_only=${daysWithJson}, both=${daysWithBoth}, conflicts=${conflicts.length}`);

  const rowsPerDayDistribution: Record<string, { min: number; max: number; median: number }> = {};
  for (const [key, vals] of Object.entries(rowDistRaw)) {
    rowsPerDayDistribution[key] = computeDistribution(vals);
  }

  if (csvBuckets.size === 0) {
    return {
      status: "no_data",
      dateRange: null, fitbitRootPrefix: fitbitRoot,
      filesParsed, filesSeen, daysAffected: 0, daysInserted: 0, daysUpdated: 0,
      rowsSkipped: 0, recomputeRan: false, parseDetails, filePatterns,
      conflictsDetected: conflicts.slice(0, 50), rowsPerDayDistribution,
      timezoneUsed: timezone, sleepBucketRule: "wake_date",
      importSummary: lastImportSummary!,
    };
  }

  const sortedDates = Array.from(csvBuckets.keys()).sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];

  const { rows: existingDays } = await pool.query(
    `SELECT day FROM daily_log WHERE day >= $1 AND day <= $2`,
    [minDate, maxDate],
  );
  const existingDaySet = new Set(existingDays.map((r: { day: string }) => r.day));

  let daysInserted = 0;
  let daysUpdated = 0;
  let rowsSkipped = 0;

  for (const [date, b] of csvBuckets.entries()) {
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
      JSON.stringify({ filePatterns, conflictsCount: conflicts.length, filesSeen, filesParsed })],
  );

  console.log(`[takeout] Import complete: ${daysInserted} inserted, ${daysUpdated} updated, ${rowsSkipped} skipped, ${conflicts.length} conflicts resolved`);

  return {
    status: "ok",
    dateRange: { start: minDate, end: maxDate },
    fitbitRootPrefix: fitbitRoot,
    filesParsed,
    filesSeen,
    daysAffected: daysInserted + daysUpdated,
    daysInserted,
    daysUpdated,
    rowsSkipped,
    recomputeRan,
    parseDetails,
    filePatterns,
    conflictsDetected: conflicts.slice(0, 100),
    rowsPerDayDistribution,
    timezoneUsed: timezone,
    sleepBucketRule: "wake_date: sleep_end (UTC) + offset → local datetime → DATE(local) = bucket_date",
    importSummary: lastImportSummary!,
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
