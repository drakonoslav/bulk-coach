import { pool } from "./db";
import crypto from "crypto";

interface Snapshot {
  id: string;
  sha256: string;
  session_date: string;
  number_of_recordings: number;
  total_nocturnal_erections: number;
  total_nocturnal_duration_seconds: number;
}

interface ParsedSnapshot {
  sha256: string;
  number_of_recordings: number;
  total_nocturnal_erections: number;
  total_nocturnal_duration_seconds: number;
}

interface DeriveResult {
  snapshot: Snapshot;
  derived: {
    sessionDate: string;
    deltaNoctErections: number;
    deltaNoctDur: number;
    multiNightCombined: boolean;
    deltaRecordings: number;
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

function computeProxyScore(noctCount: number, noctDurSec: number): number {
  const durMin = noctDurSec / 60;
  return Math.round(((noctCount * 1.0) + Math.log(1 + durMin) * 0.8) * 100) / 100;
}

function parseHmsToSeconds(val: string): number {
  val = val.trim();
  const asNum = Number(val);
  if (!isNaN(asNum) && !val.includes(":")) return Math.round(asNum);
  const parts = val.split(":").map(p => parseInt(p, 10));
  if (parts.length === 3 && parts.every(p => !isNaN(p))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every(p => !isNaN(p))) {
    return parts[0] * 60 + parts[1];
  }
  throw new Error(`Cannot parse duration value: "${val}". Expected HH:MM:SS, MM:SS, or seconds.`);
}

export function parseSnapshotFile(fileBuffer: Buffer, filename: string): ParsedSnapshot {
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  let text = fileBuffer.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 2) {
    throw new Error("File must have a header row and at least one data row");
  }

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(",").map(h => h.trim().replace(/[^a-z0-9_]/g, "_"));
  const values = lines[lines.length - 1].split(",").map(v => v.trim());

  const colMap: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    colMap[headers[i]] = i;
  }

  function findColExact(...aliases: string[]): number {
    for (const alias of aliases) {
      const normalized = alias.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      if (colMap[normalized] !== undefined) return colMap[normalized];
    }
    return -1;
  }

  function findColFuzzy(...aliases: string[]): number {
    const exact = findColExact(...aliases);
    if (exact !== -1) return exact;
    for (const alias of aliases) {
      const normalized = alias.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      for (const key of Object.keys(colMap)) {
        if (key === normalized) return colMap[key];
      }
    }
    for (const alias of aliases) {
      const normalized = alias.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      for (const key of Object.keys(colMap)) {
        if (key.includes(normalized)) return colMap[key];
      }
    }
    return -1;
  }

  const recIdx = findColFuzzy("number_of_recordings");
  const erIdx = findColExact(
    "total_number_of_nocturnal_and_morning_erections",
    "total_nocturnal_erections",
    "total_number_of_erections",
    "nocturnal_erections",
    "total_erections",
    "erections",
  );
  const durIdx = findColExact(
    "total_duration_of_all_nocturnal_and_morning_erections",
    "total_nocturnal_duration_seconds",
    "total_duration_of_all_nocturnal_erections",
    "nocturnal_duration_seconds",
    "total_duration_seconds",
  );

  if (recIdx === -1) throw new Error("Missing column: number_of_recordings");
  if (erIdx === -1) throw new Error("Missing column for erection count (tried: total_number_of_nocturnal_and_morning_erections, total_nocturnal_erections, total_number_of_erections)");
  if (durIdx === -1) throw new Error("Missing column for duration (tried: total_duration_of_all_nocturnal_and_morning_erections, total_nocturnal_duration_seconds)");

  const numRec = parseInt(values[recIdx], 10);
  const totalEr = parseInt(values[erIdx], 10);
  const totalDur = parseHmsToSeconds(values[durIdx]);

  if (isNaN(numRec)) throw new Error("Invalid number_of_recordings value");
  if (isNaN(totalEr)) throw new Error("Invalid erection count value");

  return {
    sha256,
    number_of_recordings: numRec,
    total_nocturnal_erections: totalEr,
    total_nocturnal_duration_seconds: totalDur,
  };
}

