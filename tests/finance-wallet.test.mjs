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
  assert.ok(settleBlock.includes('submitReceipts'));
  assert.equal(settleBlock.includes('commercialStatus: JSON.stringify(history)'), false);
});

test("OS a Receber lists only orders with an outstanding balance", () => {
  const financialRowsStart = page.indexOf("const financialRows");
  const financialRowsEnd = page.indexOf("const financialTotals", financialRowsStart);
  const financialRowsBlock = page.slice(financialRowsStart, financialRowsEnd);

  assert.ok(financialRowsBlock.includes("row.balance > 0"));
  assert.ok(financialRowsBlock.includes('row.status !== "Pago"'));
});

test("historical order values and receipt details are preserved", () => {
  assert.ok(page.includes("item.unitPrice ??"));
  assert.ok(page.includes("unitPrice: itemUnitPrice(item)"));
  assert.ok(page.includes("completeOrderNotes(order, \"\\n\", financeData.receipts)"));
  assert.ok(page.includes("receipt.serviceOrderId === order.id"));
  assert.ok(page.includes("via ${payment.method}"));
  assert.ok(page.includes("Previsão: ${brDate(order.deliveryDate)}"));
  assert.equal(ordersApi.includes("const repairedRows = await Promise.all"), false);
  assert.ok(ordersApi.includes("original_amount_cents: totalCents"));
  assert.ok(ordersApi.includes("received_amount_cents: receivedCents"));
});

test("Carteira remains available on the OS but not when registering a receipt", () => {
  const paymentFieldStart = page.indexOf('<Field label="Forma de pagamento *">');
  const paymentFieldEnd = page.indexOf("</Field>", paymentFieldStart);
  const paymentField = page.slice(paymentFieldStart, paymentFieldEnd);
  const receiptModalStart = page.indexOf('title="Registrar pagamento da Carteira"');
  const receiptModalEnd = page.indexOf("</Modal>", receiptModalStart);
  const receiptModal = page.slice(receiptModalStart, receiptModalEnd);

  assert.ok(paymentField.includes("<option>Carteira</option>"));
  assert.ok(receiptModal.includes("<option>Boleto</option>"));
  assert.equal(receiptModal.includes("<option>Carteira</option>"), false);
});

test("small residual balances settle the order at the received amount", () => {
  assert.ok(financeLib.includes("RESIDUAL_SETTLE_CENTS"));
  assert.ok(financeLib.includes("settleResidualTotal"));
  assert.ok(ordersApi.includes("settleResidualTotal(totals.total, received)"));
  assert.ok(ordersApi.includes("settleResidualTotal(projectedTotal, projectedReceived)"));
});

test("cash movement types match the Supabase migration constraint", () => {
  assert.ok(financeApi.includes('row.type === "entrada"'));
  assert.ok(financeApi.includes('row.type === "saida"'));
  assert.ok(financeApi.includes('type: "saida"'));
  assert.ok(financeLib.includes('type: "entrada"'));
  assert.equal(financeApi.includes('type: "Entrada"'), false);
  assert.equal(financeApi.includes('type: "Saida"'), false);
});

test("GR 188 image is available in both online and PDF catalogs", () => {
  const onlineCatalog = readFileSync(new URL("../app/catalogo/catalog-view.tsx", import.meta.url), "utf8");
  const images = readFileSync(new URL("../lib/product-images.ts", import.meta.url), "utf8");

  assert.ok(images.includes('"GR 188": "/img-006.png"'));
  assert.ok(page.includes("productImageSource(product)"));
  assert.ok(onlineCatalog.includes("productImageSource(product)"));
});
