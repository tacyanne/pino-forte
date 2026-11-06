import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORDER_STATUS,
  canGenerateOrderPdf,
  deliveryFieldsError,
  isQueuedWithoutPayment,
  normalizeOrderStatus,
  requestedCreationStatus,
  requestedUpdateStatus,
  revertToQueueBlockedReason,
} from "../lib/order-status.ts";

test("status legados viram fila e o fluxo tem só fila, entregue e cancelada", () => {
  for (const legacy of ["Aguardando", "Em produção", "Pronta", "Fila de produção", "", undefined, "xyz"])
    assert.equal(normalizeOrderStatus(legacy), ORDER_STATUS.queue);
  assert.equal(normalizeOrderStatus("Entregue"), ORDER_STATUS.delivered);
  assert.equal(normalizeOrderStatus("Cancelada"), ORDER_STATUS.canceled);
});

test("criação aceita só fila (padrão) ou entregue", () => {
  assert.equal(requestedCreationStatus(undefined), ORDER_STATUS.queue);
  assert.equal(requestedCreationStatus("Cancelada"), ORDER_STATUS.queue);
  assert.equal(requestedCreationStatus("Pronta"), ORDER_STATUS.queue);
  assert.equal(requestedCreationStatus("Entregue"), ORDER_STATUS.delivered);
});

test("atualização rejeita status desconhecido e aceita os três do fluxo", () => {
  assert.equal(requestedUpdateStatus("Entregue"), ORDER_STATUS.delivered);
  assert.equal(requestedUpdateStatus("Cancelada"), ORDER_STATUS.canceled);
  assert.equal(requestedUpdateStatus("Fila de produção"), ORDER_STATUS.queue);
  assert.equal(requestedUpdateStatus("Aguardando"), ORDER_STATUS.queue);
  assert.equal(requestedUpdateStatus("Inventado"), null);
  assert.equal(requestedUpdateStatus(""), null);
});

test("OS em fila sem forma de pagamento não tem recebível; legadas com pagamento seguem normais", () => {
  assert.equal(isQueuedWithoutPayment({ productionStatus: "Fila de produção", paymentMethod: "" }), true);
  assert.equal(isQueuedWithoutPayment({ productionStatus: "Aguardando", paymentMethod: "" }), true);
  assert.equal(isQueuedWithoutPayment({ productionStatus: "Fila de produção", paymentMethod: "Boleto" }), false);
  assert.equal(isQueuedWithoutPayment({ productionStatus: "Entregue", paymentMethod: "" }), false);
  assert.equal(isQueuedWithoutPayment({ productionStatus: "Cancelada", paymentMethod: "" }), false);
});

test("entregar exige pagamento, entrega e valor recebido nas formas à vista", () => {
  assert.match(deliveryFieldsError({ paymentMethod: "", deliveryType: "Entrega", received: 0 }), /forma de pagamento/);
  assert.match(deliveryFieldsError({ paymentMethod: "Boleto", deliveryType: "", received: 0 }), /forma de entrega/);
  assert.match(deliveryFieldsError({ paymentMethod: "Pix", deliveryType: "Entrega", received: 0 }), /valor recebido/);
  assert.equal(deliveryFieldsError({ paymentMethod: "Boleto", deliveryType: "Entrega", received: 0 }), null);
  assert.equal(deliveryFieldsError({ paymentMethod: "Pix", deliveryType: "Retirada no local", received: 10 }), null);
});

test("voltar para a fila é bloqueado quando já há valor recebido", () => {
  assert.equal(revertToQueueBlockedReason({ receivedCents: 0, receiptCount: 0 }), null);
  assert.match(revertToQueueBlockedReason({ receivedCents: 100, receiptCount: 0 }), /pagamento registrado/);
  assert.match(revertToQueueBlockedReason({ receivedCents: 0, receiptCount: 1 }), /pagamento registrado/);
});

test("a API de OS não aceita mais lista própria de status e usa o módulo do fluxo", () => {
  const source = readFileSync(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
  assert.equal(/allowedProduction/.test(source), false);
  assert.equal(/"Em produção", "Pronta"/.test(source), false);
  assert.match(source, /requestedCreationStatus/);
  assert.match(source, /requestedUpdateStatus/);
});

test("recebível só nasce na entrega: POST em fila não cria conta a receber", () => {
  const source = readFileSync(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(serviceOrderId && delivered\)/);
});

test("sincronização de recebíveis ignora OS em fila sem pagamento", () => {
  const finance = readFileSync(new URL("../lib/finance.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/finance/route.ts", import.meta.url), "utf8");
  assert.match(finance, /isQueuedWithoutPayment\(order\)\) continue/);
  assert.match(route, /isQueuedWithoutPayment\(\{ productionStatus: order\.production_status/);
});

test("PDF e envio só após a entrega; botão de entrega se chama Entregar", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /O PDF da OS só é gerado depois da entrega/);
  assert.match(page, /canGenerateOrderPdf\(orderModal\) && \(\s*<button\s+className="outline-button"\s+onClick=\{\(\) => downloadPdf\(orderModal\)\}/);
  assert.match(page, /\n\s+Entregar\r?\n/);
  assert.equal(/Marcar como entregue/.test(page), false);
});

test("PDF: entregue sim; cancelada só se já foi entregue (tem pagamento); fila e cancelada na fila não", () => {
  assert.equal(canGenerateOrderPdf({ productionStatus: "Entregue", paymentMethod: "Boleto" }), true);
  assert.equal(canGenerateOrderPdf({ productionStatus: "Cancelada", paymentMethod: "Boleto" }), true);
  assert.equal(canGenerateOrderPdf({ productionStatus: "Cancelada", paymentMethod: "" }), false);
  assert.equal(canGenerateOrderPdf({ productionStatus: "Fila de produção", paymentMethod: "" }), false);
  assert.equal(canGenerateOrderPdf({ productionStatus: "Fila de produção", paymentMethod: "Boleto" }), false);
});
