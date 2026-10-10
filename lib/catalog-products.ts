import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { products } from "../db/schema";
import { camelizeRows } from "./supabase-mappers";
import { hasSupabaseRest, supabaseSelect } from "./supabase-rest";

export async function loadActiveCatalogProducts() {
  const rows = hasSupabaseRest()
    ? camelizeRows<typeof products.$inferSelect>(
        await supabaseSelect<Record<string, unknown>>("products", {
          select: "id,code,name,piece_type,measure,price,image_data,active",
          active: "eq.true",
          order: "code.asc",
        }),
      )
    : await (
        await getDb()
      )
        .select()
        .from(products)
        .where(eq(products.active, true))
        .orderBy(asc(products.code));
  // The public catalog exposes no customer or internal management data.
  return rows.map(
    ({ id, code, name, pieceType, measure, price, imageData, active }) => ({
      id,
      code,
      name,
      pieceType,
      measure,
      price,
      imageData,
      active,
    }),
  );
}
