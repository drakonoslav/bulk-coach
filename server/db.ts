import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function runMigration(name: string, sql: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id FROM schema_migrations WHERE name = $1`,
    [name]
  );
  if (rows.length > 0) return;
  console.log(`[migration] applying: ${name}`);
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ($1)`,
    [name]
  );
  console.log(`[migration] applied: ${name}`);
}

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
      hrv REAL,

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
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS hrv REAL`);
  await pool.query(`ALTER TABLE daily_log ALTER COLUMN hrv TYPE REAL`);
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

  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS planned_bed_time TEXT`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS planned_wake_time TEXT`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS actual_bed_time TEXT`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS actual_wake_time TEXT`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_latency_min INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_waso_min INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS nap_minutes INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_awake_min INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_rem_min INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_core_min INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_deep_min INTEGER`);
  await pool.query(`ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS sleep_source_mode TEXT`);

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
    INSERT INTO training_template (id, user_id, template_type, sessions)
    VALUES (1, 'local_default', 'push_pull_legs', $1::jsonb)
    ON CONFLICT (user_id, id) DO NOTHING
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fitbit_oauth_tokens (
      user_id INTEGER PRIMARY KEY DEFAULT 1,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      scope TEXT,
      token_type TEXT DEFAULT 'Bearer',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ── Canonical health schema (vendor-agnostic) ──

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sleep_summary_daily (
      date DATE PRIMARY KEY,
      sleep_start TEXT,
      sleep_end TEXT,
      total_sleep_minutes INTEGER NOT NULL,
      time_in_bed_minutes INTEGER,
      awake_minutes INTEGER,
      rem_minutes INTEGER,
      deep_minutes INTEGER,
      light_or_core_minutes INTEGER,
      sleep_efficiency REAL,
      sleep_latency_min INTEGER,
      waso_min INTEGER,
      source TEXT NOT NULL DEFAULT 'unknown',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vitals_daily (
      date DATE PRIMARY KEY,
      resting_hr_bpm REAL,
      hrv_rmssd_ms REAL,
      hrv_sdnn_ms REAL,
      respiratory_rate_bpm REAL,
      spo2_pct REAL,
      skin_temp_delta_c REAL,
      steps INTEGER,
      active_zone_minutes INTEGER,
      energy_burned_kcal INTEGER,
      zone1_min INTEGER,
      zone2_min INTEGER,
      zone3_min INTEGER,
      below_zone1_min INTEGER,
      source TEXT NOT NULL DEFAULT 'unknown',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_session (
      session_id TEXT PRIMARY KEY,
      date DATE NOT NULL,
      start_ts TIMESTAMPTZ NOT NULL,
      end_ts TIMESTAMPTZ,
      workout_type TEXT NOT NULL DEFAULT 'other',
      duration_minutes REAL,
      avg_hr REAL,
      max_hr REAL,
      calories_burned INTEGER,
      session_strain_score REAL,
      session_type_tag TEXT,
      recovery_slope REAL,
      source TEXT NOT NULL DEFAULT 'unknown',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_session_date ON workout_session(date)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_hr_samples (
      session_id TEXT NOT NULL REFERENCES workout_session(session_id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL,
      hr_bpm INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'unknown',
      PRIMARY KEY (session_id, ts)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_rr_intervals (
      session_id TEXT NOT NULL REFERENCES workout_session(session_id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL,
      rr_ms REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'unknown',
      PRIMARY KEY (session_id, ts)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hrv_baseline_daily (
      date DATE PRIMARY KEY,
      night_hrv_rmssd_ms REAL,
      night_hrv_sdnn_ms REAL,
      baseline_hrv_rmssd_7d_median REAL,
      baseline_hrv_sdnn_7d_median REAL,
      deviation_rmssd_pct REAL,
      deviation_sdnn_pct REAL,
      morning_hrv_sdnn_ms REAL,
      morning_deviation_pct REAL,
      source TEXT NOT NULL DEFAULT 'unknown',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const migrationColumns: [string, string, string][] = [
    ['workout_session', 'strength_bias', 'REAL'],
    ['workout_session', 'cardio_bias', 'REAL'],
    ['workout_session', 'pre_session_rmssd', 'REAL'],
    ['workout_session', 'min_session_rmssd', 'REAL'],
    ['workout_session', 'post_session_rmssd', 'REAL'],
    ['workout_session', 'hrv_suppression_pct', 'REAL'],
    ['workout_session', 'hrv_rebound_pct', 'REAL'],
    ['workout_session', 'hrv_response_flag', 'TEXT'],
    ['workout_session', 'suppression_depth_pct', 'REAL'],
    ['workout_session', 'rebound_bpm_per_min', 'REAL'],
    ['workout_session', 'baseline_window_seconds', 'INTEGER DEFAULT 120'],
    ['workout_session', 'time_to_recovery_sec', 'INTEGER'],
  ];
  for (const [table, col, type] of migrationColumns) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  }

  const defaultStart = new Date();
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 60);
  const defaultStartStr = defaultStart.toISOString().slice(0, 10);
  await pool.query(`
    INSERT INTO app_settings (user_id, key, value) VALUES ('local_default', 'analysis_start_date', $1)
    ON CONFLICT (user_id, key) DO NOTHING
  `, [defaultStartStr]);

  await runMigrations();
}

async function runMigrations(): Promise<void> {
  await runMigration('001_add_timezone_to_canonical', `
    ALTER TABLE sleep_summary_daily ADD COLUMN IF NOT EXISTS timezone TEXT;
    ALTER TABLE vitals_daily ADD COLUMN IF NOT EXISTS timezone TEXT;
    ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS timezone TEXT;
  `);

  await runMigration('002_add_workout_events_table', `
    CREATE TABLE IF NOT EXISTS workout_events (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES workout_session(session_id) ON DELETE CASCADE,
      t TIMESTAMPTZ NOT NULL,
      event_type TEXT NOT NULL,
      phase TEXT,
      muscle TEXT,
      rpe REAL,
      is_compound BOOLEAN,
      cbp_before REAL,
      cbp_after REAL,
      drain REAL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_workout_events_session ON workout_events(session_id);
  `);

  await runMigration('003_add_muscle_weekly_load_table', `
    CREATE TABLE IF NOT EXISTS muscle_weekly_load (
      muscle TEXT NOT NULL,
      week_start DATE NOT NULL,
      hard_sets INTEGER NOT NULL DEFAULT 0,
      total_sets INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (muscle, week_start)
    );
  `);

  await runMigration('004_add_user_id_multi_tenant', `
    -- Add user_id to all core tables
    ALTER TABLE daily_log ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE dashboard_cache ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE sleep_summary_daily ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE vitals_daily ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE hrv_baseline_daily ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE erection_sessions ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE erection_summary_snapshots ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE muscle_weekly_load ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE androgen_proxy_daily ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE workout_events ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE fitbit_imports ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE fitbit_takeout_imports ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';

    -- Drop old PKs and create composite PKs with user_id
    ALTER TABLE daily_log DROP CONSTRAINT daily_log_pkey;
    ALTER TABLE daily_log ADD PRIMARY KEY (user_id, day);

    ALTER TABLE dashboard_cache DROP CONSTRAINT dashboard_cache_pkey;
    ALTER TABLE dashboard_cache ADD PRIMARY KEY (user_id, day);

    ALTER TABLE sleep_summary_daily DROP CONSTRAINT sleep_summary_daily_pkey;
    ALTER TABLE sleep_summary_daily ADD PRIMARY KEY (user_id, date);

    ALTER TABLE vitals_daily DROP CONSTRAINT vitals_daily_pkey;
    ALTER TABLE vitals_daily ADD PRIMARY KEY (user_id, date);

    ALTER TABLE hrv_baseline_daily DROP CONSTRAINT hrv_baseline_daily_pkey;
    ALTER TABLE hrv_baseline_daily ADD PRIMARY KEY (user_id, date);

    ALTER TABLE readiness_daily DROP CONSTRAINT readiness_daily_pkey;
    ALTER TABLE readiness_daily ADD PRIMARY KEY (user_id, date);

    ALTER TABLE erection_sessions DROP CONSTRAINT erection_sessions_pkey;
    ALTER TABLE erection_sessions ADD PRIMARY KEY (user_id, date);

    ALTER TABLE muscle_weekly_load DROP CONSTRAINT muscle_weekly_load_pkey;
    ALTER TABLE muscle_weekly_load ADD PRIMARY KEY (user_id, muscle, week_start);

    ALTER TABLE androgen_proxy_daily DROP CONSTRAINT androgen_proxy_daily_pkey;
    ALTER TABLE androgen_proxy_daily ADD PRIMARY KEY (user_id, date, computed_with_imputed);

    ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;
    ALTER TABLE app_settings ADD PRIMARY KEY (user_id, key);

    ALTER TABLE training_template DROP CONSTRAINT IF EXISTS single_row;
    ALTER TABLE training_template ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE training_template DROP CONSTRAINT training_template_pkey;
    ALTER TABLE training_template ADD PRIMARY KEY (user_id, id);

    -- Indexes for user_id scoping
    CREATE INDEX IF NOT EXISTS idx_workout_session_user ON workout_session(user_id);
    CREATE INDEX IF NOT EXISTS idx_daily_log_user ON daily_log(user_id);

    -- Macro presets table
    CREATE TABLE IF NOT EXISTS macro_presets (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local_default',
      name TEXT NOT NULL,
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      calories REAL NOT NULL,
      protein_g REAL NOT NULL,
      carbs_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      items JSONB NOT NULL DEFAULT '{}'::jsonb,
      adjust_priority JSONB NOT NULL DEFAULT '[]'::jsonb,
      cardio_fuel JSONB NOT NULL DEFAULT '{}'::jsonb,
      checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
      meal_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, id)
    );
  `);

  await runMigration('005_readiness_confidence_breakdown', `
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS type_lean REAL;
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS exercise_bias REAL;
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS cortisol_flag BOOLEAN DEFAULT FALSE;
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS conf_measured_7d INTEGER DEFAULT 0;
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS conf_imputed_7d INTEGER DEFAULT 0;
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS conf_combined_7d INTEGER DEFAULT 0;
    ALTER TABLE readiness_daily ADD COLUMN IF NOT EXISTS gate TEXT DEFAULT 'NONE';
  `);

  await runMigration('006_canonical_health_hardening', `
    -- A) Add user_id to workout_hr_samples and workout_rr_intervals
    ALTER TABLE workout_hr_samples ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';
    ALTER TABLE workout_rr_intervals ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local_default';

    -- Backfill user_id from workout_session
    UPDATE workout_hr_samples h SET user_id = (
      SELECT COALESCE(w.user_id, 'local_default') FROM workout_session w WHERE w.session_id = h.session_id
    ) WHERE EXISTS (SELECT 1 FROM workout_session w WHERE w.session_id = h.session_id);

    UPDATE workout_rr_intervals r SET user_id = (
      SELECT COALESCE(w.user_id, 'local_default') FROM workout_session w WHERE w.session_id = r.session_id
    ) WHERE EXISTS (SELECT 1 FROM workout_session w WHERE w.session_id = r.session_id);

    -- Composite indexes for user-scoped queries (keep existing PKs since session_id is globally unique)
    CREATE INDEX IF NOT EXISTS idx_hr_samples_user_session ON workout_hr_samples(user_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_rr_intervals_user_session ON workout_rr_intervals(user_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_workout_session_user_date ON workout_session(user_id, date);

    -- D) CHECK constraints for data quality
    ALTER TABLE workout_hr_samples DROP CONSTRAINT IF EXISTS chk_hr_bpm_range;
    ALTER TABLE workout_hr_samples ADD CONSTRAINT chk_hr_bpm_range CHECK (hr_bpm BETWEEN 25 AND 250);

    ALTER TABLE workout_rr_intervals DROP CONSTRAINT IF EXISTS chk_rr_ms_range;
    ALTER TABLE workout_rr_intervals ADD CONSTRAINT chk_rr_ms_range CHECK (rr_ms BETWEEN 300 AND 2000);

    ALTER TABLE sleep_summary_daily DROP CONSTRAINT IF EXISTS chk_sleep_minutes_range;
    ALTER TABLE sleep_summary_daily ADD CONSTRAINT chk_sleep_minutes_range CHECK (total_sleep_minutes BETWEEN 0 AND 1000);

    ALTER TABLE vitals_daily DROP CONSTRAINT IF EXISTS chk_resting_hr_range;
    ALTER TABLE vitals_daily ADD CONSTRAINT chk_resting_hr_range CHECK (resting_hr_bpm IS NULL OR resting_hr_bpm BETWEEN 25 AND 250);

    -- E) Analysis idempotency columns on workout_session
    ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS analysis_version TEXT;
    ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;

    -- C) Index for deterministic source resolution (updated_at tiebreak)
    CREATE INDEX IF NOT EXISTS idx_vitals_daily_user_date_updated ON vitals_daily(user_id, date, updated_at DESC);
  `);

  await runMigration('007_pk_user_isolation_hr_rr', `
    -- Update PK on workout_hr_samples to include user_id
    ALTER TABLE workout_hr_samples DROP CONSTRAINT IF EXISTS workout_hr_samples_pkey;
    ALTER TABLE workout_hr_samples ADD PRIMARY KEY (user_id, session_id, ts);

    -- Update PK on workout_rr_intervals to include user_id
    ALTER TABLE workout_rr_intervals DROP CONSTRAINT IF EXISTS workout_rr_intervals_pkey;
    ALTER TABLE workout_rr_intervals ADD PRIMARY KEY (user_id, session_id, ts);

    -- Drop redundant indexes now covered by new PKs
    DROP INDEX IF EXISTS idx_hr_samples_user_session;
    DROP INDEX IF EXISTS idx_rr_intervals_user_session;
  `);

  await runMigration('008_add_calorie_decisions', `
    CREATE TABLE IF NOT EXISTS calorie_decisions (
      user_id TEXT NOT NULL DEFAULT 'local_default',
      day TEXT NOT NULL,
      delta_kcal INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('weight_only','mode_override')),
      priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
      reason TEXT NOT NULL,
      wk_gain_lb NUMERIC,
      mode TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, day)
    );
  `);

  await runMigration('009_add_context_events', `
    CREATE TABLE IF NOT EXISTS context_events (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local_default',
      day TEXT NOT NULL,
      tag TEXT NOT NULL,
      intensity SMALLINT NOT NULL DEFAULT 0 CHECK (intensity >= 0 AND intensity <= 3),
      notes TEXT,
      adjustment_attempted BOOLEAN NOT NULL DEFAULT FALSE,
      adjustment_attempted_day TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_context_events_user_day ON context_events(user_id, day);
    CREATE INDEX IF NOT EXISTS idx_context_events_user_tag ON context_events(user_id, tag);
  `);

  await runMigration('010_context_events_label_unique', `
    ALTER TABLE context_events ADD COLUMN IF NOT EXISTS label TEXT;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_context_events_user_day_tag'
      ) THEN
        ALTER TABLE context_events ADD CONSTRAINT uq_context_events_user_day_tag UNIQUE (user_id, day, tag);
      END IF;
    END $$;
  `);

  await runMigration('011_context_lens_episodes', `
    CREATE TABLE IF NOT EXISTS context_lens_episodes (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local_default',
      tag TEXT NOT NULL,
      start_day TEXT NOT NULL,
      end_day TEXT,
      intensity SMALLINT NOT NULL DEFAULT 1 CHECK (intensity >= 0 AND intensity <= 3),
      label TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_episode_per_tag
      ON context_lens_episodes (user_id, tag) WHERE end_day IS NULL;
    CREATE INDEX IF NOT EXISTS idx_episodes_user_active
      ON context_lens_episodes (user_id) WHERE end_day IS NULL;
    CREATE INDEX IF NOT EXISTS idx_episodes_user_archive
      ON context_lens_episodes (user_id, tag, end_day) WHERE end_day IS NOT NULL;
  `);

  await runMigration('012_context_lens_archives', `
    CREATE TABLE IF NOT EXISTS context_lens_archives (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local_default',
      episode_id INTEGER REFERENCES context_lens_episodes(id),
      tag TEXT NOT NULL,
      start_day TEXT NOT NULL,
      end_day TEXT NOT NULL,
      label TEXT,
      summary_json JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_archives_user_tag ON context_lens_archives(user_id, tag);
  `);
}

export { pool };
