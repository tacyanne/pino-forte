import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { StockError, paceSentence, parseStockMovement, stockHistory, stockPosition, stockTotals } from "../lib/stock.ts";

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
    movements: [move(1, 2, "contagem", 3, "2026-03-01"), move(2, 3, "contagem", 0, "2026-03-01"), move(3, 4, "contagem", 2, "2026-03-01")],
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
  assert.equal(api.split("requireUser(request)").length - 1, 4);
  assert.ok(api.includes("parseStockMovement(body, todayIso())"));
  assert.ok(api.includes("hasSupabaseRest()"));
  assert.ok(api.includes('supabaseInsert<Record<string, unknown>>("stock_movements"'));
  assert.ok(api.includes("db.insert(stockMovements)"));
  assert.ok(/create table if not exists public\.stock_movements/i.test(migration));
  assert.ok(/revoke all on public\.stock_movements from anon, authenticated/i.test(migration));
});

test("tela de estoque usa OS entregues como saída e OS na fila como prometido", () => {
  for (const text of ['["stock", "▥", "Estoque"]', 'screen === "stock"', "stockPosition({", "Peças em estoque", "Prometidas na fila", "Falta comprar", "Sem estoque", "refreshStock"])
    assert.ok(page.includes(text), text);
});

test("tela de estoque fala em comprar, não em fabricar", () => {
  const start = page.indexOf('{screen === "stock" && (');
  const end = page.indexOf('{screen === "wallet" && (', start);
  assert.equal(/fabric/i.test(page.slice(start, end)), false);
  // peça nova só entra pelo lote de compra: o Estoque fica com os ajustes
  assert.equal(page.includes("Entrada: comprei peças"), false);
  // o saldo vem dos lotes: sem entrada nem contagem à mão, só saída sem venda
  assert.equal(page.includes("Contei: é isso que tenho agora"), false);
  assert.ok(page.includes('<input type="hidden" name="kind" value="saida" />'));
  assert.ok(page.includes("O saldo vem dos lotes de compra"));
  assert.ok(api.includes('if (input.kind !== "saida")'));
});

test("entrada sem contagem já aparece no estoque, começando em zero", () => {
  const [onlyEntry, withSale, untouched] = stockPosition({
    productIds: [1, 2, 3],
    movements: [
      move(1, 1, "entrada", 10, "2026-11-11"),
      move(2, 2, "entrada", 10, "2026-11-11"),
      move(3, 2, "saida", 1, "2026-11-12"),
    ],
    sold: [
      { productId: 2, quantity: 4, date: "2026-11-10" },
      { productId: 2, quantity: 3, date: "2026-11-11" },
    ],
    reserved: [],
    today: "2026-11-12",
  });
  assert.equal(onlyEntry.balance, 10);
  assert.equal(onlyEntry.countedAt, null);
  assert.equal(onlyEntry.status, "ok");
  // 10 − 1 de saída − 3 vendidas no dia da entrada (a venda do dia anterior não conta)
  assert.equal(withSale.balance, 6);
  assert.equal(untouched.balance, null);
  assert.equal(untouched.status, "sem-contagem");
  assert.equal(stockTotals([onlyEntry, withSale, untouched]).uncounted, 1);
});

test("histórico mostra entradas e as saídas das OS entregues que entram no saldo", () => {
  const movements = [move(1, 7, "entrada", 10, "2026-11-11"), move(2, 3, "contagem", 8, "2026-11-11")];
  const sold = [
    { productId: 7, quantity: 4, date: "2026-11-12", orderNumber: "OS-A" },
    { productId: 7, quantity: 4, date: "2026-11-11", orderNumber: "OS-B" },
    { productId: 7, quantity: 5, date: "2026-11-10", orderNumber: "OS-C" },
    { productId: 3, quantity: 2, date: "2026-11-11", orderNumber: "OS-D" },
    { productId: 3, quantity: 1, date: "2026-11-12", orderNumber: "OS-E" },
    { productId: 9, quantity: 6, date: "2026-11-12", orderNumber: "OS-F" },
  ];
  const history = stockHistory({ productIds: [7, 3, 9], movements, sold });
  // OS-C (antes da entrada), OS-D (no dia da contagem) e OS-F (peça sem lançamento) ficam de fora
  assert.deepEqual(
    history.map((item) => `${item.kind}:${item.orderNumber || item.productId}`),
    ["os:OS-E", "os:OS-A", "os:OS-B", "contagem:3", "entrada:7"],
  );
  assert.equal(history.find((item) => item.orderNumber === "OS-A").movement, undefined);

  // OS mais nova primeiro, e as peças da mesma OS ficam juntas
  const grouped = stockHistory({
    productIds: [1, 2],
    movements: [move(1, 1, "entrada", 10, "2026-11-11"), move(2, 2, "entrada", 10, "2026-11-11")],
    sold: [
      { productId: 1, quantity: 4, date: "2026-11-11", orderNumber: "OS-13" },
      { productId: 1, quantity: 4, date: "2026-11-11", orderNumber: "OS-12" },
      { productId: 2, quantity: 4, date: "2026-11-11", orderNumber: "OS-13" },
    ],
  });
  assert.deepEqual(
    grouped.filter((item) => item.kind === "os").map((item) => `${item.orderNumber}:${item.productId}`),
    ["OS-13:1", "OS-13:2", "OS-12:1"],
  );

  const [row] = stockPosition({ productIds: [7], movements, sold, reserved: [], today: "2026-11-12" });
  assert.equal(row.balance, 2);
  // o histórico saiu da tela Estoque: o dia a dia agora se lê nos lotes de compra
  assert.equal(page.includes("Histórico do estoque"), false);
  assert.equal(page.includes('className="stock-history-day"'), false);
});

test("lista do estoque: zero no lugar do traço, zeradas primeiro e sem botão de saída", () => {
  assert.ok(page.includes("{row.balance ?? 0}"));
  assert.ok(page.includes("{row.available ?? 0}"));
  assert.equal(page.includes('row.balance === null ? "—"'), false);
  assert.ok(page.includes("(a.row?.available ?? 0) - (b.row?.available ?? 0)"));
  // zeradas primeiro (menor disponível no topo) e sem botão de saída na lista
  assert.equal(page.includes("isEmptyStock"), false);
  assert.equal(page.includes(">Dar saída</button>"), false);
  assert.equal(page.includes(">Contar</button>"), false);
});
