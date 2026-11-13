import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activePeriod,
  allocateSpent,
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

test("contas pagas são separadas entre fabricação e outras", () => {
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

test("quanto sobrou é venda menos as contas pagas (fabricação e outras)", () => {
  const result = plainResult({ salesCents: 100000, receivedCents: 40000, fabricationCents: 70000, otherExpensesCents: 13000 });
  assert.equal(result.spentCents, 83000);
  assert.equal(result.leftCents, 17000);
  assert.equal(result.toReceiveCents, 60000);
  assert.equal(result.leftPer100Cents, 1700);
  assert.equal(leftSentence(result.leftPer100Cents, money), "De cada R$ 100 vendidos, sobraram R$ 17,00.");

  const loss = plainResult({ salesCents: 100000, receivedCents: 100000, fabricationCents: 90000, otherExpensesCents: 25000 });
  assert.equal(loss.leftCents, -15000);
  assert.equal(leftSentence(loss.leftPer100Cents, money), "De cada R$ 100 vendidos, faltaram R$ 15,00.");

  const empty = plainResult({ salesCents: 0, receivedCents: 0, fabricationCents: 0, otherExpensesCents: 5000 });
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
  for (const text of ["Quanto vendi", "Quanto gastei", "Quanto sobrou", "Peças vendidas", "Gasto para fabricar peça"])
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

test("lista de contas mostra data da compra, vencimento e forma em colunas separadas", () => {
  assert.ok(page.includes('data-label="Data da compra"'));
  assert.ok(page.includes('data-label="Vencimento"'));
  assert.ok(page.includes('data-label="Forma"'));
  assert.ok(page.includes('name="purchaseDate"'));
  const api = readFileSync(new URL("../app/api/finance/route.ts", import.meta.url), "utf8");
  assert.equal(api.split("purchaseDateFromBody(body.purchaseDate)").length - 1, 4);
  assert.ok(read("../supabase/migrations/20261112020000_payable_purchase_date.sql").includes("add column if not exists purchase_date"));
  assert.equal(page.includes("${brDate(payable.paidAt)}${payable.paymentMethod ?"), false);
});

test("resumo executivo: resultado em destaque, quatro indicadores e caixa", () => {
  for (const text of ["summaryPeriodLabel", "<span>A receber</span>", "<span>A pagar</span>", "Entrou no caixa", "Saiu do caixa", "Saldo do caixa", "openHint(openPayableTotals, money)"])
    assert.ok(page.includes(text), text);
  assert.equal(page.includes('className="plain-summary"'), false);
  assert.equal(page.includes("Dinheiro que entrou e saiu:"), false);
});

test("resumo mostra as peças vendidas em barras, sem pendências nem estimativa de lucro", () => {
  const start = page.indexOf('title={screen === "financial-monthly"');
  const end = page.indexOf('{screen === "financial-payables" && (', start);
  const block = page.slice(start, end);
  assert.ok(block.includes("<h2>Peças vendidas</h2>"));
  assert.ok(block.includes("y.revenueCents - x.revenueCents"));
  assert.ok(block.includes("em outras contas`}</small>"));
  for (const text of ["Precisa da sua atenção", "Suas peças: onde você ganha", "Deu mais lucro", "A receber hoje", "A pagar hoje"])
    assert.equal(block.includes(text), false, text);
});

test("resultado usa as contas pagas, e não o custo estimado das peças", () => {
  assert.ok(page.includes("fabricationCents: paidSplit.fabricationCents"));
  assert.equal(page.includes("pieceCostCents: salesProfit.costCents"), false);
  assert.ok(page.includes("para fabricar peça`}</small>"));
});

test("barra de cada peça é dividida em custo e lucro, com os valores escritos", () => {
  for (const text of ['className="piece-cost"', 'className="piece-profit"', '"prejuízo" : "lucro"', "allocateSpent(pieces, plain.spentCents)", "custo = contas pagas no período, divididas entre as peças"])
    assert.ok(page.includes(text), text);
  assert.equal(page.includes("sem custo cadastrado"), false);
});

test("contas pagas são divididas entre as peças pelo custo cadastrado, sem sobrar centavo", () => {
  const pieces = [
    { key: "A", revenueCents: 100000, costCents: 60000 },
    { key: "B", revenueCents: 50000, costCents: 30000 },
    { key: "C", revenueCents: 30000, costCents: 10000 },
  ];
  const shares = allocateSpent(pieces, 50000);
  assert.deepEqual([...shares.entries()], [["A", 30000], ["B", 15000], ["C", 5000]]);

  // arredondamento: a soma sempre fecha no total pago
  const odd = allocateSpent(pieces, 10001);
  assert.equal([...odd.values()].reduce((sum, value) => sum + value, 0), 10001);

  // peça sem custo cadastrado entra pelo valor vendido, na proporção das demais (60%)
  const mixed = allocateSpent(
    [
      { key: "A", revenueCents: 100000, costCents: 60000 },
      { key: "D", revenueCents: 50000, costCents: null },
    ],
    9000,
  );
  assert.deepEqual([...mixed.entries()], [["A", 6000], ["D", 3000]]);

  // nenhuma peça com custo: divide pelo valor vendido
  const noCost = allocateSpent(
    [
      { key: "A", revenueCents: 30000, costCents: null },
      { key: "B", revenueCents: 10000, costCents: null },
    ],
    8000,
  );
  assert.deepEqual([...noCost.entries()], [["A", 6000], ["B", 2000]]);

  assert.equal(allocateSpent([], 5000).size, 0);
  assert.deepEqual([...allocateSpent(pieces, 0).values()], [0, 0, 0]);
});
