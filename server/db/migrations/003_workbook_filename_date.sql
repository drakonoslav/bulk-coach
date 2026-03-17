-- Migration 003: filename_date on workbook_snapshots
-- Adds a display/sort convenience field parsed from logbookMMDDYYYY.xlsx pattern.
-- Authority rule: filename_date is cosmetic only.
-- snapshot_id + is_active = real operational truth.

BEGIN;

ALTER TABLE workbook_snapshots
ADD COLUMN IF NOT EXISTS filename_date DATE;

CREATE INDEX IF NOT EXISTS idx_workbook_snapshots_user_filename_date
  ON workbook_snapshots(user_id, filename_date DESC);

COMMIT;

-- Migration 003b: canonical raw sheet row table (snapshot_sheet_rows)
-- workbook_sheet_rows is legacy (references workbook_versions).
-- snapshot_sheet_rows references workbook_snapshots(id) — the new canonical table.

BEGIN;

CREATE TABLE IF NOT EXISTS snapshot_sheet_rows (
  id                   BIGSERIAL PRIMARY KEY,
  workbook_snapshot_id BIGINT NOT NULL REFERENCES workbook_snapshots(id) ON DELETE CASCADE,
  sheet_name           TEXT NOT NULL,
  row_index            INTEGER NOT NULL,
  raw_json             JSONB NOT NULL,
  UNIQUE (workbook_snapshot_id, sheet_name, row_index)
);

CREATE INDEX IF NOT EXISTS idx_ssr_snapshot_sheet
  ON snapshot_sheet_rows(workbook_snapshot_id, sheet_name);

COMMIT;
