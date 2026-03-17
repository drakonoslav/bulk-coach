/**
 * server/storage.ts — GUTTED (Pass 3)
 *
 * MemStorage has been disabled. It was an in-memory user store that created
 * split-brain persistence: any data written here existed only for the lifetime
 * of the process and could not be audited or queried.
 *
 * REPLACEMENT: Postgres (workbook_snapshots, daily_log, etc.)
 * SOURCE OF TRUTH: workbook_snapshots + Postgres only.
 * PATHS NO LONGER ALLOWED: in-memory user objects, MemStorage instances.
 *
 * If you see this file imported anywhere, that import is a bug.
 */

export {}; // Empty module — safe to import but exports nothing.

export class MemStorage {
  constructor() {
    throw new Error(
      "[storage.ts] MemStorage is DISABLED. " +
        "Use Postgres (workbook_snapshots, workbook_sheet_rows, biolog_rows). " +
        "No in-memory storage is allowed on this path."
    );
  }
}
