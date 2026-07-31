import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
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
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  measure: text("measure").notNull(),
  price: doublePrecision("price").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const serviceOrders = pgTable("service_orders", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: text("customer_name").notNull(),
  customerType: text("customer_type").notNull().default("Cliente final"),
  origin: text("origin").notNull(),
  productCode: text("product_code").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: doublePrecision("unit_price").notNull(),
  subtotal: doublePrecision("subtotal").notNull().default(0),
  discountRate: doublePrecision("discount_rate").notNull().default(0),
  total: doublePrecision("total").notNull(),
  received: doublePrecision("received").notNull().default(0),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  surchargeCents: integer("surcharge_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  receivedCents: integer("received_cents").notNull().default(0),
  balanceCents: integer("balance_cents").notNull().default(0),
  issuedAt: text("issued_at").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  deliveryDate: text("delivery_date").notNull(),
  deliveryType: text("delivery_type").notNull(),
  paymentMethod: text("payment_method").notNull(),
  walletMonth: text("wallet_month").notNull().default(""),
  productionStatus: text("production_status").notNull().default("Aguardando"),
  financialStatus: text("financial_status").notNull().default("Pendente"),
  commercialStatus: text("commercial_status").notNull().default("Pedido confirmado"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  canceledAt: text("canceled_at"),
  canceledBy: integer("canceled_by"),
  cancelReason: text("cancel_reason").notNull().default(""),
});

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  companyName: text("company_name").notNull().default("Pino Forte"),
  responsible: text("responsible").notNull().default("Rogerio Mendes"),
  companyPhone: text("company_phone").notNull().default(""),
  orderFooter: text("order_footer").notNull().default("Documento gerado pelo sistema Pino Forte"),
});

export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  role: text("role").notNull().default("user"),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const appSessions = pgTable("app_sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => appUsers.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const financialMigrationIssues = pgTable("financial_migration_issues", {
  id: serial("id").primaryKey(),
  phase: text("phase").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  issueType: text("issue_type").notNull(),
  details: text("details").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const financialCategories = pgTable("financial_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  parentId: integer("parent_id"),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  nameTypeUnique: uniqueIndex("financial_categories_name_type_unique").on(table.name, table.type),
}));

export const serviceOrderItems = pgTable("service_order_items", {
  id: serial("id").primaryKey(),
  serviceOrderId: integer("service_order_id").notNull().references(() => serviceOrders.id),
  productId: integer("product_id").references(() => products.id),
  itemPosition: integer("item_position").notNull().default(1),
  productCodeSnapshot: text("product_code_snapshot").notNull(),
  descriptionSnapshot: text("description_snapshot").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  orderPositionUnique: uniqueIndex("service_order_items_order_position_unique").on(table.serviceOrderId, table.itemPosition),
  serviceOrderIdx: index("service_order_items_service_order_idx").on(table.serviceOrderId),
}));

export const accountsReceivable = pgTable("accounts_receivable", {
  id: serial("id").primaryKey(),
  serviceOrderId: integer("service_order_id").notNull().references(() => serviceOrders.id),
  customerId: integer("customer_id").references(() => customers.id),
  issuedAt: text("issued_at").notNull(),
  dueDate: text("due_date").notNull(),
  originalAmountCents: integer("original_amount_cents").notNull(),
  receivedAmountCents: integer("received_amount_cents").notNull().default(0),
  balanceCents: integer("balance_cents").notNull().default(0),
  status: text("status").notNull().default("Pendente"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  serviceOrderUnique: uniqueIndex("accounts_receivable_service_order_unique").on(table.serviceOrderId),
  customerIdx: index("accounts_receivable_customer_idx").on(table.customerId),
  dueStatusIdx: index("accounts_receivable_due_status_idx").on(table.dueDate, table.status),
}));

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  accountReceivableId: integer("account_receivable_id").notNull().references(() => accountsReceivable.id),
  serviceOrderId: integer("service_order_id").notNull().references(() => serviceOrders.id),
  receiptDate: text("receipt_date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paymentMethod: text("payment_method").notNull(),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("Confirmado"),
  reversalOfReceiptId: integer("reversal_of_receipt_id"),
  legacySourceKey: text("legacy_source_key"),
  createdBy: integer("created_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  legacySourceKeyUnique: uniqueIndex("receipts_legacy_source_key_unique").on(table.legacySourceKey),
  accountReceivableIdx: index("receipts_account_receivable_idx").on(table.accountReceivableId),
}));

export const accountsPayable = pgTable("accounts_payable", {
  id: serial("id").primaryKey(),
  supplier: text("supplier").notNull(),
  description: text("description").notNull(),
  categoryId: integer("category_id").references(() => financialCategories.id),
  competenceMonth: text("competence_month").notNull(),
  dueDate: text("due_date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paymentMethod: text("payment_method").notNull().default(""),
  paidAt: text("paid_at"),
  status: text("status").notNull().default("Pendente"),
  recurringExpenseId: integer("recurring_expense_id"),
  receiptFileKey: text("receipt_file_key").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  dueStatusIdx: index("accounts_payable_due_status_idx").on(table.dueDate, table.status),
}));

export const recurringExpenses = pgTable("recurring_expenses", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
  categoryId: integer("category_id").references(() => financialCategories.id),
  amountCents: integer("amount_cents").notNull(),
  dueDay: integer("due_day").notNull(),
  periodicity: text("periodicity").notNull().default("mensal"),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  active: boolean("active").notNull().default(true),
  expenseType: text("expense_type").notNull().default("OUTROS"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const cashMovements = pgTable("cash_movements", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  origin: text("origin").notNull(),
  originId: integer("origin_id"),
  movementDate: text("movement_date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paymentMethod: text("payment_method").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("Confirmado"),
  reversalOfMovementId: integer("reversal_of_movement_id"),
  legacySourceKey: text("legacy_source_key"),
  createdBy: integer("created_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  legacySourceKeyUnique: uniqueIndex("cash_movements_legacy_source_key_unique").on(table.legacySourceKey),
  dateTypeIdx: index("cash_movements_date_type_idx").on(table.movementDate, table.type),
}));

export const monthlyClosings = pgTable("monthly_closings", {
  id: serial("id").primaryKey(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  closedAt: text("closed_at"),
  openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
  totalInCents: integer("total_in_cents").notNull().default(0),
  totalOutCents: integer("total_out_cents").notNull().default(0),
  closingBalanceCents: integer("closing_balance_cents").notNull().default(0),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("Aberto"),
  closedBy: integer("closed_by"),
  reopenedAt: text("reopened_at"),
  reopenedBy: integer("reopened_by"),
  reopenReason: text("reopen_reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  monthYearUnique: uniqueIndex("monthly_closings_month_year_unique").on(table.month, table.year),
}));

export const productCostHistory = pgTable("product_cost_history", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  rawMaterialCostCents: integer("raw_material_cost_cents").notNull().default(0),
  freightCents: integer("freight_cents").notNull().default(0),
  additionalCostsCents: integer("additional_costs_cents").notNull().default(0),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  beforeValues: text("before_values").notNull().default(""),
  afterValues: text("after_values").notNull().default(""),
  context: text("context").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  entityIdx: index("audit_logs_entity_idx").on(table.entity, table.entityId),
}));