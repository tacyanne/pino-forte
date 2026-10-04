import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  accountsPayable,
  accountsReceivable,
  auditLogs,
  cashMovements,
  financialCategories,
  receipts,
  serviceOrders,
} from "../../../db/schema";
import { RESIDUAL_SETTLE_CENTS, centsFromBody, currentMonth, receivableStatus, syncReceivablesFromOrders, todayIso } from "../../../lib/finance";
import { requireUser } from "../../../lib/auth";
import { camelizeRows } from "../../../lib/supabase-mappers";
import { hasSupabaseRest, supabaseGetOne, supabaseInsert, supabasePatch, supabaseSelect } from "../../../lib/supabase-rest";

type Auth = { id: number; role: string };

const isInMonth = (date: string | null | undefined, month: string) =>
  String(date || "").slice(0, 7) === month;

const jsonError = (message: string, status = 400) =>
  Response.json({ error: message }, { status });

async function audit(
  db: Awaited<ReturnType<typeof getDb>>,
  auth: Auth,
  action: string,
  entity: string,
  entityId: number | null,
  afterValues: unknown,
) {
  await db.insert(auditLogs).values({
    userId: auth.id,
    action,
    entity,
    entityId: entityId || undefined,
    afterValues: JSON.stringify(afterValues),
  });
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (hasSupabaseRest()) return getFinanceFromRest(request);

  try {
    const db = await getDb();
    await db.transaction((tx) => syncReceivablesFromOrders(tx, auth.id));

    const url = new URL(request.url);
    const month = url.searchParams.get("month") || currentMonth();
    const today = todayIso();

    const [categoryRows, receivableRows, payableRows, receiptRows, movementRows] =
      await Promise.all([
        db.select().from(financialCategories).orderBy(financialCategories.type, financialCategories.name),
        db.select().from(accountsReceivable).orderBy(desc(accountsReceivable.dueDate)).limit(300),
        db.select().from(accountsPayable).orderBy(desc(accountsPayable.dueDate)).limit(300),
        db.select().from(receipts).orderBy(desc(receipts.receiptDate)).limit(300),
        db.select().from(cashMovements).orderBy(desc(cashMovements.movementDate)).limit(300),
      ]);

    const monthReceipts = receiptRows.filter(
      (receipt) => receipt.status === "Confirmado" && isInMonth(receipt.receiptDate, month),
    );
    const monthMovements = movementRows.filter(
      (movement) => movement.status === "Confirmado" && isInMonth(movement.movementDate, month),
    );
    const openReceivables = receivableRows.filter((row) => row.status !== "Pago" && row.status !== "Cancelado");
    const openPayables = payableRows.filter((row) => row.status !== "Pago" && row.status !== "Cancelado");

    const summary = {
      month,
      receivableOpenCents: openReceivables.reduce((sum, row) => sum + row.balanceCents, 0),
      receivableOverdueCents: openReceivables
        .filter((row) => row.dueDate < today)
        .reduce((sum, row) => sum + row.balanceCents, 0),
      receivableReceivedCents: monthReceipts.reduce((sum, row) => sum + row.amountCents, 0),
      payableOpenCents: openPayables.reduce((sum, row) => sum + row.amountCents, 0),
      payableOverdueCents: openPayables
        .filter((row) => row.dueDate < today)
        .reduce((sum, row) => sum + row.amountCents, 0),
      payablePaidCents: payableRows
        .filter((row) => row.status === "Pago" && isInMonth(row.paidAt, month))
        .reduce((sum, row) => sum + row.amountCents, 0),
      cashInCents: monthMovements
        .filter((row) => row.type === "entrada")
        .reduce((sum, row) => sum + row.amountCents, 0),
      cashOutCents: monthMovements
        .filter((row) => row.type === "saida")
        .reduce((sum, row) => sum + row.amountCents, 0),
    };

    return Response.json(
      {
        summary: {
          ...summary,
          cashNetCents: summary.cashInCents - summary.cashOutCents,
        },
        categories: categoryRows,
        accountsReceivable: receivableRows,
        accountsPayable: payableRows,
        receipts: receiptRows,
        cashMovements: movementRows,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel carregar o financeiro." },
      { status: 500 },
    );
  }
}

async function getFinanceFromRest(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || currentMonth();
    const today = todayIso();
    const [
      categoryRowsRaw,
      receivableRowsRaw,
      payableRowsRaw,
      receiptRowsRaw,
      movementRowsRaw,
    ] = await Promise.all([
      supabaseSelect<Record<string, unknown>>("financial_categories", {
        select: "*",
        order: "type.asc,name.asc",
      }),
      supabaseSelect<Record<string, unknown>>("accounts_receivable", {
        select: "*",
        order: "due_date.desc",
        limit: "300",
      }),
      supabaseSelect<Record<string, unknown>>("accounts_payable", {
        select: "*",
        order: "due_date.desc",
        limit: "300",
      }),
      supabaseSelect<Record<string, unknown>>("receipts", {
        select: "*",
        order: "receipt_date.desc",
        limit: "300",
      }),
      supabaseSelect<Record<string, unknown>>("cash_movements", {
        select: "*",
        order: "movement_date.desc",
        limit: "300",
      }),
    ]);

    const categoryRows = camelizeRows<Record<string, unknown>>(categoryRowsRaw);
    const receivableRows = camelizeRows<Record<string, unknown>>(receivableRowsRaw);
    const payableRows = camelizeRows<Record<string, unknown>>(payableRowsRaw);
    const receiptRows = camelizeRows<Record<string, unknown>>(receiptRowsRaw);
    const movementRows = camelizeRows<Record<string, unknown>>(movementRowsRaw);

    const amount = (row: Record<string, unknown>, key: string) => Number(row[key] || 0);
    const date = (row: Record<string, unknown>, key: string) => String(row[key] || "");
    const status = (row: Record<string, unknown>) => String(row.status || "");

    const monthReceipts = receiptRows.filter(
      (receipt) => status(receipt) === "Confirmado" && isInMonth(date(receipt, "receiptDate"), month),
    );
    const monthMovements = movementRows.filter(
      (movement) => status(movement) === "Confirmado" && isInMonth(date(movement, "movementDate"), month),
    );
    const openReceivables = receivableRows.filter((row) => status(row) !== "Pago" && status(row) !== "Cancelado");
    const openPayables = payableRows.filter((row) => status(row) !== "Pago" && status(row) !== "Cancelado");

    const summary = {
      month,
      receivableOpenCents: openReceivables.reduce((sum, row) => sum + amount(row, "balanceCents"), 0),
      receivableOverdueCents: openReceivables
        .filter((row) => date(row, "dueDate") < today)
        .reduce((sum, row) => sum + amount(row, "balanceCents"), 0),
      receivableReceivedCents: monthReceipts.reduce((sum, row) => sum + amount(row, "amountCents"), 0),
      payableOpenCents: openPayables.reduce((sum, row) => sum + amount(row, "amountCents"), 0),
      payableOverdueCents: openPayables
        .filter((row) => date(row, "dueDate") < today)
        .reduce((sum, row) => sum + amount(row, "amountCents"), 0),
      payablePaidCents: payableRows
        .filter((row) => status(row) === "Pago" && isInMonth(date(row, "paidAt"), month))
        .reduce((sum, row) => sum + amount(row, "amountCents"), 0),
      cashInCents: monthMovements
        .filter((row) => row.type === "entrada")
        .reduce((sum, row) => sum + amount(row, "amountCents"), 0),
      cashOutCents: monthMovements
        .filter((row) => row.type === "saida")
        .reduce((sum, row) => sum + amount(row, "amountCents"), 0),
    };

    return Response.json(
      {
        summary: {
          ...summary,
          cashNetCents: summary.cashInCents - summary.cashOutCents,
        },
        categories: categoryRows,
        accountsReceivable: receivableRows,
        accountsPayable: payableRows,
        receipts: receiptRows,
        cashMovements: movementRows,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel carregar o financeiro." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (hasSupabaseRest()) return postFinanceWithRest(auth, body);
    const db = await getDb();
    const action = String(body.action || "");

    if (action === "category") {
      const name = String(body.name || "").trim();
      const type = String(body.type || "").trim();
      if (!name || !type) return jsonError("Informe nome e tipo da categoria.");
      const [category] = await db
        .insert(financialCategories)
        .values({ name, type, parentId: Number(body.parentId) || undefined })
        .returning();
      await audit(db, auth, "create", "financial_categories", category.id, category);
      return Response.json({ category }, { status: 201 });
    }

    if (action === "payable") {
      const amountCents = centsFromBody(body);
      const supplier = String(body.supplier || "").trim();
      const description = String(body.description || "").trim();
      const dueDate = String(body.dueDate || "").slice(0, 10);
      if (!supplier || !description || !dueDate || amountCents <= 0)
        return jsonError("Fornecedor, descricao, vencimento e valor sao obrigatorios.");

      const payable = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(accountsPayable)
          .values({
            supplier,
            description,
            categoryId: Number(body.categoryId) || undefined,
            competenceMonth: String(body.competenceMonth || dueDate.slice(0, 7)),
            dueDate,
            amountCents,
            paymentMethod: String(body.paymentMethod || ""),
            paidAt: body.status === "Pago" ? String(body.paidAt || todayIso()) : null,
            status: body.status === "Pago" ? "Pago" : "Pendente",
            notes: String(body.notes || ""),
          })
          .returning();

        if (created.status === "Pago") {
          await tx.insert(cashMovements).values({
            type: "saida",
            origin: "Conta a pagar",
            originId: created.id,
            movementDate: created.paidAt || todayIso(),
            amountCents: created.amountCents,
            paymentMethod: created.paymentMethod || "Nao informado",
            description: created.description,
            legacySourceKey: `accounts_payable:${created.id}:payment`,
            createdBy: auth.id,
          });
        }

        await tx.insert(auditLogs).values({
          userId: auth.id,
          action: "create",
          entity: "accounts_payable",
          entityId: created.id,
          afterValues: JSON.stringify(created),
        });
        return created;
      });

      return Response.json({ payable }, { status: 201 });
    }

    if (action === "cashMovement") {
      const amountCents = centsFromBody(body);
      const type = String(body.type || "");
      const movementDate = String(body.movementDate || todayIso()).slice(0, 10);
      const description = String(body.description || "").trim();
      const normalizedType = type.toLowerCase();
      if (!["entrada", "saida"].includes(normalizedType) || amountCents <= 0 || !description)
        return jsonError("Informe tipo, valor e descricao do movimento.");
      const [movement] = await db
        .insert(cashMovements)
        .values({
          type: normalizedType,
          origin: "Manual",
          movementDate,
          amountCents,
          paymentMethod: String(body.paymentMethod || "Nao informado"),
          description,
          createdBy: auth.id,
        })
        .returning();
      await audit(db, auth, "create", "cash_movements", movement.id, movement);
      return Response.json({ movement }, { status: 201 });
    }

    return jsonError("Acao financeira invalida.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel salvar o lancamento financeiro." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (hasSupabaseRest()) return patchFinanceWithRest(auth, body);
    const db = await getDb();
    const entity = String(body.entity || "");
    const id = Number(body.id);
    if (!id) return jsonError("Informe o registro financeiro.");

    if (entity === "accountsReceivable") {
      const amountCents = centsFromBody(body);
      const paymentMethod = String(body.paymentMethod || "").trim();
      const receiptDate = String(body.receiptDate || todayIso()).slice(0, 10);
      if (amountCents <= 0 || !paymentMethod)
        return jsonError("Informe valor e forma de recebimento.");

      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(accountsReceivable).where(eq(accountsReceivable.id, id)).limit(1);
        if (!current) throw new Error("Conta a receber nao encontrada.");
        if (current.status === "Pago") throw new Error("Esta conta a receber ja esta paga.");
        if (amountCents > current.balanceCents) throw new Error("O recebimento excede o saldo em aberto.");

        const newReceived = current.receivedAmountCents + amountCents;
        const rawBalance = Math.max(0, current.originalAmountCents - newReceived);
        // Resíduo pequeno é quitado: o total da OS passa a ser o valor recebido.
        const writeOff = rawBalance > 0 && rawBalance <= RESIDUAL_SETTLE_CENTS;
        const newOriginal = writeOff ? newReceived : current.originalAmountCents;
        const newBalance = writeOff ? 0 : rawBalance;
        const status = receivableStatus(newBalance, current.dueDate);
        const [receipt] = await tx
          .insert(receipts)
          .values({
            accountReceivableId: current.id,
            serviceOrderId: current.serviceOrderId,
            receiptDate,
            amountCents,
            paymentMethod,
            notes: String(body.notes || ""),
            createdBy: auth.id,
          })
          .returning();

        const [updated] = await tx
          .update(accountsReceivable)
          .set({
            originalAmountCents: newOriginal,
            receivedAmountCents: newReceived,
            balanceCents: newBalance,
            status,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(accountsReceivable.id, id))
          .returning();

        await tx
          .update(serviceOrders)
          .set({
            receivedCents: newReceived,
            received: newReceived / 100,
            balanceCents: newBalance,
            financialStatus: status,
            updatedAt: new Date().toISOString(),
            ...(writeOff ? { totalCents: newReceived, total: newReceived / 100 } : {}),
          })
          .where(eq(serviceOrders.id, current.serviceOrderId));

        await tx.insert(cashMovements).values({
          type: "entrada",
          origin: "Recebimento",
          originId: current.id,
          movementDate: receiptDate,
          amountCents,
          paymentMethod,
          description: `Recebimento da OS ${current.serviceOrderId}`,
          legacySourceKey: `receipt:${receipt.id}`,
          createdBy: auth.id,
        });

        await tx.insert(auditLogs).values({
          userId: auth.id,
          action: "receive",
          entity: "accounts_receivable",
          entityId: id,
          afterValues: JSON.stringify({ updated, receipt }),
        });

        return { accountReceivable: updated, receipt };
      });

      return Response.json(result);
    }

    if (entity === "accountsPayable") {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(accountsPayable).where(eq(accountsPayable.id, id)).limit(1);
        if (!current) throw new Error("Conta a pagar nao encontrada.");
        const status = body.status ? String(body.status) : current.status;
        const paidAt = status === "Pago" ? String(body.paidAt || current.paidAt || todayIso()).slice(0, 10) : current.paidAt;
        const paymentMethod = String(body.paymentMethod ?? current.paymentMethod ?? "");
        const [updated] = await tx
          .update(accountsPayable)
          .set({
            supplier: body.supplier === undefined ? current.supplier : String(body.supplier).trim(),
            description: body.description === undefined ? current.description : String(body.description).trim(),
            categoryId: body.categoryId === undefined ? current.categoryId : Number(body.categoryId) || null,
            competenceMonth: body.competenceMonth === undefined ? current.competenceMonth : String(body.competenceMonth),
            dueDate: body.dueDate === undefined ? current.dueDate : String(body.dueDate).slice(0, 10),
            amountCents: body.amountCents === undefined && body.amount === undefined ? current.amountCents : centsFromBody(body),
            paymentMethod,
            paidAt,
            status,
            notes: body.notes === undefined ? current.notes : String(body.notes),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(accountsPayable.id, id))
          .returning();

        if (updated.status === "Pago") {
          await tx
            .insert(cashMovements)
            .values({
              type: "saida",
              origin: "Conta a pagar",
              originId: updated.id,
              movementDate: updated.paidAt || todayIso(),
              amountCents: updated.amountCents,
              paymentMethod: updated.paymentMethod || "Nao informado",
              description: updated.description,
              legacySourceKey: `accounts_payable:${updated.id}:payment`,
              createdBy: auth.id,
            })
            .onConflictDoUpdate({
              target: cashMovements.legacySourceKey,
              set: {
                movementDate: updated.paidAt || todayIso(),
                amountCents: updated.amountCents,
                paymentMethod: updated.paymentMethod || "Nao informado",
                description: updated.description,
              },
            });
        }

        await tx.insert(auditLogs).values({
          userId: auth.id,
          action: "update",
          entity: "accounts_payable",
          entityId: id,
          afterValues: JSON.stringify(updated),
        });

        return updated;
      });

      return Response.json({ payable: result });
    }

    return jsonError("Entidade financeira invalida.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel atualizar o financeiro." },
      { status: 500 },
    );
  }
}

