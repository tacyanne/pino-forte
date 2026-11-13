import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDashboardActions, daysFrom, forecastAhead, previousLabel, tightSentence } from "../lib/dashboard.ts";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const money = (value) => `R$ ${value.toFixed(2).replace(".", ",")}`;
const format = { money, brDate: (iso) => iso.split("-").reverse().join("/"), percent: (rate) => `${Math.round(rate * 1000) / 10}%`.replace(".", ",") };
const today = "2026-03-10";

const receivable = (values) => ({ key: "1", orderId: 1, orderNumber: "OS-EX-1", customerName: "Cliente A", installmentLabel: "", dueDate: today, balanceCents: 10000, ...values });
const base = { today, receivables: [], payables: [], stock: [], pieces: [], targetRate: 0.35, format };

test("dias até uma data", () => {
  assert.equal(daysFrom("2026-03-10", "2026-03-17"), 7);
  assert.equal(daysFrom("2026-03-10", "2026-03-08"), -2);
  assert.equal(daysFrom("2026-02-27", "2026-03-01"), 2);
});

test("sem nada vencendo nem travando, a lista fica vazia", () => {
  assert.deepEqual(buildDashboardActions(base), []);
  assert.deepEqual(
    buildDashboardActions({
      ...base,
      receivables: [receivable({ dueDate: "2026-03-18" }), receivable({ key: "2", balanceCents: 0 })],
      payables: [{ id: 1, supplier: "Fornecedor X", dueDate: "2026-03-18", amountCents: 5000 }],
      stock: [{ code: "PF-AA-1", status: "ok", available: 10, missing: 0, monthlyPace: 2 }, { code: "PF-BB-1", status: "zerado", available: 0, missing: 0, monthlyPace: 0 }],
      pieces: [{ code: "PF-AA-1", onCost: 0.4 }],
    }),
    [],
  );
});

test("o que venceu vem primeiro; depois o que vence em até 7 dias", () => {
  const actions = buildDashboardActions({
    ...base,
    receivables: [
      receivable({ key: "a", dueDate: "2026-03-16", customerName: "Cliente B", orderNumber: "OS-EX-2" }),
      receivable({ key: "b", dueDate: "2026-03-08", installmentLabel: "Parcela 1/2" }),
      receivable({ key: "c", dueDate: "2026-03-11", customerName: "Cliente C", orderNumber: "OS-EX-3" }),
    ],
    payables: [
      { id: 7, supplier: "Fornecedor X", dueDate: "2026-03-10", amountCents: 4000 },
      { id: 8, supplier: "Fornecedor Y", dueDate: "2026-03-01", amountCents: 9000 },
    ],
  });
  assert.deepEqual(actions.map((action) => action.key), ["pagar-8", "receber-b", "pagar-7", "receber-c", "receber-a"]);
  assert.equal(actions[0].tone, "red");
  assert.equal(actions[0].title, "Pagar Fornecedor Y: R$ 90,00");
  assert.equal(actions[0].detail, "Venceu há 9 dias");
  assert.equal(actions[1].title, "Cobrar Cliente A: R$ 100,00");
  assert.equal(actions[1].detail, "OS-EX-1 · Parcela 1/2 venceu há 2 dias");
  assert.equal(actions[2].detail, "Vence hoje");
  assert.equal(actions[3].detail, "OS-EX-3 vence amanhã (11/03)");
  assert.equal(actions[4].title, "Receber de Cliente B: R$ 100,00");
  assert.equal(actions[4].detail, "OS-EX-2 vence em 6 dias (16/03)");
  assert.equal(actions[4].tone, "amber");
  assert.equal(actions[4].target, "order");
});

test("fila, estoque, margem e custo viram ações com destino certo", () => {
  const actions = buildDashboardActions({
    ...base,
    queue: [{ orderId: 5, orderNumber: "OS-EX-9", customerName: "Cliente D", totalCents: 25000, createdAt: "2026-03-07" }],
    stock: [
      { code: "PF-AA-1", status: "baixo", available: 2, missing: 0, monthlyPace: 4.3 },
      { code: "PF-BB-1", status: "falta", available: -3, missing: 3, monthlyPace: 1 },
      { code: "PF-CC-1", status: "zerado", available: 0, missing: 0, monthlyPace: 2 },
      { code: "PF-DD-1", status: "baixo", available: 1, missing: 0, monthlyPace: 5 },
      { code: "PF-EE-1", status: "zerado", available: 0, missing: 0, monthlyPace: 0 },
    ],
    pieces: [
      { code: "PF-AA-1", onCost: 0.1 },
      { code: "PF-BB-1", onCost: 0.031 },
      { code: "PF-CC-1", onCost: 0.5 },
      { code: "PF-DD-1", onCost: null },
    ],
  });
  const byKey = Object.fromEntries(actions.map((action) => [action.key, action]));
  assert.deepEqual(actions.map((action) => action.key), ["fila-5", "estoque-PF-BB-1", "estoque-PF-CC-1", "estoque-PF-DD-1", "estoque-mais", "margem", "sem-custo"]);
  assert.equal(byKey["fila-5"].title, "Entregar OS-EX-9: Cliente D");
  assert.equal(byKey["fila-5"].detail, "Na fila há 3 dias · R$ 250,00");
  assert.equal(byKey["estoque-PF-BB-1"].title, "Falta comprar 3 de PF-BB-1");
  assert.equal(byKey["estoque-PF-CC-1"].title, "PF-CC-1 está sem estoque");
  assert.equal(byKey["estoque-PF-DD-1"].title, "PF-DD-1 está acabando: 1 em estoque");
  assert.equal(byKey["estoque-PF-DD-1"].detail, "Vende 5 por mês · dura menos de 1 mês");
  assert.equal(byKey["estoque-mais"].title, "Mais 1 peça com estoque baixo ou zerado");
  assert.equal(byKey.margem.title, "2 peças com lucro abaixo da meta de 35%");
  assert.equal(byKey.margem.detail, "A menor: PF-BB-1, 3,1% sobre o custo");
  assert.equal(byKey.margem.target, "pricing");
  assert.equal(byKey["sem-custo"].title, "1 peça sem custo cadastrado");
  assert.equal(byKey["sem-custo"].target, "products");

  const loss = buildDashboardActions({ ...base, pieces: [{ code: "PF-AA-1", onCost: -0.05 }, { code: "PF-BB-1", onCost: 0.2 }] });
  assert.equal(loss[0].title, "1 peça dá prejuízo no preço atual");
  assert.equal(loss[0].tone, "red");
});

