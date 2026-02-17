import { pool } from "./db";
import crypto from "crypto";

const DEFAULT_USER_ID = 'local_default';

interface Snapshot {
  id: string;
  sha256: string;
  session_date: string;
  total_nights: number;
  total_erections: number;
  total_duration_sec: number;
  number_of_recordings: number;
  erectile_fitness_score: number | null;
  avg_firmness_nocturnal: number | null;
  avg_erections_per_night: number | null;
  avg_duration_per_night_sec: number | null;
}

interface ParsedSnapshot {
  sha256: string;
  total_nights: number;
  total_erections: number;
  total_duration_sec: number;
  number_of_recordings: number;
  erectile_fitness_score: number | null;
  avg_firmness_nocturnal: number | null;
  avg_erections_per_night: number | null;
  avg_duration_per_night_sec: number | null;
}

interface DeriveResult {
  snapshot: Snapshot;
  derived: {
    sessionDate: string;
    deltaErections: number;
    deltaDurationSec: number;
    multiNightCombined: boolean;
    deltaNights: number;
  } | null;
  note: string;
  gapsFilled: number;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z");
  const db = new Date(b + "T00:00:00Z");
  return Math.round((db.getTime() - da.getTime()) / (86400 * 1000));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function roundInt(v: number): number {
  return Math.round(v);
}

function computeProxyScore(erections: number, durationSec: number): number {
  const durMin = durationSec / 60;
  return Math.round(((erections * 1.0) + Math.log(1 + durMin) * 0.8) * 100) / 100;
}

function parseHmsToSeconds(val: string): number {
  val = val.trim();
  const asNum = Number(val);
  if (!isNaN(asNum) && !val.includes(":")) return Math.round(asNum);
  const parts = val.split(":").map((p: string) => parseInt(p, 10));
  if (parts.length === 3 && parts.every((p: number) => !isNaN(p))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every((p: number) => !isNaN(p))) {
    return parts[0] * 60 + parts[1];
  }
  throw new Error(`Cannot parse duration value: "${val}". Expected HH:MM:SS, MM:SS, or seconds.`);
}

function parseOptionalFloat(val: string | undefined): number | null {
  if (val == null || val.trim() === "") return null;
  const n = parseFloat(val.trim());
  return isNaN(n) ? null : n;
}

function parseOptionalHms(val: string | undefined): number | null {
  if (val == null || val.trim() === "") return null;
  try {
    return parseHmsToSeconds(val);
  } catch {
    return null;
  }
}

export function parseSnapshotFile(fileBuffer: Buffer, _filename: string): ParsedSnapshot {
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  let text = fileBuffer.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("File must have a header row and at least one data row");
  }

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(",").map((h: string) => h.trim().replace(/[^a-z0-9_]/g, "_"));
  const values = lines[lines.length - 1].split(",").map((v: string) => v.trim());

