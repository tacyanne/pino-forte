import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { productCostInUse } from "../db/schema";
import { costSourceOf, latestCostUse, planCostUseChange, type CostUse, type CostUseInput } from "./product-costs";
import { camelizeRows } from "./supabase-mappers";
import { hasSupabaseRest, supabaseInsert, supabasePatch, supabaseSelect } from "./supabase-rest";

const toCostUse = (row: Record<string, unknown>): CostUse => ({
  id: Number(row.id),
  productId: Number(row.productId),
  source: costSourceOf(row.source),
  startsAt: String(row.startsAt || ""),
});

export async function listCostUses(productId?: number): Promise<CostUse[]> {
  if (hasSupabaseRest()) {
    const rows = await supabaseSelect<Record<string, unknown>>("product_cost_in_use", {
      select: "*",
      order: "product_id.asc,starts_at.asc",
      ...(productId ? { product_id: `eq.${productId}` } : {}),
    });
    return camelizeRows<Record<string, unknown>>(rows).map(toCostUse);
  }
  const db = await getDb();
  const query = db.select().from(productCostInUse);
  const rows = await (productId ? query.where(eq(productCostInUse.productId, productId)) : query).orderBy(
    asc(productCostInUse.productId),
    asc(productCostInUse.startsAt),
  );
  return rows.map(toCostUse);
}

// Grava qual custo a peça passa a usar (revenda ou fabricação) a partir de uma data
// e devolve as escolhas da peça.
export async function saveCostUse(productId: number, input: CostUseInput): Promise<CostUse[]> {
  const plan = planCostUseChange(latestCostUse(await listCostUses(productId), productId), input);
  if (plan.kind === "none") return listCostUses(productId);

  if (hasSupabaseRest()) {
    if (plan.kind === "update")
      await supabasePatch("product_cost_in_use", { id: `eq.${plan.id}` }, { source: input.source, starts_at: input.startsAt });
    else await supabaseInsert("product_cost_in_use", { product_id: productId, source: input.source, starts_at: input.startsAt });
    return listCostUses(productId);
  }

  const db = await getDb();
  if (plan.kind === "update")
    await db.update(productCostInUse).set({ source: input.source, startsAt: input.startsAt }).where(eq(productCostInUse.id, plan.id));
  else await db.insert(productCostInUse).values({ productId, source: input.source, startsAt: input.startsAt });
  return listCostUses(productId);
}

// O catálogo interno não pode parar por falha na leitura do custo em uso.
export async function listCostUsesSafe() {
  try {
    return await listCostUses();
  } catch (error) {
    console.error("Falha ao carregar o custo em uso das peças.", error);
    return [];
  }
}
