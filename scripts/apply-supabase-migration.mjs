import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  try {
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] ||= value;
    }
  } catch {
    // .env.local is optional when env vars are already provided by the host.
  }
}

await loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL or SUPABASE_DATABASE_URL.");
  process.exit(1);
}

const migrationPath = process.argv[2] || "supabase/migrations/001_pino_forte_supabase_foundation.sql";
const absoluteMigrationPath = path.resolve(process.cwd(), migrationPath);
const sqlText = await fs.readFile(absoluteMigrationPath, "utf8");

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  await sql`select 1`;
  await sql.begin(async (tx) => {
    await tx.unsafe(sqlText);
  });
  console.log(`Applied migration: ${migrationPath}`);
} finally {
  await sql.end({ timeout: 5 });
}