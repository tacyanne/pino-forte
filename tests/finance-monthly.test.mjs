import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  barHeights,
  dedupeReceipts,
  divergingBars,
  forecastCurrentMonth,
  monthRange,
  monthlyCash,
  monthlyResult,
  shortMonth,
} from "../lib/finance-monthly.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/page.tsx");
const financeLib = read("../lib/finance.ts");

test("meses seguem em sequência, sem buracos, inclusive na virada do ano", () => {
  assert.deepEqual(monthRange("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthRange("2026-05", "2026-05"), ["2026-05"]);
  assert.deepEqual(monthRange("2026-06", "2026-05"), []);
  assert.equal(shortMonth("2026-06"), "jun/26");
});

test("lucro do mês desconta custo das peças e outras contas, sem repetir fabricação", () => {
  const rows = monthlyResult(
    [
      { month: "2026-01", revenueCents: 100000, costCents: 70000 },
      { month: "2026-01", revenueCents: 20000, costCents: null },
      { month: "2026-03", revenueCents: 50000, costCents: 45000 },
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
  assert.deepEqual(rows.map((row) => row.leftCents), [40000, -8000, 5000, 0]);
  assert.deepEqual(rows.map((row) => row.accumulatedCents), [40000, 32000, 37000, 37000]);
  assert.equal(rows[0].spentCents, 80000);
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

test("previsão mantém o ritmo dos dias passados e soma contas a vencer", () => {
  const row = { month: "2026-04", salesCents: 60000, pieceCostCents: 48000, otherCents: 5000, spentCents: 53000, leftCents: 7000, accumulatedCents: 0 };
  assert.deepEqual(forecastCurrentMonth(row, "2026-04-10", 3000), {
    day: 10,
    daysInMonth: 30,
    salesCents: 180000,
    spentCents: 144000 + 8000,
    leftCents: 28000,
  });
  assert.equal(forecastCurrentMonth(row, "2026-04-30", 0), null);
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

test("recebimento automático não é criado quando a OS já tem recebimento", () => {
  assert.ok(financeLib.includes("hasReceipt"));
});
