import fs from "node:fs";
import postgres from "postgres";

function addDaysIso(date, days) {
  const value = String(date || new Date().toISOString()).slice(0, 10);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env.import-production");

const productionUrl = (process.env.PRODUCTION_URL || "https://www.pinoforte.com.br").replace(/\/$/, "");
const email = process.env.PRODUCTION_EMAIL;
const password = process.env.PRODUCTION_PASSWORD;
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL or SUPABASE_DATABASE_URL in .env.local.");
if (!email || !password) throw new Error("Missing PRODUCTION_EMAIL or PRODUCTION_PASSWORD in .env.import-production.");

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBool(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !["0", "false", "inativo"].includes(value.trim().toLowerCase());
  return fallback;
}

function toCents(value) {
  return Math.round(asNumber(value) * 100);
}

async function request(path, options = {}, cookie = "") {
  const response = await fetch(`${productionUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${data.error || response.statusText}`);
  return { response, data };
}

console.log(`Importing production data from ${productionUrl}`);

const login = await request("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "login", email, password }),
});
const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Production login did not return a session cookie.");

const [{ data: catalog }, { data: ordersData }] = await Promise.all([
  request("/api/catalog", {}, cookie),
  request("/api/orders", {}, cookie),
]);

const customers = Array.isArray(catalog.customers) ? catalog.customers : [];
const orders = Array.isArray(ordersData.orders) ? ordersData.orders : [];
console.log(`Fetched customers=${customers.length} orders=${orders.length}`);

const sql = postgres(databaseUrl, { ssl: "require", prepare: false, max: 1 });
try {
  await sql.begin(async (tx) => {
    for (const customer of customers) {
      await tx`
        insert into customers (
          id, name, document, whatsapp, email, zip_code, street, number,
          complement, neighborhood, city, state, customer_type, active, created_at, updated_at
        ) values (
          ${asNumber(customer.id)}, ${asText(customer.name)}, ${asText(customer.document)}, ${asText(customer.whatsapp)},
          ${asText(customer.email)}, ${asText(customer.zipCode)}, ${asText(customer.street)}, ${asText(customer.number)},
          ${asText(customer.complement)}, ${asText(customer.neighborhood)}, ${asText(customer.city)}, ${asText(customer.state)},
          ${asText(customer.customerType, "Cliente final")}, ${asBool(customer.active)}, ${asText(customer.createdAt, new Date().toISOString())}, ${new Date().toISOString()}
        )
        on conflict (id) do update set
          name = excluded.name,
          document = excluded.document,
          whatsapp = excluded.whatsapp,
          email = excluded.email,
          zip_code = excluded.zip_code,
          street = excluded.street,
          number = excluded.number,
          complement = excluded.complement,
          neighborhood = excluded.neighborhood,
          city = excluded.city,
          state = excluded.state,
          customer_type = excluded.customer_type,
          active = excluded.active,
          updated_at = excluded.updated_at
      `;
    }

    const customerRows = await tx`select id, name from customers`;
    const customerIds = new Map(customerRows.map((row) => [row.name.trim().toLocaleLowerCase("pt-BR"), row.id]));

    for (const order of orders) {
      const total = asNumber(order.total);
      const received = Math.min(asNumber(order.received), total);
      const subtotal = asNumber(order.subtotal, total);
      const createdAt = asText(order.createdAt, new Date().toISOString().slice(0, 10));
      const issuedAt = createdAt.slice(0, 10);
      const dueDate = addDaysIso(issuedAt, 30);
      const deliveryDate = asText(order.deliveryDate, issuedAt);
      const customerName = asText(order.customerName);
      await tx`
        insert into service_orders (
          id, number, customer_id, customer_name, customer_type, origin, product_code,
          quantity, unit_price, subtotal, discount_rate, total, received,
          subtotal_cents, total_cents, received_cents, balance_cents,
          issued_at, due_date, delivery_date, delivery_type, payment_method, wallet_month,
          production_status, financial_status, commercial_status, notes, created_at, updated_at
        ) values (
          ${asNumber(order.id)}, ${asText(order.number)}, ${customerIds.get(customerName.trim().toLocaleLowerCase("pt-BR")) || null},
          ${customerName}, ${asText(order.customerType, "Cliente final")}, ${asText(order.origin, "WhatsApp")}, ${asText(order.productCode)},
          ${asNumber(order.quantity, 1)}, ${asNumber(order.unitPrice)}, ${subtotal}, ${asNumber(order.discountRate)}, ${total}, ${received},
          ${toCents(subtotal)}, ${toCents(total)}, ${toCents(received)}, ${Math.max(0, toCents(total) - toCents(received))},
          ${issuedAt}, ${dueDate}, ${deliveryDate.slice(0, 10)}, ${asText(order.deliveryType)}, ${asText(order.paymentMethod)}, ${asText(order.walletMonth)},
          ${asText(order.productionStatus, "Fila de producao")}, ${received >= total ? "Pago" : "Pendente"}, ${asText(order.commercialStatus, "Pedido confirmado")},
          ${asText(order.notes)}, ${createdAt}, ${new Date().toISOString()}
        )
        on conflict (id) do update set
          number = excluded.number,
          customer_id = excluded.customer_id,
          customer_name = excluded.customer_name,
          customer_type = excluded.customer_type,
          origin = excluded.origin,
          product_code = excluded.product_code,
          quantity = excluded.quantity,
          unit_price = excluded.unit_price,
          subtotal = excluded.subtotal,
          discount_rate = excluded.discount_rate,
          total = excluded.total,
          received = excluded.received,
          subtotal_cents = excluded.subtotal_cents,
          total_cents = excluded.total_cents,
          received_cents = excluded.received_cents,
          balance_cents = excluded.balance_cents,
          issued_at = excluded.issued_at,
          due_date = excluded.due_date,
          delivery_date = excluded.delivery_date,
          delivery_type = excluded.delivery_type,
          payment_method = excluded.payment_method,
          wallet_month = excluded.wallet_month,
          production_status = excluded.production_status,
          financial_status = excluded.financial_status,
          commercial_status = excluded.commercial_status,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `;
    }

    await tx`select setval(pg_get_serial_sequence('customers', 'id'), greatest((select coalesce(max(id), 1) from customers), 1), true)`;
    await tx`select setval(pg_get_serial_sequence('service_orders', 'id'), greatest((select coalesce(max(id), 1) from service_orders), 1), true)`;
  });

  const [counts] = await sql`
    select
      (select count(*)::int from customers) as customers,
      (select count(*)::int from service_orders) as service_orders
  `;
  console.log(`Imported. Supabase totals customers=${counts.customers} orders=${counts.service_orders}`);
  console.log("Open /api/finance once after login to sync accounts_receivable from imported orders.");
} finally {
  await sql.end({ timeout: 5 });
}
