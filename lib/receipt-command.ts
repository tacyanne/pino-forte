export type ReceiptPayment = {
  id: number;
  amountCents: number;
  expectedBalanceCents: number;
  paymentMethod: string;
  receiptDate: string;
  notes: string;
};

export class ReceiptInputError extends Error {}

export function receiptCommand(body: Record<string, unknown>, key: string | null) {
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
    throw new ReceiptInputError("Informe uma chave de idempotencia UUID.");
  const input = body.payments === undefined ? [body] : body.payments;
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw new ReceiptInputError("Informe de 1 a 100 recebimentos.");
  const payments: ReceiptPayment[] = input.map((item) => {
    if (!item || typeof item !== "object") throw new ReceiptInputError("Recebimento invalido.");
    const { id, expectedBalanceCents, paymentMethod, receiptDate } = item;
    const amountCents = item.amountCents;
    if (![id, amountCents, expectedBalanceCents].every((n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 2147483647))
      throw new ReceiptInputError("Informe identificador, valor em centavos e saldo esperado validos.");
    if (amountCents > expectedBalanceCents) throw new ReceiptInputError("O recebimento excede o saldo informado.");
    if (!["Pix", "Dinheiro", "Cartão", "Boleto"].includes(paymentMethod))
      throw new ReceiptInputError("Forma de recebimento invalida.");
    if (typeof receiptDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate) ||
        !Number.isFinite(Date.parse(receiptDate)) || new Date(receiptDate).toISOString().slice(0, 10) !== receiptDate)
      throw new ReceiptInputError("Data de recebimento invalida.");
    const notes = item.notes ?? "";
    if (typeof notes !== "string" || notes.length > 2000) throw new ReceiptInputError("Observacao invalida.");
    return { id, amountCents, expectedBalanceCents, paymentMethod, receiptDate, notes };
  }).sort((a, b) => a.id - b.id);
  if (new Set(payments.map((p) => p.id)).size !== payments.length)
    throw new ReceiptInputError("Uma conta nao pode aparecer duas vezes no lote.");
  return { key: key.toLowerCase(), payments };
}
