import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  accountsReceivable,
  cashMovements,
  receipts,
  serviceOrders,
} from "../db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type WritableDb = Db | Tx;

export const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const currentMonth = () => todayIso().slice(0, 7);

export function addDaysIso(date: string, days: number) {
  const value = date?.slice(0, 10) || todayIso();
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return todayIso();
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export const receivableDueDateFromIssuedAt = (issuedAt: string) => addDaysIso(issuedAt, 30);

export function toCents(value: unknown) {
  if (typeof value === "number") return Math.round(value * 100);
  const normalized = String(value || "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const number = Number(normalized || 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function centsFromBody(body: Record<string, unknown>, amountKey = "amountCents") {
  const cents = Number(body[amountKey]);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents);
  return toCents(body.amount);
}

export function receivableStatus(balanceCents: number, dueDate: string, today = todayIso()) {
  if (balanceCents <= 0) return "Pago";
  if (dueDate && dueDate < today) return "Vencido";
  return "Pendente";
}

export async function syncReceivablesFromOrders(db: WritableDb, userId?: number) {
  const orders = await db.select().from(serviceOrders);
  let synced = 0;

  for (const order of orders) {
    if (order.productionStatus === "Cancelada") continue;

    const totalCents = order.totalCents || toCents(order.total);
    const receivedCents = order.receivedCents || toCents(order.received);
    const balanceCents = Math.max(0, totalCents - receivedCents);
    const issuedAt = order.issuedAt || order.createdAt.slice(0, 10);
    const dueDate = receivableDueDateFromIssuedAt(issuedAt);
    const status = receivableStatus(balanceCents, dueDate);

    const [receivable] = await db
      .insert(accountsReceivable)
      .values({
        serviceOrderId: order.id,
        customerId: order.customerId,
        issuedAt,
        dueDate,
        originalAmountCents: totalCents,
        receivedAmountCents: Math.min(receivedCents, totalCents),
        balanceCents,
        status,
        notes: order.notes,
      })
      .onConflictDoUpdate({
        target: accountsReceivable.serviceOrderId,
        set: {
          customerId: order.customerId,
          issuedAt,
          dueDate,
          originalAmountCents: totalCents,
          receivedAmountCents: Math.min(receivedCents, totalCents),
          balanceCents,
          status,
          notes: order.notes,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();

    await db
      .update(serviceOrders)
      .set({
        subtotalCents: order.subtotalCents || toCents(order.subtotal),
        totalCents,
        receivedCents: Math.min(receivedCents, totalCents),
        balanceCents,
        issuedAt,
        dueDate,
        financialStatus: status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(serviceOrders.id, order.id));

    if (receivedCents > 0 && receivable) {
      const legacySourceKey = `service_order:${order.id}:initial_receipt`;
      await db
        .insert(receipts)
        .values({
          accountReceivableId: receivable.id,
          serviceOrderId: order.id,
          receiptDate: order.createdAt.slice(0, 10),
          amountCents: Math.min(receivedCents, totalCents),
          paymentMethod: order.paymentMethod,
          notes: "Recebimento importado da OS.",
          legacySourceKey,
          createdBy: userId,
        })
        .onConflictDoNothing({ target: receipts.legacySourceKey });

      await db
        .insert(cashMovements)
        .values({
          type: "entrada",
          origin: "Recebimento",
          originId: receivable.id,
          movementDate: order.createdAt.slice(0, 10),
          amountCents: Math.min(receivedCents, totalCents),
          paymentMethod: order.paymentMethod,
          description: `Recebimento ${order.number}`,
          legacySourceKey,
          createdBy: userId,
        })
        .onConflictDoNothing({ target: cashMovements.legacySourceKey });
    }

    synced += 1;
  }

  return synced;
}
