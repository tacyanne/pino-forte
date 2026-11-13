import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countLabel, openHint, payableKpis, wholePercent } from "../lib/payable-kpis.ts";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const money = (value) => `R$ ${value.toFixed(2).replace(".", ",")}`;

const rows = [
  { supplier: "Fornecedor A", amountCents: 50000, status: "Pago", dueDate: "2026-03-01", categoryId: 20 },
  { supplier: "Fornecedor A", amountCents: 30000, status: "Pendente", dueDate: "2026-03-20", categoryId: 20 },
  { supplier: "Fornecedor B", amountCents: 12000, status: "Pago", dueDate: "2026-03-05", categoryId: 4 },
  { supplier: "Fornecedor C", amountCents: 8000, status: "Pendente", dueDate: "2026-03-08", categoryId: null },
  { supplier: " ", amountCents: 5000, status: "Pendente", dueDate: "2026-04-30", categoryId: null },
  { supplier: "Fornecedor D", amountCents: 99900, status: "Cancelado", dueDate: "2026-03-01", categoryId: null },
];

test("totais separam pago, a pagar, atraso e vencimento próximo", () => {
  const kpis = payableKpis(rows, [1, 20], "2026-03-15");
  assert.equal(kpis.totalCents, 105000);
  assert.equal(kpis.count, 5);
  assert.equal(kpis.paidCents, 62000);
  assert.equal(kpis.paidCount, 2);
  assert.equal(kpis.openCents, 43000);
  assert.equal(kpis.openCount, 3);
  assert.equal(kpis.overdueCents, 8000);
  assert.equal(kpis.dueSoonCents, 30000);
  assert.equal(kpis.paidCents + kpis.openCents, kpis.totalCents);
});

test("gasto de fabricação e outras contas somam o total", () => {
  const kpis = payableKpis(rows, [1, 20], "2026-03-15");
  assert.equal(kpis.fabricationCents, 80000);
  assert.equal(kpis.otherCents, 25000);
  assert.equal(kpis.fabricationCents + kpis.otherCents, kpis.totalCents);
  assert.equal(wholePercent(kpis.fabricationShare), "76%");
  assert.equal(wholePercent(payableKpis([], [], "2026-03-15").fabricationShare), "—");
});

test("fornecedores vêm do maior para o menor, somando as contas de cada um", () => {
  const kpis = payableKpis(rows, [1, 20], "2026-03-15");
  assert.deepEqual(kpis.suppliers, [
    { supplier: "Fornecedor A", totalCents: 80000, count: 2 },
    { supplier: "Fornecedor B", totalCents: 12000, count: 1 },
    { supplier: "Fornecedor C", totalCents: 8000, count: 1 },
    { supplier: "Sem fornecedor", totalCents: 5000, count: 1 },
  ]);
});

test("frase do cartão A pagar destaca atraso antes de vencimento próximo", () => {
  assert.equal(openHint({ openCount: 3, overdueCents: 8000, dueSoonCents: 30000 }, money), "R$ 80,00 em atraso");
  assert.equal(openHint({ openCount: 2, overdueCents: 0, dueSoonCents: 30000 }, money), "R$ 300,00 vencem em até 7 dias");
  assert.equal(openHint({ openCount: 1, overdueCents: 0, dueSoonCents: 0 }, money), "1 conta no prazo");
  assert.equal(openHint({ openCount: 0, overdueCents: 0, dueSoonCents: 0 }, money), "Nenhuma conta em aberto");
  assert.equal(countLabel(4), "4 contas");
});

test("tela de contas a pagar mostra indicadores e total da lista", () => {
  for (const text of ["payableKpis(payableRows, fabricationIds, todayIso())", "Total de contas", "Já pago", "Para fabricar peça", "Outras contas", "Para quem foi o dinheiro", "payable-total"])
    assert.ok(page.includes(text), text);
});