test("próximos 30 dias: a receber, a pagar, saldo e alerta de caixa apertado", () => {
  const ahead = forecastAhead({
    today,
    receivables: [
      receivable({ key: "a", orderId: 1, orderNumber: "OS-EX-1", dueDate: "2026-03-20", balanceCents: 50000 }),
      receivable({ key: "b", orderId: 2, orderNumber: "OS-EX-2", dueDate: "2026-03-05", balanceCents: 10000 }),
      receivable({ key: "c", orderId: 3, orderNumber: "OS-EX-3", dueDate: "2026-04-20", balanceCents: 70000 }),
    ],
    payables: [
      { id: 1, supplier: "Fornecedor Y", dueDate: "2026-03-20", amountCents: 42000, orderId: 1 },
      { id: 2, supplier: "Fornecedor X", dueDate: "2026-03-12", amountCents: 4000 },
      { id: 3, supplier: "Fornecedor Y", dueDate: "2026-05-01", amountCents: 9000, orderId: 3 },
    ],
  });
  assert.deepEqual(ahead, { inCents: 60000, outCents: 46000, balanceCents: 14000, tightCents: 42000, tightOrders: ["OS-EX-1"] });
  assert.equal(
    tightSentence(ahead, money),
    "Atenção: R$ 420,00 ao fornecedor vencem no mesmo dia ou antes de você receber a OS-EX-1. Se o cliente atrasar, falta caixa.",
  );

  const calm = forecastAhead({ today, receivables: [receivable({ dueDate: "2026-03-12" })], payables: [{ id: 1, supplier: "Fornecedor Y", dueDate: "2026-03-20", amountCents: 3000, orderId: 1 }] });
  assert.equal(calm.tightCents, 0);
  assert.equal(tightSentence(calm, money), "");

  const short = forecastAhead({ today, receivables: [], payables: [{ id: 1, supplier: "Fornecedor X", dueDate: "2026-03-12", amountCents: 3000 }] });
  assert.equal(tightSentence(short, money), "Atenção: nos próximos dias você tem mais a pagar do que a receber. Faltam R$ 30,00.");
  assert.equal(previousLabel("fevereiro", 32000, money), "fevereiro: R$ 320,00");
  assert.equal(previousLabel("fevereiro", null, money), "sem mês anterior");
});

test("tela inicial tem as três faixas e não repete o histórico mensal", () => {
  for (const text of ["Precisa de você hoje", "O que vem pela frente · próximos 30 dias", "Como estou em ${monthName(dashboardMonth)}", "Tudo em dia.", "buildDashboardActions({", "forecastAhead({ today, receivables, payables: pendingPayables })"])
    assert.ok(page.includes(text), text);
  for (const text of ["Histórico mensal", "dashboardHistory", "OS a Receber"]) assert.equal(page.includes(text), false, text);
  // sobrou com sinal, como o saldo previsto; no computador, "pela frente" vem acima de "como estou"
  assert.ok(page.includes('{`${leftCents < 0 ? "− " : "+ "}${money(Math.abs(leftCents) / 100)}`}'));
  assert.ok(page.indexOf("O que vem pela frente · próximos 30 dias") < page.indexOf("Como estou em ${monthName(dashboardMonth)}"));
});

test("lote que caminha para prejuízo ou está acabando vira ação do painel", () => {
  const actions = buildDashboardActions({
    ...base,
    batches: [
      { id: 1, supplier: "Fornecedor Y", totalCents: -4500, stockQty: 30, boughtQty: 80 },
      { id: 2, supplier: "Fornecedor Z", totalCents: 9000, stockQty: 4, boughtQty: 40 },
      { id: 3, supplier: "Fornecedor W", totalCents: 9000, stockQty: 30, boughtQty: 40 },
      { id: 4, supplier: "Fornecedor V", totalCents: 9000, stockQty: 0, boughtQty: 40 },
    ],
  });
  assert.deepEqual(actions.map((action) => action.key), ["lote-prejuizo-1", "lote-acabando-2"]);
  assert.equal(actions[0].title, "Lote Fornecedor Y caminha para prejuízo de R$ 45,00");
  assert.equal(actions[0].tone, "red");
  assert.equal(actions[0].target, "batch");
  assert.equal(actions[0].batchId, 1);
  assert.equal(actions[1].title, "Lote Fornecedor Z está acabando: 4 peças restantes");
  assert.equal(actions[1].detail, "36 de 40 já saíram · hora de pensar na próxima compra");
  assert.ok(page.includes('if (action.target === "batch") {'));
  assert.ok(page.includes('go("batches");'));
});
