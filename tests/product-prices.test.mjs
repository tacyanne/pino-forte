import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openPrice, planProductPriceChange, priceChangeLabel, priceSourceOf, priceTimeline } from "../lib/product-prices.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/page.tsx");
const api = read("../app/api/catalog/route.ts");
const store = read("../lib/product-price-store.ts");
const migration = read("../supabase/migrations/20261113020000_product_price_history.sql");
const money = (value) => `R$ ${value.toFixed(2).replace(".", ",")}`;

const row = (values) => ({ id: 1, productId: 7, priceCents: 1000, startsAt: "2026-06-01", endsAt: null, source: "tela", ...values });

test("mudança de preço fecha a vigência anterior e abre a nova a partir de hoje", () => {
  const open = row({ id: 5 });
  assert.deepEqual(planProductPriceChange(null, 1200, "2026-11-13"), { kind: "insert", closeId: null, closeEndsAt: null });
  assert.deepEqual(planProductPriceChange(open, 1000, "2026-11-13"), { kind: "none" });
  assert.deepEqual(planProductPriceChange(open, 1200, "2026-11-13"), { kind: "insert", closeId: 5, closeEndsAt: "2026-11-12" });
  // segunda mudança no mesmo dia corrige a vigência aberta, sem criar outra
  assert.deepEqual(planProductPriceChange(row({ id: 6, startsAt: "2026-11-13" }), 1300, "2026-11-13"), { kind: "update", id: 6 });
  assert.deepEqual(planProductPriceChange(open, 0, "2026-11-13"), { kind: "none" });
  assert.deepEqual(planProductPriceChange(open, 10.5, "2026-11-13"), { kind: "none" });
});

test("vigência aberta e linha do tempo com a variação sobre o preço anterior", () => {
  const history = [
    row({ id: 1, priceCents: 1000, startsAt: "2026-06-01", endsAt: "2026-09-30", source: "vendas" }),
    row({ id: 2, priceCents: 1100, startsAt: "2026-10-01", endsAt: "2026-11-12", source: "vendas" }),
    row({ id: 3, priceCents: 990, startsAt: "2026-11-13" }),
    row({ id: 4, productId: 8, priceCents: 500 }),
  ];
  assert.equal(openPrice(history, 7).id, 3);
  assert.equal(openPrice(history, 99), null);

  const timeline = priceTimeline(history, 7);
  assert.deepEqual(timeline.map((item) => item.id), [3, 2, 1]);
  assert.equal(timeline[0].previousCents, 1100);
  assert.equal(timeline[0].deltaCents, -110);
  assert.equal(timeline[0].deltaRate, -0.1);
  assert.equal(timeline[2].deltaCents, null);

  assert.equal(priceChangeLabel(timeline[0], money), "−R$ 1,10 (−10,0%)");
  assert.equal(priceChangeLabel(timeline[1], money), "+R$ 1,00 (+10,0%)");
  assert.equal(priceChangeLabel(timeline[2], money), "preço inicial");
  assert.equal(priceChangeLabel({ deltaCents: 0, deltaRate: 0 }, money), "sem mudança");
  assert.equal(priceSourceOf("vendas"), "vendas");
  assert.equal(priceSourceOf("outro"), "tela");
});

test("API registra o preço no histórico nos dois caminhos de banco", () => {
  assert.equal(api.split("productPrices: await listProductPricesSafe()").length - 1, 2);
  assert.equal(api.split('todayIso(), "cadastro")').length - 1, 2);
  assert.equal(api.split('todayIso(), "tela")').length - 1, 2);
  assert.ok(store.includes("hasSupabaseRest()"));
  assert.ok(store.includes('supabaseInsert("product_price_history"'));
  assert.ok(store.includes("tx.insert(productPriceHistory)"));
});

test("tabela do histórico de preço fica fechada para acesso público", () => {
  assert.ok(/create table if not exists public\.product_price_history/i.test(migration));
  assert.ok(/enable row level security/i.test(migration));
  assert.ok(/revoke all on public\.product_price_history from anon, authenticated/i.test(migration));
});

test("tela da peça mostra o histórico de preço, e o catálogo público não", () => {
  assert.ok(page.includes("<legend>Histórico de preço</legend>"));
  assert.ok(page.includes("priceTimeline(productPrices, editingProduct.id)"));
  assert.ok(page.includes("estimado pelas vendas"));
  assert.equal(/product_price_history|productPrices/.test(read("../app/catalogo/page.tsx")), false);
  assert.equal(/priceHistory|product-prices/.test(read("../lib/catalog-products.ts")), false);
});
