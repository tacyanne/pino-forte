import { supabaseInsert, supabaseSelect, supabaseUpsert } from "../../../../lib/supabase-rest";

type LegacyRow = Record<string, string | number | boolean | null>;
type D1Database = {
  prepare(sql: string): { all<T>(): Promise<{ results?: T[] }> };
};

const tokenIsValid = (request: Request) => {
  const expected = process.env.LEGACY_MIGRATION_TOKEN || "";
  return Boolean(expected) && request.headers.get("x-migration-token") === expected;
};

async function d1() {
  const { env } = await import("cloudflare:workers") as unknown as { env: { DB?: D1Database } };
  if (!env.DB) throw new Error("A base legada D1 não está vinculada.");
  return env.DB;
}

async function readTable(db: D1Database, table: string) {
  try {
    const result = await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all<LegacyRow>();
    return result.results || [];
  } catch {
    return [];
  }
}

async function snapshot() {
  const db = await d1();
  const [customers, products, orders, settings] = await Promise.all([
    readTable(db, "customers"),
    readTable(db, "products"),
    readTable(db, "service_orders"),
    readTable(db, "app_settings"),
  ]);
  return { customers, products, orders, settings };
}

const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const text = (value: unknown) => String(value ?? "");

async function targetCounts() {
  const [customers, products, orders] = await Promise.all([
    supabaseSelect<{ id: number }>("customers", { select: "id" }),
    supabaseSelect<{ id: number }>("products", { select: "id" }),
    supabaseSelect<{ id: number }>("service_orders", { select: "id" }),
  ]);
  return { customers: customers.length, products: products.length, orders: orders.length };
}

export async function GET(request: Request) {
  if (!tokenIsValid(request)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const legacy = await snapshot();
  return Response.json({
    legacy,
    legacyCounts: Object.fromEntries(Object.entries(legacy).map(([key, rows]) => [key, rows.length])),
    targetCounts: await targetCounts(),
  });
}

export async function POST(request: Request) {
  if (!tokenIsValid(request)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const before = await targetCounts();
  if (before.customers > 0 || before.orders > 0) {
    return Response.json({ error: "Migração bloqueada: o destino já contém clientes ou OS.", targetCounts: before }, { status: 409 });
  }

  const legacy = await snapshot();
  const productIdByCode = new Map<string, number>();
  for (const row of legacy.products) {
    const code = text(row.code);
    const price = Number(row.price || 0);
    const saved = await supabaseUpsert<{ id: number }>("products", {
      code,
      sku: text(row.sku) || code.replace(/\s+/g, "-"),
      name: text(row.name),
      piece_type: "Pino",
      measure: text(row.measure),
      price,
      price_cents: cents(price),
      active: Boolean(row.active),
      created_at: text(row.created_at) || new Date().toISOString(),
      updated_at: text(row.created_at) || new Date().toISOString(),
    }, "code");
    productIdByCode.set(code, saved.id);
  }

  const customerIdByName = new Map<string, number>();
  for (const row of legacy.customers) {
    const saved = await supabaseUpsert<{ id: number }>("customers", {
      id: Number(row.id),
      name: text(row.name), document: text(row.document), whatsapp: text(row.whatsapp), email: text(row.email),
      zip_code: text(row.zip_code), street: text(row.street), number: text(row.number), complement: text(row.complement),
      neighborhood: text(row.neighborhood), city: text(row.city), state: text(row.state),
      customer_type: text(row.customer_type) || "Cliente final", active: Boolean(row.active),
      created_at: text(row.created_at) || new Date().toISOString(), updated_at: text(row.created_at) || new Date().toISOString(),
    }, "id");
    customerIdByName.set(text(row.name).trim().toLocaleLowerCase("pt-BR"), saved.id);
  }

  for (const row of legacy.orders) {
    const orderId = Number(row.id);
    const subtotal = Number(row.subtotal || row.total || 0);
    const total = Number(row.total || 0);
    const received = Number(row.received || 0);
    const totalCents = cents(total);
    const receivedCents = cents(received);
    const createdAt = text(row.created_at) || new Date().toISOString();
    const issuedAt = createdAt.slice(0, 10);
    const customerId = customerIdByName.get(text(row.customer_name).trim().toLocaleLowerCase("pt-BR")) || null;
    const canceled = text(row.commercial_status).toLowerCase().includes("cancel");
    const financialStatus = canceled ? "Cancelado" : receivedCents >= totalCents ? "Pago" : receivedCents > 0 ? "Parcial" : "Pendente";
    await supabaseUpsert("service_orders", {
      id: orderId, number: text(row.number), customer_id: customerId, customer_name: text(row.customer_name),
      customer_type: text(row.customer_type) || "Cliente final", origin: text(row.origin), product_code: text(row.product_code),
      quantity: Number(row.quantity || 0), unit_price: Number(row.unit_price || 0), subtotal,
      discount_rate: Number(row.discount_rate || 0), total, received,
      subtotal_cents: cents(subtotal), discount_cents: cents(subtotal - total), surcharge_cents: 0,
      total_cents: totalCents, received_cents: receivedCents, balance_cents: Math.max(0, totalCents - receivedCents),
      issued_at: issuedAt, due_date: text(row.delivery_date) || issuedAt, delivery_date: text(row.delivery_date),
      delivery_type: text(row.delivery_type), payment_method: text(row.payment_method), wallet_month: text(row.wallet_month),
      production_status: text(row.production_status) || "Aguardando", financial_status: financialStatus,
      commercial_status: text(row.commercial_status) || "Pedido confirmado", notes: text(row.notes),
      created_at: createdAt, updated_at: createdAt,
    }, "id");

    await supabaseUpsert("service_order_items", {
      service_order_id: orderId, product_id: productIdByCode.get(text(row.product_code)) || null, item_position: 1,
      product_code_snapshot: text(row.product_code), description_snapshot: text(row.product_code),
      quantity: Number(row.quantity || 0), unit_price_cents: cents(row.unit_price), total_cents: cents(Number(row.unit_price || 0) * Number(row.quantity || 0)),
      created_at: createdAt, updated_at: createdAt,
    }, "service_order_id,item_position");

    const receivable = await supabaseUpsert<{ id: number }>("accounts_receivable", {
      service_order_id: orderId, customer_id: customerId, issued_at: issuedAt, due_date: text(row.delivery_date) || issuedAt,
      original_amount_cents: totalCents, received_amount_cents: receivedCents, balance_cents: Math.max(0, totalCents - receivedCents),
      status: financialStatus, notes: text(row.notes), created_at: createdAt, updated_at: createdAt,
    }, "service_order_id");
    if (receivedCents > 0) {
      await supabaseInsert("receipts", {
        account_receivable_id: receivable.id, service_order_id: orderId, receipt_date: issuedAt,
        amount_cents: receivedCents, payment_method: text(row.payment_method), notes: "Pagamento legado migrado do D1",
        status: "Confirmado", legacy_source_key: `d1-order-${orderId}-received`, created_at: createdAt,
      });
    }
  }

  for (const row of legacy.settings) {
    await supabaseUpsert("app_settings", {
      id: Number(row.id), company_name: text(row.company_name), responsible: text(row.responsible),
      company_phone: text(row.company_phone), order_footer: text(row.order_footer),
    }, "id");
  }

  return Response.json({ ok: true, legacyCounts: Object.fromEntries(Object.entries(legacy).map(([key, rows]) => [key, rows.length])), targetCounts: await targetCounts() });
}
