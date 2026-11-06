import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { customers, serviceOrders } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { boletoFirstDueDate, parseBoletoTerm } from "../../../lib/boleto-installments";
import {
  ORDER_STATUS,
  deliveryFieldsError,
  normalizeOrderStatus,
  requestedCreationStatus,
  requestedUpdateStatus,
  revertToQueueBlockedReason,
} from "../../../lib/order-status";
import { receivableDueDateFromIssuedAt, receivableStatus, settleResidualTotal } from "../../../lib/finance";
import {
  assertBoletoTermChangeAllowedDb,
  assertBoletoTermChangeAllowedRest,
  syncInstallmentsRest,
} from "../../../lib/receivable-installments";
import { camelizeRow, camelizeRows } from "../../../lib/supabase-mappers";
import { hasSupabaseRest, supabaseDelete, supabaseGetOne, supabaseInsert, supabasePatch, supabaseSelect } from "../../../lib/supabase-rest";

type OrderItem = { code: string; quantity: number; unitPrice: number };
type RestCustomer = { id: number; name: string; customerType: string };
type RestOrder = Record<string, unknown> & {
  id: number;
  customerName: string;
  customerType: string;
  productCode: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discountRate: number;
  total: number;
  received: number;
  paymentMethod: string;
  productionStatus: string;
  createdAt: string;
  walletMonth: string;
};

function automaticDiscount(customerType: string, quantity: number) {
  if (customerType.trim().toLocaleLowerCase("pt-BR") !== "distribuidor") return 0;
  if (quantity >= 20) return 10;
  if (quantity >= 10) return 8;
  return 5;
}

async function calculateTotals(
  db: Awaited<ReturnType<typeof getDb>>,
  auth: { role: string },
  customerId: number,
  customerName: string,
  requestedCustomerType: unknown,
  items: OrderItem[],
  requestedDiscount: unknown,
) {
  const quantity = items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity)), 0);
  const subtotal = items.reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity)) * Math.max(0, Number(item.unitPrice)),
    0,
  );
  const [customer] = customerId
    ? await db.select().from(customers).where(eq(customers.id, customerId)).limit(1)
    : await db.select().from(customers).where(eq(customers.name, customerName.trim())).limit(1);
  // O cadastro do cliente é a fonte oficial da condição comercial.
  // Um valor antigo mantido no formulário não pode sobrescrever "Distribuidor".
  const customerType =
    customer?.customerType ||
    String(requestedCustomerType || "").trim() ||
    "Cliente final";
  const automatic = automaticDiscount(customerType, quantity);
  const requested = requestedDiscount === undefined || requestedDiscount === null || requestedDiscount === ""
    ? automatic
    : Number(requestedDiscount);
  if (!Number.isFinite(requested) || requested < 0 || requested >= 100)
    throw new Error("Informe um desconto válido.");
  if (requested > 10 && auth.role !== "admin")
    throw new Error("Descontos acima de 10% exigem autorização do administrador.");
  const discountRate = auth.role === "admin" ? requested : automatic;
  const total = Math.round(subtotal * (1 - discountRate / 100) * 100) / 100;
  return { quantity, subtotal, customerType, discountRate, total };
}

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  if (hasSupabaseRest()) return getOrdersFromRest();
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(serviceOrders)
      .orderBy(desc(serviceOrders.id))
      .limit(100);
    return Response.json({
      orders: rows.map((order) => ({
        ...order,
        productionStatus: normalizeOrderStatus(order.productionStatus),
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível consultar as ordens.",
      },
      { status: 500 },
    );
  }
}

async function calculateTotalsFromRest(
  auth: { role: string },
  customerId: number,
  customerName: string,
  requestedCustomerType: unknown,
  items: OrderItem[],
  requestedDiscount: unknown,
) {
  const quantity = items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity)), 0);
  const subtotal = items.reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity)) * Math.max(0, Number(item.unitPrice)),
    0,
  );
  const customer = customerId
    ? await supabaseGetOne<RestCustomer>("customers", {
        select: "id,name,customerType:customer_type",
        id: `eq.${customerId}`,
      })
    : await supabaseGetOne<RestCustomer>("customers", {
        select: "id,name,customerType:customer_type",
        name: `eq.${customerName.trim()}`,
      });
  const customerType =
    customer?.customerType ||
    String(requestedCustomerType || "").trim() ||
    "Cliente final";
  const automatic = automaticDiscount(customerType, quantity);
  const requested = requestedDiscount === undefined || requestedDiscount === null || requestedDiscount === ""
    ? automatic
    : Number(requestedDiscount);
  if (!Number.isFinite(requested) || requested < 0 || requested >= 100)
    throw new Error("Informe um desconto valido.");
  if (requested > 10 && auth.role !== "admin")
    throw new Error("Descontos acima de 10% exigem autorizacao do administrador.");
  const discountRate = auth.role === "admin" ? requested : automatic;
  const total = Math.round(subtotal * (1 - discountRate / 100) * 100) / 100;
  return { quantity, subtotal, customerType, discountRate, total, customerId: customer?.id || customerId || null };
}

