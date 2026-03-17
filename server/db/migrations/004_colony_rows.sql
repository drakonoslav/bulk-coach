BEGIN;

CREATE TABLE IF NOT EXISTS drift_event_rows (
  id BIGSERIAL PRIMARY KEY,
  workbook_snapshot_id BIGINT NOT NULL REFERENCES workbook_snapshots(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  drift_date DATE,
  phase TEXT,
  drift_type TEXT,
  drift_source TEXT,
  confidence TEXT,
  weighted_drift_score NUMERIC,
  watch_flag TEXT,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workbook_snapshot_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_drift_event_rows_snapshot_date
  ON drift_event_rows(workbook_snapshot_id, drift_date);

CREATE INDEX IF NOT EXISTS idx_drift_event_rows_snapshot_type
  ON drift_event_rows(workbook_snapshot_id, drift_type);

CREATE TABLE IF NOT EXISTS colony_metric_rows (
  id BIGSERIAL PRIMARY KEY,
  workbook_snapshot_id BIGINT NOT NULL REFERENCES workbook_snapshots(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  metric TEXT,
  metric_value TEXT,
  threshold_value TEXT,
  status TEXT,
  recommendation TEXT,
  confidence TEXT,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workbook_snapshot_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_colony_metric_rows_snapshot_metric
  ON colony_metric_rows(workbook_snapshot_id, metric);

CREATE TABLE IF NOT EXISTS threshold_lab_rows (
  id BIGSERIAL PRIMARY KEY,
  workbook_snapshot_id BIGINT NOT NULL REFERENCES workbook_snapshots(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  threshold_name TEXT,
  current_value TEXT,
  suggested_value TEXT,
  evidence_count NUMERIC,
  notes TEXT,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workbook_snapshot_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_threshold_lab_rows_snapshot_name
  ON threshold_lab_rows(workbook_snapshot_id, threshold_name);

COMMIT;
