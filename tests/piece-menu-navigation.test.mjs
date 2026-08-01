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

test("sidebar keeps operational entries first and support records under Configurações", () => {
  const primaryStart = page.indexOf("const primaryNav");
  const settingsStart = page.indexOf("const settingsNav");

  assert.ok(primaryStart > 0, "primaryNav should exist");
  assert.ok(settingsStart > primaryStart, "settingsNav should follow primaryNav");
  assert.ok(page.includes('["dashboard", "⌂", "Início"]'));
  assert.ok(page.includes('["orders", "▤", "OS"]'));
  assert.ok(page.includes('["wallet", "▣", "Carteira"]'));
  assert.ok(page.includes('["financial", "$", "Financeiro"]'));
  assert.ok(page.includes('["reports", "▥", "Relatórios"]'));
  assert.ok(page.includes('["catalog", "▦", "Catálogo"]'));
  assert.ok(page.includes('["customers", "♙", "Clientes"]'));
  assert.ok(page.includes('["products", "⬡", "Peças"]'));
  assert.ok(page.includes('["company", "⌂", "Empresa"]'));
  assert.ok(page.includes('["users", "◉", "Usuários"]'));
  assert.equal(page.includes('["piece-types",'), false);
  assert.equal(page.includes('["order-status",'), false);
  assert.equal(page.includes('["payment-status",'), false);
  assert.equal(page.includes('["payment-methods",'), false);
  assert.ok(page.includes("showSettings = settingsOpen || isSettingsScreen"));
  assert.ok(page.includes("nav-submenu"));
  assert.equal(page.includes("Cadastros"), false);
});

test("piece registration has required type, listing column, and migration default", () => {
  assert.ok(page.includes('const basePieceTypes = ["Pino", "Bucha"]'));
  assert.ok(page.includes('name="pieceType" required'));
  assert.ok(catalogApi.includes("Selecione o tipo de peça"));
  assert.ok(page.includes("<th>Tipo</th>"));
  assert.equal(page.includes("<th>Ações</th>"), false, "Pieces should open by row click without a visual action button");
  assert.ok(page.includes("productTypeFilter"));
  assert.ok(schema.includes('pieceType: text("piece_type").notNull().default("Pino")'));
  assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS piece_type"));
  assert.ok(migration.includes("DEFAULT 'Pino'"));
});
