/**
 * lib/workbook-types.ts
 * Exact frontend types matching the canonical workbook API contract.
 * Do NOT invent alternate payload shapes.
 * Do NOT read from workbook_versions — workbook_snapshots only.
 */

export type DbProvenance = {
  host: string | null;
  port: string | null;
  database: string | null;
  ssl: string | null;
  nodeEnv?: string | null;
  node_env?: string | null;
};

export type ApiProvenance = {
  db: DbProvenance;
  userId: string | null;
  activeWorkbookSnapshotId: number | null;
  tablesRead?: string[];
  tablesWritten?: string[];
  source: string;
  filenameMatchedLogbookPattern?: boolean;
};

export type WorkbookSnapshot = {
  id: number;
  filename: string;
  filenameDate: string | null;
  versionTag: string | null;
  uploadedAt: string;
  isActive: boolean;
  rowCounts: Record<string, number>;
  warnings: string[];
};

export type WorkbookSnapshotsResponse = {
  snapshots: WorkbookSnapshot[];
  _provenance: ApiProvenance;
};

export type ActiveWorkbookResponse = {
  activeSnapshot: WorkbookSnapshot;
  _provenance: ApiProvenance;
};

export type ActivateWorkbookResponse = {
  ok: boolean;
  activatedSnapshotId: number;
  _provenance: ApiProvenance;
};

export type UploadWorkbookResponse = {
  ok: boolean;
  workbookSnapshotId: number;
  uploadedAt: string;
  filename: string;
  filenameDate: string | null;
  versionTag: string | null;
  rowCounts: Record<string, number>;
  warnings: string[];
  _provenance: ApiProvenance;
};

export type ApiErrorResponse = {
  error: string;
  _provenance?: Partial<ApiProvenance>;
};
