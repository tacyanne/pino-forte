import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type PostgresFactory = typeof postgres;

let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!url) {
    throw new Error("Configure DATABASE_URL com a connection string Postgres do Supabase.");
  }
  return url;
}

async function getPostgresFactory(): Promise<PostgresFactory> {
  if (process.env.PINO_LOCAL_NODE_POSTGRES !== "1") return postgres;
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("postgres");
}

export async function getSql() {
  if (!client) {
    const postgresFactory = await getPostgresFactory();
    client = postgresFactory(getDatabaseUrl(), {
      max: 1,
      prepare: false,
      ssl: "require",
      connect_timeout: 10,
      idle_timeout: 20,
    });
  }
  return client;
}

export async function getDb() {
  if (!db) db = drizzle(await getSql(), { schema });
  return db;
}
