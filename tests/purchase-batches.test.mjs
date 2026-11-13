import assert from "node:assert/strict";
import test from "node:test";
import { NO_BATCH, PurchaseBatchError, allocateBatches, assertBatchChangeAllowed, batchStudy, lockedBatchProducts, parsePurchaseBatch } from "../lib/purchase-batches.ts";

const money = (value) => `R$ ${value.toFixed(2).replace(".", ",")}`;
const format = { money, percent: (rate) => `${Math.round(rate * 1000) / 10}%`.replace(".", ",") };
const entry = (values) => ({ movementId: 1, batchId: 1, productId: 7, quantity: 10, unitCostCents: 2000, date: "2026-03-01", ...values });
const sale = (values) => ({ orderId: 1, orderNumber: "OS-EX-1", productId: 7, quantity: 4, revenueCents: 10000, date: "2026-03-05", ...values });

test("venda sai do lote mais antigo primeiro e passa para o seguinte quando ele acaba", () => {
  const { byBatch, unallocated } = allocateBatches({
    entries: [
      entry({ movementId: 1, batchId: 1, quantity: 5, unitCostCents: 2000, date: "2026-03-01" }),
      entry({ movementId: 2, batchId: 2, quantity: 10, unitCostCents: 2500, date: "2026-03-10" }),
    ],
    sales: [
      sale({ orderId: 1, quantity: 4, revenueCents: 10000, date: "2026-03-05" }),
      sale({ orderId: 2, orderNumber: "OS-EX-2", quantity: 3, revenueCents: 7501, date: "2026-03-12" }),
    ],
  });
  const first = byBatch.get(1);
  const second = byBatch.get(2);
  assert.deepEqual(first.sold.map((line) => [line.orderId, line.quantity, line.revenueCents, line.costCents]), [[1, 4, 10000, 8000], [2, 1, 2500, 2000]]);
  assert.deepEqual(first.left, []);
  // a segunda venda é dividida entre os dois lotes sem sobrar centavo
  assert.deepEqual(second.sold.map((line) => [line.orderId, line.quantity, line.revenueCents, line.costCents]), [[2, 2, 5001, 5000]]);
  assert.deepEqual(second.left, [{ movementId: 2, productId: 7, quantity: 8, unitCostCents: 2500 }]);
  assert.deepEqual(unallocated, []);
});

test("venda antes da entrada, sem lote ou acima do estoque fica fora do estudo", () => {
  const { byBatch, unallocated } = allocateBatches({
    entries: [entry({ quantity: 3, date: "2026-03-10" })],
    sales: [
      sale({ orderId: 1, quantity: 2, revenueCents: 5000, date: "2026-03-05" }),
      sale({ orderId: 2, quantity: 5, revenueCents: 12500, date: "2026-03-11" }),
      sale({ orderId: 3, productId: 99, quantity: 1, revenueCents: 900, date: "2026-03-11" }),
    ],
  });
  assert.deepEqual(byBatch.get(1).sold.map((line) => [line.orderId, line.quantity, line.revenueCents]), [[2, 3, 7500]]);
  assert.deepEqual(unallocated.map((line) => [line.orderId, line.quantity, line.revenueCents]), [[3, 1, 900], [1, 2, 5000], [2, 2, 5000]]);
});

test("saída lançada à mão desconta do lote mais antigo sem virar venda", () => {
  const { byBatch } = allocateBatches({
    entries: [entry({ quantity: 10 })],
    sales: [sale({ quantity: 4, date: "2026-03-06" })],
    outs: [{ productId: 7, quantity: 2, date: "2026-03-06" }],
  });
  const allocation = byBatch.get(1);
  assert.equal(allocation.manualOut, 2);
  assert.deepEqual(allocation.lost, [{ productId: 7, quantity: 2, costCents: 4000 }]);
  assert.equal(allocation.sold[0].quantity, 4);
  assert.equal(allocation.left[0].quantity, 4);
});

