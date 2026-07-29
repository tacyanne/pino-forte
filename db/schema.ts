import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  document: text("document").notNull().default(""),
  whatsapp: text("whatsapp").notNull(),
  email: text("email").notNull().default(""),
  zipCode: text("zip_code").notNull().default(""),
  street: text("street").notNull().default(""),
  number: text("number").notNull().default(""),
  complement: text("complement").notNull().default(""),
  neighborhood: text("neighborhood").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  customerType: text("customer_type").notNull().default("Cliente final"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  measure: text("measure").notNull(),
  price: real("price").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const serviceOrders = sqliteTable("service_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(),
  customerName: text("customer_name").notNull(),
  customerType: text("customer_type").notNull().default("Cliente final"),
  origin: text("origin").notNull(),
  productCode: text("product_code").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  subtotal: real("subtotal").notNull().default(0),
  discountRate: real("discount_rate").notNull().default(0),
  total: real("total").notNull(),
  received: real("received").notNull().default(0),
  deliveryDate: text("delivery_date").notNull(),
  deliveryType: text("delivery_type").notNull(),
  paymentMethod: text("payment_method").notNull(),
  productionStatus: text("production_status").notNull().default("Aguardando"),
  commercialStatus: text("commercial_status").notNull().default("Pedido confirmado"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  companyName: text("company_name").notNull().default("Pino de Balança"),
  responsible: text("responsible").notNull().default("Rogério Mendes"),
  companyPhone: text("company_phone").notNull().default(""),
  orderFooter: text("order_footer").notNull().default("Documento gerado pelo sistema Pino de Balança"),
});
