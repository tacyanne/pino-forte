import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { pieceLines, products } from "../db/schema";
import { camelizeRow, camelizeRows } from "./supabase-mappers";
import { hasSupabaseRest, supabaseGetOne, supabaseInsert, supabasePatch, supabaseSelect } from "./supabase-rest";

export type PieceLine = typeof pieceLines.$inferSelect;

export class PieceLineError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function normalizeLineName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 200) throw new PieceLineError("Informe uma linha com até 200 caracteres.");
  return name;
}

export async function listPieceLines(): Promise<PieceLine[]> {
  if (hasSupabaseRest()) return camelizeRows<PieceLine>(await supabaseSelect<Record<string, unknown>>("piece_lines", { select: "*", order: "name.asc" }));
  return (await getDb()).select().from(pieceLines).orderBy(asc(pieceLines.name));
}

export async function validateProductLine(value: unknown, productId?: number) {
  const name = normalizeLineName(value);
  const type = (await listPieceLines()).find((type) => type.name === name);
  if (!type) throw new PieceLineError("Selecione uma linha cadastrada em Configurações → Linhas.");
  if (!type.active) {
    const existing = productId
      ? hasSupabaseRest()
        ? await supabaseGetOne<{ line_name: string }>("products", { select: "line_name", id: `eq.${productId}` })
        : (await (await getDb()).select({ line_name: products.lineName }).from(products).where(eq(products.id, productId)).limit(1))[0]
      : null;
    if (existing?.line_name !== name) throw new PieceLineError("Esta linha está inativa. Selecione uma linha ativa.");
  }
  return type.name;
}

export async function savePieceLine(body: { id?: unknown; name?: unknown; active?: unknown }, editing = false) {
  const id = Number(body.id);
  if (editing && (!Number.isSafeInteger(id) || id <= 0)) throw new PieceLineError("Linha inválida.");
  if (body.active !== undefined && typeof body.active !== "boolean") throw new PieceLineError("Status inválido.");
  const allTypes = await listPieceLines();
  const existing = editing ? allTypes.find((type) => type.id === id) : undefined;
  if (editing && !existing) throw new PieceLineError("Linha não encontrada. Atualize a lista e tente novamente.", 404);
  const name = body.name === undefined && existing ? existing.name : normalizeLineName(body.name);
  if (allTypes.some((type) => type.id !== existing?.id && type.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
    throw new PieceLineError("Já existe uma linha cadastrada com esse nome.", 409);
  }
  const changes = { name, ...(typeof body.active === "boolean" ? { active: body.active } : {}), updatedAt: new Date().toISOString() };
  try {
    let saved: PieceLine | undefined;
    if (hasSupabaseRest()) {
      const values = { name, ...(typeof body.active === "boolean" ? { active: body.active } : {}), updated_at: changes.updatedAt };
      const row = editing
        ? await supabasePatch<Record<string, unknown>>("piece_lines", { id: `eq.${id}` }, values)
        : await supabaseInsert<Record<string, unknown>>("piece_lines", values);
      saved = row ? camelizeRow<PieceLine>(row) : undefined;
    } else {
      const db = await getDb();
      [saved] = editing ? await db.update(pieceLines).set(changes).where(eq(pieceLines.id, id)).returning()
        : await db.insert(pieceLines).values(changes).returning();
    }
    if (!saved) throw new PieceLineError("Não foi possível confirmar a linha salva. Tente novamente.", 404);
    return saved;
  } catch (error) {
    if (error instanceof Error && /23505|duplicate key/i.test(error.message)) throw new PieceLineError("Já existe uma linha cadastrada com esse nome.", 409);
    throw error;
  }
}
