import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const catalogApi = readFileSync(new URL("../app/api/catalog/route.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/002_add_product_piece_type.sql", import.meta.url),
  "utf8",
);

test("sidebar keeps operational entries first and support records under Cadastros", () => {
  const primaryStart = page.indexOf("const primaryNav");
  const registrationsStart = page.indexOf("const registrationNav");

  assert.ok(primaryStart > 0, "primaryNav should exist");
  assert.ok(registrationsStart > primaryStart, "registrationNav should follow primaryNav");
  assert.ok(page.includes('["dashboard", "⌂", "Início"]'));
  assert.ok(page.includes('["orders", "▤", "Ordens de Serviço"]'));
  assert.ok(page.includes('["wallet", "▣", "Carteira"]'));
  assert.ok(page.includes('["financial", "$", "Financeiro"]'));
  assert.ok(page.includes('["reports", "▥", "Relatórios"]'));
  assert.ok(page.includes('["settings", "⚙", "Configurações"]'));
  assert.ok(page.includes('["customers", "♙", "Clientes"]'));
  assert.ok(page.includes('["products", "⬡", "Peças"]'));
  assert.ok(page.includes('["catalog", "▦", "Catálogo"]'));
  assert.ok(page.includes("showRegistrations = registrationsOpen || isRegistrationScreen"));
  assert.ok(page.includes("nav-submenu"));
});

test("piece registration has required type, listing column, and migration default", () => {
  assert.ok(page.includes('const basePieceTypes = ["Pino", "Bucha"]'));
  assert.ok(page.includes('name="pieceType" required'));
  assert.ok(catalogApi.includes("Selecione o tipo de peça"));
  assert.ok(page.includes("<th>Tipo</th>"));
  assert.ok(page.includes("productTypeFilter"));
  assert.ok(schema.includes('pieceType: text("piece_type").notNull().default("Pino")'));
  assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS piece_type"));
  assert.ok(migration.includes("DEFAULT 'Pino'"));
});
