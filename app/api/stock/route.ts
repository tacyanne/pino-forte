import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { purchaseBatches, stockMovements } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { todayIso } from "../../../lib/finance";
import { StockError, parseStockMovement, type StockKind, type StockMovement } from "../../../lib/stock";
import { PurchaseBatchError, parsePurchaseBatch, type PurchaseBatch } from "../../../lib/purchase-batches";
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
  batchId: row.batchId == null ? null : Number(row.batchId),
  unitCostCents: row.unitCostCents == null ? null : Number(row.unitCostCents),
});

const toBatch = (row: Record<string, unknown>): PurchaseBatch => ({
  id: Number(row.id),
  supplier: String(row.supplier || ""),
  purchaseDate: String(row.purchaseDate || ""),
  notes: String(row.notes || ""),
});

function failure(error: unknown) {
  return Response.json(
    { error: error instanceof StockError || error instanceof PurchaseBatchError ? error.message : "Não foi possível carregar ou salvar o estoque. Tente novamente." },
    { status: error instanceof StockError || error instanceof PurchaseBatchError ? error.status : 500, headers },
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

async function listBatches(): Promise<PurchaseBatch[]> {
  if (hasSupabaseRest()) {
    const rows = await supabaseSelect<Record<string, unknown>>("purchase_batches", { select: "*", order: "purchase_date.desc,id.desc" });
    return camelizeRows<Record<string, unknown>>(rows).map(toBatch);
  }
  const db = await getDb();
  const rows = await db.select().from(purchaseBatches).orderBy(desc(purchaseBatches.purchaseDate), desc(purchaseBatches.id));
  return rows.map(toBatch);
}

// Os lotes não podem derrubar a tela de estoque.
async function listBatchesSafe() {
  try {
    return await listBatches();
  } catch (error) {
    console.error("Falha ao carregar os lotes de compra.", error);
    return [];
  }
}

// Lote novo: grava o lote e uma entrada de estoque por peça, com o custo pago.
async function createBatch(raw: unknown, userId: number) {
  const input = parsePurchaseBatch(raw, todayIso());
  if (hasSupabaseRest()) {
    const batch = await supabaseInsert<Record<string, unknown>>("purchase_batches", {
      supplier: input.supplier,
      purchase_date: input.purchaseDate,
      notes: input.notes,
      created_by: userId,
    });
    for (const item of input.items)
      await supabaseInsert("stock_movements", {
        product_id: item.productId,
        kind: "entrada",
        quantity: item.quantity,
        movement_date: input.purchaseDate,
        notes: `Lote ${input.supplier}`,
        batch_id: Number(batch.id),
        unit_cost_cents: item.unitCostCents,
        created_by: userId,
      });
    return;
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(purchaseBatches)
      .values({ supplier: input.supplier, purchaseDate: input.purchaseDate, notes: input.notes, createdBy: userId })
      .returning();
    for (const item of input.items)
      await tx.insert(stockMovements).values({
        productId: item.productId,
        kind: "entrada",
        quantity: item.quantity,
        movementDate: input.purchaseDate,
        notes: `Lote ${input.supplier}`,
        batchId: batch.id,
        unitCostCents: item.unitCostCents,
        createdBy: userId,
      });
  });
}

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    return Response.json({ movements: await listMovements(), batches: await listBatchesSafe() }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    const body = await request.json();
    if (body && typeof body === "object" && (body as { type?: unknown }).type === "batch") {
      await createBatch(body, auth.id);
      return Response.json({ movements: await listMovements(), batches: await listBatchesSafe() }, { status: 201, headers });
    }
    const input = parseStockMovement(body, todayIso());
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
