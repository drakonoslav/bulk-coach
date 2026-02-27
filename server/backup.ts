import { pool } from "./db";
import { recomputeRange } from "./recompute";

const BACKUP_VERSION = 1;
const DB_SCHEMA_VERSION = 1;

interface BackupMetadata {
  backup_version: number;
  exported_at: string;
  app_version: string;
  db_schema_version: number;
  caches_included: boolean;
}

interface BackupPayload {
  metadata: BackupMetadata;
  daily_logs: Record<string, unknown>[];
  dashboard_cache: Record<string, unknown>[];
  fitbit_imports: Record<string, unknown>[];
  erection_summary_snapshots: Record<string, unknown>[];
  erection_sessions: Record<string, unknown>[];
  androgen_proxy_daily: Record<string, unknown>[];
}

interface ImportCounts {
  daily_logs: number;
  dashboard_cache: number;
  fitbit_imports: number;
  erection_summary_snapshots: number;
  erection_sessions: number;
  androgen_proxy_daily: number;
}

interface ImportResult {
  status: string;
  imported?: ImportCounts;
  would_insert?: ImportCounts;
  would_update?: ImportCounts;
  recomputed?: boolean;
  date_range?: { min: string; max: string };
  conflicts?: string[];
}

function dateToStr(val: unknown): string | null {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val);
}

