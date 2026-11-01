import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { accountsReceivable, receivableInstallments, serviceOrders } from "../db/schema";
import { boletoTermChangeBlockedReason, planInstallments, summarizeInstallments, type BoletoTerm, type PlannedInstallment } from "./boleto-installments";
import { todayIso } from "./finance";
import { supabaseDelete, supabasePatch, supabaseSelect, supabaseUpsert } from "./supabase-rest";

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type InstallmentSyncInput = {
  accountReceivableId: number;
  serviceOrderId: number;
  totalCents: number;
  receivedCents: number;
  issuedAt: string;
  termDays: number;
  canceled?: boolean;
};

const nowIso = () => new Date().toISOString();

function rowStatus(item: PlannedInstallment, canceled?: boolean) {
  return canceled ? "Cancelado" : item.status;
}

// Persistência via Supabase REST (caminho usado em produção).
export async function syncInstallmentsRest(input: InstallmentSyncInput) {
  const existingRows = await supabaseSelect<Record<string, unknown>>("receivable_installments", {
    select: "number,amount_cents,received_cents",
    account_receivable_id: `eq.${input.accountReceivableId}`,
  });
  const planned = planInstallments({
    totalCents: input.totalCents,
    receivedCents: input.receivedCents,
    issuedAt: input.issuedAt,
    termDays: input.termDays,
    today: todayIso(),
    existing: existingRows.map((row) => ({
      number: Number(row.number),
      amountCents: Number(row.amount_cents || 0),
      receivedCents: Number(row.received_cents || 0),
    })),
  });
  for (const item of planned) {
    await supabaseUpsert(
      "receivable_installments",
      {
        account_receivable_id: input.accountReceivableId,
        service_order_id: input.serviceOrderId,
        number: item.number,
        total_installments: item.totalInstallments,
        due_date: item.dueDate,
        amount_cents: item.amountCents,
        received_cents: item.receivedCents,
        balance_cents: item.balanceCents,
        status: rowStatus(item, input.canceled),
        paid_at: item.balanceCents <= 0 ? todayIso() : null,
        updated_at: nowIso(),
      },
      "account_receivable_id,number",
    );
  }
  await supabaseDelete("receivable_installments", {
    account_receivable_id: `eq.${input.accountReceivableId}`,
    number: `gt.${planned.length}`,
  });
  const summary = summarizeInstallments(planned);
  await supabasePatch("accounts_receivable", { id: `eq.${input.accountReceivableId}` }, {
    due_date: summary.dueDate,
    status: summary.status,
    updated_at: nowIso(),
  });
  await supabasePatch("service_orders", { id: `eq.${input.serviceOrderId}` }, {
    due_date: summary.dueDate,
    financial_status: summary.status,
  });
  return planned;
}

// Persistência via Drizzle (fallback local sem REST).
export async function syncInstallmentsDb(db: Db | Tx, input: InstallmentSyncInput) {
  const existingRows = await db
    .select()
    .from(receivableInstallments)
    .where(eq(receivableInstallments.accountReceivableId, input.accountReceivableId));
  const planned = planInstallments({
    totalCents: input.totalCents,
    receivedCents: input.receivedCents,
    issuedAt: input.issuedAt,
    termDays: input.termDays,
    today: todayIso(),
    existing: existingRows.map((row) => ({
      number: row.number,
      amountCents: row.amountCents,
      receivedCents: row.receivedCents,
    })),
  });
  for (const item of planned) {
    const values = {
      accountReceivableId: input.accountReceivableId,
      serviceOrderId: input.serviceOrderId,
      number: item.number,
      totalInstallments: item.totalInstallments,
      dueDate: item.dueDate,
      amountCents: item.amountCents,
      receivedCents: item.receivedCents,
      balanceCents: item.balanceCents,
      status: rowStatus(item, input.canceled),
      paidAt: item.balanceCents <= 0 ? todayIso() : null,
      updatedAt: nowIso(),
    };
    await db
      .insert(receivableInstallments)
      .values(values)
      .onConflictDoUpdate({
        target: [receivableInstallments.accountReceivableId, receivableInstallments.number],
        set: values,
      });
  }
  await db
    .delete(receivableInstallments)
    .where(
      and(
        eq(receivableInstallments.accountReceivableId, input.accountReceivableId),
        gt(receivableInstallments.number, planned.length),
      ),
    );
  const summary = summarizeInstallments(planned);
  await db
    .update(accountsReceivable)
    .set({ dueDate: summary.dueDate, status: summary.status, updatedAt: nowIso() })
    .where(eq(accountsReceivable.id, input.accountReceivableId));
  await db
    .update(serviceOrders)
    .set({ dueDate: summary.dueDate, financialStatus: summary.status })
    .where(eq(serviceOrders.id, input.serviceOrderId));
  return planned;
}

export async function assertBoletoTermChangeAllowedRest(serviceOrderId: number, nextTerm: BoletoTerm | null) {
  const rows = await supabaseSelect<Record<string, unknown>>("receivable_installments", {
    select: "received_cents",
    service_order_id: `eq.${serviceOrderId}`,
  });
  return boletoTermChangeBlockedReason(
    rows.map((row) => ({ receivedCents: Number(row.received_cents || 0) })),
    nextTerm,
  );
}

export async function assertBoletoTermChangeAllowedDb(db: Db | Tx, serviceOrderId: number, nextTerm: BoletoTerm | null) {
  const rows = await db
    .select({ receivedCents: receivableInstallments.receivedCents })
    .from(receivableInstallments)
    .where(eq(receivableInstallments.serviceOrderId, serviceOrderId));
  return boletoTermChangeBlockedReason(rows, nextTerm);
}