async function getOrdersFromRest() {
  const rows = await supabaseSelect<Record<string, unknown>>("service_orders", {
    select: "*",
    order: "id.desc",
    limit: "100",
  });
  return Response.json({
    orders: camelizeRows<Record<string, unknown>>(rows).map((order) => ({
      ...order,
      productionStatus: normalizeOrderStatus(order.productionStatus),
    })),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (hasSupabaseRest()) return postOrderWithRest(auth, body);
    const items = Array.isArray(body.items)
      ? (
          body.items as { code: string; quantity: number; unitPrice: number }[]
        ).filter((item) => item.code && Number(item.quantity) > 0)
      : [];
    const normalizedItems: OrderItem[] = items.length
      ? items
      : [{ code: String(body.productCode || ""), quantity: Math.max(1, Number(body.quantity || 1)), unitPrice: Math.max(0, Number(body.unitPrice || 0)) }];
    const productionStatus = requestedCreationStatus(body.productionStatus);
    const delivered = productionStatus === ORDER_STATUS.delivered;
    const pricedItems = normalizedItems;
    const storedItems = items;
    const quantity = normalizedItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity)), 0);
    const unitPrice = items.length
      ? Math.max(0, Number(items[0].unitPrice))
      : Math.max(0, Number(body.unitPrice || 0));
    // Em fila o valor já é calculado, mas não há pagamento, entrega nem recebível.
    const received = delivered ? Math.max(0, Number(body.received || 0)) : 0;
    const paymentMethod = delivered ? String(body.paymentMethod || "") : "";
    const deliveryType = delivered ? String(body.deliveryType || "") : "";
    if (delivered) {
      const fieldsError = deliveryFieldsError({ paymentMethod, deliveryType, received });
      if (fieldsError) return Response.json({ error: fieldsError }, { status: 400 });
    }
    const boletoTermDays = paymentMethod === "Boleto" ? parseBoletoTerm(body.boletoTermDays) : null;
    if (paymentMethod === "Boleto" && !boletoTermDays)
      return Response.json({ error: "Escolha o prazo do boleto: 25, 50 ou 75 dias." }, { status: 400 });
    if (!String(body.customerName || "").trim() || !normalizedItems.length || normalizedItems.some((item) => !item.code)) {
      return Response.json(
        { error: "Selecione o cliente e pelo menos uma peça." },
        { status: 400 },
      );
    }
    const db = await getDb();
    const totals = await calculateTotals(
      db,
      auth,
      Number(body.customerId || 0),
      String(body.customerName),
      body.customerType,
      pricedItems,
      body.discountRate,
    );
    const orderTotal = settleResidualTotal(totals.total, received);
    const moveToWallet =
      ["Pix", "Cartão"].includes(paymentMethod) &&
      received < orderTotal;
    const storedPaymentMethod = moveToWallet ? "Carteira" : paymentMethod;
    const initialWalletHistory =
      moveToWallet && received > 0
        ? JSON.stringify([
            {
              amount: Math.min(received, orderTotal),
              method: paymentMethod,
              date: String(body.createdAt || new Date().toISOString().slice(0, 10)),
            },
          ])
        : String(body.commercialStatus || "");
    const orderCreatedAt = String(body.createdAt || new Date().toISOString().slice(0, 10));
    let walletMonth = "";
    if (storedPaymentMethod === "Carteira") {
      const customerKey = String(body.customerName).trim().toLocaleLowerCase("pt-BR");
      const existingOrders = await db.select().from(serviceOrders);
      const openWalletOrder = existingOrders
        .filter(
          (order) =>
            order.customerName.trim().toLocaleLowerCase("pt-BR") === customerKey &&
            order.paymentMethod === "Carteira" &&
            order.productionStatus !== "Cancelada" &&
            order.received < order.total,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      walletMonth =
        openWalletOrder?.walletMonth ||
        openWalletOrder?.createdAt.slice(0, 7) ||
        orderCreatedAt.slice(0, 7);
    }
    // Numeração baseada no maior número já emitido (não no id, que diverge após exclusões).
    const [{ lastSeq }] = await db
      .select({ lastSeq: sql<number>`coalesce(max(cast(substring(${serviceOrders.number} from '[0-9]+$') as integer)), 0)` })
      .from(serviceOrders);
    const number = `OS-${new Date().getFullYear()}-${String(Number(lastSeq || 0) + 1).padStart(6, "0")}`;
    const issuedAt = orderCreatedAt.slice(0, 10);
    const dueDate = boletoTermDays ? boletoFirstDueDate(issuedAt) : receivableDueDateFromIssuedAt(issuedAt);
    const [order] = await db
      .insert(serviceOrders)
      .values({
        number,
        customerName: String(body.customerName),
        customerType: totals.customerType,
        origin: String(body.origin || "WhatsApp"),
        createdAt: orderCreatedAt,
        issuedAt,
        dueDate,
        boletoTermDays,
        productCode: storedItems.length
          ? JSON.stringify(storedItems)
          : String(body.productCode),
        quantity,
        unitPrice,
        subtotal: totals.subtotal,
        discountRate: totals.discountRate,
        total: orderTotal,
        received: Math.min(received, orderTotal),
        deliveryDate: String(body.deliveryDate || body.createdAt || new Date().toISOString().slice(0, 10)),
        deliveryType,
        paymentMethod: storedPaymentMethod,
        walletMonth,
        productionStatus,
        commercialStatus: initialWalletHistory,
        notes: String(body.notes || ""),
      })
      .returning();
    return Response.json({ order }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a OS.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (hasSupabaseRest()) return patchOrderWithRest(auth, body);
    const id = Number(body.id);
    if (!id) return Response.json({ error: "OS inválida." }, { status: 400 });
    const requestedStatus = body.productionStatus !== undefined ? requestedUpdateStatus(body.productionStatus) : null;
    if (body.productionStatus !== undefined && body.productionStatus !== "" && !requestedStatus)
      return Response.json({ error: "Status inválido." }, { status: 400 });
    const db = await getDb();
    const [current] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, id)).limit(1);
    if (!current) return Response.json({ error: "OS não encontrada." }, { status: 404 });
    const currentStatus = normalizeOrderStatus(current.productionStatus);
    const nextStatus = requestedStatus ?? currentStatus;
    // Em fila (sem pagamento definido) a OS guarda só cliente, peças, data e observações.
    const isRevertToQueue = currentStatus === ORDER_STATUS.delivered && nextStatus === ORDER_STATUS.queue;
    const queuedBasic =
      nextStatus === ORDER_STATUS.queue &&
      (isRevertToQueue || !String(body.paymentMethod ?? current.paymentMethod ?? "").trim());
    const effectivePaymentMethod = String(body.paymentMethod ?? current.paymentMethod);
    const effectiveDeliveryType = String(body.deliveryType ?? current.deliveryType);
    const effectiveReceived = Math.max(0, Number(body.received ?? current.received));
    const validatesPayment =
      !queuedBasic &&
      (nextStatus === ORDER_STATUS.delivered ||
        body.paymentMethod !== undefined ||
        body.deliveryType !== undefined ||
        body.received !== undefined ||
        body.productCode !== undefined);
    if (validatesPayment && nextStatus !== ORDER_STATUS.canceled) {
      const fieldsError = deliveryFieldsError({
        paymentMethod: effectivePaymentMethod,
        deliveryType: effectiveDeliveryType,
        received: effectiveReceived,
      });
      if (fieldsError) return Response.json({ error: fieldsError }, { status: 400 });
    }
    if (currentStatus === ORDER_STATUS.canceled && requestedStatus && requestedStatus !== ORDER_STATUS.canceled)
      return Response.json({ error: "OS cancelada não pode ser reaberta." }, { status: 400 });
    if (isRevertToQueue) {
      const blocked = revertToQueueBlockedReason({ receivedCents: Math.round(current.received * 100), receiptCount: 0 });
      if (blocked) return Response.json({ error: blocked }, { status: 400 });
    }
    const changes: Partial<typeof serviceOrders.$inferInsert> = {};
    if (body.paymentMethod !== undefined || body.boletoTermDays !== undefined) {
      const nextTerm =
        effectivePaymentMethod === "Boleto" ? parseBoletoTerm(body.boletoTermDays ?? current.boletoTermDays) : null;
      if (effectivePaymentMethod === "Boleto" && !nextTerm)
        return Response.json({ error: "Escolha o prazo do boleto: 25, 50 ou 75 dias." }, { status: 400 });
      const blocked = await assertBoletoTermChangeAllowedDb(db, id, nextTerm);
      if (blocked) return Response.json({ error: blocked }, { status: 400 });
      changes.boletoTermDays = nextTerm;
    }
    if (requestedStatus) changes.productionStatus = requestedStatus;
    if (isRevertToQueue) {
      // Volta para a fila: o valor da OS fica, some pagamento, entrega e recebido.
      changes.paymentMethod = "";
      changes.deliveryType = "";
      changes.received = 0;
      changes.boletoTermDays = null;
      changes.walletMonth = "";
    }
    if (body.received !== undefined)
      changes.received = Math.max(0, Number(body.received));
    if (body.deliveryDate) changes.deliveryDate = String(body.deliveryDate);
    if (body.notes !== undefined) changes.notes = String(body.notes);
    if (body.commercialStatus !== undefined)
      changes.commercialStatus = String(body.commercialStatus);
    if (body.customerName !== undefined) changes.customerName = String(body.customerName);
    if (body.createdAt !== undefined) {
      changes.createdAt = String(body.createdAt);
      const issuedAt = String(body.createdAt).slice(0, 10);
      changes.issuedAt = issuedAt;
      changes.dueDate = receivableDueDateFromIssuedAt(issuedAt);
    }
    if (body.origin !== undefined) changes.origin = String(body.origin);
    if (body.productCode !== undefined) {
      const items = Array.isArray(body.items)
        ? (body.items as { code: string; quantity: number; unitPrice: number }[])
        : [];
      if (items.length) {
        const customerName = String(body.customerName ?? current.customerName);
        const totals = await calculateTotals(
          db,
          auth,
          Number(body.customerId || 0),
          customerName,
          body.customerType,
          items,
          body.discountRate,
        );
        changes.productCode = JSON.stringify(items);
        changes.quantity = totals.quantity;
        changes.unitPrice = Math.max(0, Number(items[0].unitPrice));
        changes.subtotal = totals.subtotal;
        changes.customerType = totals.customerType;
        changes.discountRate = totals.discountRate;
        changes.total = totals.total;
      } else {
        changes.productCode = String(body.productCode);
      }
    }
    if (body.deliveryType !== undefined) changes.deliveryType = String(body.deliveryType);
    if (body.paymentMethod !== undefined) changes.paymentMethod = String(body.paymentMethod);
    if (effectivePaymentMethod === "Carteira") {
      const customerName = String(body.customerName ?? current.customerName);
      const customerKey = customerName.trim().toLocaleLowerCase("pt-BR");
      const existingOrders = await db.select().from(serviceOrders);
      const openWalletOrder = existingOrders
        .filter(
          (order) =>
            order.id !== current.id &&
            order.customerName.trim().toLocaleLowerCase("pt-BR") === customerKey &&
            order.paymentMethod === "Carteira" &&
            order.productionStatus !== "Cancelada" &&
            order.received < order.total,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      const effectiveCreatedAt = String(body.createdAt ?? current.createdAt);
      changes.walletMonth =
        openWalletOrder?.walletMonth ||
        openWalletOrder?.createdAt.slice(0, 7) ||
        current.walletMonth ||
        effectiveCreatedAt.slice(0, 7);
    } else if (body.paymentMethod !== undefined) {
      changes.walletMonth = "";
    }
    if (!Object.keys(changes).length)
      return Response.json(
        { error: "Nenhuma alteração informada." },
        { status: 400 },
      );
    const projectedTotal = changes.total !== undefined ? Number(changes.total) : current.total;
    const projectedReceived = changes.received !== undefined ? Number(changes.received) : current.received;
    const settledTotal = settleResidualTotal(projectedTotal, projectedReceived);
    if (settledTotal !== projectedTotal) changes.total = settledTotal;
    const [order] = await db
      .update(serviceOrders)
      .set(changes)
      .where(eq(serviceOrders.id, id))
      .returning();
    if (!order)
      return Response.json({ error: "OS não encontrada." }, { status: 404 });
    return Response.json({ order });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar a OS.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    if (hasSupabaseRest()) {
      await supabaseDelete("service_orders", { id: "gte.0" });
      return Response.json({ success: true });
    }
    const db = await getDb();
    await db.delete(serviceOrders);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível limpar as ordens.",
      },
      { status: 500 },
    );
  }
}

