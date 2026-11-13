import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { productPriceHistory } from "../db/schema";
import { openPrice, planProductPriceChange, priceSourceOf, type PriceSource, type ProductPrice } from "./product-prices";
import { camelizeRows } from "./supabase-mappers";
import { hasSupabaseRest, supabaseInsert, supabasePatch, supabaseSelect } from "./supabase-rest";

const toProductPrice = (row: Record<string, unknown>): ProductPrice => ({
  id: Number(row.id),
  productId: Number(row.productId),
  priceCents: Number(row.priceCents) || 0,
  startsAt: String(row.startsAt || ""),
  endsAt: row.endsAt ? String(row.endsAt) : null,
  source: priceSourceOf(row.source),
});

export async function listProductPrices(productId?: number): Promise<ProductPrice[]> {
  if (hasSupabaseRest()) {
    const rows = await supabaseSelect<Record<string, unknown>>("product_price_history", {
      select: "*",
      order: "product_id.asc,starts_at.asc",
      ...(productId ? { product_id: `eq.${productId}` } : {}),
    });
    return camelizeRows<Record<string, unknown>>(rows).map(toProductPrice);
  }
  const db = await getDb();
  const query = db.select().from(productPriceHistory);
  const rows = await (productId ? query.where(eq(productPriceHistory.productId, productId)) : query).orderBy(
    asc(productPriceHistory.productId),
    asc(productPriceHistory.startsAt),
  );
  return rows.map(toProductPrice);
}

// Registra o preço de venda da peça no histórico e devolve as vigências dela.
export async function recordProductPrice(productId: number, priceCents: number, today: string, source: PriceSource): Promise<ProductPrice[]> {
  const plan = planProductPriceChange(openPrice(await listProductPrices(productId), productId), priceCents, today);
  if (plan.kind === "none") return listProductPrices(productId);

  if (hasSupabaseRest()) {
    if (plan.kind === "update") {
      await supabasePatch("product_price_history", { id: `eq.${plan.id}` }, { price_cents: priceCents });
    } else {
      if (plan.closeId)
        await supabasePatch("product_price_history", { id: `eq.${plan.closeId}` }, { ends_at: plan.closeEndsAt });
      await supabaseInsert("product_price_history", { product_id: productId, price_cents: priceCents, starts_at: today, source });
    }
    return listProductPrices(productId);
  }

  const db = await getDb();
  await db.transaction(async (tx) => {
    if (plan.kind === "update") {
      await tx.update(productPriceHistory).set({ priceCents }).where(eq(productPriceHistory.id, plan.id));
      return;
    }
    if (plan.closeId)
      await tx.update(productPriceHistory).set({ endsAt: plan.closeEndsAt }).where(eq(productPriceHistory.id, plan.closeId));
    await tx.insert(productPriceHistory).values({ productId, priceCents, startsAt: today, source });
  });
  return listProductPrices(productId);
}

// A peça já foi gravada quando o histórico é registrado: uma falha aqui não desfaz o cadastro.
export async function recordProductPriceSafe(productId: number, priceCents: number, today: string, source: PriceSource) {
  try {
    return await recordProductPrice(productId, priceCents, today, source);
  } catch (error) {
    console.error("Falha ao registrar o histórico de preço da peça.", error);
    return null;
  }
}

// O catálogo interno não pode parar por falha na leitura do histórico de preço.
export async function listProductPricesSafe() {
  try {
    return await listProductPrices();
  } catch (error) {
    console.error("Falha ao carregar o histórico de preço das peças.", error);
    return [];
  }
}
