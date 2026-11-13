import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_RESALE_SUPPLIER, parseOrderItems, planOrderPayables } from "../lib/order-payables.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sync = read("../lib/order-payable-sync.ts");
const financeApi = read("../app/api/finance/route.ts");
const migration = read("../supabase/migrations/20261113060000_order_supplier_payables.sql");

test("itens da OS saem do campo de peças, em lista ou código único", () => {
  assert.deepEqual(parseOrderItems('[{"code":"PF-AA-100","quantity":4,"unitPrice":10},{"code":"PF-BB-200","quantity":2}]', 6), [
    { code: "PF-AA-100", quantity: 4 },
    { code: "PF-BB-200", quantity: 2 },
  ]);
  assert.deepEqual(parseOrderItems("AA 100", 3), [{ code: "AA 100", quantity: 3 }]);
  assert.deepEqual(parseOrderItems("AA 100", 0), []);
  assert.deepEqual(parseOrderItems("[quebrado", 2), []);
  assert.deepEqual(parseOrderItems("", 2), []);
});

test("conta a pagar da OS entregue: custo revenda x quantidade, no vencimento da OS", () => {
  const planned = planOrderPayables({
    orderNumber: "OS-TESTE-1",
    deliveryDate: "2026-11-12",
    dueDates: ["2026-12-07"],
    lines: [
      { supplier: "", unitCostCents: 2400, quantity: 4 },
      { supplier: " usiart ", unitCostCents: 2600, quantity: 2 },
    ],
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].supplier, DEFAULT_RESALE_SUPPLIER);
  assert.equal(planned[0].amountCents, 2400 * 4 + 2600 * 2);
  assert.equal(planned[0].dueDate, "2026-12-07");
  assert.equal(planned[0].competenceMonth, "2026-12");
  assert.equal(planned[0].purchaseDate, "2026-11-12");
  assert.equal(planned[0].installmentNumber, 1);
  assert.equal(planned[0].description, "Peças de revenda da OS-TESTE-1");
});

test("OS parcelada gera uma conta por parcela, sem sobrar centavo", () => {
  const planned = planOrderPayables({
    orderNumber: "OS-TESTE-2",
    deliveryDate: "2026-11-12",
    dueDates: ["2026-11-21", "2026-12-16", "2027-01-10"],
    lines: [{ supplier: "USIART", unitCostCents: 3333, quantity: 1 }],
  });
  assert.deepEqual(planned.map((item) => item.amountCents), [1111, 1111, 1111]);
  assert.deepEqual(planned.map((item) => item.dueDate), ["2026-11-21", "2026-12-16", "2027-01-10"]);
  assert.equal(planned[1].description, "Peças de revenda da OS-TESTE-2 (parcela 2/3)");

  const odd = planOrderPayables({
    orderNumber: "OS-TESTE-3",
    deliveryDate: "2026-11-12",
    dueDates: ["2026-11-21", "2026-12-16"],
    lines: [{ supplier: "USIART", unitCostCents: 1001, quantity: 1 }],
  });
  assert.deepEqual(odd.map((item) => item.amountCents), [500, 501]);
});

test("fornecedores diferentes geram contas separadas; sem peça de revenda, nada", () => {
  const planned = planOrderPayables({
    orderNumber: "OS-TESTE-4",
    deliveryDate: "2026-11-12",
    dueDates: ["2026-12-07"],
    lines: [
      { supplier: "Fornecedor B", unitCostCents: 1000, quantity: 1 },
      { supplier: "USIART", unitCostCents: 2000, quantity: 1 },
    ],
  });
  assert.deepEqual(planned.map((item) => `${item.supplier}:${item.amountCents}`), ["FORNECEDOR B:1000", "USIART:2000"]);
  assert.deepEqual(planOrderPayables({ orderNumber: "OS-X", deliveryDate: "2026-11-12", dueDates: ["2026-12-07"], lines: [] }), []);
  assert.deepEqual(
    planOrderPayables({ orderNumber: "OS-X", deliveryDate: "2026-11-12", dueDates: [], lines: [{ supplier: "", unitCostCents: 100, quantity: 1 }] }),
    [],
  );
  assert.deepEqual(
    planOrderPayables({ orderNumber: "OS-X", deliveryDate: "2026-11-12", dueDates: ["2026-12-07"], lines: [{ supplier: "", unitCostCents: 0, quantity: 5 }] }),
    [],
  );
});

test("geração é feita uma vez por OS entregue, nos dois caminhos de banco, e some se a OS volta", () => {
  assert.equal(financeApi.split("await syncOrderPayablesSafe();").length - 1, 2);
  assert.ok(sync.includes('costSourceOf(cost.source) !== "comprada"'));
  assert.ok(sync.includes("order.productionStatus === DELIVERED && !order.supplierPayableAt"));
  assert.ok(sync.includes("order.productionStatus !== DELIVERED && order.supplierPayableAt"));
  assert.ok(sync.includes('supabaseDelete("accounts_payable", { service_order_id: `eq.${orderId}`, status: "eq.Pendente" })'));
  assert.ok(sync.includes("tx.insert(accountsPayable)"));
  assert.ok(/add column if not exists service_order_id/i.test(migration));
  assert.ok(/add column if not exists supplier_payable_at/i.test(migration));
});