async function postOrderWithRest(auth: { role: string }, body: Record<string, unknown>) {
  const items = Array.isArray(body.items)
    ? (body.items as { code: string; quantity: number; unitPrice: number }[]).filter((item) => item.code && Number(item.quantity) > 0)
    : [];
  const normalizedItems: OrderItem[] = items.length
    ? items
    : [{ code: String(body.productCode || ""), quantity: Math.max(1, Number(body.quantity || 1)), unitPrice: Math.max(0, Number(body.unitPrice || 0)) }];
  const productionStatus = requestedCreationStatus(body.productionStatus);
  const delivered = productionStatus === ORDER_STATUS.delivered;
  const pricedItems = normalizedItems;
  const storedItems = items;
  const unitPrice = items.length
    ? Math.max(0, Number(items[0].unitPrice))
    : Math.max(0, Number(body.unitPrice || 0));
  // Em fila o valor já é calculado, mas não há pagamento, entrega nem recebível.
  const received = delivered ? Math.max(0, Number(body.received || 0)) : 0;
  const paymentMethod = delivered ? String(body.paymentMethod || "") : "";
  const deliveryType = delivered ? String(body.deliveryType || "") : "";
  if (delivered) {
    const fieldsError = deliveryFieldsError({ paymentMethod, deliveryType, received });
    if (fieldsError) return Response.json({ error: fieldsError }, { status: 400 });
  }
  const boletoTermDays = paymentMethod === "Boleto" ? parseBoletoTerm(body.boletoTermDays) : null;
  if (paymentMethod === "Boleto" && !boletoTermDays)
    return Response.json({ error: "Escolha o prazo do boleto: 25, 50 ou 75 dias." }, { status: 400 });
  if (!String(body.customerName || "").trim() || !normalizedItems.length || normalizedItems.some((item) => !item.code))
    return Response.json({ error: "Selecione o cliente e pelo menos uma peca." }, { status: 400 });
  const totals = await calculateTotalsFromRest(
    auth,
    Number(body.customerId || 0),
    String(body.customerName),
    body.customerType,
    pricedItems,
    body.discountRate,
  );
  const orderTotal = settleResidualTotal(totals.total, received);
  const moveToWallet = ["Pix", "Cartão"].includes(paymentMethod) && received < orderTotal;
  const storedPaymentMethod = moveToWallet ? "Carteira" : paymentMethod;
  const initialWalletHistory =
    moveToWallet && received > 0
      ? JSON.stringify([{ amount: Math.min(received, orderTotal), method: paymentMethod, date: String(body.createdAt || new Date().toISOString().slice(0, 10)) }])
      : String(body.commercialStatus || "");
  const orderCreatedAt = String(body.createdAt || new Date().toISOString().slice(0, 10));
  const issuedAt = orderCreatedAt.slice(0, 10);
  const dueDate = boletoTermDays ? boletoFirstDueDate(issuedAt) : receivableDueDateFromIssuedAt(issuedAt);
  // Numeração baseada no maior número já emitido (não no id, que diverge após exclusões).
  const [lastOrder] = await supabaseSelect<{ number: string }>("service_orders", {
    select: "number",
    order: "number.desc",
    limit: "1",
  });
  const lastSeq = Number(String(lastOrder?.number || "").match(/(\d+)$/)?.[1] || 0);
  const number = `OS-${new Date().getFullYear()}-${String(lastSeq + 1).padStart(6, "0")}`;
  const order = await supabaseInsert<Record<string, unknown>>("service_orders", {
    number,
    customer_id: totals.customerId,
    customer_name: String(body.customerName),
    customer_type: totals.customerType,
    origin: String(body.origin || "WhatsApp"),
    created_at: orderCreatedAt,
    issued_at: issuedAt,
    due_date: dueDate,
    boleto_term_days: boletoTermDays,
    product_code: storedItems.length ? JSON.stringify(storedItems) : String(body.productCode),
    quantity: totals.quantity,
    unit_price: unitPrice,
    subtotal: totals.subtotal,
    discount_rate: totals.discountRate,
    total: orderTotal,
    received: Math.min(received, orderTotal),
    delivery_date: String(body.deliveryDate || body.createdAt || new Date().toISOString().slice(0, 10)),
    delivery_type: deliveryType,
    payment_method: storedPaymentMethod,
    wallet_month: storedPaymentMethod === "Carteira" ? orderCreatedAt.slice(0, 7) : "",
    production_status: productionStatus,
    commercial_status: initialWalletHistory,
    notes: String(body.notes || ""),
  });
  const serviceOrderId = Number(order.id || 0);
  // Recebível e parcelas só nascem na entrega.
  if (serviceOrderId && delivered) {
    const originalAmountCents = Math.round(totals.total * 100);
    const receivedAmountCents = Math.min(Math.round(received * 100), originalAmountCents);
    const balanceCents = Math.max(0, originalAmountCents - receivedAmountCents);
    try {
      const receivableRow = await supabaseInsert<Record<string, unknown>>("accounts_receivable", {
        service_order_id: serviceOrderId,
        customer_id: totals.customerId,
        issued_at: issuedAt,
        due_date: dueDate,
        original_amount_cents: originalAmountCents,
        received_amount_cents: receivedAmountCents,
        balance_cents: balanceCents,
        status: balanceCents <= 0 ? "Pago" : "Pendente",
        notes: String(body.notes || ""),
      });
      if (boletoTermDays && receivableRow?.id)
        await syncInstallmentsRest({
          accountReceivableId: Number(receivableRow.id),
          serviceOrderId,
          totalCents: originalAmountCents,
          receivedCents: receivedAmountCents,
          issuedAt,
          termDays: boletoTermDays,
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (!/duplicate|23505|unique/i.test(message)) {
        console.error("Não foi possível criar a conta a receber da OS", serviceOrderId, error);
      }
    }
  }
  return Response.json({ order: camelizeRow(order) }, { status: 201 });
}

async function patchOrderWithRest(auth: { role: string }, body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) return Response.json({ error: "OS invalida." }, { status: 400 });
  const current = await supabaseGetOne<RestOrder>("service_orders", {
    select: "*",
    id: `eq.${id}`,
  });
  if (!current) return Response.json({ error: "OS nao encontrada." }, { status: 404 });
  const requestedStatus = body.productionStatus !== undefined ? requestedUpdateStatus(body.productionStatus) : null;
  if (body.productionStatus !== undefined && body.productionStatus !== "" && !requestedStatus)
    return Response.json({ error: "Status inválido." }, { status: 400 });
  const currentStatus = normalizeOrderStatus(current.production_status);
  const nextStatus = requestedStatus ?? currentStatus;
  const currentPayment = String(current.payment_method ?? "").trim();
  if (currentStatus === ORDER_STATUS.canceled && requestedStatus && requestedStatus !== ORDER_STATUS.canceled)
    return Response.json({ error: "OS cancelada não pode ser reaberta." }, { status: 400 });
  const isRevertToQueue = currentStatus === ORDER_STATUS.delivered && nextStatus === ORDER_STATUS.queue;
  // Em fila (sem pagamento definido) a OS guarda só cliente, peças, data e observações:
  // não existe recebível e nada financeiro é recalculado.
  const queuedBasic =
    (nextStatus === ORDER_STATUS.queue || nextStatus === ORDER_STATUS.canceled) &&
    currentStatus !== ORDER_STATUS.delivered &&
    !currentPayment &&
    body.paymentMethod === undefined;
  if (currentStatus !== ORDER_STATUS.delivered && nextStatus === ORDER_STATUS.delivered) {
    const fieldsError = deliveryFieldsError({
      paymentMethod: String(body.paymentMethod ?? current.payment_method ?? ""),
      deliveryType: String(body.deliveryType ?? current.delivery_type ?? ""),
      received: Math.max(0, Number(body.received ?? current.received ?? 0)),
    });
    if (fieldsError) return Response.json({ error: fieldsError }, { status: 400 });
    if (!Array.isArray(body.items) || !body.items.length)
      return Response.json({ error: "Informe as peças com valor para entregar a OS." }, { status: 400 });
  }
  if (isRevertToQueue) {
    const receipts = await supabaseSelect<{ id: number }>("receipts", {
      select: "id",
      service_order_id: `eq.${id}`,
      limit: "1",
    });
    const blocked = revertToQueueBlockedReason({
      receivedCents: Math.max(Math.round(Number(current.received_cents || 0)), Math.round(Number(current.received || 0) * 100)),
      receiptCount: receipts.length,
    });
    if (blocked) return Response.json({ error: blocked }, { status: 400 });
    await supabaseDelete("receivable_installments", { service_order_id: `eq.${id}` });
    await supabaseDelete("accounts_receivable", { service_order_id: `eq.${id}` });
    // Volta para a fila: o valor da OS fica (itens, subtotal, desconto, total); some pagamento, entrega e recebido.
    let revertedProductCode = String(current.product_code || "");
    let revertedQuantity = Number(current.quantity || 0);
    let revertedTotals: Record<string, string | number> = {};
    const incomingItems = Array.isArray(body.items) ? (body.items as OrderItem[]).filter((item) => item.code) : [];
    if (incomingItems.length) {
      const totals = await calculateTotalsFromRest(
        auth,
        Number(body.customerId || 0),
        String(body.customerName ?? current.customer_name ?? ""),
        body.customerType,
        incomingItems,
        body.discountRate,
      );
      revertedProductCode = JSON.stringify(incomingItems);
      revertedQuantity = totals.quantity;
      revertedTotals = {
        unit_price: Math.max(0, Number(incomingItems[0].unitPrice)),
        subtotal: totals.subtotal,
        subtotal_cents: Math.round(totals.subtotal * 100),
        discount_rate: totals.discountRate,
        discount_cents: Math.max(0, Math.round((totals.subtotal - totals.total) * 100)),
        total: totals.total,
        total_cents: Math.round(totals.total * 100),
        balance_cents: Math.round(totals.total * 100),
        customer_type: totals.customerType,
      };
    }
    // Edições feitas no mesmo salvamento (cliente, data, observações) também valem.
    const revertedIssuedAt = body.createdAt !== undefined ? String(body.createdAt).slice(0, 10) : null;
    const reverted = await supabasePatch<Record<string, unknown>>("service_orders", { id: `eq.${id}` }, {
      production_status: ORDER_STATUS.queue,
      payment_method: "",
      delivery_type: "",
      boleto_term_days: null,
      wallet_month: "",
      received: 0,
      received_cents: 0,
      financial_status: "Pendente",
      product_code: revertedProductCode,
      quantity: revertedQuantity,
      ...revertedTotals,
      ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
      ...(body.customerName !== undefined ? { customer_name: String(body.customerName) } : {}),
      ...(revertedIssuedAt
        ? { created_at: String(body.createdAt), issued_at: revertedIssuedAt, due_date: receivableDueDateFromIssuedAt(revertedIssuedAt) }
        : {}),
      updated_at: new Date().toISOString(),
    });
    return Response.json({ order: camelizeRow(reverted) });
  }
  const changes: Record<string, string | number | null> = {};
  if (body.paymentMethod !== undefined || body.boletoTermDays !== undefined) {
    const effectiveMethod = String(body.paymentMethod ?? current.payment_method ?? "");
    const nextTerm =
      effectiveMethod === "Boleto" ? parseBoletoTerm(body.boletoTermDays ?? current.boleto_term_days) : null;
    if (effectiveMethod === "Boleto" && !nextTerm)
      return Response.json({ error: "Escolha o prazo do boleto: 25, 50 ou 75 dias." }, { status: 400 });
    const blocked = await assertBoletoTermChangeAllowedRest(id, nextTerm);
    if (blocked) return Response.json({ error: blocked }, { status: 400 });
    changes.boleto_term_days = nextTerm;
  }
  if (requestedStatus) changes.production_status = requestedStatus;
  if (body.received !== undefined) changes.received = Math.max(0, Number(body.received));
  if (body.deliveryDate) changes.delivery_date = String(body.deliveryDate);
  if (body.notes !== undefined) changes.notes = String(body.notes);
  if (body.commercialStatus !== undefined) changes.commercial_status = String(body.commercialStatus);
  if (body.customerName !== undefined) changes.customer_name = String(body.customerName);
  if (body.createdAt !== undefined) {
    changes.created_at = String(body.createdAt);
    const issuedAt = String(body.createdAt).slice(0, 10);
    changes.issued_at = issuedAt;
    changes.due_date = receivableDueDateFromIssuedAt(issuedAt);
  }
  if (body.origin !== undefined) changes.origin = String(body.origin);
  if (body.deliveryType !== undefined) changes.delivery_type = String(body.deliveryType);
  if (body.paymentMethod !== undefined) changes.payment_method = String(body.paymentMethod);
  if (body.productCode !== undefined) {
    const items = Array.isArray(body.items) ? (body.items as { code: string; quantity: number; unitPrice: number }[]) : [];
    if (items.length) {
      const totals = await calculateTotalsFromRest(
        auth,
        Number(body.customerId || 0),
        String(body.customerName ?? current.customer_name ?? ""),
        body.customerType,
        items,
        body.discountRate,
      );
      changes.product_code = JSON.stringify(items);
      changes.quantity = totals.quantity;
      changes.unit_price = Math.max(0, Number(items[0].unitPrice));
      changes.subtotal = totals.subtotal;
      changes.customer_type = totals.customerType;
      changes.discount_rate = totals.discountRate;
      changes.total = totals.total;
      changes.customer_id = totals.customerId;
    } else {
      changes.product_code = String(body.productCode);
    }
  }
  if (queuedBasic) {
    if (!Object.keys(changes).length) return Response.json({ error: "Nenhuma alteracao informada." }, { status: 400 });
    changes.updated_at = new Date().toISOString();
    const queuedOrder = await supabasePatch<Record<string, unknown>>("service_orders", { id: `eq.${id}` }, changes);
    return Response.json({ order: camelizeRow(queuedOrder) });
  }
  if (String(body.paymentMethod ?? current.payment_method ?? "") === "Carteira") {
    const effectiveCreatedAt = String(body.createdAt ?? current.createdAt);
    changes.wallet_month = current.walletMonth || effectiveCreatedAt.slice(0, 7);
  } else if (body.paymentMethod !== undefined) {
    changes.wallet_month = "";
  }
  if (!Object.keys(changes).length) return Response.json({ error: "Nenhuma alteracao informada." }, { status: 400 });
  const projectedTotal = changes.total !== undefined ? Number(changes.total) : current.total;
  const projectedReceived = changes.received !== undefined ? Number(changes.received) : current.received;
  const settledTotal = settleResidualTotal(projectedTotal, projectedReceived);
  if (settledTotal !== projectedTotal) changes.total = settledTotal;
  const order = await supabasePatch<Record<string, unknown>>("service_orders", { id: `eq.${id}` }, changes);
  const totalCents = Math.round(Number(order.total || 0) * 100);
  const subtotalCents = Math.round(Number(order.subtotal || order.total || 0) * 100);
  const receivedCents = Math.min(
    Math.round(Number(order.received || 0) * 100),
    totalCents,
  );
  const balanceCents = Math.max(0, totalCents - receivedCents);
  const issuedAt = String(order.issued_at || order.created_at || "").slice(0, 10);
  const dueDate = String(order.due_date || receivableDueDateFromIssuedAt(issuedAt)).slice(0, 10);
  const financialStatus = receivableStatus(balanceCents, dueDate);
  const syncedOrder = await supabasePatch<Record<string, unknown>>("service_orders", { id: `eq.${id}` }, {
    subtotal_cents: subtotalCents,
    discount_cents: Math.max(0, subtotalCents - totalCents),
    total_cents: totalCents,
    received_cents: receivedCents,
    balance_cents: balanceCents,
    financial_status: financialStatus,
    updated_at: new Date().toISOString(),
  });
  const receivable = await supabaseGetOne<Record<string, unknown>>("accounts_receivable", {
    select: "*",
    service_order_id: `eq.${id}`,
  });
  const receivableValues = {
    customer_id: Number(order.customer_id || 0) || null,
    issued_at: issuedAt,
    due_date: dueDate,
    original_amount_cents: totalCents,
    received_amount_cents: receivedCents,
    balance_cents: balanceCents,
    status: financialStatus,
    notes: String(order.notes || ""),
    updated_at: new Date().toISOString(),
  };
  let receivableId = receivable ? Number(receivable.id) : 0;
  if (receivable) {
    await supabasePatch("accounts_receivable", { id: `eq.${receivableId}` }, receivableValues);
  } else {
    const inserted = await supabaseInsert<Record<string, unknown>>("accounts_receivable", {
      service_order_id: id,
      ...receivableValues,
    });
    receivableId = Number(inserted?.id || 0);
  }
  const termDays = parseBoletoTerm(order.boleto_term_days);
  if (termDays && receivableId) {
    // Boleto parcelado: parcelas, vencimento e status da conta saem do plano de parcelas.
    await syncInstallmentsRest({
      accountReceivableId: receivableId,
      serviceOrderId: id,
      totalCents,
      receivedCents,
      issuedAt,
      termDays,
      canceled: String(order.production_status || "") === "Cancelada",
    });
    const finalOrder = await supabaseGetOne<Record<string, unknown>>("service_orders", { select: "*", id: `eq.${id}` });
    return Response.json({ order: camelizeRow(finalOrder || syncedOrder) });
  }
  if (body.paymentMethod !== undefined) await supabaseDelete("receivable_installments", { service_order_id: `eq.${id}` });
  return Response.json({ order: camelizeRow(syncedOrder) });
}
