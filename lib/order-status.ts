// Fluxo de status da OS: "Fila de produção" -> "Entregue" (e "Cancelada").
// Em fila a OS guarda só cliente, peças, data e observações. Preço, pagamento,
// entrega e recebível só existem a partir de "Entregue".

export const ORDER_STATUS = {
  queue: "Fila de produção",
  delivered: "Entregue",
  canceled: "Cancelada",
} as const;

// Valores antigos que hoje significam "ainda em fila".
const LEGACY_QUEUE_STATUSES = new Set(["Aguardando", "Em produção", "Pronta", "Fila de producao", ""]);

export const PAYMENT_METHODS = ["Pix", "Dinheiro", "Cartão", "Boleto", "Carteira"] as const;
export const DELIVERY_TYPES = ["Retirada no local", "Entrega"] as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** Normaliza o status gravado (inclui valores legados) para um dos três status do fluxo. */
export function normalizeOrderStatus(value: unknown): OrderStatus {
  const status = String(value ?? "").trim();
  if (status === ORDER_STATUS.delivered) return ORDER_STATUS.delivered;
  if (status === ORDER_STATUS.canceled) return ORDER_STATUS.canceled;
  if (status === ORDER_STATUS.queue || LEGACY_QUEUE_STATUSES.has(status)) return ORDER_STATUS.queue;
  return ORDER_STATUS.queue;
}

/** Status pedido na criação: só "Entregue" muda o padrão (fila). */
export function requestedCreationStatus(value: unknown): OrderStatus {
  return normalizeOrderStatus(value) === ORDER_STATUS.delivered ? ORDER_STATUS.delivered : ORDER_STATUS.queue;
}

/** Status aceito em atualização, ou null se inválido. */
export function requestedUpdateStatus(value: unknown): OrderStatus | null {
  const status = String(value ?? "").trim();
  if (!status) return null;
  if (
    status === ORDER_STATUS.queue ||
    status === ORDER_STATUS.delivered ||
    status === ORDER_STATUS.canceled ||
    LEGACY_QUEUE_STATUSES.has(status)
  )
    return normalizeOrderStatus(status);
  return null;
}

/** OS em fila criada pelo fluxo novo: sem forma de pagamento, portanto sem preço nem recebível. */
export function isQueuedWithoutPayment(order: { productionStatus?: unknown; paymentMethod?: unknown }) {
  return normalizeOrderStatus(order.productionStatus) === ORDER_STATUS.queue && !String(order.paymentMethod || "").trim();
}

/** Campos obrigatórios para entregar (ou criar já entregue). Retorna a mensagem de erro, ou null. */
export function deliveryFieldsError(fields: { paymentMethod: string; deliveryType: string; received: number }) {
  if (!(PAYMENT_METHODS as readonly string[]).includes(fields.paymentMethod))
    return "Selecione a forma de pagamento.";
  if (!(DELIVERY_TYPES as readonly string[]).includes(fields.deliveryType))
    return "Selecione a forma de entrega.";
  if (["Pix", "Dinheiro", "Cartão"].includes(fields.paymentMethod) && fields.received <= 0)
    return "Informe o valor recebido.";
  return null;
}

/** Voltar de "Entregue" para a fila só é possível sem nenhum valor recebido. */
export function revertToQueueBlockedReason(info: { receivedCents: number; receiptCount: number }) {
  if (info.receivedCents > 0 || info.receiptCount > 0)
    return "Esta OS já tem pagamento registrado. Não é possível voltar para a fila de produção.";
  return null;
}
