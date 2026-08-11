import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const financeApi = readFileSync(new URL("../app/api/finance/route.ts", import.meta.url), "utf8");
const financeLib = readFileSync(new URL("../lib/finance.ts", import.meta.url), "utf8");
const ordersApi = readFileSync(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");

test("wallet is backed by receivables and receipts", () => {
  const walletStart = page.indexOf("const walletCustomers");
  const walletEnd = page.indexOf("const walletRows");
  const walletBlock = page.slice(walletStart, walletEnd);
  const settleStart = page.indexOf("async function settleWallet");
  const settleEnd = page.indexOf("async function toggle", settleStart);
  const settleBlock = page.slice(settleStart, settleEnd);

  assert.ok(walletBlock.includes("financeData.accountsReceivable"));
  assert.ok(walletBlock.includes("WalletEntry"));
  assert.equal(walletBlock.includes('paymentMethod === "Carteira"'), false);
  assert.ok(page.includes("financeData.receipts"));
  assert.ok(page.includes('entity: "accountsReceivable"'));
  assert.equal(settleBlock.includes('commercialStatus: JSON.stringify(history)'), false);
});

test("small residual balances settle the order at the received amount", () => {
  assert.ok(financeLib.includes("RESIDUAL_SETTLE_CENTS"));
  assert.ok(financeLib.includes("settleResidualTotal"));
  assert.ok(ordersApi.includes("settleResidualTotal(totals.total, received)"));
  assert.ok(ordersApi.includes("settleResidualTotal(projectedTotal, projectedReceived)"));
  assert.ok(financeApi.includes("RESIDUAL_SETTLE_CENTS"));
  assert.ok(financeApi.includes("original_amount_cents: newOriginal"));
});

test("cash movement types match the Supabase migration constraint", () => {
  assert.ok(financeApi.includes('row.type === "entrada"'));
  assert.ok(financeApi.includes('row.type === "saida"'));
  assert.ok(financeApi.includes('type: "entrada"'));
  assert.ok(financeApi.includes('type: "saida"'));
  assert.ok(financeLib.includes('type: "entrada"'));
  assert.equal(financeApi.includes('type: "Entrada"'), false);
  assert.equal(financeApi.includes('type: "Saida"'), false);
});
