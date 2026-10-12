import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { pieceTypes, products } from "../db/schema";
import { camelizeRow, camelizeRows } from "./supabase-mappers";
import { hasSupabaseRest, supabaseGetOne, supabaseInsert, supabasePatch, supabaseSelect } from "./supabase-rest";

export type PieceType = typeof pieceTypes.$inferSelect;

export class PieceTypeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function normalizeTypeName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) throw new PieceTypeError("Informe um tipo com até 80 caracteres.");
  return name;
}

export async function listPieceTypes(): Promise<PieceType[]> {
  if (hasSupabaseRest()) return camelizeRows<PieceType>(await supabaseSelect<Record<string, unknown>>("piece_types", { select: "*", order: "name.asc" }));
  return (await getDb()).select().from(pieceTypes).orderBy(asc(pieceTypes.name));
}

export async function validateProductType(value: unknown, productId?: number) {
  const name = normalizeTypeName(value);
  const type = (await listPieceTypes()).find((type) => type.name === name);
  if (!type) throw new PieceTypeError("Selecione um tipo cadastrado em Configurações → Tipos.");
  if (!type.active) {
    const existing = productId
      ? hasSupabaseRest()
        ? await supabaseGetOne<{ piece_type: string }>("products", { select: "piece_type", id: `eq.${productId}` })
        : (await (await getDb()).select({ piece_type: products.pieceType }).from(products).where(eq(products.id, productId)).limit(1))[0]
      : null;
    if (existing?.piece_type !== name) throw new PieceTypeError("Este tipo está inativo. Selecione um tipo ativo.");
  }
  return type.name;
}

export async function savePieceType(body: { id?: unknown; name?: unknown; active?: unknown }, editing = false) {
  const id = Number(body.id);
  if (editing && (!Number.isSafeInteger(id) || id <= 0)) throw new PieceTypeError("Tipo inválido.");
  if (body.active !== undefined && typeof body.active !== "boolean") throw new PieceTypeError("Status inválido.");
  const allTypes = await listPieceTypes();
  const existing = editing ? allTypes.find((type) => type.id === id) : undefined;
  if (editing && !existing) throw new PieceTypeError("Tipo não encontrado. Atualize a lista e tente novamente.", 404);
  const name = body.name === undefined && existing ? existing.name : normalizeTypeName(body.name);
  if (allTypes.some((type) => type.id !== existing?.id && type.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
    throw new PieceTypeError("Já existe um tipo cadastrado com esse nome.", 409);
  }
  const changes = { name, ...(typeof body.active === "boolean" ? { active: body.active } : {}), updatedAt: new Date().toISOString() };
  try {
    let saved: PieceType | undefined;
    if (hasSupabaseRest()) {
      const values = { name, ...(typeof body.active === "boolean" ? { active: body.active } : {}), updated_at: changes.updatedAt };
      const row = editing
        ? await supabasePatch<Record<string, unknown>>("piece_types", { id: `eq.${id}` }, values)
        : await supabaseInsert<Record<string, unknown>>("piece_types", values);
      saved = row ? camelizeRow<PieceType>(row) : undefined;
    } else {
      const db = await getDb();
      [saved] = editing ? await db.update(pieceTypes).set(changes).where(eq(pieceTypes.id, id)).returning()
        : await db.insert(pieceTypes).values(changes).returning();
    }
    if (!saved) throw new PieceTypeError("Não foi possível confirmar o tipo salvo. Tente novamente.", 404);
    return saved;
  } catch (error) {
    if (error instanceof Error && /23505|duplicate key/i.test(error.message)) throw new PieceTypeError("Já existe um tipo cadastrado com esse nome.", 409);
    throw error;
  }
}