export async function importSnapshotAndDerive(
  parsed: ParsedSnapshot,
  sessionDate: string,
  originalFilename: string,
): Promise<DeriveResult> {
  const { rows: existingSnap } = await pool.query(
    `SELECT id FROM erection_summary_snapshots WHERE sha256 = $1`,
    [parsed.sha256],
  );
  if (existingSnap.length > 0) {
    const snap = (await pool.query(`SELECT * FROM erection_summary_snapshots WHERE sha256 = $1`, [parsed.sha256])).rows[0];
    return {
      snapshot: rowToSnapshot(snap),
      derived: null,
      note: "duplicate_snapshot",
      gapsFilled: 0,
    };
  }

  const { rows: insertedRows } = await pool.query(
    `INSERT INTO erection_summary_snapshots (sha256, session_date, number_of_recordings, total_nocturnal_erections, total_nocturnal_duration_seconds, original_filename)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [parsed.sha256, sessionDate, parsed.number_of_recordings, parsed.total_nocturnal_erections, parsed.total_nocturnal_duration_seconds, originalFilename],
  );
  const sNew = rowToSnapshot(insertedRows[0]);

  const { rows: prevRows } = await pool.query(
    `SELECT * FROM erection_summary_snapshots
     WHERE number_of_recordings < $1
     ORDER BY number_of_recordings DESC
     LIMIT 1`,
    [sNew.number_of_recordings],
  );

  if (prevRows.length === 0) {
    if (sNew.number_of_recordings === 1) {
      await pool.query(
        `INSERT INTO erection_sessions (date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id, is_imputed, imputed_method, imputed_source_date_start, imputed_source_date_end, multi_night_combined, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, NULL, NULL, NULL, FALSE, NOW())
         ON CONFLICT (date) DO UPDATE SET
           nocturnal_erections = EXCLUDED.nocturnal_erections,
           nocturnal_duration_seconds = EXCLUDED.nocturnal_duration_seconds,
           snapshot_id = EXCLUDED.snapshot_id,
           is_imputed = FALSE,
           imputed_method = NULL,
           imputed_source_date_start = NULL,
           imputed_source_date_end = NULL,
           multi_night_combined = FALSE,
           updated_at = NOW()`,
        [sessionDate, sNew.total_nocturnal_erections, sNew.total_nocturnal_duration_seconds, sNew.id],
      );

      await recomputeProxyPipeline(sessionDate);

      return {
        snapshot: sNew,
        derived: {
          sessionDate,
          deltaNoctErections: sNew.total_nocturnal_erections,
          deltaNoctDur: sNew.total_nocturnal_duration_seconds,
          multiNightCombined: false,
          deltaRecordings: 1,
        },
        note: "single_night_measured",
        gapsFilled: 0,
      };
    }

    return {
      snapshot: sNew,
      derived: null,
      note: "baseline_stored",
      gapsFilled: 0,
    };
  }

  const sPrev = rowToSnapshot(prevRows[0]);
  const dRec = sNew.number_of_recordings - sPrev.number_of_recordings;
  if (dRec <= 0) {
    return {
      snapshot: sNew,
      derived: null,
      note: "no_new_recordings",
      gapsFilled: 0,
    };
  }

  const deltaNoctErections = sNew.total_nocturnal_erections - sPrev.total_nocturnal_erections;
  const deltaNoctDur = sNew.total_nocturnal_duration_seconds - sPrev.total_nocturnal_duration_seconds;
  const multiNightCombined = dRec > 1;

  await pool.query(
    `INSERT INTO erection_sessions (date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id, is_imputed, imputed_method, imputed_source_date_start, imputed_source_date_end, multi_night_combined, updated_at)
     VALUES ($1, $2, $3, $4, FALSE, NULL, NULL, NULL, $5, NOW())
     ON CONFLICT (date) DO UPDATE SET
       nocturnal_erections = EXCLUDED.nocturnal_erections,
       nocturnal_duration_seconds = EXCLUDED.nocturnal_duration_seconds,
       snapshot_id = EXCLUDED.snapshot_id,
       is_imputed = FALSE,
       imputed_method = NULL,
       imputed_source_date_start = NULL,
       imputed_source_date_end = NULL,
       multi_night_combined = EXCLUDED.multi_night_combined,
       updated_at = NOW()`,
    [sessionDate, deltaNoctErections, deltaNoctDur, sNew.id, multiNightCombined],
  );

  const gapsFilled = await detectAndFillGaps(
    addDays(sessionDate, -60),
    addDays(sessionDate, 60),
    sNew.id,
  );

  await recomputeProxyPipeline(sessionDate);

  return {
    snapshot: sNew,
    derived: {
      sessionDate,
      deltaNoctErections,
      deltaNoctDur,
      multiNightCombined,
      deltaRecordings: dRec,
    },
    note: "ok",
    gapsFilled,
  };
}

async function detectAndFillGaps(fromDate: string, toDate: string, snapshotId: string | null): Promise<number> {
  const { rows: anchors } = await pool.query(
    `SELECT date::text as date, nocturnal_erections, nocturnal_duration_seconds
     FROM erection_sessions
     WHERE date BETWEEN $1 AND $2 AND is_imputed = FALSE
     ORDER BY date ASC`,
    [fromDate, toDate],
  );

  if (anchors.length < 2) return 0;

  let filled = 0;

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const gap = daysDiff(a.date, b.date);
    if (gap <= 1) continue;

    for (let k = 1; k < gap; k++) {
      const d = addDays(a.date, k);
      const t = k / gap;
      const interpE = roundInt(lerp(a.nocturnal_erections ?? 0, b.nocturnal_erections ?? 0, t));
      const interpDur = roundInt(lerp(a.nocturnal_duration_seconds ?? 0, b.nocturnal_duration_seconds ?? 0, t));

      await pool.query(
        `INSERT INTO erection_sessions (date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id, is_imputed, imputed_method, imputed_source_date_start, imputed_source_date_end, multi_night_combined, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, FALSE, NOW())
         ON CONFLICT (date) DO UPDATE SET
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
        [d, interpE, interpDur, snapshotId, "linear_interpolation", a.date, b.date],
      );
      filled++;
    }
  }

  return filled;
}

