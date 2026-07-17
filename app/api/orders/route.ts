import { desc, eq, max } from "drizzle-orm";
import { getDb } from "../../../db";
import { serviceOrders } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
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
        productionStatus:
          order.productionStatus === "Aguardando"
            ? "Fila de produção"
            : order.productionStatus,
      })),
    });
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
    const quantity = items.length
      ? items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity)), 0)
      : Math.max(1, Number(body.quantity || 1));
    const unitPrice = items.length
      ? Math.max(0, Number(items[0].unitPrice))
      : Math.max(0, Number(body.unitPrice || 0));
    const received = Math.max(0, Number(body.received || 0));
    const requestedStatus = String(body.productionStatus || "Fila de produção");
    const productionStatus = ["Fila de produção", "Em produção", "Pronta", "Entregue"].includes(requestedStatus)
      ? requestedStatus
      : "Fila de produção";
    if (!body.customerName || !body.productCode || !body.deliveryDate) {
      return Response.json(
        { error: "Cliente, pino e previsão de entrega são obrigatórios." },
        { status: 400 },
      );
    }
    const db = await getDb();
    const [{ lastId }] = await db
      .select({ lastId: max(serviceOrders.id) })
      .from(serviceOrders);
    const number = `OS-${new Date().getFullYear()}-${String(Number(lastId || 0) + 1).padStart(6, "0")}`;
    const [order] = await db
      .insert(serviceOrders)
      .values({
        number,
        customerName: String(body.customerName),
        origin: String(body.origin || "WhatsApp"),
        productCode: items.length
          ? JSON.stringify(items)
          : String(body.productCode),
        quantity,
        unitPrice,
        total: items.length
          ? items.reduce(
              (sum, item) =>
                sum +
                Math.max(1, Number(item.quantity)) *
                  Math.max(0, Number(item.unitPrice)),
              0,
            )
          : quantity * unitPrice,
        received,
        deliveryDate: String(body.deliveryDate),
        deliveryType: String(body.deliveryType || "Retirada no local"),
        paymentMethod: String(body.paymentMethod || "Pix"),
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
    const body = (await request.json()) as Record<string, string | number>;
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
