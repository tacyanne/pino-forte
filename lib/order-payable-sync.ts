import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { accountsPayable, financialCategories, products, receivableInstallments, serviceOrders } from "../db/schema";
import { preferredFabricationCategoryId } from "./finance-plain";
import { parseOrderItems, planOrderPayables, type PlannedOrderPayable, type ResaleLine } from "./order-payables";
import { listProductCosts } from "./product-cost-store";
import { listCostUses } from "./product-cost-use-store";
import { costAt, costSourceOf, normalizePieceCode } from "./product-costs";
import { camelizeRows } from "./supabase-mappers";
import { hasSupabaseRest, supabaseDelete, supabaseInsert, supabasePatch, supabaseSelect } from "./supabase-rest";

type OrderRow = {
  id: number;
  number: string;
  productionStatus: string;
  productCode: string;
  quantity: number;
  deliveryDate: string;
  createdAt: string;
  dueDate: string;
  supplierPayableAt: string | null;
};
type InstallmentRow = { serviceOrderId: number; number: number; dueDate: string; status: string };

const DELIVERED = "Entregue";

async function loadRows() {
  if (hasSupabaseRest()) {
    const [orderRows, productRows, installmentRows, categoryRows] = await Promise.all([
      supabaseSelect<Record<string, unknown>>("service_orders", {
        select: "id,number,production_status,product_code,quantity,delivery_date,created_at,due_date,supplier_payable_at",
        order: "id.desc",
        limit: "1000",
      }),
      supabaseSelect<Record<string, unknown>>("products", { select: "id,code" }),
      supabaseSelect<Record<string, unknown>>("receivable_installments", {
        select: "service_order_id,number,due_date,status",
        order: "id.desc",
        limit: "2000",
      }),
      supabaseSelect<Record<string, unknown>>("financial_categories", { select: "id,name,type,active" }),
    ]);
    return {
      orders: camelizeRows<Record<string, unknown>>(orderRows) as unknown as OrderRow[],
      products: productRows.map((row) => ({ id: Number(row.id), code: String(row.code || "") })),
      installments: camelizeRows<Record<string, unknown>>(installmentRows) as unknown as InstallmentRow[],
      categories: categoryRows.map((row) => ({ id: Number(row.id), name: String(row.name || ""), type: String(row.type || ""), active: row.active !== false })),
    };
  }
  const db = await getDb();
  const [orderRows, productRows, installmentRows, categoryRows] = await Promise.all([
    db.select().from(serviceOrders),
    db.select({ id: products.id, code: products.code }).from(products),
    db.select().from(receivableInstallments),
    db.select().from(financialCategories),
  ]);
  return {
    orders: orderRows as unknown as OrderRow[],
    products: productRows,
    installments: installmentRows as unknown as InstallmentRow[],
    categories: categoryRows.map((row) => ({ id: row.id, name: row.name, type: row.type, active: row.active })),
  };
}

async function insertPayables(orderId: number, categoryId: number | null, planned: PlannedOrderPayable[], markedAt: string) {
  if (hasSupabaseRest()) {
    for (const item of planned)
      await supabaseInsert("accounts_payable", {
        supplier: item.supplier,
        description: item.description,
        category_id: categoryId,
        competence_month: item.competenceMonth,
        purchase_date: item.purchaseDate,
        due_date: item.dueDate,
        amount_cents: item.amountCents,
        status: "Pendente",
        notes: item.notes,
        service_order_id: orderId,
        installment_number: item.installmentNumber,
      });
    await supabasePatch("service_orders", { id: `eq.${orderId}` }, { supplier_payable_at: markedAt });
    return;
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const item of planned)
      await tx.insert(accountsPayable).values({
        supplier: item.supplier,
        description: item.description,
        categoryId,
        competenceMonth: item.competenceMonth,
        purchaseDate: item.purchaseDate,
        dueDate: item.dueDate,
        amountCents: item.amountCents,
        status: "Pendente",
        notes: item.notes,
        serviceOrderId: orderId,
        installmentNumber: item.installmentNumber,
      });
    await tx.update(serviceOrders).set({ supplierPayableAt: markedAt }).where(eq(serviceOrders.id, orderId));
  });
}

// OS que deixou de estar entregue: as contas automáticas ainda pendentes saem; as já pagas ficam.
async function removePendingPayables(orderId: number) {
  if (hasSupabaseRest()) {
    await supabaseDelete("accounts_payable", { service_order_id: `eq.${orderId}`, status: "eq.Pendente" });
    await supabasePatch("service_orders", { id: `eq.${orderId}` }, { supplier_payable_at: null });
    return;
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(accountsPayable)
      .where(and(eq(accountsPayable.serviceOrderId, orderId), eq(accountsPayable.status, "Pendente"), isNotNull(accountsPayable.serviceOrderId)));
    await tx.update(serviceOrders).set({ supplierPayableAt: null }).where(eq(serviceOrders.id, orderId));
  });
}

// Gera, uma única vez por OS entregue, a conta a pagar ao fornecedor das peças de revenda,
// com os mesmos vencimentos da OS. Só entram peças cujo custo em uso na data da entrega é o de revenda.
export async function syncOrderPayables() {
  const { orders, products: productRows, installments, categories } = await loadRows();
  const pending = orders.filter((order) => order.productionStatus === DELIVERED && !order.supplierPayableAt);
  const stale = orders.filter((order) => order.productionStatus !== DELIVERED && order.supplierPayableAt);
  if (!pending.length && !stale.length) return { created: 0, removed: 0 };

  let created = 0;
  if (pending.length) {
    const [costs, uses] = await Promise.all([listProductCosts(), listCostUses()]);
    const productByKey = new Map(productRows.map((product) => [normalizePieceCode(product.code), product]));
    const categoryId = preferredFabricationCategoryId(categories);
    for (const order of pending) {
      const deliveryDate = String(order.deliveryDate || order.createdAt || "").slice(0, 10);
      if (!deliveryDate) continue;
      const lines: ResaleLine[] = [];
      for (const item of parseOrderItems(order.productCode, order.quantity)) {
        const product = productByKey.get(normalizePieceCode(item.code));
        const cost = product ? costAt(costs, product.id, deliveryDate, uses) : null;
        if (!cost || costSourceOf(cost.source) !== "comprada" || cost.unitCostCents <= 0) continue;
        lines.push({ supplier: cost.supplier, unitCostCents: cost.unitCostCents, quantity: item.quantity });
      }
      const dueDates = installments
        .filter((row) => Number(row.serviceOrderId) === order.id && row.status !== "Cancelado")
        .sort((a, b) => Number(a.number) - Number(b.number))
        .map((row) => String(row.dueDate));
      const planned = planOrderPayables({
        orderNumber: order.number,
        deliveryDate,
        dueDates: dueDates.length ? dueDates : [String(order.dueDate || deliveryDate)],
        lines,
      });
      if (!planned.length) continue;
      await insertPayables(order.id, categoryId, planned, new Date().toISOString());
      created += planned.length;
    }
  }
  for (const order of stale) await removePendingPayables(order.id);
  return { created, removed: stale.length };
}

// O financeiro não pode parar por falha na geração automática.
export async function syncOrderPayablesSafe() {
  try {
    return await syncOrderPayables();
  } catch (error) {
    console.error("Falha ao gerar a conta a pagar automática das OS entregues.", error);
    return null;
  }
}
