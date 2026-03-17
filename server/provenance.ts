import { pool } from "./db.js";

// ─── DB environment detection ──────────────────────────────────────────────
function getDbEnv(): string {
  const url = process.env.DATABASE_URL || "";
  if (url.includes("neon.tech")) {
    return process.env.NODE_ENV === "production" ? "neon·prod" : "neon·dev";
  }
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    return "local-postgres";
  }
  return "postgres·unknown-env";
}

function getDbHost(): string {
  try {
    const parsed = new URL(process.env.DATABASE_URL || "");
    return parsed.hostname;
  } catch {
    return "unknown-host";
  }
}

function getDbName(): string {
  try {
    const parsed = new URL(process.env.DATABASE_URL || "");
    // pathname is "/dbname"
    return parsed.pathname.replace(/^\//, "") || "unknown-db";
  } catch {
    return "unknown-db";
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────
export interface ActiveWorkbook {
  id: number;
  filename: string;
  version_tag: string | null;
  uploaded_at: string;
  row_counts: Record<string, number>;
  is_active: boolean;
  /** "explicit" = user activated it; "implicit" = fallback to most recent */
  selection_mode: "explicit" | "implicit" | "none";
}

export interface Provenance {
  db_env: string;
  db_host: string;
  db_name: string;
  user_id: string;
  tables_read: string[];
  active_workbook: ActiveWorkbook | null;
  legacy_daily_log: boolean;
  generated_at: string;
}

// ─── Active workbook resolution ────────────────────────────────────────────
export async function getActiveWorkbook(
  userId: string
): Promise<ActiveWorkbook | null> {
  // 1. Explicit activation
  const r = await pool.query(
    `SELECT id, filename, version_tag, uploaded_at, row_counts, is_active
     FROM workbook_versions
     WHERE user_id = $1 AND is_active = true
     ORDER BY uploaded_at DESC LIMIT 1`,
    [userId]
  );
  if (r.rows.length) {
    return { ...r.rows[0], selection_mode: "explicit" } as ActiveWorkbook;
  }

  // 2. Implicit fallback: most recent upload
  const r2 = await pool.query(
    `SELECT id, filename, version_tag, uploaded_at, row_counts, is_active
     FROM workbook_versions
     WHERE user_id = $1
     ORDER BY uploaded_at DESC LIMIT 1`,
    [userId]
  );
  if (r2.rows.length) {
    return { ...r2.rows[0], selection_mode: "implicit" } as ActiveWorkbook;
  }

  return null;
}

// ─── Provenance builder ────────────────────────────────────────────────────
/**
 * Build a provenance object. Pass tablesRead = [] for endpoints that don't
 * touch a specific table list (the /api/provenance endpoint itself uses this).
 */
export async function buildProvenance(
  userId: string,
  tablesRead: string[]
): Promise<Provenance> {
  const [wb, legacyCheck] = await Promise.all([
    getActiveWorkbook(userId),
    // Detect whether daily_log has rows for this user (legacy truth path alive?)
    pool.query(
      `SELECT 1 FROM daily_log WHERE user_id = $1 LIMIT 1`,
      [userId]
    ),
  ]);

  return {
    db_env: getDbEnv(),
    db_host: getDbHost(),
    db_name: getDbName(),
    user_id: userId,
    tables_read: tablesRead,
    active_workbook: wb,
    legacy_daily_log: legacyCheck.rowCount! > 0,
    generated_at: new Date().toISOString(),
  };
}