test("estudo do lote: lucro já feito, lucro que falta e pontos de atenção", () => {
  const entries = [
    entry({ movementId: 1, productId: 7, quantity: 10, unitCostCents: 2000 }),
    entry({ movementId: 2, productId: 8, quantity: 10, unitCostCents: 3000 }),
    entry({ movementId: 3, productId: 9, quantity: 10, unitCostCents: 5000 }),
    entry({ movementId: 4, productId: 10, quantity: 5, unitCostCents: null }),
  ];
  const { byBatch } = allocateBatches({
    entries,
    sales: [
      sale({ orderId: 1, orderNumber: "OS-EX-1", productId: 7, quantity: 4, revenueCents: 7600, discounted: true }),
      sale({ orderId: 2, orderNumber: "OS-EX-2", productId: 7, quantity: 2, revenueCents: 5000 }),
      sale({ orderId: 2, orderNumber: "OS-EX-2", productId: 8, quantity: 2, revenueCents: 6200 }),
    ],
  });
  const study = batchStudy({
    entries,
    allocation: byBatch.get(1),
    products: [
      { id: 7, code: "PF-AA-1", priceCents: 2500 },
      { id: 8, code: "PF-BB-1", priceCents: 3100 },
      { id: 9, code: "PF-CC-1", priceCents: 4600 },
      { id: 10, code: "PF-DD-1", priceCents: 1000 },
    ],
    targetRate: 0.35,
    format,
  });
  assert.equal(study.boughtQty, 35);
  assert.equal(study.soldQty, 8);
  assert.equal(study.stockQty, 27);
  assert.equal(study.costCents, 20000 + 30000 + 50000);
  assert.equal(study.soldRevenueCents, 18800);
  // OS 1: 7600 − 8000 = −400; OS 2: 11200 − (4000 + 6000) = 1200
  assert.deepEqual(study.orders.map((row) => [row.orderNumber, row.quantity, row.profitCents]), [["OS-EX-2", 4, 1200], ["OS-EX-1", 4, -400]]);
  assert.equal(study.realizedCents, 800);
  // estoque: 4 x 500 + 8 x 100 + 10 x (−400); a peça sem custo fica fora
  assert.deepEqual(study.stock.map((row) => [row.code, row.quantity, row.profitCents]), [["PF-AA-1", 4, 2000], ["PF-BB-1", 8, 800], ["PF-CC-1", 10, -4000], ["PF-DD-1", 5, null]]);
  assert.equal(study.expectedStockCents, -1200);
  assert.equal(study.totalCents, -400);
  assert.equal(study.rateOnCost, -0.004);
  assert.deepEqual(study.missingCost, ["PF-DD-1"]);
  assert.deepEqual(
    study.notes.map((note) => `${note.tone}:${note.text}`),
    [
      "red:PF-CC-1 dá prejuízo: custa R$ 50,00 e vende a R$ 46,00.",
      "red:A OS-EX-1 foi vendida com desconto e deu prejuízo de R$ 4,00.",
      "amber:Lucro médio de -0,4% sobre o custo, abaixo da meta de 35%.",
      "amber:PF-BB-1 quase sem lucro: R$ 1,00 por peça.",
      "amber:Sem custo neste lote: PF-DD-1. O lucro dessas peças não entra na conta.",
    ],
  );

  const empty = batchStudy({ entries: [], allocation: undefined, products: [], targetRate: 0.35, format });
  assert.equal(empty.rateOnCost, null);
  assert.equal(empty.soldShare, 0);
  assert.deepEqual(empty.notes, []);
});

test("estoque antigo sem lote sai primeiro, e a venda não é atribuída ao lote novo", () => {
  const { byBatch } = allocateBatches({
    entries: [
      entry({ movementId: 1, batchId: NO_BATCH, quantity: 3, unitCostCents: null, date: "2026-02-01" }),
      entry({ movementId: 2, batchId: 1, quantity: 10, date: "2026-03-01" }),
    ],
    sales: [sale({ quantity: 4, revenueCents: 10000, date: "2026-03-05" })],
  });
  assert.equal(byBatch.get(NO_BATCH).sold[0].quantity, 3);
  assert.deepEqual(byBatch.get(1).sold.map((line) => [line.quantity, line.revenueCents]), [[1, 2500]]);
  assert.equal(byBatch.get(1).left[0].quantity, 9);
});

