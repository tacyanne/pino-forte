import type { ReceiptPayment } from "./receipt-command";

// Keep the same key across retries and reloads. Expected balances also protect
// against duplicate submissions from another tab/device using a different key.
export async function submitReceipts(actorId: number, payments: ReceiptPayment[]) {
  const body = { entity: "accountsReceivable", payments: [...payments].sort((a, b) => a.id - b.id) };
  const fingerprint = JSON.stringify(body);
  const storageKey = `pino.receipt-attempt.${actorId}`;
  let previous: { fingerprint: string; key: string } | null = null;
  try { previous = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* new attempt */ }
  const key = previous?.fingerprint === fingerprint ? previous.key : crypto.randomUUID();
  // Fail before sending if storage is unavailable: never lose an uncertain key.
  sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
  const response = await fetch("/api/finance", {
    method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": key }, body: fingerprint,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Recebimento nao confirmado.");
  return result;
}