function tsToStr(val: unknown): string | null {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export async function exportBackup(): Promise<BackupPayload> {
  const [dailyLogs, dashboardCache, fitbitImports, snapshots, sessions, proxyDaily] = await Promise.all([
    pool.query(`SELECT * FROM daily_log ORDER BY day ASC`),
    pool.query(`SELECT * FROM dashboard_cache ORDER BY day ASC`),
    pool.query(`SELECT * FROM fitbit_imports ORDER BY uploaded_at DESC`),
    pool.query(`SELECT * FROM erection_summary_snapshots ORDER BY total_nights ASC`),
    pool.query(`SELECT * FROM erection_sessions ORDER BY date ASC`),
    pool.query(`SELECT * FROM androgen_proxy_daily ORDER BY date ASC, computed_with_imputed ASC`),
  ]);

  const serializeSessions = sessions.rows.map((r: Record<string, unknown>) => ({
    ...r,
    date: dateToStr(r.date),
    imputed_source_date_start: dateToStr(r.imputed_source_date_start),
    imputed_source_date_end: dateToStr(r.imputed_source_date_end),
    updated_at: tsToStr(r.updated_at),
  }));

  const serializeSnapshots = snapshots.rows.map((r: Record<string, unknown>) => ({
    ...r,
    session_date: dateToStr(r.session_date),
    uploaded_at: tsToStr(r.uploaded_at),
  }));

  const serializeProxy = proxyDaily.rows.map((r: Record<string, unknown>) => ({
    ...r,
    date: dateToStr(r.date),
    computed_at: tsToStr(r.computed_at),
  }));

  const serializeFitbit = fitbitImports.rows.map((r: Record<string, unknown>) => ({
    ...r,
    uploaded_at: tsToStr(r.uploaded_at),
  }));

  const serializeDashboard = dashboardCache.rows.map((r: Record<string, unknown>) => ({
    ...r,
    recomputed_at: tsToStr(r.recomputed_at),
  }));

  const serializeDailyLogs = dailyLogs.rows.map((r: Record<string, unknown>) => ({
    ...r,
    created_at: tsToStr(r.created_at),
    updated_at: tsToStr(r.updated_at),
  }));

  return {
    metadata: {
      backup_version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      app_version: "v4.2",
      db_schema_version: DB_SCHEMA_VERSION,
      caches_included: true,
    },
    daily_logs: serializeDailyLogs,
    dashboard_cache: serializeDashboard,
    fitbit_imports: serializeFitbit,
    erection_summary_snapshots: serializeSnapshots,
    erection_sessions: serializeSessions,
    androgen_proxy_daily: serializeProxy,
  };
}

const DAILY_LOG_COLUMNS = [
  "user_id", "day",
  "morning_weight_lb", "evening_weight_lb", "waist_in",
  "bf_morning_r1", "bf_morning_r2", "bf_morning_r3", "bf_morning_pct",
  "bf_evening_r1", "bf_evening_r2", "bf_evening_r3", "bf_evening_pct",
  "sleep_start", "sleep_end", "sleep_quality", "sleep_minutes",
  "water_liters", "steps", "cardio_min", "active_zone_minutes",
  "lift_done", "deload_week", "adherence", "performance_note", "notes",
  "energy_burned_kcal", "resting_hr", "hrv",
  "sleep_plan_bedtime", "sleep_plan_wake", "tossed_minutes",
  "planned_bed_time", "planned_wake_time",
  "actual_bed_time", "actual_wake_time",
  "sleep_latency_min", "sleep_waso_min", "nap_minutes",
  "sleep_awake_min", "sleep_rem_min", "sleep_core_min", "sleep_deep_min",
  "sleep_source_mode",
  "calories_in", "training_load",
  "cardio_start_time", "cardio_end_time",
  "lift_start_time", "lift_end_time", "lift_min", "lift_working_min",
  "zone1_min", "zone2_min", "zone3_min", "zone4_min", "zone5_min",
  "below_zone1_min",
  "lift_z1_min", "lift_z2_min", "lift_z3_min", "lift_z4_min", "lift_z5_min",
  "fat_free_mass_lb",
  "pushups_reps", "pullups_reps", "bench_reps", "bench_weight_lb", "ohp_reps", "ohp_weight_lb",
  "pain_0_10",
  "meal_checklist",
  "cardio_skipped", "lift_skipped",
  "sleep_efficiency", "bedtime_deviation_min", "wake_deviation_min", "sleep_plan_alignment_score",
  "sleep_start_local", "sleep_end_local",
  "created_at", "updated_at",
] as const;

const DAILY_LOG_BOOL_COLS = new Set(["lift_done", "deload_week", "cardio_skipped", "lift_skipped"]);

async function upsertDailyLog(row: Record<string, unknown>): Promise<"insert" | "update" | "skip"> {
  const day = row.day as string;
  const userId = (row.user_id as string) || "local_default";
  const { rows: existing } = await pool.query(
    `SELECT day FROM daily_log WHERE user_id = $1 AND day = $2`,
    [userId, day],
  );
  const isUpdate = existing.length > 0;

  const cols = DAILY_LOG_COLUMNS;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const updateSet = cols
    .filter(c => c !== "user_id" && c !== "day" && c !== "created_at")
    .map(c => {
      if (c === "updated_at") return `updated_at = NOW()`;
      return `${c} = EXCLUDED.${c}`;
    })
    .join(", ");

  const values = cols.map(c => {
    if (c === "user_id") return userId;
    if (c === "created_at") return row.created_at ?? new Date().toISOString();
    if (c === "updated_at") return row.updated_at ?? new Date().toISOString();
    if (DAILY_LOG_BOOL_COLS.has(c)) return row[c] ?? false;
    if (c === "meal_checklist") {
      const v = row[c];
      if (v == null) return null;
      return typeof v === "string" ? v : JSON.stringify(v);
    }
    return row[c] ?? null;
  });

  await pool.query(
    `INSERT INTO daily_log (${cols.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (user_id, day) DO UPDATE SET ${updateSet}`,
    values,
  );

  return isUpdate ? "update" : "insert";
}

async function upsertSnapshot(row: Record<string, unknown>): Promise<"insert" | "update" | "skip"> {
  const sha = row.sha256 as string;
  const { rows: existing } = await pool.query(`SELECT id FROM erection_summary_snapshots WHERE sha256 = $1`, [sha]);
  if (existing.length > 0) return "skip";

  const userId = (row.user_id as string) || "local_default";
  await pool.query(
    `INSERT INTO erection_summary_snapshots (
      id, user_id, sha256, session_date, total_nights, total_nocturnal_erections, total_nocturnal_duration_seconds,
      number_of_recordings, erectile_fitness_score, avg_firmness_nocturnal, avg_erections_per_night, avg_duration_per_night_sec,
      original_filename, uploaded_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (sha256) DO NOTHING`,
    [
      row.id ?? null,
      userId,
      sha,
      row.session_date,
      row.total_nights,
      row.total_nocturnal_erections ?? row.total_erections ?? 0,
      row.total_nocturnal_duration_seconds ?? row.total_duration_sec ?? 0,
      row.number_of_recordings ?? null,
      row.erectile_fitness_score ?? null,
      row.avg_firmness_nocturnal ?? null,
      row.avg_erections_per_night ?? null,
      row.avg_duration_per_night_sec ?? null,
      row.original_filename ?? null,
      row.uploaded_at ?? new Date().toISOString(),
    ],
  );

  return "insert";
}

async function upsertSession(row: Record<string, unknown>): Promise<"insert" | "update" | "skip"> {
  const date = dateToStr(row.date) as string;
  const userId = (row.user_id as string) || "local_default";
  const { rows: existing } = await pool.query(
    `SELECT date FROM erection_sessions WHERE user_id = $1 AND date = $2`,
    [userId, date],
  );
  const isUpdate = existing.length > 0;

  await pool.query(
    `INSERT INTO erection_sessions (
      user_id, date, nocturnal_erections, nocturnal_duration_seconds, snapshot_id,
      is_imputed, imputed_method, imputed_source_date_start, imputed_source_date_end,
      multi_night_combined, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (user_id, date) DO UPDATE SET
      nocturnal_erections = EXCLUDED.nocturnal_erections,
      nocturnal_duration_seconds = EXCLUDED.nocturnal_duration_seconds,
      snapshot_id = EXCLUDED.snapshot_id,
      is_imputed = EXCLUDED.is_imputed,
      imputed_method = EXCLUDED.imputed_method,
      imputed_source_date_start = EXCLUDED.imputed_source_date_start,
      imputed_source_date_end = EXCLUDED.imputed_source_date_end,
      multi_night_combined = EXCLUDED.multi_night_combined,
      updated_at = NOW()`,
    [
      userId,
      date,
      row.nocturnal_erections ?? null,
      row.nocturnal_duration_seconds ?? null,
      row.snapshot_id ?? null,
      row.is_imputed ?? false,
      row.imputed_method ?? null,
      dateToStr(row.imputed_source_date_start),
      dateToStr(row.imputed_source_date_end),
      row.multi_night_combined ?? false,
      row.updated_at ?? new Date().toISOString(),
    ],
  );

  return isUpdate ? "update" : "insert";
}

async function upsertProxyDaily(row: Record<string, unknown>): Promise<"insert" | "update" | "skip"> {
  const date = dateToStr(row.date) as string;
  const userId = (row.user_id as string) || "local_default";
  const cwi = row.computed_with_imputed ?? false;
  const { rows: existing } = await pool.query(
    `SELECT date FROM androgen_proxy_daily WHERE user_id = $1 AND date = $2 AND computed_with_imputed = $3`,
    [userId, date, cwi],
  );
  const isUpdate = existing.length > 0;

  await pool.query(
    `INSERT INTO androgen_proxy_daily (user_id, date, proxy_score, proxy_7d_avg, computed_with_imputed, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, date, computed_with_imputed) DO UPDATE SET
       proxy_score = EXCLUDED.proxy_score,
       proxy_7d_avg = EXCLUDED.proxy_7d_avg,
       computed_at = NOW()`,
    [
      userId,
      date,
      row.proxy_score ?? null,
      row.proxy_7d_avg ?? null,
      cwi,
      row.computed_at ?? new Date().toISOString(),
    ],
  );

  return isUpdate ? "update" : "insert";
}

async function upsertDashboardCache(row: Record<string, unknown>): Promise<"insert" | "update" | "skip"> {
  const day = row.day as string;
  const userId = (row.user_id as string) || "local_default";
  const { rows: existing } = await pool.query(
    `SELECT day FROM dashboard_cache WHERE user_id = $1 AND day = $2`,
    [userId, day],
  );
  const isUpdate = existing.length > 0;

  await pool.query(
    `INSERT INTO dashboard_cache (user_id, day, lean_mass_lb, fat_mass_lb, weight_7d_avg, waist_7d_avg, lean_mass_7d_avg, lean_gain_ratio_14d_roll, cardio_fuel_note, recomputed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (user_id, day) DO UPDATE SET
       lean_mass_lb = EXCLUDED.lean_mass_lb,
       fat_mass_lb = EXCLUDED.fat_mass_lb,
       weight_7d_avg = EXCLUDED.weight_7d_avg,
       waist_7d_avg = EXCLUDED.waist_7d_avg,
       lean_mass_7d_avg = EXCLUDED.lean_mass_7d_avg,
       lean_gain_ratio_14d_roll = EXCLUDED.lean_gain_ratio_14d_roll,
       cardio_fuel_note = EXCLUDED.cardio_fuel_note,
       recomputed_at = NOW()`,
    [
      userId,
      day,
      row.lean_mass_lb ?? null,
      row.fat_mass_lb ?? null,
      row.weight_7d_avg ?? null,
      row.waist_7d_avg ?? null,
      row.lean_mass_7d_avg ?? null,
      row.lean_gain_ratio_14d_roll ?? null,
      row.cardio_fuel_note ?? null,
    ],
  );

  return isUpdate ? "update" : "insert";
}

async function upsertFitbitImport(row: Record<string, unknown>): Promise<"insert" | "update" | "skip"> {
  const sha = row.sha256 as string | null;
  const userId = (row.user_id as string) || "local_default";
  if (sha) {
    const { rows: existing } = await pool.query(`SELECT id FROM fitbit_imports WHERE sha256 = $1`, [sha]);
    if (existing.length > 0) return "skip";
  }

  const id = row.id as string || Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await pool.query(
    `INSERT INTO fitbit_imports (id, user_id, uploaded_at, original_filename, sha256, date_range_start, date_range_end, rows_imported, rows_upserted, rows_skipped, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      userId,
      row.uploaded_at ?? new Date().toISOString(),
      row.original_filename ?? null,
      sha,
      row.date_range_start ?? null,
      row.date_range_end ?? null,
      row.rows_imported ?? 0,
      row.rows_upserted ?? 0,
      row.rows_skipped ?? 0,
      row.notes ?? null,
    ],
  );

  return "insert";
}

async function wipeTables(): Promise<void> {
  await pool.query(`DELETE FROM androgen_proxy_daily`);
  await pool.query(`DELETE FROM erection_sessions`);
  await pool.query(`DELETE FROM erection_summary_snapshots`);
  await pool.query(`DELETE FROM dashboard_cache`);
  await pool.query(`DELETE FROM fitbit_imports`);
  await pool.query(`DELETE FROM daily_log`);
}

async function recomputeAllCaches(minDay: string, maxDay: string): Promise<void> {
  const start = new Date(minDay + "T00:00:00Z");
  const end = new Date(maxDay + "T00:00:00Z");

  const current = new Date(start);
  while (current <= end) {
    const dayStr = current.toISOString().slice(0, 10);
    await recomputeRange(dayStr);
    current.setUTCDate(current.getUTCDate() + 7);
  }
  const lastStr = end.toISOString().slice(0, 10);
  await recomputeRange(lastStr);
}

export async function importBackup(
  data: BackupPayload,
  mode: "merge" | "replace" = "merge",
  dryRun: boolean = false,
): Promise<ImportResult> {
  if (!data.metadata || !data.metadata.backup_version) {
    throw new Error("Invalid backup file: missing metadata");
  }

  const tables = {
    daily_logs: data.daily_logs || [],
    dashboard_cache: data.dashboard_cache || [],
    fitbit_imports: data.fitbit_imports || [],
    erection_summary_snapshots: data.erection_summary_snapshots || [],
    erection_sessions: data.erection_sessions || [],
    androgen_proxy_daily: data.androgen_proxy_daily || [],
  };

  if (dryRun) {
    const wouldInsert: ImportCounts = {
      daily_logs: 0,
      dashboard_cache: 0,
      fitbit_imports: 0,
      erection_summary_snapshots: 0,
      erection_sessions: 0,
      androgen_proxy_daily: 0,
    };
    const wouldUpdate: ImportCounts = { ...wouldInsert };

    for (const row of tables.daily_logs) {
      const userId = (row.user_id as string) || "local_default";
      const { rows } = await pool.query(`SELECT day FROM daily_log WHERE user_id = $1 AND day = $2`, [userId, row.day]);
      if (rows.length > 0) wouldUpdate.daily_logs++;
      else wouldInsert.daily_logs++;
    }
    for (const row of tables.erection_summary_snapshots) {
      const { rows } = await pool.query(`SELECT id FROM erection_summary_snapshots WHERE sha256 = $1`, [row.sha256]);
      if (rows.length > 0) wouldUpdate.erection_summary_snapshots++;
      else wouldInsert.erection_summary_snapshots++;
    }
    for (const row of tables.erection_sessions) {
      const userId = (row.user_id as string) || "local_default";
      const d = dateToStr(row.date);
      const { rows } = await pool.query(`SELECT date FROM erection_sessions WHERE user_id = $1 AND date = $2`, [userId, d]);
      if (rows.length > 0) wouldUpdate.erection_sessions++;
      else wouldInsert.erection_sessions++;
    }
    wouldInsert.fitbit_imports = tables.fitbit_imports.length;
    wouldInsert.dashboard_cache = tables.dashboard_cache.length;
    wouldInsert.androgen_proxy_daily = tables.androgen_proxy_daily.length;

    return {
      status: "dry_run",
      would_insert: wouldInsert,
      would_update: wouldUpdate,
      conflicts: [],
    };
  }

  if (mode === "replace") {
    await wipeTables();
  }

  const counts: ImportCounts = {
    daily_logs: 0,
    dashboard_cache: 0,
    fitbit_imports: 0,
    erection_summary_snapshots: 0,
    erection_sessions: 0,
    androgen_proxy_daily: 0,
  };

  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  for (const row of tables.daily_logs) {
    const result = await upsertDailyLog(row);
    if (result !== "skip") counts.daily_logs++;
    const day = row.day as string;
    if (day < minDate) minDate = day;
    if (day > maxDate) maxDate = day;
  }

  for (const row of tables.erection_summary_snapshots) {
    const result = await upsertSnapshot(row);
    if (result !== "skip") counts.erection_summary_snapshots++;
  }

  for (const row of tables.erection_sessions) {
    const result = await upsertSession(row);
    if (result !== "skip") counts.erection_sessions++;
    const d = dateToStr(row.date) as string;
    if (d < minDate) minDate = d;
    if (d > maxDate) maxDate = d;
  }

  for (const row of tables.androgen_proxy_daily) {
    const result = await upsertProxyDaily(row);
    if (result !== "skip") counts.androgen_proxy_daily++;
  }

  for (const row of tables.fitbit_imports) {
    const result = await upsertFitbitImport(row);
    if (result !== "skip") counts.fitbit_imports++;
  }

  for (const row of tables.dashboard_cache) {
    const result = await upsertDashboardCache(row);
    if (result !== "skip") counts.dashboard_cache++;
  }

  let recomputed = false;
  if (minDate < "9999-12-31" && maxDate > "0000-01-01") {
    try {
      await recomputeAllCaches(minDate, maxDate);
      recomputed = true;
    } catch (err) {
      console.error("Recompute after restore failed:", err);
    }
  }

  return {
    status: "ok",
    imported: counts,
    recomputed,
    date_range: minDate < "9999-12-31" ? { min: minDate, max: maxDate } : undefined,
  };
}
