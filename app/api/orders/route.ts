import { desc, eq, max } from "drizzle-orm";
import { getDb } from "../../../db";
import { serviceOrders } from "../../../db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.select().from(serviceOrders).orderBy(desc(serviceOrders.id)).limit(100);
    return Response.json({ orders: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível consultar as ordens." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, string | number>;
    const quantity = Math.max(1, Number(body.quantity || 1));
    const unitPrice = Math.max(0, Number(body.unitPrice || 0));
    const received = Math.max(0, Number(body.received || 0));
    if (!body.customerName || !body.productCode || !body.deliveryDate) {
      return Response.json({ error: "Cliente, pino e previsão de entrega são obrigatórios." }, { status: 400 });
    }
    const db = await getDb();
    const [{ lastId }] = await db.select({ lastId: max(serviceOrders.id) }).from(serviceOrders);
    const number = `OS-${new Date().getFullYear()}-${String(Number(lastId || 0) + 1).padStart(6, "0")}`;
    const [order] = await db.insert(serviceOrders).values({
      number,
      customerName: String(body.customerName),
      origin: String(body.origin || "WhatsApp"),
      productCode: String(body.productCode), quantity, unitPrice,
      total: quantity * unitPrice, received,
      deliveryDate: String(body.deliveryDate),
      deliveryType: String(body.deliveryType || "Retirada no local"),
      paymentMethod: String(body.paymentMethod || "Pix"),
      notes: String(body.notes || ""),
    }).returning();
    return Response.json({ order }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível salvar a OS." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, string | number>;
    const id = Number(body.id);
    if (!id) return Response.json({ error: "OS inválida." }, { status: 400 });
    const allowedProduction = ["Aguardando", "Em produção", "Pronta", "Entregue", "Cancelada"];
    const db = await getDb();
    const changes: Partial<typeof serviceOrders.$inferInsert> = {};
    if (body.productionStatus && allowedProduction.includes(String(body.productionStatus))) changes.productionStatus = String(body.productionStatus);
    if (body.received !== undefined) changes.received = Math.max(0, Number(body.received));
    if (body.deliveryDate) changes.deliveryDate = String(body.deliveryDate);
    if (body.notes !== undefined) changes.notes = String(body.notes);
    if (!Object.keys(changes).length) return Response.json({ error: "Nenhuma alteração informada." }, { status: 400 });
    const [order] = await db.update(serviceOrders).set(changes).where(eq(serviceOrders.id, id)).returning();
    if (!order) return Response.json({ error: "OS não encontrada." }, { status: 404 });
    return Response.json({ order });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar a OS." }, { status: 500 });
  }
}
