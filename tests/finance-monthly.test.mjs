import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FORECAST_MIN_DAYS,
  barHeights,
  dedupeReceipts,
  divergingBars,
  forecastCurrentMonth,
  monthRange,
  monthlyCash,
  monthlyResult,
  needsInitialReceipt,
  shortMonth,
  trustedCents,
} from "../lib/finance-monthly.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/page.tsx");
const financeLib = read("../lib/finance.ts");
const financeApi = read("../app/api/finance/route.ts");

test("meses seguem em sequência, sem buracos, inclusive na virada do ano", () => {
  assert.deepEqual(monthRange("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthRange("2026-05", "2026-05"), ["2026-05"]);
  assert.deepEqual(monthRange("2026-06", "2026-05"), []);
  assert.equal(shortMonth("2026-06"), "jun/26");
});

test("lucro do mês é o que foi vendido menos todas as contas pagas no mês", () => {
  const rows = monthlyResult(
    [
      { month: "2026-01", revenueCents: 100000 },
      { month: "2026-01", revenueCents: 20000 },
      { month: "2026-03", revenueCents: 50000 },
    ],
    [
      { month: "2026-01", amountCents: 40000, paid: true, isFabrication: true },
      { month: "2026-01", amountCents: 10000, paid: true, isFabrication: false },
      { month: "2026-02", amountCents: 8000, paid: true, isFabrication: false },
      { month: "2026-03", amountCents: 9000, paid: false, isFabrication: false },
    ],
    "2026-04",
  );
  assert.deepEqual(rows.map((row) => row.month), ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(rows.map((row) => row.leftCents), [70000, -8000, 50000, 0]);
  assert.deepEqual(rows.map((row) => row.accumulatedCents), [70000, 62000, 112000, 112000]);
  assert.equal(rows[0].spentCents, 50000);
  assert.equal(rows[0].fabricationCents, 40000);
  assert.equal(rows[0].otherCents, 10000);
});

test("recebimento repetido da mesma OS conta uma vez só", () => {
  const receipts = [
    { id: 9, serviceOrderId: 1, receiptDate: "2026-01-10", amountCents: 30000, status: "Confirmado", legacySourceKey: "service_order:1:initial_receipt" },
    { id: 1, serviceOrderId: 1, receiptDate: "2026-02-03", amountCents: 30000, status: "Confirmado", legacySourceKey: null },
    { id: 6, serviceOrderId: 2, receiptDate: "2026-01-15", amountCents: 20000, status: "Confirmado", legacySourceKey: "service_order:2:initial_receipt" },
    { id: 3, serviceOrderId: 2, receiptDate: "2026-02-12", amountCents: 20000, status: "Confirmado", legacySourceKey: "" },
    { id: 7, serviceOrderId: 3, receiptDate: "2026-01-20", amountCents: 5000, status: "Confirmado", legacySourceKey: "service_order:3:initial_receipt" },
    { id: 8, serviceOrderId: 3, receiptDate: "2026-02-20", amountCents: 7000, status: "Confirmado", legacySourceKey: null },
    { id: 10, serviceOrderId: 4, receiptDate: "2026-02-21", amountCents: 9000, status: "Estornado", legacySourceKey: null },
  ];
  const kept = dedupeReceipts(receipts, { 1: 30000, 2: 19000, 3: 12000, 4: 0 });
  assert.deepEqual(kept.map((receipt) => [receipt.id, receipt.amountCents]), [[7, 5000], [1, 30000], [3, 19000], [8, 7000]]);
  assert.equal(receipts[3].amountCents, 20000);
});

test("caixa do mês é o que entrou menos o que saiu, com saldo acumulado", () => {
  const rows = monthlyCash(
    [
      { id: 1, serviceOrderId: 1, receiptDate: "2026-02-03", amountCents: 30000, status: "Confirmado" },
      { id: 2, serviceOrderId: 2, receiptDate: "2026-03-09", amountCents: 12000, status: "Confirmado" },
    ],
    [
      { month: "2026-01", amountCents: 7000, paid: true, isFabrication: false },
      { month: "2026-03", amountCents: 40000, paid: true, isFabrication: true },
      { month: "2026-03", amountCents: 5000, paid: false, isFabrication: false },
    ],
    "2026-03",
  );
  assert.deepEqual(rows.map((row) => row.netCents), [-7000, 30000, -28000]);
  assert.deepEqual(rows.map((row) => row.balanceCents), [-7000, 23000, -5000]);
});

test("previsão mantém o ritmo das vendas e soma ao gasto as contas a vencer", () => {
  const row = { month: "2026-04", salesCents: 60000, fabricationCents: 48000, otherCents: 5000, spentCents: 53000, leftCents: 7000, accumulatedCents: 0 };
  assert.deepEqual(forecastCurrentMonth(row, "2026-04-10", 3000), {
    day: 10,
    daysInMonth: 30,
    salesCents: 180000,
    spentCents: 56000,
    leftCents: 124000,
  });
  assert.equal(forecastCurrentMonth(row, "2026-04-30", 0), null);
  assert.equal(FORECAST_MIN_DAYS, 5);
  assert.equal(forecastCurrentMonth(row, "2026-04-04", 0), null);
  assert.notEqual(forecastCurrentMonth(row, "2026-04-05", 0), null);
  assert.equal(forecastCurrentMonth({ ...row, salesCents: 0 }, "2026-04-10", 0), null);
  assert.equal(forecastCurrentMonth(undefined, "2026-04-10", 0), null);
});

test("barras dividem a altura entre lucro e prejuízo", () => {
  const bars = divergingBars([300, -100, 0], 160);
  assert.equal(bars.positiveArea, 120);
  assert.equal(bars.negativeArea, 40);
  assert.deepEqual(bars.heights, [120, 40, 0]);
  assert.deepEqual(divergingBars([0, 0], 160).heights, [0, 0]);
  assert.deepEqual(barHeights([200, 50, 0, 1], 100), [100, 25, 0, 2]);
});

test("financeiro tem submenus e telas de lucro e caixa mês a mês", () => {
  for (const text of ['"financial-monthly"', '"financial-cash"', '"financial-payables"', "Lucro mês a mês", "Caixa mês a mês", "monthlyResult(", "monthlyCash(", "dedupeReceipts("])
    assert.ok(page.includes(text), text);
});

test("recebimento automático só nasce para OS com valor recebido e sem recebimento", () => {
  assert.equal(needsInitialReceipt({ receivedCents: 5000, hasReceivable: true, alreadyHasReceipt: false }), true);
  assert.equal(needsInitialReceipt({ receivedCents: 5000, hasReceivable: true, alreadyHasReceipt: true }), false);
  assert.equal(needsInitialReceipt({ receivedCents: 0, hasReceivable: true, alreadyHasReceipt: false }), false);
  assert.equal(needsInitialReceipt({ receivedCents: 5000, hasReceivable: false, alreadyHasReceipt: false }), false);
  assert.ok(financeLib.includes("needsInitialReceipt({ receivedCents, hasReceivable: true, alreadyHasReceipt: ordersWithReceipt.has(order.id) })"));
  assert.ok(financeLib.includes("ordersWithReceipt.add(order.id)"));
});

test("resumo e telas mês a mês usam a mesma regra de mês e de caixa", () => {
  assert.ok(page.includes("payableMonth(payable) === financialMonth"));
  assert.ok(page.includes("month: payableMonth(payable),"));
  assert.ok(page.includes("<b>{money(periodCashIn / 100)}</b>"));
  assert.ok(page.includes("<b>{money(periodCashOut / 100)}</b>"));
  assert.equal(page.split("dayInSaoPaulo(order.createdAt)").length - 1, 1);
});

test("financeiro carrega o histórico até o teto e avisa quando corta", () => {
  assert.equal(financeApi.includes(".limit(300)"), false);
  assert.equal(financeApi.includes('limit: "300"'), false);
  assert.equal(financeApi.split("historyTruncated: receiptRows.length >= HISTORY_LIMIT").length - 1, 2);
  assert.ok(page.includes("financeData.historyTruncated"));
});

test("valor da OS em centavos segue o valor em reais quando os dois divergem", () => {
  assert.equal(trustedCents(100.8, 10080), 10080);
  assert.equal(trustedCents(100.8, 4990), 10080);
  assert.equal(trustedCents(100.8, 0), 10080);
  assert.equal(trustedCents(100.8, null), 10080);
  assert.equal(trustedCents(293.4, 29341), 29341);
  assert.equal(trustedCents(0, 0), 0);
  assert.equal(financeLib.includes("order.totalCents || toCents(order.total)"), false);
  assert.ok(financeLib.includes("trustedCents(order.total, order.totalCents)"));
  assert.ok(financeApi.includes("trustedCents(order.total, order.total_cents)"));
});

test("tela inicial lista todas as OS em aberto, da que vence primeiro", () => {
  assert.equal(page.includes("openReceivableRows.slice(0, 6)"), false);
  assert.ok(page.includes("dateTimestamp(a.dueDate) - dateTimestamp(b.dueDate) || a.receivable.id - b.receivable.id"));
});