  const colMap: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    colMap[headers[i]] = i;
  }

  function findCol(...aliases: string[]): number {
    for (const alias of aliases) {
      const normalized = alias.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      if (colMap[normalized] !== undefined) return colMap[normalized];
    }
    for (const alias of aliases) {
      const normalized = alias.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      for (const key of Object.keys(colMap)) {
        if (key.includes(normalized)) return colMap[key];
      }
    }
    return -1;
  }

  const nightsIdx = findCol(
    "number_of_recordings_with_nocturnal_or_morning_erections",
    "number_of_recordings_with_nocturnal",
    "recordings_with_nocturnal",
  );
  const erIdx = findCol(
    "total_number_of_nocturnal_and_morning_erections",
    "total_nocturnal_erections",
    "total_number_of_erections",
    "nocturnal_erections",
    "total_erections",
  );
  const durIdx = findCol(
    "total_duration_of_all_nocturnal_and_morning_erections",
    "total_nocturnal_duration_seconds",
    "total_duration_of_all_nocturnal_erections",
    "nocturnal_duration_seconds",
    "total_duration_seconds",
  );
  const recIdx = findCol(
    "number_of_recordings",
  );
  const fitnessIdx = findCol(
    "erectile_fitness_score",
  );
  const firmnessIdx = findCol(
    "average_firmness_of_nocturnal_erections",
    "avg_firmness_nocturnal",
  );
  const avgErPerNightIdx = findCol(
    "average_number_of_nocturnal_erections_per_night",
    "avg_erections_per_night",
  );
  const avgDurPerNightIdx = findCol(
    "average_total_duration_of_all_nocturnal_erections_per_night",
    "avg_duration_per_night",
  );

  if (nightsIdx === -1) throw new Error("Missing column: number_of_recordings_with_nocturnal_or_morning_erections");
  if (erIdx === -1) throw new Error("Missing column for erection count (tried: total_number_of_nocturnal_and_morning_erections, total_nocturnal_erections)");
  if (durIdx === -1) throw new Error("Missing column for duration (tried: total_duration_of_all_nocturnal_and_morning_erections, total_nocturnal_duration_seconds)");

  const totalNights = parseInt(values[nightsIdx], 10);
  const totalErections = parseInt(values[erIdx], 10);
  const totalDurationSec = parseHmsToSeconds(values[durIdx]);
  const numberOfRecordings = recIdx !== -1 ? parseInt(values[recIdx], 10) : totalNights;

  if (isNaN(totalNights)) throw new Error("Invalid total_nights value");
  if (isNaN(totalErections)) throw new Error("Invalid erection count value");

  return {
    sha256,
    total_nights: totalNights,
    total_erections: totalErections,
    total_duration_sec: totalDurationSec,
    number_of_recordings: isNaN(numberOfRecordings) ? totalNights : numberOfRecordings,
    erectile_fitness_score: fitnessIdx !== -1 ? parseOptionalFloat(values[fitnessIdx]) : null,
    avg_firmness_nocturnal: firmnessIdx !== -1 ? parseOptionalFloat(values[firmnessIdx]) : null,
    avg_erections_per_night: avgErPerNightIdx !== -1 ? parseOptionalFloat(values[avgErPerNightIdx]) : null,
    avg_duration_per_night_sec: avgDurPerNightIdx !== -1 ? parseOptionalHms(values[avgDurPerNightIdx]) : null,
  };
}

