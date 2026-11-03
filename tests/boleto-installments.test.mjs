import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  boletoFirstDueDate,
  boletoTermChangeBlockedReason,
  installmentCount,
  parseBoletoTerm,
  planInstallments,
  splitCents,
  summarizeInstallments,
} from "../lib/boleto-installments.ts";

const base = { receivedCents: 0, issuedAt: "2026-11-01", today: "2026-11-01" };
const sum = (plan, key) => plan.reduce((total, item) => total + item[key], 0);

test("prazo aceita só 25, 50 ou 75 dias", () => {
  assert.equal(parseBoletoTerm(25), 25);
  assert.equal(parseBoletoTerm("50"), 50);
  assert.equal(parseBoletoTerm(75), 75);
  assert.equal(parseBoletoTerm(30), null);
  assert.equal(parseBoletoTerm(undefined), null);
  assert.deepEqual([25, 50, 75].map(installmentCount), [1, 2, 3]);
});

test("25 dias gera 1 parcela; 50 gera 2; 75 gera 3, vencendo a cada 25 dias", () => {
  const p25 = planInstallments({ ...base, totalCents: 30000, termDays: 25 });
  const p50 = planInstallments({ ...base, totalCents: 30000, termDays: 50 });
  const p75 = planInstallments({ ...base, totalCents: 30000, termDays: 75 });
  assert.deepEqual(p25.map((item) => item.dueDate), ["2026-11-26"]);
  assert.deepEqual(p50.map((item) => item.dueDate), ["2026-11-26", "2026-12-21"]);
  assert.deepEqual(p75.map((item) => item.dueDate), ["2026-11-26", "2026-12-21", "2027-01-15"]);
  assert.deepEqual(p75.map((item) => item.amountCents), [10000, 10000, 10000]);
  assert.equal(boletoFirstDueDate("2026-11-01"), "2026-11-26");
});

test("divisão em centavos: última parcela absorve o resto e a soma bate com o total", () => {
  assert.deepEqual(splitCents(10000, 3), [3333, 3333, 3334]);
  const plan = planInstallments({ ...base, totalCents: 10000, termDays: 75 });
  assert.deepEqual(plan.map((item) => item.amountCents), [3333, 3333, 3334]);
  assert.equal(sum(plan, "amountCents"), 10000);
});

test("recebido da OS é alocado das parcelas mais antigas para as mais novas", () => {
  const plan = planInstallments({ ...base, totalCents: 30000, receivedCents: 15000, termDays: 75 });
  assert.deepEqual(plan.map((item) => item.receivedCents), [10000, 5000, 0]);
  assert.deepEqual(plan.map((item) => item.status), ["Pago", "Pendente", "Pendente"]);
  assert.equal(sum(plan, "receivedCents"), 15000);
});

test("parcela paga fora de ordem é preservada ao recalcular", () => {
  const existing = [
    { number: 1, amountCents: 10000, receivedCents: 0 },
    { number: 2, amountCents: 10000, receivedCents: 10000 },
    { number: 3, amountCents: 10000, receivedCents: 0 },
  ];
  const plan = planInstallments({ ...base, totalCents: 30000, receivedCents: 10000, termDays: 75, existing });
  assert.deepEqual(plan.map((item) => item.receivedCents), [0, 10000, 0]);
  assert.equal(plan[1].status, "Pago");
});

test("aumentar o total da OS redistribui só as parcelas em aberto", () => {
  const existing = [
    { number: 1, amountCents: 10000, receivedCents: 10000 },
    { number: 2, amountCents: 10000, receivedCents: 0 },
    { number: 3, amountCents: 10000, receivedCents: 0 },
  ];
  const plan = planInstallments({ ...base, totalCents: 40000, receivedCents: 10000, termDays: 75, existing });
  assert.deepEqual(plan.map((item) => item.amountCents), [10000, 15000, 15000]);
  assert.equal(sum(plan, "amountCents"), 40000);
});

test("mudar a data da OS recalcula os vencimentos", () => {
  const plan = planInstallments({ ...base, issuedAt: "2026-12-10", totalCents: 20000, termDays: 50 });
  assert.deepEqual(plan.map((item) => item.dueDate), ["2027-01-04", "2027-01-29"]);
});

test("vencida só a parcela em aberto com data passada; conta agrega próxima parcela aberta", () => {
  const plan = planInstallments({ ...base, today: "2026-12-25", totalCents: 30000, receivedCents: 10000, termDays: 75 });
  assert.deepEqual(plan.map((item) => item.status), ["Pago", "Vencido", "Pendente"]);
  assert.deepEqual(summarizeInstallments(plan), { dueDate: "2026-12-21", status: "Vencido" });
  const paid = planInstallments({ ...base, totalCents: 30000, receivedCents: 30000, termDays: 75 });
  assert.deepEqual(summarizeInstallments(paid), { dueDate: "2027-01-15", status: "Pago" });
});

test("parcela recebida trava troca de prazo e de forma de pagamento", () => {
  assert.equal(boletoTermChangeBlockedReason([{ receivedCents: 0 }], 50), null);
  assert.equal(boletoTermChangeBlockedReason([{ receivedCents: 100 }, { receivedCents: 0 }], 50), null);
  assert.match(boletoTermChangeBlockedReason([{ receivedCents: 100 }, { receivedCents: 0 }], 75), /prazo/);
  assert.match(boletoTermChangeBlockedReason([{ receivedCents: 100 }], null), /forma de pagamento/);
});

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("API de OS exige prazo no Boleto e não manda Boleto para a Carteira", () => {
  const orders = read("../app/api/orders/route.ts");
  assert.ok(orders.includes("Escolha o prazo do boleto"));
  assert.equal(orders.includes('["Pix", "Boleto", "Cartão"].includes(paymentMethod)'), false);
  assert.ok(orders.includes("syncInstallmentsRest"));
  assert.ok(orders.includes("assertBoletoTermChangeAllowedRest"));
});

test("recebimento aceita parcela e financeiro devolve as parcelas", () => {
  const finance = read("../app/api/finance/route.ts");
  assert.ok(finance.includes("installmentId"));
  assert.ok(finance.includes("receivableInstallments: installmentRows"));
  assert.ok(finance.includes("O recebimento excede o saldo da parcela."));
  const page = read("../app/page.tsx");
  assert.ok(page.includes("settleBoleto(orderModal, parcel)"));
  assert.ok(page.includes("Prazo do boleto"));
});

test("migration cria tabela de parcelas com RLS e backfill", () => {
  const migration = read("../supabase/migrations/20261101120000_boleto_installments.sql");
  assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS public.receivable_installments"));
  assert.ok(migration.includes("boleto_term_days IN (25, 50, 75)"));
  assert.ok(migration.includes("ENABLE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("INSERT INTO public.receivable_installments"));
});
