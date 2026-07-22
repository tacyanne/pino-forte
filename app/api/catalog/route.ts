import { asc, eq, like } from "drizzle-orm";
import { getDb } from "../../../db";
import { customers, products } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";

const initialProducts = [
  ["RN 180", "RN-180", "Pino de balança RN 180", "180 mm", 49],
  ["RN 190", "RN-190", "Pino de balança RN 190", "190 mm", 55],
  ["RN 205", "RN-205", "Pino de balança RN 205", "205 mm", 56],
  ["RN 225", "RN-225", "Pino de balança RN 225", "225 mm", 57],
  ["RO 215", "RO-215", "Pino de balança RO 215", "215 mm", 63],
  ["RO 235", "RO-235", "Pino de balança RO 235", "235 mm", 68],
] as const;

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const db = await getDb();
    let productRows = await db.select().from(products).orderBy(asc(products.code));
    if (!productRows.length) {
      await db.insert(products).values(initialProducts.map(([code, sku, name, measure, price]) => ({ code, sku, name, measure, price })));
      productRows = await db.select().from(products).orderBy(asc(products.code));
    }
    const customerRows = await db.select().from(customers).orderBy(asc(customers.name));
    return Response.json({ products: productRows, customers: customerRows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os cadastros." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as { type?: string; name?: string; whatsapp?: string; document?: string; email?: string; zipCode?: string; street?: string; number?: string; complement?: string; neighborhood?: string; city?: string; state?: string; code?: string; sku?: string; measure?: string; price?: number };
    const db = await getDb();
    if (body.type === "product") {
      const code = body.code?.trim().toUpperCase() || "";
      const name = body.name?.trim() || "";
      const measure = body.measure?.trim() || "";
      const price = Math.max(0, Number(body.price || 0));
      if (!code || !name || !measure || !price) return Response.json({ error: "Código, descrição, medida e preço são obrigatórios." }, { status: 400 });
      const [product] = await db.insert(products).values({ code, sku: body.sku?.trim().toUpperCase() || code.replace(/\s+/g, "-"), name, measure, price }).returning();
      return Response.json({ product }, { status: 201 });
    }
    const name = body.name?.trim() || "";
    const whatsapp = body.whatsapp?.trim() || "";
    if (!name || !whatsapp) return Response.json({ error: "Nome e WhatsApp são obrigatórios." }, { status: 400 });
    if ((body.zipCode || "").replace(/\D/g, "").length !== 8 || !body.street?.trim() || !body.neighborhood?.trim() || !body.city?.trim() || !body.state?.trim() || !body.number?.trim()) return Response.json({ error: "Preencha o endereço obrigatório usando um CEP válido." }, { status: 400 });
    const document = body.document?.trim() || "";
    if (!document) return Response.json({ error: "CPF ou CNPJ é obrigatório." }, { status: 400 });
    const existing = await db.select().from(customers).where(eq(customers.document, document)).limit(1);
    if (existing.length) return Response.json({ error: "Este CPF/CNPJ já está cadastrado." }, { status: 409 });
    const [customer] = await db.insert(customers).values({ name, whatsapp, document: body.document?.trim() || "", email: body.email?.trim() || "", zipCode: body.zipCode?.trim() || "", street: body.street?.trim() || "", number: body.number?.trim() || "", complement: body.complement?.trim() || "", neighborhood: body.neighborhood?.trim() || "", city: body.city?.trim() || "", state: body.state?.trim() || "" }).returning();
    return Response.json({ customer }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível cadastrar o cliente." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as { type?: string; id?: number; active?: boolean; price?: number; name?: string; whatsapp?: string; email?: string; document?: string; zipCode?: string; street?: string; number?: string; complement?: string; neighborhood?: string; city?: string; state?: string; code?: string; measure?: string; sku?: string };
    const id = Number(body.id);
    if (!id) return Response.json({ error: "Cadastro inválido." }, { status: 400 });
    const db = await getDb();
    if (body.type === "product") {
      const changes: Partial<typeof products.$inferInsert> = {};
      if (body.active !== undefined) changes.active = body.active;
      if (body.price !== undefined) changes.price = Math.max(0, Number(body.price));
      if (body.code) changes.code = body.code.trim().toUpperCase();
      if (body.name) changes.name = body.name.trim();
      if (body.measure) changes.measure = body.measure.trim();
      if (body.sku !== undefined) changes.sku = body.sku.trim().toUpperCase();
      const [product] = await db.update(products).set(changes).where(eq(products.id, id)).returning();
      return Response.json({ product });
    }
    if (body.name !== undefined && !body.document?.trim()) return Response.json({ error: "CPF ou CNPJ é obrigatório." }, { status: 400 });
    if (body.name !== undefined && ((body.zipCode || "").replace(/\D/g, "").length !== 8 || !body.street?.trim() || !body.neighborhood?.trim() || !body.city?.trim() || !body.state?.trim() || !body.number?.trim())) return Response.json({ error: "Preencha o endereço obrigatório usando um CEP válido." }, { status: 400 });
    const changes: Partial<typeof customers.$inferInsert> = {};
    if (body.active !== undefined) changes.active = body.active;
    if (body.name) changes.name = body.name.trim();
    if (body.whatsapp) changes.whatsapp = body.whatsapp.trim();
    if (body.email !== undefined) changes.email = body.email.trim();
    if (body.document !== undefined) changes.document = body.document.trim();
    if (body.zipCode !== undefined) changes.zipCode = body.zipCode.trim();
    if (body.street !== undefined) changes.street = body.street.trim();
    if (body.number !== undefined) changes.number = body.number.trim();
    if (body.complement !== undefined) changes.complement = body.complement.trim();
    if (body.neighborhood !== undefined) changes.neighborhood = body.neighborhood.trim();
    if (body.city !== undefined) changes.city = body.city.trim();
    if (body.state !== undefined) changes.state = body.state.trim();
    const [customer] = await db.update(customers).set(changes).where(eq(customers.id, id)).returning();
    return Response.json({ customer });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o cadastro." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as { type?: string; id?: number; name?: string };
    if (body.type !== "customer") {
      return Response.json({ error: "Tipo de cadastro inválido." }, { status: 400 });
    }

    const db = await getDb();
    const id = Number(body.id);
    const name = body.name?.trim() || "";
    if (!id && !name) {
      return Response.json({ error: "Informe o cliente que será excluído." }, { status: 400 });
    }

    const deleted = id
      ? await db.delete(customers).where(eq(customers.id, id)).returning()
      : await db.delete(customers).where(like(customers.name, name)).returning();

    if (!deleted.length) {
      return Response.json({ error: "Cliente não encontrado." }, { status: 404 });
    }
    return Response.json({ success: true, deleted: deleted.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível excluir o cliente." }, { status: 500 });
  }
}