async function recomputeProxyPipeline(sessionDate: string): Promise<void> {
  const from = addDays(sessionDate, -30);
  const to = addDays(sessionDate, 30);

  await recomputeAndrogenProxy(from, to, false);
  await recomputeAndrogenProxy(from, to, true);
}

async function recomputeAndrogenProxy(fromDate: string, toDate: string, includeImputed: boolean): Promise<void> {
  const pullFrom = addDays(fromDate, -7);

  const { rows } = await pool.query(
    `SELECT date::text as date, nocturnal_erections, nocturnal_duration_seconds, is_imputed
     FROM erection_sessions
     WHERE date BETWEEN $1 AND $2
       AND ($3::boolean = TRUE OR is_imputed = FALSE)
     ORDER BY date ASC`,
    [pullFrom, toDate, includeImputed],
  );

  const daily = rows.map(r => ({
    date: r.date,
    proxy: (r.nocturnal_erections == null || r.nocturnal_duration_seconds == null)
      ? null
      : computeProxyScore(r.nocturnal_erections, r.nocturnal_duration_seconds),
  }));

  const targetRows = daily.filter(r => r.date >= fromDate && r.date <= toDate);

  for (const row of targetRows) {
    const idx = daily.findIndex(d => d.date === row.date);
    const window = daily.slice(Math.max(0, idx - 6), idx + 1);
    const vals = window.map(x => x.proxy).filter((v): v is number => v != null);
    const avg7 = vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : null;

    await pool.query(
      `INSERT INTO androgen_proxy_daily (date, proxy_score, proxy_7d_avg, computed_with_imputed, computed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (date, computed_with_imputed) DO UPDATE SET
         proxy_score = EXCLUDED.proxy_score,
         proxy_7d_avg = EXCLUDED.proxy_7d_avg,
         computed_at = NOW()`,
      [row.date, row.proxy, avg7, includeImputed],
    );
  }
}

export async function getSnapshots(): Promise<Snapshot[]> {
  const { rows } = await pool.query(
    `SELECT * FROM erection_summary_snapshots ORDER BY number_of_recordings ASC`,
  );
  return rows.map(rowToSnapshot);
}

export async function getSessions(fromDate?: string, toDate?: string, includeImputed: boolean = true): Promise<any[]> {
  let query = `SELECT date::text as date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id, is_imputed, imputed_method, imputed_source_date_start::text, imputed_source_date_end::text, multi_night_combined, updated_at FROM erection_sessions`;
  const params: any[] = [];

  const conditions: string[] = [];
  if (fromDate) { params.push(fromDate); conditions.push(`date >= $${params.length}`); }
  if (toDate) { params.push(toDate); conditions.push(`date <= $${params.length}`); }
  if (!includeImputed) { conditions.push(`is_imputed = FALSE`); }

  if (conditions.length > 0) query += ` WHERE ` + conditions.join(" AND ");
  query += ` ORDER BY date ASC`;

  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getProxyData(fromDate?: string, toDate?: string, includeImputed: boolean = false): Promise<any[]> {
  let query = `SELECT date::text as date, proxy_score, proxy_7d_avg, computed_with_imputed FROM androgen_proxy_daily WHERE computed_with_imputed = $1`;
  const params: any[] = [includeImputed];

  if (fromDate) { params.push(fromDate); query += ` AND date >= $${params.length}`; }
  if (toDate) { params.push(toDate); query += ` AND date <= $${params.length}`; }
  query += ` ORDER BY date ASC`;

  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getSessionBadges(): Promise<Record<string, "measured" | "imputed">> {
  const { rows } = await pool.query(
    `SELECT date::text as date, is_imputed FROM erection_sessions ORDER BY date ASC`,
  );
  const badges: Record<string, "measured" | "imputed"> = {};
  for (const r of rows) {
    badges[r.date] = r.is_imputed ? "imputed" : "measured";
  }
  return badges;
}

function rowToSnapshot(row: any): Snapshot {
  return {
    id: row.id,
    sha256: row.sha256,
    session_date: typeof row.session_date === "object" ? row.session_date.toISOString().slice(0, 10) : String(row.session_date),
    number_of_recordings: Number(row.number_of_recordings),
    total_nocturnal_erections: Number(row.total_nocturnal_erections),
    total_nocturnal_duration_seconds: Number(row.total_nocturnal_duration_seconds),
  };
}