export async function importSnapshotAndDerive(
  parsed: ParsedSnapshot,
  sessionDate: string,
  originalFilename: string,
  userId: string = DEFAULT_USER_ID,
): Promise<DeriveResult> {
  const { rows: existingSnap } = await pool.query(
    `SELECT id FROM erection_summary_snapshots WHERE sha256 = $1 AND user_id = $2`,
    [parsed.sha256, userId],
  );
  if (existingSnap.length > 0) {
    const snap = (await pool.query(`SELECT * FROM erection_summary_snapshots WHERE sha256 = $1 AND user_id = $2`, [parsed.sha256, userId])).rows[0];
    return {
      snapshot: rowToSnapshot(snap),
      derived: null,
      note: "duplicate_snapshot",
      gapsFilled: 0,
    };
  }

  const { rows: insertedRows } = await pool.query(
    `INSERT INTO erection_summary_snapshots (
       user_id, sha256, session_date, total_nights, total_nocturnal_erections, total_nocturnal_duration_seconds,
       number_of_recordings, erectile_fitness_score, avg_firmness_nocturnal, avg_erections_per_night, avg_duration_per_night_sec,
       original_filename
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      userId,
      parsed.sha256, sessionDate, parsed.total_nights, parsed.total_erections, parsed.total_duration_sec,
      parsed.number_of_recordings, parsed.erectile_fitness_score, parsed.avg_firmness_nocturnal, parsed.avg_erections_per_night, parsed.avg_duration_per_night_sec,
      originalFilename,
    ],
  );
  const sNew = rowToSnapshot(insertedRows[0]);

  const { rows: prevRows } = await pool.query(
    `SELECT * FROM erection_summary_snapshots
     WHERE total_nights < $1 AND user_id = $2
     ORDER BY total_nights DESC
     LIMIT 1`,
    [sNew.total_nights, userId],
  );

  if (prevRows.length === 0) {
    if (sNew.total_nights === 1) {
      await upsertMeasuredSession(
        sessionDate,
        sNew.total_erections,
        sNew.total_duration_sec,
        sNew.id,
        false,
        userId,
      );

      const chainResult = await chainRecomputeNext(sNew, sessionDate, userId);
      const maxDate = chainResult.nextSessionDate
        ? (sessionDate > chainResult.nextSessionDate ? sessionDate : chainResult.nextSessionDate)
        : sessionDate;
      await recomputeGapsAndProxy(sessionDate, maxDate, userId);

      return {
        snapshot: sNew,
        derived: {
          sessionDate,
          deltaErections: sNew.total_erections,
          deltaDurationSec: sNew.total_duration_sec,
          multiNightCombined: false,
          deltaNights: 1,
        },
        note: "baseline_measured",
        gapsFilled: chainResult.gapsFilled,
      };
    } else {
      const chainResult = await chainRecomputeNext(sNew, sessionDate, userId);
      const maxDate = chainResult.nextSessionDate
        ? (sessionDate > chainResult.nextSessionDate ? sessionDate : chainResult.nextSessionDate)
        : sessionDate;
      await recomputeGapsAndProxy(sessionDate, maxDate, userId);

      return {
        snapshot: sNew,
        derived: null,
        note: "baseline_seed_no_session",
        gapsFilled: chainResult.gapsFilled,
      };
    }
  }

  const sPrev = rowToSnapshot(prevRows[0]);
  const dn = sNew.total_nights - sPrev.total_nights;
  const de = sNew.total_erections - sPrev.total_erections;
  const dd = sNew.total_duration_sec - sPrev.total_duration_sec;

  if (dn <= 0 || de < 0 || dd < 0) {
    await pool.query(`DELETE FROM erection_summary_snapshots WHERE id = $1 AND user_id = $2`, [sNew.id, userId]);
    throw new Error(
      `Snapshot not cumulative / ordering invalid: dn=${dn}, de=${de}, dd=${dd}`
    );
  }

  const multiNightCombined = dn > 1;

  await upsertMeasuredSession(
    sessionDate,
    de,
    dd,
    sNew.id,
    multiNightCombined,
    userId,
  );

  let gapsFilled = await detectAndFillGaps(
    addDays(sessionDate, -60),
    addDays(sessionDate, 60),
    sNew.id,
    userId,
  );

  const chainResult = await chainRecomputeNext(sNew, sessionDate, userId);
  gapsFilled += chainResult.gapsFilled;

  const minDate = chainResult.nextSessionDate
    ? (sessionDate < chainResult.nextSessionDate ? sessionDate : chainResult.nextSessionDate)
    : sessionDate;
  const maxDate = chainResult.nextSessionDate
    ? (sessionDate > chainResult.nextSessionDate ? sessionDate : chainResult.nextSessionDate)
    : sessionDate;
  await recomputeGapsAndProxy(minDate, maxDate, userId);

  return {
    snapshot: sNew,
    derived: {
      sessionDate,
      deltaErections: de,
      deltaDurationSec: dd,
      multiNightCombined,
      deltaNights: dn,
    },
    note: multiNightCombined ? "multi_night_measured" : "single_night_measured",
    gapsFilled,
  };
}

async function upsertMeasuredSession(
  date: string,
  erections: number,
  durationSec: number,
  snapshotId: string,
  multiNightCombined: boolean,
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  await pool.query(
    `INSERT INTO erection_sessions (user_id, date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id, is_imputed, imputed_method, imputed_source_date_start, imputed_source_date_end, multi_night_combined, updated_at)
     VALUES ($1, $2, $3, $4, $5, FALSE, NULL, NULL, NULL, $6, NOW())
     ON CONFLICT (user_id, date) DO UPDATE SET
       nocturnal_erections = EXCLUDED.nocturnal_erections,
       nocturnal_duration_seconds = EXCLUDED.nocturnal_duration_seconds,
       snapshot_id = EXCLUDED.snapshot_id,
       is_imputed = FALSE,
       imputed_method = NULL,
       imputed_source_date_start = NULL,
       imputed_source_date_end = NULL,
       multi_night_combined = EXCLUDED.multi_night_combined,
       updated_at = NOW()`,
    [userId, date, erections, durationSec, snapshotId, multiNightCombined],
  );
}

async function detectAndFillGaps(fromDate: string, toDate: string, snapshotId: string | null, userId: string = DEFAULT_USER_ID): Promise<number> {
  const { rows: anchors } = await pool.query(
    `SELECT date::text as date, nocturnal_erections, nocturnal_duration_seconds
     FROM erection_sessions
     WHERE date BETWEEN $1 AND $2 AND is_imputed = FALSE AND user_id = $3
     ORDER BY date ASC`,
    [fromDate, toDate, userId],
  );

  if (anchors.length < 2) return 0;

  let filled = 0;

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i] as { date: string; nocturnal_erections: number; nocturnal_duration_seconds: number };
    const b = anchors[i + 1] as { date: string; nocturnal_erections: number; nocturnal_duration_seconds: number };
    const gap = daysDiff(a.date, b.date);
    if (gap <= 1) continue;

    for (let k = 1; k < gap; k++) {
      const d = addDays(a.date, k);
      const t = k / gap;
      const interpE = roundInt(lerp(a.nocturnal_erections ?? 0, b.nocturnal_erections ?? 0, t));
      const interpDur = roundInt(lerp(a.nocturnal_duration_seconds ?? 0, b.nocturnal_duration_seconds ?? 0, t));

      await pool.query(
        `INSERT INTO erection_sessions (user_id, date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id, is_imputed, imputed_method, imputed_source_date_start, imputed_source_date_end, multi_night_combined, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, FALSE, NOW())
         ON CONFLICT (user_id, date) DO UPDATE SET
           nocturnal_erections = EXCLUDED.nocturnal_erections,
           nocturnal_duration_seconds = EXCLUDED.nocturnal_duration_seconds,
           snapshot_id = EXCLUDED.snapshot_id,
           is_imputed = TRUE,
           imputed_method = EXCLUDED.imputed_method,
           imputed_source_date_start = EXCLUDED.imputed_source_date_start,
           imputed_source_date_end = EXCLUDED.imputed_source_date_end,
           multi_night_combined = FALSE,
           updated_at = NOW()
         WHERE erection_sessions.is_imputed = TRUE`,
        [userId, d, interpE, interpDur, snapshotId, "linear_interpolation", a.date, b.date],
      );
      filled++;
    }
  }

  return filled;
}

async function recomputeGapsAndProxy(sessionDateOrMin: string, sessionDateMax?: string, userId: string = DEFAULT_USER_ID): Promise<void> {
  const minD = sessionDateOrMin;
  const maxD = sessionDateMax ?? sessionDateOrMin;
  const from = addDays(minD < maxD ? minD : maxD, -30);
  const to = addDays(minD > maxD ? minD : maxD, 1);

  await recomputeAndrogenProxy(from, to, false, userId);
  await recomputeAndrogenProxy(from, to, true, userId);
}

async function chainRecomputeNext(
  sNew: Snapshot,
  sessionDate: string,
  userId: string = DEFAULT_USER_ID,
): Promise<{ gapsFilled: number; nextSessionDate: string | null }> {
  const { rows: nextRows } = await pool.query(
    `SELECT * FROM erection_summary_snapshots
     WHERE total_nights > $1 AND user_id = $2
     ORDER BY total_nights ASC
     LIMIT 1`,
    [sNew.total_nights, userId],
  );

  if (nextRows.length === 0) {
    return { gapsFilled: 0, nextSessionDate: null };
  }

  const sNext = rowToSnapshot(nextRows[0]);
  const dn2 = sNext.total_nights - sNew.total_nights;
  const de2 = sNext.total_erections - sNew.total_erections;
  const dd2 = sNext.total_duration_sec - sNew.total_duration_sec;

  if (dn2 <= 0 || de2 < 0 || dd2 < 0) {
    console.warn(`Chain recompute: next snapshot ${sNext.id} has invalid delta after insert (dn=${dn2}, de=${de2}, dd=${dd2}), skipping`);
    return { gapsFilled: 0, nextSessionDate: sNext.session_date };
  }

  const multiNight2 = dn2 > 1;
  await upsertMeasuredSession(
    sNext.session_date,
    de2,
    dd2,
    sNext.id,
    multiNight2,
    userId,
  );

  const rangeFrom = sessionDate < sNext.session_date ? sessionDate : sNext.session_date;
  const rangeTo = sessionDate > sNext.session_date ? sessionDate : sNext.session_date;
  const gapsFilled = await detectAndFillGaps(
    addDays(rangeFrom, -7),
    addDays(rangeTo, 7),
    sNext.id,
    userId,
  );

  return { gapsFilled, nextSessionDate: sNext.session_date };
}

async function recomputeAndrogenProxy(fromDate: string, toDate: string, includeImputed: boolean, userId: string = DEFAULT_USER_ID): Promise<void> {
  const pullFrom = addDays(fromDate, -7);

  const { rows } = await pool.query(
    `SELECT date::text as date, nocturnal_erections, nocturnal_duration_seconds, is_imputed
     FROM erection_sessions
     WHERE date BETWEEN $1 AND $2
       AND ($3::boolean = TRUE OR is_imputed = FALSE)
       AND user_id = $4
     ORDER BY date ASC`,
    [pullFrom, toDate, includeImputed, userId],
  );

  const sessionMap = new Map<string, number | null>();
  for (const r of rows) {
    const score = (r.nocturnal_erections == null || r.nocturnal_duration_seconds == null)
      ? null
      : computeProxyScore(r.nocturnal_erections, r.nocturnal_duration_seconds);
    sessionMap.set(r.date, score);
  }

  interface DailyProxy {
    date: string;
    proxy: number | null;
  }

  const fullSeries: DailyProxy[] = [];
  let cursor = pullFrom;
  while (cursor <= toDate) {
    fullSeries.push({ date: cursor, proxy: sessionMap.get(cursor) ?? null });
    cursor = addDays(cursor, 1);
  }

  const targetRows = fullSeries.filter(r => r.date >= fromDate && r.date <= toDate);

  for (const row of targetRows) {
    const idx = fullSeries.findIndex(d => d.date === row.date);
    const windowStart = Math.max(0, idx - 6);
    const window = fullSeries.slice(windowStart, idx + 1);
    const vals = window.map(x => x.proxy).filter((v): v is number => v != null);
    const avg7 = vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : null;

    await pool.query(
      `INSERT INTO androgen_proxy_daily (user_id, date, proxy_score, proxy_7d_avg, computed_with_imputed, computed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, date, computed_with_imputed) DO UPDATE SET
         proxy_score = EXCLUDED.proxy_score,
         proxy_7d_avg = EXCLUDED.proxy_7d_avg,
         computed_at = NOW()`,
      [userId, row.date, row.proxy, avg7, includeImputed],
    );
  }
}

export async function getSnapshots(userId: string = DEFAULT_USER_ID): Promise<Snapshot[]> {
  const { rows } = await pool.query(
    `SELECT * FROM erection_summary_snapshots WHERE user_id = $1 ORDER BY total_nights ASC`,
    [userId],
  );
  return rows.map(rowToSnapshot);
}

export async function getSessions(fromDate?: string, toDate?: string, includeImputed: boolean = true, userId: string = DEFAULT_USER_ID): Promise<Record<string, unknown>[]> {
  let query = `SELECT date::text as date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id, is_imputed, imputed_method, imputed_source_date_start::text, imputed_source_date_end::text, multi_night_combined, updated_at FROM erection_sessions`;
  const params: (string | boolean)[] = [userId];

  const conditions: string[] = [`user_id = $1`];
  if (fromDate) { params.push(fromDate); conditions.push(`date >= $${params.length}`); }
  if (toDate) { params.push(toDate); conditions.push(`date <= $${params.length}`); }
  if (!includeImputed) { conditions.push(`is_imputed = FALSE`); }

  if (conditions.length > 0) query += ` WHERE ` + conditions.join(" AND ");
  query += ` ORDER BY date ASC`;

  const { rows } = await pool.query(query, params);
  return rows as Record<string, unknown>[];
}

export async function getProxyData(fromDate?: string, toDate?: string, includeImputed: boolean = false, userId: string = DEFAULT_USER_ID): Promise<Record<string, unknown>[]> {
  let query = `SELECT date::text as date, proxy_score, proxy_7d_avg, computed_with_imputed FROM androgen_proxy_daily WHERE computed_with_imputed = $1 AND user_id = $2`;
  const params: (string | boolean)[] = [includeImputed, userId];

  if (fromDate) { params.push(fromDate); query += ` AND date >= $${params.length}`; }
  if (toDate) { params.push(toDate); query += ` AND date <= $${params.length}`; }
  query += ` ORDER BY date ASC`;

  const { rows } = await pool.query(query, params);
  return rows as Record<string, unknown>[];
}

export async function getSessionBadges(userId: string = DEFAULT_USER_ID): Promise<Record<string, "measured" | "imputed">> {
  const { rows } = await pool.query(
    `SELECT date::text as date, is_imputed FROM erection_sessions WHERE user_id = $1 ORDER BY date ASC`,
    [userId],
  );
  const badges: Record<string, "measured" | "imputed"> = {};
  for (const r of rows as { date: string; is_imputed: boolean }[]) {
    badges[r.date] = r.is_imputed ? "imputed" : "measured";
  }
  return badges;
}

export interface ConfidenceWindow {
  window: string;
  days: number;
  measured: number;
  imputed: number;
  multiNight: number;
  grade: "High" | "Med" | "Low" | "None";
}

export async function getDataConfidence(userId: string = DEFAULT_USER_ID): Promise<ConfidenceWindow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const windows = [
    { label: "7d", days: 7 },
    { label: "14d", days: 14 },
    { label: "30d", days: 30 },
  ];

  const results: ConfidenceWindow[] = [];

  for (const w of windows) {
    const fromDate = addDays(today, -(w.days - 1));
    const { rows } = await pool.query(
      `SELECT is_imputed, multi_night_combined FROM erection_sessions
       WHERE date BETWEEN $1 AND $2 AND user_id = $3`,
      [fromDate, today, userId],
    );

    const measured = rows.filter((r: { is_imputed: boolean }) => !r.is_imputed).length;
    const imputed = rows.filter((r: { is_imputed: boolean }) => r.is_imputed).length;
    const multiNight = rows.filter((r: { multi_night_combined: boolean }) => r.multi_night_combined).length;
    const total = measured + imputed;

    let grade: "High" | "Med" | "Low" | "None" = "None";
    if (total === 0) {
      grade = "None";
    } else {
      const measuredRatio = measured / total;
      if (measuredRatio >= 0.7 && measured >= Math.min(w.days * 0.5, 4)) {
        grade = "High";
      } else if (measuredRatio >= 0.4 && measured >= 2) {
        grade = "Med";
      } else {
        grade = "Low";
      }
    }

    results.push({
      window: w.label,
      days: w.days,
      measured,
      imputed,
      multiNight,
      grade,
    });
  }

  return results;
}

function rowToSnapshot(row: Record<string, unknown>): Snapshot {
  const sessionDate = row.session_date;
  const dateStr = sessionDate instanceof Date
    ? sessionDate.toISOString().slice(0, 10)
    : String(sessionDate);
  return {
    id: String(row.id),
    sha256: String(row.sha256),
    session_date: dateStr,
    total_nights: Number(row.total_nights),
    total_erections: Number(row.total_nocturnal_erections),
    total_duration_sec: Number(row.total_nocturnal_duration_seconds),
    number_of_recordings: Number(row.number_of_recordings ?? row.total_nights),
    erectile_fitness_score: row.erectile_fitness_score != null ? Number(row.erectile_fitness_score) : null,
    avg_firmness_nocturnal: row.avg_firmness_nocturnal != null ? Number(row.avg_firmness_nocturnal) : null,
    avg_erections_per_night: row.avg_erections_per_night != null ? Number(row.avg_erections_per_night) : null,
    avg_duration_per_night_sec: row.avg_duration_per_night_sec != null ? Number(row.avg_duration_per_night_sec) : null,
  };
}
