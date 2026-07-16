import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  document: text("document").notNull().default(""),
  whatsapp: text("whatsapp").notNull(),
  email: text("email").notNull().default(""),
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
  origin: text("origin").notNull(),
  productCode: text("product_code").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
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