async function auditRest(auth: Auth, action: string, entity: string, entityId: number | null, afterValues: unknown) {
  await supabaseInsert("audit_logs", {
    user_id: auth.id,
    action,
    entity,
    entity_id: entityId,
    after_values: JSON.stringify(afterValues),
  });
}

async function postFinanceWithRest(auth: Auth, body: Record<string, unknown>) {
  const action = String(body.action || "");

  if (action === "category") {
    const name = String(body.name || "").trim();
    const type = String(body.type || "").trim();
    if (!name || !type) return jsonError("Informe nome e tipo da categoria.");
    const category = await supabaseInsert<Record<string, unknown>>("financial_categories", {
      name,
      type,
      parent_id: Number(body.parentId) || null,
    });
    await auditRest(auth, "create", "financial_categories", Number(category.id || 0), category);
    return Response.json({ category: camelizeRows([category])[0] }, { status: 201 });
  }

  if (action === "payable") {
    const amountCents = centsFromBody(body);
    const supplier = String(body.supplier || "").trim();
    const description = String(body.description || "").trim();
    const dueDate = String(body.dueDate || "").slice(0, 10);
    if (!supplier || !description || !dueDate || amountCents <= 0)
      return jsonError("Fornecedor, descricao, vencimento e valor sao obrigatorios.");
    const status = body.status === "Pago" ? "Pago" : "Pendente";
    const paidAt = status === "Pago" ? String(body.paidAt || todayIso()).slice(0, 10) : null;
    const payable = await supabaseInsert<Record<string, unknown>>("accounts_payable", {
      supplier,
      description,
      category_id: Number(body.categoryId) || null,
      competence_month: String(body.competenceMonth || dueDate.slice(0, 7)),
      due_date: dueDate,
      amount_cents: amountCents,
      payment_method: String(body.paymentMethod || ""),
      paid_at: paidAt,
      status,
      notes: String(body.notes || ""),
    });
    if (status === "Pago") {
      await supabaseInsert("cash_movements", {
        type: "saida",
        origin: "Conta a pagar",
        origin_id: Number(payable.id || 0),
        movement_date: paidAt || todayIso(),
        amount_cents: amountCents,
        payment_method: String(body.paymentMethod || "Nao informado"),
        description,
        legacy_source_key: `accounts_payable:${payable.id}:payment`,
        created_by: auth.id,
      });
    }
    await auditRest(auth, "create", "accounts_payable", Number(payable.id || 0), payable);
    return Response.json({ payable: camelizeRows([payable])[0] }, { status: 201 });
  }

  if (action === "cashMovement") {
    const amountCents = centsFromBody(body);
    const type = String(body.type || "").toLowerCase();
    const movementDate = String(body.movementDate || todayIso()).slice(0, 10);
    const description = String(body.description || "").trim();
    if (!["entrada", "saida"].includes(type) || amountCents <= 0 || !description)
      return jsonError("Informe tipo, valor e descricao do movimento.");
    const movement = await supabaseInsert<Record<string, unknown>>("cash_movements", {
      type,
      origin: "Manual",
      movement_date: movementDate,
      amount_cents: amountCents,
      payment_method: String(body.paymentMethod || "Nao informado"),
      description,
      created_by: auth.id,
    });
    await auditRest(auth, "create", "cash_movements", Number(movement.id || 0), movement);
    return Response.json({ movement: camelizeRows([movement])[0] }, { status: 201 });
  }

  return jsonError("Acao financeira invalida.");
}

