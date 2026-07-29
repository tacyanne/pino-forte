import { desc, eq, max } from "drizzle-orm";
import { getDb } from "../../../db";
import { customers, serviceOrders } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";

type OrderItem = { code: string; quantity: number; unitPrice: number };

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
  const customerType =
    String(requestedCustomerType || "").trim() ||
    customer?.customerType ||
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
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(serviceOrders)
      .orderBy(desc(serviceOrders.id))
      .limit(100);
    const customerRows = await db.select().from(customers);
    const customerTypes = new Map(
      customerRows.map((customer) => [
        customer.name.trim().toLocaleLowerCase("pt-BR"),
        customer.customerType.trim().toLocaleLowerCase("pt-BR"),
      ]),
    );
    const repairedRows = await Promise.all(
      rows.map(async (order) => {
        const isDistributor =
          order.customerType.trim().toLocaleLowerCase("pt-BR") === "distribuidor" ||
          customerTypes.get(order.customerName.trim().toLocaleLowerCase("pt-BR")) ===
            "distribuidor";
        if (!isDistributor || order.discountRate > 0) return order;
        const subtotal = order.subtotal > 0 ? order.subtotal : order.total;
        const discountRate = automaticDiscount("Distribuidor", order.quantity);
        const total = Math.round(subtotal * (1 - discountRate / 100) * 100) / 100;
        const [updated] = await db
          .update(serviceOrders)
          .set({
            subtotal,
            customerType: "Distribuidor",
            discountRate,
            total,
            received: Math.min(order.received, total),
          })
          .where(eq(serviceOrders.id, order.id))
          .returning();
        return updated || order;
      }),
    );
    return Response.json({
      orders: repairedRows.map((order) => ({
        ...order,
        productionStatus:
          order.productionStatus === "Aguardando"
            ? "Fila de produção"
            : order.productionStatus,
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

export async function POST(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const items = Array.isArray(body.items)
      ? (
          body.items as { code: string; quantity: number; unitPrice: number }[]
        ).filter((item) => item.code && Number(item.quantity) > 0)
      : [];
    const normalizedItems: OrderItem[] = items.length
      ? items
      : [{ code: String(body.productCode || ""), quantity: Math.max(1, Number(body.quantity || 1)), unitPrice: Math.max(0, Number(body.unitPrice || 0)) }];
    const quantity = normalizedItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity)), 0);
    const unitPrice = items.length
      ? Math.max(0, Number(items[0].unitPrice))
      : Math.max(0, Number(body.unitPrice || 0));
    const received = Math.max(0, Number(body.received || 0));
    const paymentMethod = String(body.paymentMethod || "");
    const deliveryType = String(body.deliveryType || "");
    if (!["Pix", "Dinheiro", "Cartão", "Boleto", "Carteira"].includes(paymentMethod))
      return Response.json({ error: "Selecione a forma de pagamento." }, { status: 400 });
    if (!["Retirada no local", "Entrega"].includes(deliveryType))
      return Response.json({ error: "Selecione a forma de entrega." }, { status: 400 });
    if (["Pix", "Dinheiro", "Cartão"].includes(paymentMethod) && received <= 0)
      return Response.json({ error: "Informe o valor recebido." }, { status: 400 });
    const requestedStatus = String(body.productionStatus || "Fila de produção");
    const productionStatus = ["Fila de produção", "Em produção", "Pronta", "Entregue"].includes(requestedStatus)
      ? requestedStatus
      : "Fila de produção";
    if (!String(body.customerName || "").trim() || !normalizedItems.length || normalizedItems.some((item) => !item.code)) {
      return Response.json(
        { error: "Selecione o cliente e pelo menos um pino." },
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
      normalizedItems,
      body.discountRate,
    );
    const [{ lastId }] = await db
      .select({ lastId: max(serviceOrders.id) })
      .from(serviceOrders);
    const number = `OS-${new Date().getFullYear()}-${String(Number(lastId || 0) + 1).padStart(6, "0")}`;
    const [order] = await db
      .insert(serviceOrders)
      .values({
        number,
        customerName: String(body.customerName),
        customerType: totals.customerType,
        origin: String(body.origin || "WhatsApp"),
        createdAt: body.createdAt ? String(body.createdAt) : undefined,
        productCode: items.length
          ? JSON.stringify(items)
          : String(body.productCode),
        quantity,
        unitPrice,
        subtotal: totals.subtotal,
        discountRate: totals.discountRate,
        total: totals.total,
        received: Math.min(received, totals.total),
        deliveryDate: String(body.deliveryDate || body.createdAt || new Date().toISOString().slice(0, 10)),
        deliveryType,
        paymentMethod,
        productionStatus,
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
    const id = Number(body.id);
    if (!id) return Response.json({ error: "OS inválida." }, { status: 400 });
    const allowedProduction = [
      "Fila de produção",
      "Aguardando",
      "Em produção",
      "Pronta",
      "Entregue",
      "Cancelada",
    ];
    const db = await getDb();
    const [current] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, id)).limit(1);
    if (!current) return Response.json({ error: "OS não encontrada." }, { status: 404 });
    const effectivePaymentMethod = String(body.paymentMethod ?? current.paymentMethod);
    const effectiveDeliveryType = String(body.deliveryType ?? current.deliveryType);
    const effectiveReceived = Math.max(0, Number(body.received ?? current.received));
    const validatesPayment =
      body.paymentMethod !== undefined ||
      body.deliveryType !== undefined ||
      body.received !== undefined ||
      body.productCode !== undefined;
    if (validatesPayment && !["Pix", "Dinheiro", "Cartão", "Boleto", "Carteira"].includes(effectivePaymentMethod))
      return Response.json({ error: "Selecione a forma de pagamento." }, { status: 400 });
    if (validatesPayment && !["Retirada no local", "Entrega"].includes(effectiveDeliveryType))
      return Response.json({ error: "Selecione a forma de entrega." }, { status: 400 });
    if (validatesPayment && ["Pix", "Dinheiro", "Cartão"].includes(effectivePaymentMethod) && effectiveReceived <= 0)
      return Response.json({ error: "Informe o valor recebido." }, { status: 400 });
    const changes: Partial<typeof serviceOrders.$inferInsert> = {};
    if (
      body.productionStatus &&
      allowedProduction.includes(String(body.productionStatus))
    )
      changes.productionStatus = String(body.productionStatus);
    if (body.received !== undefined)
      changes.received = Math.max(0, Number(body.received));
    if (body.deliveryDate) changes.deliveryDate = String(body.deliveryDate);
    if (body.notes !== undefined) changes.notes = String(body.notes);
    if (body.commercialStatus !== undefined)
      changes.commercialStatus = String(body.commercialStatus);
    if (body.customerName !== undefined) changes.customerName = String(body.customerName);
    if (body.createdAt !== undefined) changes.createdAt = String(body.createdAt);
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
    if (!Object.keys(changes).length)
      return Response.json(
        { error: "Nenhuma alteração informada." },
        { status: 400 },
      );
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
