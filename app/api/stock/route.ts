import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { stockMovements } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { todayIso } from "../../../lib/finance";
import { StockError, parseStockMovement, type StockKind, type StockMovement } from "../../../lib/stock";
import { camelizeRows } from "../../../lib/supabase-mappers";
import { hasSupabaseRest, supabaseDelete, supabaseInsert, supabaseSelect } from "../../../lib/supabase-rest";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store, no-cache, must-revalidate" };
// Quantos lançamentos o estoque carrega de uma vez.
const STOCK_LIMIT = 1000;

const toMovement = (row: Record<string, unknown>): StockMovement => ({
  id: Number(row.id),
  productId: Number(row.productId),
  kind: String(row.kind) as StockKind,
  quantity: Number(row.quantity) || 0,
  movementDate: String(row.movementDate || ""),
  notes: String(row.notes || ""),
});

function failure(error: unknown) {
  return Response.json(
    { error: error instanceof StockError ? error.message : "Não foi possível carregar ou salvar o estoque. Tente novamente." },
    { status: error instanceof StockError ? error.status : 500, headers },
  );
}

async function listMovements(): Promise<StockMovement[]> {
  if (hasSupabaseRest()) {
    const rows = await supabaseSelect<Record<string, unknown>>("stock_movements", {
      select: "*",
      order: "movement_date.desc,id.desc",
      limit: String(STOCK_LIMIT),
    });
    return camelizeRows<Record<string, unknown>>(rows).map(toMovement);
  }
  const db = await getDb();
  const rows = await db.select().from(stockMovements).orderBy(desc(stockMovements.movementDate), desc(stockMovements.id)).limit(STOCK_LIMIT);
  return rows.map(toMovement);
}

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    return Response.json({ movements: await listMovements() }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    const input = parseStockMovement(await request.json(), todayIso());
    if (hasSupabaseRest()) {
      const created = await supabaseInsert<Record<string, unknown>>("stock_movements", {
        product_id: input.productId,
        kind: input.kind,
        quantity: input.quantity,
        movement_date: input.movementDate,
        notes: input.notes,
        created_by: auth.id,
      });
      return Response.json({ movement: toMovement(camelizeRows<Record<string, unknown>>([created])[0]) }, { status: 201, headers });
    }
    const db = await getDb();
    const [created] = await db.insert(stockMovements).values({ ...input, createdBy: auth.id }).returning();
    return Response.json({ movement: toMovement(created) }, { status: 201, headers });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new StockError("Lançamento não encontrado.");
    if (hasSupabaseRest()) await supabaseDelete("stock_movements", { id: `eq.${id}` });
    else {
      const db = await getDb();
      await db.delete(stockMovements).where(eq(stockMovements.id, id));
    }
    return Response.json({ success: true }, { headers });
  } catch (error) { return failure(error); }
}
