import { and, desc, eq, isNotNull, notInArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { purchaseBatches, stockMovements } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";
import { todayIso } from "../../../lib/finance";
import { StockError, parseStockMovement, type StockKind, type StockMovement } from "../../../lib/stock";
import { PurchaseBatchError, parsePurchaseBatch, type PurchaseBatch } from "../../../lib/purchase-batches";
import { camelizeRows } from "../../../lib/supabase-mappers";
import { hasSupabaseRest, supabaseDelete, supabaseInsert, supabasePatch, supabaseSelect } from "../../../lib/supabase-rest";

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
    // As entradas de lote vêm sempre inteiras: o limite acima não pode cortar peça de um lote.
    const batchRows = await supabaseSelect<Record<string, unknown>>("stock_movements", { select: "*", batch_id: "not.is.null" });
    return mergeMovements(camelizeRows<Record<string, unknown>>(rows).map(toMovement), camelizeRows<Record<string, unknown>>(batchRows).map(toMovement));
  }
  const db = await getDb();
  const rows = await db.select().from(stockMovements).orderBy(desc(stockMovements.movementDate), desc(stockMovements.id)).limit(STOCK_LIMIT);
  const batchRows = await db.select().from(stockMovements).where(isNotNull(stockMovements.batchId));
  return mergeMovements(rows.map(toMovement), batchRows.map(toMovement));
}

function mergeMovements(recent: StockMovement[], batchEntries: StockMovement[]) {
  const seen = new Set(recent.map((movement) => movement.id));
  const extra = batchEntries.filter((movement) => !seen.has(movement.id));
  if (!extra.length) return recent;
  return [...recent, ...extra].sort((a, b) => b.movementDate.localeCompare(a.movementDate) || b.id - a.id);
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
    const batchId = Number(batch.id);
    try {
      for (const item of input.items)
        await supabaseInsert("stock_movements", {
          product_id: item.productId,
          kind: "entrada",
          quantity: item.quantity,
          movement_date: input.purchaseDate,
          notes: `Lote ${input.supplier}`,
          batch_id: batchId,
          unit_cost_cents: item.unitCostCents,
          created_by: userId,
        });
    } catch (error) {
      // Sem transação neste caminho: desfaz o que já foi gravado para não sobrar lote pela metade.
      await supabaseDelete("stock_movements", { batch_id: `eq.${batchId}` }).catch(() => undefined);
      await supabaseDelete("purchase_batches", { id: `eq.${batchId}` }).catch(() => undefined);
      throw error;
    }
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

// Edição do lote: atualiza fornecedor e data e deixa as entradas iguais à lista enviada
// (muda quantidade e custo, inclui peça nova e tira a que saiu da lista).
async function updateBatch(raw: unknown, userId: number) {
  const id = Number((raw as { id?: unknown } | null)?.id);
  if (!Number.isInteger(id) || id <= 0) throw new PurchaseBatchError("Lote não encontrado.");
  const input = parsePurchaseBatch(raw, todayIso());
  const note = `Lote ${input.supplier}`;
  if (hasSupabaseRest()) {
    const updated = await supabasePatch<Record<string, unknown>>("purchase_batches", { id: `eq.${id}` }, {
      supplier: input.supplier,
      purchase_date: input.purchaseDate,
      notes: input.notes,
    });
    if (!updated) throw new PurchaseBatchError("Lote não encontrado.");
    const current = await supabaseSelect<Record<string, unknown>>("stock_movements", { select: "id,product_id", batch_id: `eq.${id}` });
    for (const item of input.items) {
      const existing = current.find((row) => Number(row.product_id) === item.productId);
      const values = { quantity: item.quantity, unit_cost_cents: item.unitCostCents, movement_date: input.purchaseDate, notes: note };
      if (existing) await supabasePatch("stock_movements", { id: `eq.${Number(existing.id)}` }, values);
      else await supabaseInsert("stock_movements", { product_id: item.productId, kind: "entrada", batch_id: id, created_by: userId, ...values });
    }
    const kept = new Set(input.items.map((item) => item.productId));
    for (const row of current) if (!kept.has(Number(row.product_id))) await supabaseDelete("stock_movements", { id: `eq.${Number(row.id)}` });
    return;
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(purchaseBatches)
      .set({ supplier: input.supplier, purchaseDate: input.purchaseDate, notes: input.notes })
      .where(eq(purchaseBatches.id, id))
      .returning();
    if (!updated) throw new PurchaseBatchError("Lote não encontrado.");
    const current = await tx.select({ id: stockMovements.id, productId: stockMovements.productId }).from(stockMovements).where(eq(stockMovements.batchId, id));
    for (const item of input.items) {
      const existing = current.find((row) => row.productId === item.productId);
      const values = { quantity: item.quantity, unitCostCents: item.unitCostCents, movementDate: input.purchaseDate, notes: note };
      if (existing) await tx.update(stockMovements).set(values).where(eq(stockMovements.id, existing.id));
      else await tx.insert(stockMovements).values({ productId: item.productId, kind: "entrada", batchId: id, createdBy: userId, ...values });
    }
    await tx
      .delete(stockMovements)
      .where(and(eq(stockMovements.batchId, id), notInArray(stockMovements.productId, input.items.map((item) => item.productId))));
  });
}

// Exclui o lote inteiro: as entradas dele saem do estoque junto.
async function deleteBatch(id: number) {
  if (hasSupabaseRest()) {
    await supabaseDelete("stock_movements", { batch_id: `eq.${id}` });
    await supabaseDelete("purchase_batches", { id: `eq.${id}` });
    return;
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(stockMovements).where(eq(stockMovements.batchId, id));
    await tx.delete(purchaseBatches).where(eq(purchaseBatches.id, id));
  });
}

export async function PUT(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    await updateBatch(await request.json(), auth.id);
    return Response.json({ movements: await listMovements(), batches: await listBatchesSafe() }, { headers });
  } catch (error) { return failure(error); }
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
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; batchId?: unknown };
    if (body.batchId !== undefined) {
      const batchId = Number(body.batchId);
      if (!Number.isInteger(batchId) || batchId <= 0) throw new PurchaseBatchError("Lote não encontrado.");
      await deleteBatch(batchId);
      return Response.json({ movements: await listMovements(), batches: await listBatchesSafe() }, { headers });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new StockError("Lançamento não encontrado.");
    // Entrada de lote: se era a última peça do lote, o lote sai junto para não ficar vazio.
    if (hasSupabaseRest()) {
      const [current] = await supabaseSelect<Record<string, unknown>>("stock_movements", { select: "batch_id", id: `eq.${id}` });
      await supabaseDelete("stock_movements", { id: `eq.${id}` });
      const batchId = Number(current?.batch_id || 0);
      if (batchId) {
        const rest = await supabaseSelect<Record<string, unknown>>("stock_movements", { select: "id", batch_id: `eq.${batchId}`, limit: "1" });
        if (!rest.length) await supabaseDelete("purchase_batches", { id: `eq.${batchId}` });
      }
    } else {
      const db = await getDb();
      await db.transaction(async (tx) => {
        const [current] = await tx.select({ batchId: stockMovements.batchId }).from(stockMovements).where(eq(stockMovements.id, id));
        await tx.delete(stockMovements).where(eq(stockMovements.id, id));
        if (!current?.batchId) return;
        const rest = await tx.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.batchId, current.batchId)).limit(1);
        if (!rest.length) await tx.delete(purchaseBatches).where(eq(purchaseBatches.id, current.batchId));
      });
    }
    return Response.json({ success: true }, { headers });
  } catch (error) { return failure(error); }
}
