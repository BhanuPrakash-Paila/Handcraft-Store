import pg from "pg";

const { Pool } = pg;
let pool: pg.Pool | undefined;

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!pool) {
    const sslMode = process.env.PGSSLMODE;
    const sslRequired =
      process.env.NODE_ENV === "production" ||
      Boolean(sslMode && sslMode !== "disable");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslMode === "disable"
        ? false
        : sslRequired
          ? { rejectUnauthorized: sslMode !== "require" }
          : undefined,
      max: Number(process.env.PG_POOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}
