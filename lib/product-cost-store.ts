import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { productCostHistory } from "../db/schema";
import {
  openCost,
  planProductCostChange,
  totalCostCents,
  type ProductCost,
  type ProductCostInput,
} from "./product-costs";
import { camelizeRows } from "./supabase-mappers";
import { hasSupabaseRest, supabaseInsert, supabasePatch, supabaseSelect } from "./supabase-rest";

const toProductCost = (row: Record<string, unknown>): ProductCost => ({
  id: Number(row.id),
  productId: Number(row.productId),
  rawMaterialCostCents: Number(row.rawMaterialCostCents) || 0,
  freightCents: Number(row.freightCents) || 0,
  additionalCostsCents: Number(row.additionalCostsCents) || 0,
  unitCostCents: Number(row.unitCostCents) || 0,
  startsAt: String(row.startsAt || ""),
  endsAt: row.endsAt ? String(row.endsAt) : null,
});

export async function listProductCosts(productId?: number): Promise<ProductCost[]> {
  if (hasSupabaseRest()) {
    const rows = await supabaseSelect<Record<string, unknown>>("product_cost_history", {
      select: "*",
      order: "product_id.asc,starts_at.asc",
      ...(productId ? { product_id: `eq.${productId}` } : {}),
    });
    return camelizeRows<Record<string, unknown>>(rows).map(toProductCost);
  }
  const db = await getDb();
  const query = db.select().from(productCostHistory);
  const rows = await (productId ? query.where(eq(productCostHistory.productId, productId)) : query).orderBy(
    asc(productCostHistory.productId),
    asc(productCostHistory.startsAt),
  );
  return rows.map(toProductCost);
}

// Grava o custo de uma peça respeitando o histórico e devolve as vigências dela.
export async function saveProductCost(productId: number, input: ProductCostInput): Promise<ProductCost[]> {
  const plan = planProductCostChange(openCost(await listProductCosts(productId), productId), input);
  if (plan.kind === "none") return listProductCosts(productId);

  const values = {
    rawMaterialCostCents: input.materialCents,
    additionalCostsCents: input.laborCents,
    freightCents: input.freightCents,
    unitCostCents: totalCostCents(input),
  };

  if (hasSupabaseRest()) {
    const restValues = {
      raw_material_cost_cents: values.rawMaterialCostCents,
      additional_costs_cents: values.additionalCostsCents,
      freight_cents: values.freightCents,
      unit_cost_cents: values.unitCostCents,
    };
    if (plan.kind === "update") {
      await supabasePatch("product_cost_history", { id: `eq.${plan.id}` }, restValues);
    } else {
      if (plan.closeId)
        await supabasePatch("product_cost_history", { id: `eq.${plan.closeId}` }, { ends_at: plan.closeEndsAt });
      await supabaseInsert("product_cost_history", { product_id: productId, ...restValues, starts_at: input.startsAt });
    }
    return listProductCosts(productId);
  }

  const db = await getDb();
  await db.transaction(async (tx) => {
    if (plan.kind === "update") {
      await tx.update(productCostHistory).set(values).where(eq(productCostHistory.id, plan.id));
      return;
    }
    if (plan.closeId)
      await tx.update(productCostHistory).set({ endsAt: plan.closeEndsAt }).where(eq(productCostHistory.id, plan.closeId));
    await tx.insert(productCostHistory).values({ productId, ...values, startsAt: input.startsAt });
  });
  return listProductCosts(productId);
}

// O catálogo interno não pode parar por falha na leitura de custos.
export async function listProductCostsSafe() {
  try {
    return await listProductCosts();
  } catch (error) {
    console.error("Falha ao carregar o custo das peças.", error);
    return [];
  }
}
