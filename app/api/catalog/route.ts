import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { customers, products } from "../../../db/schema";

const initialProducts = [
  ["RN 180", "RN-180", "Pino de balança RN 180", "180 mm", 49],
  ["RN 190", "RN-190", "Pino de balança RN 190", "190 mm", 55],
  ["RN 205", "RN-205", "Pino de balança RN 205", "205 mm", 56],
  ["RN 225", "RN-225", "Pino de balança RN 225", "225 mm", 57],
  ["RO 215", "RO-215", "Pino de balança RO 215", "215 mm", 63],
  ["RO 235", "RO-235", "Pino de balança RO 235", "235 mm", 68],
] as const;

export async function GET() {
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