async function patchFinanceWithRest(auth: Auth, body: Record<string, unknown>) {
  const entity = String(body.entity || "");
  const id = Number(body.id);
  if (!id) return jsonError("Informe o registro financeiro.");

  if (entity === "accountsReceivable") {
    const amountCents = centsFromBody(body);
    const paymentMethod = String(body.paymentMethod || "").trim();
    const receiptDate = String(body.receiptDate || todayIso()).slice(0, 10);
    if (amountCents <= 0 || !paymentMethod) return jsonError("Informe valor e forma de recebimento.");
    const current = await supabaseGetOne<Record<string, unknown>>("accounts_receivable", {
      select: "*",
      id: `eq.${id}`,
    });
    if (!current) throw new Error("Conta a receber nao encontrada.");
    if (current.status === "Pago") throw new Error("Esta conta a receber ja esta paga.");
    const balanceCents = Number(current.balance_cents || 0);
    if (amountCents > balanceCents) throw new Error("O recebimento excede o saldo em aberto.");
    const originalAmountCents = Number(current.original_amount_cents || 0);
    const newReceived = Number(current.received_amount_cents || 0) + amountCents;
    const rawBalance = Math.max(0, originalAmountCents - newReceived);
    // Resíduo pequeno é quitado: o total da OS passa a ser o valor recebido.
    const writeOff = rawBalance > 0 && rawBalance <= RESIDUAL_SETTLE_CENTS;
    const newOriginal = writeOff ? newReceived : originalAmountCents;
    const newBalance = writeOff ? 0 : rawBalance;
    const status = receivableStatus(newBalance, String(current.due_date || ""));
    const receipt = await supabaseInsert<Record<string, unknown>>("receipts", {
      account_receivable_id: id,
      service_order_id: Number(current.service_order_id || 0),
      receipt_date: receiptDate,
      amount_cents: amountCents,
      payment_method: paymentMethod,
      notes: String(body.notes || ""),
      created_by: auth.id,
    });
    const updated = await supabasePatch<Record<string, unknown>>("accounts_receivable", { id: `eq.${id}` }, {
      original_amount_cents: newOriginal,
      received_amount_cents: newReceived,
      balance_cents: newBalance,
      status,
      updated_at: new Date().toISOString(),
    });
    await supabasePatch("service_orders", { id: `eq.${Number(current.service_order_id || 0)}` }, {
      received_cents: newReceived,
      received: newReceived / 100,
      balance_cents: newBalance,
      financial_status: status,
      updated_at: new Date().toISOString(),
      ...(writeOff ? { total_cents: newReceived, total: newReceived / 100 } : {}),
    });
    await supabaseInsert("cash_movements", {
      type: "entrada",
      origin: "Recebimento",
      origin_id: id,
      movement_date: receiptDate,
      amount_cents: amountCents,
      payment_method: paymentMethod,
      description: `Recebimento da OS ${current.service_order_id}`,
      legacy_source_key: `receipt:${receipt.id}`,
      created_by: auth.id,
    });
    await auditRest(auth, "receive", "accounts_receivable", id, { updated, receipt });
    return Response.json({ accountReceivable: camelizeRows([updated])[0], receipt: camelizeRows([receipt])[0] });
  }

  if (entity === "accountsPayable") {
    const current = await supabaseGetOne<Record<string, unknown>>("accounts_payable", {
      select: "*",
      id: `eq.${id}`,
    });
    if (!current) throw new Error("Conta a pagar nao encontrada.");
    const status = body.status ? String(body.status) : String(current.status || "");
    const paidAt = status === "Pago" ? String(body.paidAt || current.paid_at || todayIso()).slice(0, 10) : String(current.paid_at || "") || null;
    const paymentMethod = String(body.paymentMethod ?? current.payment_method ?? "");
    const amountCents = body.amountCents === undefined && body.amount === undefined
      ? Number(current.amount_cents || 0)
      : centsFromBody(body);
    const updated = await supabasePatch<Record<string, unknown>>("accounts_payable", { id: `eq.${id}` }, {
      supplier: body.supplier === undefined ? String(current.supplier || "") : String(body.supplier).trim(),
      description: body.description === undefined ? String(current.description || "") : String(body.description).trim(),
      category_id: body.categoryId === undefined ? Number(current.category_id || 0) || null : Number(body.categoryId) || null,
      competence_month: body.competenceMonth === undefined ? String(current.competence_month || "") : String(body.competenceMonth),
      due_date: body.dueDate === undefined ? String(current.due_date || "") : String(body.dueDate).slice(0, 10),
      amount_cents: amountCents,
      payment_method: paymentMethod,
      paid_at: paidAt,
      status,
      notes: body.notes === undefined ? String(current.notes || "") : String(body.notes),
      updated_at: new Date().toISOString(),
    });
    if (status === "Pago") {
      const legacySourceKey = `accounts_payable:${id}:payment`;
      const movement = await supabaseGetOne<Record<string, unknown>>("cash_movements", {
        select: "id",
        legacy_source_key: `eq.${legacySourceKey}`,
      });
      const values = {
        type: "saida",
        origin: "Conta a pagar",
        origin_id: id,
        movement_date: paidAt || todayIso(),
        amount_cents: amountCents,
        payment_method: paymentMethod || "Nao informado",
        description: String(updated.description || ""),
        legacy_source_key: legacySourceKey,
        created_by: auth.id,
      };
      if (movement?.id) await supabasePatch("cash_movements", { id: `eq.${movement.id}` }, values);
      else await supabaseInsert("cash_movements", values);
    }
    await auditRest(auth, "update", "accounts_payable", id, updated);
    return Response.json({ payable: camelizeRows([updated])[0] });
  }

  return jsonError("Entidade financeira invalida.");
}
