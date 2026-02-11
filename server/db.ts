import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_log (
      day TEXT PRIMARY KEY,
      morning_weight_lb REAL,
      evening_weight_lb REAL,
      waist_in REAL,

      bf_morning_r1 REAL,
      bf_morning_r2 REAL,
      bf_morning_r3 REAL,
      bf_morning_pct REAL,

      bf_evening_r1 REAL,
      bf_evening_r2 REAL,
      bf_evening_r3 REAL,
      bf_evening_pct REAL,

      sleep_start TEXT,
      sleep_end TEXT,
      sleep_quality INTEGER,
      sleep_minutes INTEGER,

      water_liters REAL,
      steps INTEGER,
      cardio_min INTEGER,
      active_zone_minutes INTEGER,
      lift_done BOOLEAN DEFAULT false,
      deload_week BOOLEAN DEFAULT false,

      adherence REAL,
      performance_note TEXT,
      notes TEXT,

      energy_burned_kcal INTEGER,
      resting_hr INTEGER,
      hrv INTEGER,

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dashboard_cache (
      day TEXT PRIMARY KEY,
      lean_mass_lb REAL,
      fat_mass_lb REAL,
      weight_7d_avg REAL,
      waist_7d_avg REAL,
      lean_mass_7d_avg REAL,
      lean_gain_ratio_14d_roll REAL,
      cardio_fuel_note TEXT,
      recomputed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fitbit_imports (
      id TEXT PRIMARY KEY,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      original_filename TEXT,
      sha256 TEXT UNIQUE,
      date_range_start TEXT,
      date_range_end TEXT,
      rows_imported INTEGER DEFAULT 0,
      rows_upserted INTEGER DEFAULT 0,
      rows_skipped INTEGER DEFAULT 0,
      notes TEXT
    );
  `);

  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_minutes INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS active_zone_minutes INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS energy_burned_kcal INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS resting_hr INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS hrv INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS zone1_min REAL`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS zone2_min REAL`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS zone3_min REAL`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS below_zone1_min REAL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fitbit_takeout_imports (
      id TEXT PRIMARY KEY,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      original_filename TEXT,
      sha256 TEXT UNIQUE,
      timezone TEXT,
      fitbit_root_prefix TEXT,
      date_range_start TEXT,
      date_range_end TEXT,
      days_affected INTEGER DEFAULT 0,
      rows_upserted INTEGER DEFAULT 0,
      rows_skipped INTEGER DEFAULT 0,
      notes TEXT
    );
  `);
  await pool.query(`ALTER TABLE fitbit_takeout_imports ADD COLUMN IF NOT EXISTS fitbit_root_prefix TEXT`);

  await pool.query(`ALTER TABLE daily_log ALTER COLUMN morning_weight_lb DROP NOT NULL`);
  await pool.query(`ALTER TABLE daily_log ALTER COLUMN morning_weight_lb DROP DEFAULT`);
  await pool.query(`ALTER TABLE daily_log ALTER COLUMN adherence DROP DEFAULT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fitbit_daily_sources (
      date TEXT NOT NULL,
      metric TEXT NOT NULL,
      source TEXT NOT NULL,
      import_id TEXT,
      file_path TEXT,
      rows_consumed INTEGER DEFAULT 0,
      value NUMERIC,
      PRIMARY KEY (date, metric)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fitbit_import_conflicts (
      id SERIAL PRIMARY KEY,
      import_id TEXT,
      date TEXT NOT NULL,
      metric TEXT NOT NULL,
      csv_value NUMERIC,
      json_value NUMERIC,
      chosen_source TEXT NOT NULL,
      file_path_csv TEXT,
      file_path_json TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fitbit_sleep_bucketing (
      id SERIAL PRIMARY KEY,
      import_id TEXT,
      date TEXT NOT NULL,
      sleep_end_raw TEXT,
      sleep_end_local TEXT,
      bucket_date TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sleep_import_diagnostics (
      id SERIAL PRIMARY KEY,
      import_id TEXT NOT NULL,
      date TEXT NOT NULL,
      raw_start TEXT,
      raw_end TEXT,
      minutes_asleep INTEGER NOT NULL,
      bucket_date TEXT NOT NULL,
      timezone_used TEXT NOT NULL,
      source_file TEXT NOT NULL,
      is_segment BOOLEAN DEFAULT false,
      is_main_sleep BOOLEAN,
      suspicious BOOLEAN DEFAULT false,
      suspicion_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fitbit_import_file_contributions (
      id SERIAL PRIMARY KEY,
      import_id TEXT,
      metric TEXT NOT NULL,
      source TEXT NOT NULL,
      file_path TEXT NOT NULL,
      rows_consumed INTEGER DEFAULT 0,
      days_touched INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS erection_summary_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sha256 TEXT UNIQUE NOT NULL,
      session_date DATE NOT NULL,
      total_nights INTEGER NOT NULL,
      total_nocturnal_erections INTEGER NOT NULL DEFAULT 0,
      total_nocturnal_duration_seconds INTEGER NOT NULL DEFAULT 0,
      number_of_recordings INTEGER,
      erectile_fitness_score REAL,
      avg_firmness_nocturnal REAL,
      avg_erections_per_night REAL,
      avg_duration_per_night_sec INTEGER,
      original_filename TEXT
    );
  `);

  await pool.query(`ALTER TABLE erection_summary_snapshots ADD COLUMN IF NOT EXISTS number_of_recordings INTEGER`);
  await pool.query(`ALTER TABLE erection_summary_snapshots ADD COLUMN IF NOT EXISTS erectile_fitness_score REAL`);
  await pool.query(`ALTER TABLE erection_summary_snapshots ADD COLUMN IF NOT EXISTS avg_firmness_nocturnal REAL`);
  await pool.query(`ALTER TABLE erection_summary_snapshots ADD COLUMN IF NOT EXISTS avg_erections_per_night REAL`);
  await pool.query(`ALTER TABLE erection_summary_snapshots ADD COLUMN IF NOT EXISTS avg_duration_per_night_sec INTEGER`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS erection_sessions (
      date DATE PRIMARY KEY,
      nocturnal_erections INTEGER,
      nocturnal_duration_seconds INTEGER,
      snapshot_id UUID,
      is_imputed BOOLEAN NOT NULL DEFAULT FALSE,
      imputed_method TEXT,
      imputed_source_date_start DATE,
      imputed_source_date_end DATE,
      multi_night_combined BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS androgen_proxy_daily (
      date DATE NOT NULL,
      proxy_score NUMERIC,
      proxy_7d_avg NUMERIC,
      computed_with_imputed BOOLEAN NOT NULL DEFAULT FALSE,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (date, computed_with_imputed)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS readiness_daily (
      date DATE PRIMARY KEY,
      readiness_score REAL NOT NULL,
      readiness_tier TEXT NOT NULL,
      confidence_grade TEXT NOT NULL,
      hrv_delta REAL,
      rhr_delta REAL,
      sleep_delta REAL,
      proxy_delta REAL,
      hrv_7d REAL,
      hrv_28d REAL,
      rhr_7d REAL,
      rhr_28d REAL,
      sleep_7d REAL,
      sleep_28d REAL,
      proxy_7d REAL,
      proxy_28d REAL,
      drivers JSONB,
      computed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS training_template (
      id INTEGER PRIMARY KEY DEFAULT 1,
      template_type TEXT NOT NULL DEFAULT 'push_pull_legs',
      sessions JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);

  await pool.query(`
    INSERT INTO training_template (id, template_type, sessions)
    VALUES (1, 'push_pull_legs', $1::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [JSON.stringify([
    { name: "Push", highLabel: "Heavy Bench / OHP", medLabel: "Normal Hypertrophy", lowLabel: "Machine Press / Flyes / Pump" },
    { name: "Pull", highLabel: "Heavy Rows / Deadlift", medLabel: "Normal Hypertrophy", lowLabel: "Cables / Light Rows / Technique" },
    { name: "Legs", highLabel: "Heavy Squat / RDL", medLabel: "Normal Hypertrophy", lowLabel: "Leg Press / Machines / Pump" },
  ])]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const defaultStart = new Date();
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 60);
  const defaultStartStr = defaultStart.toISOString().slice(0, 10);
  await pool.query(`
    INSERT INTO app_settings (key, value) VALUES ('analysis_start_date', $1)
    ON CONFLICT (key) DO NOTHING
  `, [defaultStartStr]);
}

export { pool };
