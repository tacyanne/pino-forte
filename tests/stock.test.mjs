import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { StockError, paceSentence, parseStockMovement, stockPosition, stockTotals } from "../lib/stock.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/page.tsx");
const api = read("../app/api/stock/route.ts");
const migration = read("../supabase/migrations/20261113010000_stock_movements.sql");

const move = (id, productId, kind, quantity, movementDate) => ({ id, productId, kind, quantity, movementDate, notes: "" });

test("lançamento de estoque valida peça, tipo, quantidade e data", () => {
  assert.deepEqual(parseStockMovement({ productId: 7, kind: "contagem", quantity: 0, notes: "  inventário  " }, "2026-03-10"), {
    productId: 7,
    kind: "contagem",
    quantity: 0,
    movementDate: "2026-03-10",
    notes: "inventário",
  });
  assert.throws(() => parseStockMovement({ productId: 0, kind: "entrada", quantity: 5 }, "2026-03-10"), StockError);
  assert.throws(() => parseStockMovement({ productId: 7, kind: "venda", quantity: 5 }, "2026-03-10"), StockError);
  assert.throws(() => parseStockMovement({ productId: 7, kind: "entrada", quantity: 0 }, "2026-03-10"), StockError);
  assert.throws(() => parseStockMovement({ productId: 7, kind: "entrada", quantity: 2.5 }, "2026-03-10"), StockError);
  assert.throws(() => parseStockMovement({ productId: 7, kind: "entrada", quantity: -1 }, "2026-03-10"), StockError);
  assert.throws(() => parseStockMovement({ productId: 7, kind: "entrada", quantity: 3, movementDate: "2026-03-11" }, "2026-03-10"), /futuro/);
  assert.throws(() => parseStockMovement(null, "2026-03-10"), StockError);
});

test("saldo parte da última contagem e segue com entradas, saídas e OS entregues", () => {
  const [row] = stockPosition({
    productIds: [7],
    movements: [
      move(1, 7, "contagem", 50, "2026-01-05"),
      move(2, 7, "entrada", 99, "2026-02-20"),
      move(3, 7, "contagem", 20, "2026-03-01"),
      move(4, 7, "entrada", 10, "2026-03-05"),
      move(5, 7, "saida", 2, "2026-03-06"),
      move(6, 8, "entrada", 500, "2026-03-06"),
    ],
    sold: [
      { productId: 7, quantity: 4, date: "2026-02-25" },
      { productId: 7, quantity: 3, date: "2026-03-01" },
      { productId: 7, quantity: 6, date: "2026-03-08T10:00:00" },
      { productId: 8, quantity: 9, date: "2026-03-08" },
    ],
    reserved: [{ productId: 7, quantity: 5, date: "2026-03-09" }],
    today: "2026-03-10",
  });
  // 20 contadas + 10 − 2 − 6 vendidas depois da contagem (a do dia 01/03 já estava fora)
  assert.equal(row.balance, 22);
  assert.equal(row.countedAt, "2026-03-01");
  assert.equal(row.reserved, 5);
  assert.equal(row.available, 17);
  assert.equal(row.missing, 0);
  // 13 vendidas nos últimos 90 dias = 4,3 por mês
  assert.equal(row.monthlyPace, 4.3);
  assert.equal(row.coverageMonths, 4);
  assert.equal(row.status, "ok");
});

test("lançamento do mesmo dia da contagem só conta se foi gravado depois dela", () => {
  const [row] = stockPosition({
    productIds: [7],
    movements: [move(1, 7, "entrada", 8, "2026-03-01"), move(2, 7, "contagem", 20, "2026-03-01"), move(3, 7, "entrada", 5, "2026-03-01")],
    sold: [],
    reserved: [],
    today: "2026-03-10",
  });
  assert.equal(row.balance, 25);
});

test("status: sem contagem, falta para a fila, zerado e baixo", () => {
  const rows = stockPosition({
    productIds: [1, 2, 3, 4],
    movements: [move(1, 2, "contagem", 3, "2026-03-01"), move(2, 3, "contagem", 0, "2026-03-01"), move(3, 4, "contagem", 2, "2026-03-01"), move(4, 1, "entrada", 9, "2026-03-02")],
    sold: [{ productId: 4, quantity: 12, date: "2026-02-10" }],
    reserved: [{ productId: 2, quantity: 5, date: "2026-03-05" }, { productId: 1, quantity: 4, date: "2026-03-05" }],
    today: "2026-03-10",
  });
  assert.deepEqual(rows.map((row) => row.status), ["sem-contagem", "falta", "zerado", "baixo"]);
  assert.equal(rows[0].balance, null);
  assert.equal(rows[0].available, null);
  assert.equal(rows[1].available, -2);
  assert.equal(rows[1].missing, 2);
  assert.equal(rows[3].coverageMonths, 0.5);
  assert.deepEqual(stockTotals(rows), { inStock: 5, reserved: 9, missing: 2, uncounted: 1 });
});

test("frase do ritmo de venda", () => {
  assert.equal(paceSentence({ monthlyPace: 0, coverageMonths: null, available: 5 }), "Sem venda nos últimos 3 meses");
  assert.equal(paceSentence({ monthlyPace: 4.3, coverageMonths: 4, available: 17 }), "Vende 4,3 por mês · dura 4 meses");
  assert.equal(paceSentence({ monthlyPace: 4, coverageMonths: 1, available: 4 }), "Vende 4 por mês · dura 1 mês");
  assert.equal(paceSentence({ monthlyPace: 4, coverageMonths: 0.5, available: 2 }), "Vende 4 por mês · dura menos de 1 mês");
  assert.equal(paceSentence({ monthlyPace: 4, coverageMonths: null, available: null }), "Vende 4 por mês");
});

test("API de estoque exige login e grava nos dois caminhos de banco", () => {
  assert.equal(api.split("requireUser(request)").length - 1, 3);
  assert.ok(api.includes("parseStockMovement(await request.json(), todayIso())"));
  assert.ok(api.includes("hasSupabaseRest()"));
  assert.ok(api.includes('supabaseInsert<Record<string, unknown>>("stock_movements"'));
  assert.ok(api.includes("db.insert(stockMovements)"));
  assert.ok(/create table if not exists public\.stock_movements/i.test(migration));
  assert.ok(/revoke all on public\.stock_movements from anon, authenticated/i.test(migration));
});

test("tela de estoque usa OS entregues como saída e OS na fila como prometido", () => {
  for (const text of ['["stock", "▥", "Estoque"]', 'screen === "stock"', "stockPosition({", "Peças em estoque", "Prometidas na fila", "Falta comprar", "Sem contagem", "refreshStock"])
    assert.ok(page.includes(text), text);
});

test("tela de estoque fala em comprar, não em fabricar", () => {
  const start = page.indexOf('{screen === "stock" && (');
  const end = page.indexOf('{screen === "wallet" && (', start);
  assert.equal(/fabric/i.test(page.slice(start, end)), false);
  assert.ok(page.includes("Entrada: comprei peças"));
});
