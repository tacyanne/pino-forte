import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!url) {
    throw new Error("Configure DATABASE_URL com a connection string Postgres do Supabase.");
  }
  return url;
}

export function getSql() {
  if (!client) {
    client = postgres(getDatabaseUrl(), {
      max: 5,
      prepare: false,
      ssl: "require",
    });
  }
  return client;
}

export async function getDb() {
  if (!db) db = drizzle(getSql(), { schema });
  return db;
}