test("peça que saiu sem venda vira perda, e venda de peça sem custo fica fora do lucro", () => {
  const entries = [
    entry({ movementId: 1, productId: 7, quantity: 10, unitCostCents: 2000 }),
    entry({ movementId: 2, productId: 8, quantity: 5, unitCostCents: null }),
  ];
  const { byBatch } = allocateBatches({
    entries,
    sales: [
      sale({ orderId: 1, orderNumber: "OS-EX-1", productId: 7, quantity: 2, revenueCents: 5000 }),
      sale({ orderId: 1, orderNumber: "OS-EX-1", productId: 8, quantity: 1, revenueCents: 900 }),
      sale({ orderId: 2, orderNumber: "OS-EX-2", productId: 8, quantity: 2, revenueCents: 1800 }),
    ],
    outs: [{ productId: 7, quantity: 3, date: "2026-03-06" }],
  });
  const study = batchStudy({
    entries,
    allocation: byBatch.get(1),
    products: [{ id: 7, code: "PF-AA-1", priceCents: 2500 }, { id: 8, code: "PF-BB-1", priceCents: 900 }],
    targetRate: 0.1,
    format,
  });
  assert.equal(study.soldQty, 5);
  // "já vendido" e "lucro já feito" contam as mesmas peças: só as que têm custo
  assert.equal(study.soldRevenueCents, 5000);
  assert.equal(study.uncostedRevenueCents, 2700);
  assert.equal(study.realizedCents, 1000);
  assert.deepEqual(study.orders.map((row) => [row.orderNumber, row.quantity, row.profitCents, row.uncostedQty]), [["OS-EX-2", 2, null, 2], ["OS-EX-1", 3, 1000, 1]]);
  assert.equal(study.lostQty, 3);
  assert.equal(study.lostCostCents, 6000);
  // 1000 já feito + 5 x 500 em estoque − 6000 de perda
  assert.equal(study.expectedStockCents, 2500);
  assert.equal(study.totalCents, -2500);
  const texts = study.notes.map((note) => note.text);
  assert.ok(texts.includes("3 peças saíram do estoque sem venda: perda de R$ 60,00."));
  assert.ok(texts.includes("R$ 27,00 vendidos de peças sem custo ficaram fora do lucro."));
});

test("peça com OS entregue ou na fila fica travada no lote", () => {
  const lines = [
    { productId: 7, date: "2026-03-05", status: "entregue" },
    { productId: 8, date: "2026-02-20", status: "entregue" },
    { productId: 9, date: "2026-02-20", status: "fila" },
    { productId: 99, date: "2026-03-05", status: "entregue" },
  ];
  // entregue antes da data do lote não trava; na fila trava sempre; peça de fora do lote não conta
  assert.deepEqual([...lockedBatchProducts("2026-03-01", [7, 8, 9, 10], lines)].sort(), [7, 9]);

  const current = [
    { productId: 7, quantity: 10, unitCostCents: 2000 },
    { productId: 10, quantity: 5, unitCostCents: 1000 },
  ];
  const next = (items, purchaseDate = "2026-03-01") => ({ supplier: "Fornecedor Y", purchaseDate, notes: "", items });
  const check = (nextInput) => assertBatchChangeAllowed({ purchaseDate: "2026-03-01", current, next: nextInput, lines, codeOf: (id) => `PF-${id}` });

  // peça livre pode mudar ou sair; a travada precisa ficar igual
  check(next([{ productId: 7, quantity: 10, unitCostCents: 2000 }, { productId: 10, quantity: 8, unitCostCents: 1200 }]));
  check(next([{ productId: 7, quantity: 10, unitCostCents: 2000 }]));
  assert.throws(() => check(next([{ productId: 7, quantity: 9, unitCostCents: 2000 }])), /PF-7 já tem OS entregue ou na fila/);
  assert.throws(() => check(next([{ productId: 7, quantity: 10, unitCostCents: 2100 }])), /PF-7 já tem OS/);
  assert.throws(() => check(next([{ productId: 10, quantity: 5, unitCostCents: 1000 }])), /PF-7 já tem OS/);
  assert.throws(() => check(next([{ productId: 7, quantity: 10, unitCostCents: 2000 }], "2026-02-01")), /data da compra não pode mudar/);
  assert.throws(() => check(null), /não pode ser excluído/);
  assert.throws(() => check(null), PurchaseBatchError);

  // lote sem OS: tudo liberado, inclusive excluir
  assertBatchChangeAllowed({ purchaseDate: "2026-03-01", current, next: null, lines: [], codeOf: (id) => `PF-${id}` });
});

