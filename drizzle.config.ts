import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./supabase/drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || "",
  },
});