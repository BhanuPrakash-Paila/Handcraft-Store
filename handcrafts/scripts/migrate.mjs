import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(root, "services", "api", "migrations");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to apply database migrations.");
  process.exitCode = 1;
} else {
  const sslMode = process.env.PGSSLMODE;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslMode === "disable"
      ? false
      : process.env.NODE_ENV === "production" || Boolean(sslMode)
        ? { rejectUnauthorized: sslMode !== "require" }
        : undefined,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  let client;
  try {
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock(hashtext('handcrafts:schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((name) => /^\d{3,}_[a-z0-9_-]+\.sql$/.test(name))
      .sort();

    if (!files.length) throw new Error("No numbered SQL migrations were found.");

    for (const file of files) {
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      const version = file.slice(0, -4);
      const checksum = createHash("sha256").update(sql).digest("hex");
      const recorded = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [version],
      );

      if (recorded.rowCount) {
        if (recorded.rows[0].checksum.trim() !== checksum) {
          throw new Error(`Applied migration ${version} was modified; create a new migration instead.`);
        }
        console.log(`Already applied: ${version}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [version, checksum],
        );
        await client.query("COMMIT");
        console.log(`Applied: ${version}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration failed.");
    process.exitCode = 1;
  } finally {
    if (client) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext('handcrafts:schema-migrations'))");
      } catch {
        // The connection may already be unavailable after a database error.
      }
      client.release();
    }
    await pool.end();
  }
}
