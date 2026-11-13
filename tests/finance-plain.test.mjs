import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activePeriod,
  daysBetween,
  fabricationCategoryIds,
  leftSentence,
  overdueSentence,
  payableSentence,
  periodMonth,
  pieceResultLabel,
  plainResult,
  preferredFabricationCategoryId,
  splitPaidExpenses,
} from "../lib/finance-plain.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/page.tsx");
const migration = read("../supabase/migrations/20261112010000_fabrication_cost_category.sql");
const money = (value) => `R$ ${value.toFixed(2).replace(".", ",")}`;

const categories = [
  { id: 1, name: "Materia-prima", type: "saida", active: true },
  { id: 4, name: "Manutencao", type: "saida", active: true },
  { id: 20, name: "Custo de fabricação", type: "saida", active: true },
];

test("gasto de fabricação é reconhecido pela categoria, com ou sem acento", () => {
  assert.deepEqual(fabricationCategoryIds(categories), [1, 20]);
  assert.equal(preferredFabricationCategoryId(categories), 20);
  assert.equal(preferredFabricationCategoryId(categories.slice(0, 2)), 1);
  assert.equal(preferredFabricationCategoryId([categories[1]]), null);
});

test("contas pagas de fabricação não entram de novo no gasto", () => {
  const split = splitPaidExpenses(
    [
      { amountCents: 50000, status: "Pago", categoryId: 20 },
      { amountCents: 20000, status: "Pago", categoryId: 1 },
      { amountCents: 9000, status: "Pago", categoryId: 4 },
      { amountCents: 4000, status: "Pago", categoryId: null },
      { amountCents: 7000, status: "Pendente", categoryId: 4 },
    ],
    [1, 20],
  );
  assert.deepEqual(split, { fabricationCents: 70000, otherCents: 13000, totalCents: 83000 });
});

test("quanto sobrou é venda menos custo das peças menos outras contas", () => {
  const result = plainResult({ salesCents: 100000, receivedCents: 40000, pieceCostCents: 70000, otherExpensesCents: 13000 });
  assert.equal(result.spentCents, 83000);
  assert.equal(result.leftCents, 17000);
  assert.equal(result.toReceiveCents, 60000);
  assert.equal(result.leftPer100Cents, 1700);
  assert.equal(leftSentence(result.leftPer100Cents, money), "De cada R$ 100 vendidos, sobraram R$ 17,00.");

  const loss = plainResult({ salesCents: 100000, receivedCents: 100000, pieceCostCents: 90000, otherExpensesCents: 25000 });
  assert.equal(loss.leftCents, -15000);
  assert.equal(leftSentence(loss.leftPer100Cents, money), "De cada R$ 100 vendidos, faltaram R$ 15,00.");

  const empty = plainResult({ salesCents: 0, receivedCents: 0, pieceCostCents: 0, otherExpensesCents: 5000 });
  assert.equal(empty.leftPer100Cents, null);
  assert.equal(leftSentence(empty.leftPer100Cents, money), "Nenhuma venda entregue neste período.");
});

test("período vira mês e volta", () => {
  assert.equal(periodMonth("this", "2026-11-12"), "2026-11");
  assert.equal(periodMonth("last", "2026-11-12"), "2026-10");
  assert.equal(periodMonth("last", "2027-01-05"), "2026-12");
  assert.equal(periodMonth("all", "2026-11-12"), "");
  assert.equal(activePeriod("", "2026-11-12"), "all");
  assert.equal(activePeriod("2026-11", "2026-11-12"), "this");
  assert.equal(activePeriod("2026-10", "2026-11-12"), "last");
  assert.equal(activePeriod("2026-06", "2026-11-12"), null);
});

test("frases de pendência falam em dias, hoje e amanhã", () => {
  assert.equal(daysBetween("2026-11-01", "2026-11-12"), 11);
  assert.equal(daysBetween("2026-11-12", "2026-11-09"), -3);
  assert.equal(overdueSentence("Oficina A", "R$ 100,00", 12), "Oficina A está devendo R$ 100,00 há 12 dias.");
  assert.equal(overdueSentence("Oficina A", "R$ 100,00", 1), "Oficina A está devendo R$ 100,00 há 1 dia.");
  assert.equal(payableSentence("Fornecedor B", "R$ 50,00", 3), "A conta de Fornecedor B, de R$ 50,00, vence em 3 dias.");
  assert.equal(payableSentence("Fornecedor B", "R$ 50,00", 1), "A conta de Fornecedor B, de R$ 50,00, vence amanhã.");
  assert.equal(payableSentence("Fornecedor B", "R$ 50,00", 0), "A conta de Fornecedor B, de R$ 50,00, vence hoje.");
  assert.equal(payableSentence("Fornecedor B", "R$ 50,00", -2), "A conta de Fornecedor B, de R$ 50,00, venceu há 2 dias.");
});

test("resultado de cada peça em palavras", () => {
  assert.equal(pieceResultLabel(12050, money), "sobrou R$ 120,50");
  assert.equal(pieceResultLabel(-800, money), "perdeu R$ 8,00");
  assert.equal(pieceResultLabel(null, money), "falta cadastrar o custo");
});

test("tela usa linguagem simples e não os termos técnicos antigos", () => {
  for (const text of ["Quanto vendi", "Quanto gastei", "Quanto sobrou", "Precisa da sua atenção", "Suas peças: onde você ganha e onde perde", "Gasto para fabricar peça"])
    assert.ok(page.includes(text), text);
  const start = page.indexOf('title="Financeiro"');
  const end = page.indexOf('<section className="financial-layout">', start);
  const block = page.slice(start, end);
  for (const text of ["Taxa de recebimento", "Ticket médio", "RESULTADO DO PERÍODO", "Lucro sobre o custo"])
    assert.equal(block.includes(text), false, text);
  assert.ok(page.includes("splitPaidExpenses(payableRows, fabricationIds)"));
});

test("migration cria a categoria sem duplicar", () => {
  assert.ok(migration.includes("'Custo de fabricacao'"));
  assert.ok(/on conflict/i.test(migration));
});

test("conta pendente pode ser editada, inclusive a marcação de fabricação", () => {
  assert.ok(page.includes('editingPayable ? "Editar conta a pagar" : "Cadastrar conta a pagar"'));
  assert.ok(page.includes('{ entity: "accountsPayable", id: editingPayable.id, ...fields, ...categoryChange }'));
  assert.ok(page.includes("onClick={() => openPayableForm(payable)}"));
  assert.ok(page.includes('type="checkbox"\n                  name="isFabrication"'));
  assert.ok(page.includes("!isFabrication && wasFabrication ? { categoryId: null }"));
});