test("lançamento de lote valida fornecedor, data e peças", () => {
  const ok = { supplier: " Fornecedor Y ", purchaseDate: "2026-03-01", items: [{ productId: 7, quantity: 10, unitCostCents: 2000.4 }, { productId: 8, quantity: 0, unitCostCents: 0 }] };
  assert.deepEqual(parsePurchaseBatch(ok, "2026-03-10"), {
    supplier: "Fornecedor Y",
    purchaseDate: "2026-03-01",
    notes: "",
    items: [{ productId: 7, quantity: 10, unitCostCents: 2000 }],
  });
  assert.throws(() => parsePurchaseBatch({ ...ok, supplier: " " }, "2026-03-10"), PurchaseBatchError);
  assert.throws(() => parsePurchaseBatch({ ...ok, purchaseDate: "2026-03-11" }, "2026-03-10"), /futuro/);
  assert.throws(() => parsePurchaseBatch({ ...ok, items: [] }, "2026-03-10"), /pelo menos uma peça/);
  assert.throws(() => parsePurchaseBatch({ ...ok, items: [{ productId: 7, quantity: 2, unitCostCents: 0 }] }, "2026-03-10"), /custo pago/);
  assert.throws(() => parsePurchaseBatch({ ...ok, items: [{ productId: 7, quantity: 2.5, unitCostCents: 100 }] }, "2026-03-10"), /inteiro/);
  assert.throws(
    () => parsePurchaseBatch({ ...ok, items: [{ productId: 7, quantity: 2, unitCostCents: 100 }, { productId: 7, quantity: 1, unitCostCents: 100 }] }, "2026-03-10"),
    /uma vez/,
  );
  assert.throws(() => parsePurchaseBatch(null, "2026-03-10"), PurchaseBatchError);
});

test("tela de estoque lista os lotes e abre o estudo; API grava nos dois caminhos de banco", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const page = read("../app/page.tsx");
  const api = read("../app/api/stock/route.ts");
  for (const text of ['["financial-batches", "Lotes de compra"]', 'screen === "financial-batches" && (', 'page pageLabel="" backLabel="Lotes de compra" close={() => setViewingBatchId(null)}', "batchStudies.get(batch.id)", "allocateBatches({ entries, sales, outs })", "batchId: Number(movement.batchId) || NO_BATCH", "discounted: grossCents - totalCents > items.length", "de nenhum lote, porque a venda passou do estoque lançado", "Lucro esperado do lote", "Pontos de atenção", "Dinheiro do lote"])
    assert.ok(page.includes(text), text);
  assert.ok(api.includes('supabaseInsert<Record<string, unknown>>("purchase_batches"'));
  assert.ok(api.includes(".insert(purchaseBatches)"));
  assert.ok(api.includes('(body as { type?: unknown }).type === "batch"'));
  const migration = read("../supabase/migrations/20261113070000_purchase_batches.sql");
  assert.ok(/create table if not exists public\.purchase_batches/i.test(migration));
  assert.ok(/revoke all on public\.purchase_batches from anon, authenticated/i.test(migration));
  assert.ok(/add column if not exists batch_id/i.test(migration));
  assert.ok(/check \(unit_cost_cents is null or unit_cost_cents > 0\)/i.test(migration));
  // lote não fica pela metade nem vazio, e o limite de lançamentos não corta peça de lote
  assert.ok(api.includes('await supabaseDelete("purchase_batches", { id: `eq.${batchId}` }).catch(() => undefined);'));
  assert.ok(api.includes('if (!rest.length) await supabaseDelete("purchase_batches", { id: `eq.${batchId}` });'));
  assert.ok(api.includes('batch_id: "not.is.null"'));
  // lançar, editar e excluir lote pela tela, nos dois caminhos de banco
  for (const text of ["＋ Lançar lote", "Editar lote", "Excluir lote", 'method: batchForm.id ? "PUT" : "POST"', "JSON.stringify({ batchId: batch.id })", "Para tirar uma peça do lote, apague a quantidade dela."])
    assert.ok(page.includes(text), text);
  assert.ok(api.includes("export async function PUT(request: Request)"));
  assert.ok(api.includes("notInArray(stockMovements.productId, input.items.map((item) => item.productId))"));
  assert.ok(api.includes('await supabaseDelete("stock_movements", { batch_id: `eq.${id}` });'));
  assert.ok(api.includes("if (body.batchId !== undefined) {"));
  // a trava de peça com OS vale na tela e também na API
  assert.ok(api.includes("await assertBatchChange(id, input);"));
  assert.ok(api.includes("await assertBatchChange(id, null);"));
  assert.ok(page.includes("readOnly={locked.has(product.id)}"));
  // trocar de menu fecha o lote aberto em página
  const goBlock = page.slice(page.indexOf("function go(next: Screen) {"), page.indexOf("setScreen(next);"));
  assert.ok(goBlock.includes("setViewingBatchId(null);") && goBlock.includes("setBatchForm(null);"));
  assert.ok(page.includes("disabled={saving || lockedPiecesOf(batch).size > 0}"));
});
