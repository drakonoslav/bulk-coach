/**
 * server/db/pool.ts
 * NEW CANONICAL: Single Postgres connection pool for all workbook-spine routes.
 * REPLACES: scattered pool imports from server/db.ts on new routes.
 *
 * Rules:
 * - DATABASE_URL must be set; if missing, process exits loudly.
 * - getDbProvenance() is attached to every API response as _provenance.db
 * - No fallback connections. No silent substitution.
 */
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("[db/pool] FATAL: DATABASE_URL is not set. Refusing to start.");
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[db/pool] Unexpected pool error:", err.message);
  process.exitCode = 1;
});

export interface DbProvenance {
  host: string | null;
  port: string | null;
  database: string | null;
  node_env: string | null;
  ssl: string | null;
}

export function getDbProvenance(): DbProvenance {
  const raw = process.env.DATABASE_URL || "";
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname.replace(/^\//, ""),
      node_env: process.env.NODE_ENV || null,
      ssl: url.searchParams.get("sslmode") || null,
    };
  } catch {
    return {
      host: null,
      port: null,
      database: null,
      node_env: process.env.NODE_ENV || null,
      ssl: null,
    };
  }
}
