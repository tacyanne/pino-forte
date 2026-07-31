-- Pino Forte - Supabase/Postgres foundation
-- Apply in Supabase SQL editor or via Supabase CLI after backup/approval.

CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  document text NOT NULL DEFAULT '',
  whatsapp text NOT NULL,
  email text NOT NULL DEFAULT '',
  zip_code text NOT NULL DEFAULT '',
  street text NOT NULL DEFAULT '',
  number text NOT NULL DEFAULT '',
  complement text NOT NULL DEFAULT '',
  neighborhood text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  customer_type text NOT NULL DEFAULT 'Cliente final',
  active boolean NOT NULL DEFAULT true,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  measure text NOT NULL,
  price double precision NOT NULL,
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS service_orders (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  customer_id integer REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  customer_type text NOT NULL DEFAULT 'Cliente final',
  origin text NOT NULL,
  product_code text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price double precision NOT NULL CHECK (unit_price >= 0),
  subtotal double precision NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_rate double precision NOT NULL DEFAULT 0 CHECK (discount_rate >= 0),
  total double precision NOT NULL CHECK (total >= 0),
  received double precision NOT NULL DEFAULT 0 CHECK (received >= 0),
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  surcharge_cents integer NOT NULL DEFAULT 0 CHECK (surcharge_cents >= 0),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  received_cents integer NOT NULL DEFAULT 0 CHECK (received_cents >= 0),
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  issued_at text NOT NULL DEFAULT '',
  due_date text NOT NULL DEFAULT '',
  delivery_date text NOT NULL,
  delivery_type text NOT NULL,
  payment_method text NOT NULL,
  wallet_month text NOT NULL DEFAULT '',
  production_status text NOT NULL DEFAULT 'Aguardando',
  financial_status text NOT NULL DEFAULT 'Pendente',
  commercial_status text NOT NULL DEFAULT 'Pedido confirmado',
  notes text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  canceled_at text,
  canceled_by integer,
  cancel_reason text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY,
  company_name text NOT NULL DEFAULT 'Pino Forte',
  responsible text NOT NULL DEFAULT 'Rogerio Mendes',
  company_phone text NOT NULL DEFAULT '',
  order_footer text NOT NULL DEFAULT 'Documento gerado pelo sistema Pino Forte'
);

CREATE TABLE IF NOT EXISTS app_users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  salt text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  active boolean NOT NULL DEFAULT true,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS financial_migration_issues (
  id serial PRIMARY KEY,
  phase text NOT NULL,
  entity text NOT NULL,
  entity_id integer,
  issue_type text NOT NULL,
  details text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS financial_categories (
  id serial PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('entrada', 'saida')),
  parent_id integer REFERENCES financial_categories(id),
  active boolean NOT NULL DEFAULT true,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  UNIQUE (name, type)
);

CREATE TABLE IF NOT EXISTS service_order_items (
  id serial PRIMARY KEY,
  service_order_id integer NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
  product_id integer REFERENCES products(id) ON DELETE SET NULL,
  item_position integer NOT NULL DEFAULT 1,
  product_code_snapshot text NOT NULL,
  description_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  UNIQUE (service_order_id, item_position)
);

CREATE TABLE IF NOT EXISTS accounts_receivable (
  id serial PRIMARY KEY,
  service_order_id integer NOT NULL UNIQUE REFERENCES service_orders(id) ON DELETE RESTRICT,
  customer_id integer REFERENCES customers(id) ON DELETE RESTRICT,
  issued_at text NOT NULL,
  due_date text NOT NULL,
  original_amount_cents integer NOT NULL CHECK (original_amount_cents >= 0),
  received_amount_cents integer NOT NULL DEFAULT 0 CHECK (received_amount_cents >= 0),
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  status text NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Parcial', 'Pago', 'Vencido', 'Cancelado')),
  notes text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS receipts (
  id serial PRIMARY KEY,
  account_receivable_id integer NOT NULL REFERENCES accounts_receivable(id) ON DELETE RESTRICT,
  service_order_id integer NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
  receipt_date text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  payment_method text NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Confirmado' CHECK (status IN ('Confirmado', 'Estornado')),
  reversal_of_receipt_id integer REFERENCES receipts(id),
  legacy_source_key text UNIQUE,
  created_by integer,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS accounts_payable (
  id serial PRIMARY KEY,
  supplier text NOT NULL,
  description text NOT NULL,
  category_id integer REFERENCES financial_categories(id) ON DELETE SET NULL,
  competence_month text NOT NULL,
  due_date text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  payment_method text NOT NULL DEFAULT '',
  paid_at text,
  status text NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Pago', 'Vencido', 'Cancelado')),
  recurring_expense_id integer,
  receipt_file_key text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id serial PRIMARY KEY,
  description text NOT NULL,
  category_id integer REFERENCES financial_categories(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  due_day integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  periodicity text NOT NULL DEFAULT 'mensal',
  starts_at text NOT NULL,
  ends_at text,
  active boolean NOT NULL DEFAULT true,
  expense_type text NOT NULL DEFAULT 'OUTROS',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id serial PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('entrada', 'saida')),
  origin text NOT NULL,
  origin_id integer,
  movement_date text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  payment_method text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'Confirmado' CHECK (status IN ('Confirmado', 'Estornado')),
  reversal_of_movement_id integer REFERENCES cash_movements(id),
  legacy_source_key text UNIQUE,
  created_by integer,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS monthly_closings (
  id serial PRIMARY KEY,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year >= 2000),
  closed_at text,
  opening_balance_cents integer NOT NULL DEFAULT 0,
  total_in_cents integer NOT NULL DEFAULT 0,
  total_out_cents integer NOT NULL DEFAULT 0,
  closing_balance_cents integer NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Aberto' CHECK (status IN ('Aberto', 'Fechado')),
  closed_by integer,
  reopened_at text,
  reopened_by integer,
  reopen_reason text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  UNIQUE (month, year)
);

CREATE TABLE IF NOT EXISTS product_cost_history (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  raw_material_cost_cents integer NOT NULL DEFAULT 0,
  freight_cents integer NOT NULL DEFAULT 0,
  additional_costs_cents integer NOT NULL DEFAULT 0,
  unit_cost_cents integer NOT NULL DEFAULT 0,
  starts_at text NOT NULL,
  ends_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  user_id integer,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id integer,
  before_values text NOT NULL DEFAULT '',
  after_values text NOT NULL DEFAULT '',
  context text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

CREATE INDEX IF NOT EXISTS service_orders_customer_idx ON service_orders(customer_id);
CREATE INDEX IF NOT EXISTS service_order_items_service_order_idx ON service_order_items(service_order_id);
CREATE INDEX IF NOT EXISTS accounts_receivable_customer_idx ON accounts_receivable(customer_id);
CREATE INDEX IF NOT EXISTS accounts_receivable_due_status_idx ON accounts_receivable(due_date, status);
CREATE INDEX IF NOT EXISTS receipts_account_receivable_idx ON receipts(account_receivable_id);
CREATE INDEX IF NOT EXISTS accounts_payable_due_status_idx ON accounts_payable(due_date, status);
CREATE INDEX IF NOT EXISTS cash_movements_date_type_idx ON cash_movements(movement_date, type);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity, entity_id);

INSERT INTO app_settings (id, company_name, responsible, company_phone, order_footer)
VALUES (1, 'Pino Forte', 'Rogerio Mendes', '', 'Documento gerado pelo sistema Pino Forte')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (code, sku, name, measure, price, price_cents)
VALUES
  ('RN 180', 'RN-180', 'Pino de balanca RN 180', '180 mm', 49, 4900),
  ('RN 190', 'RN-190', 'Pino de balanca RN 190', '190 mm', 55, 5500),
  ('RN 205', 'RN-205', 'Pino de balanca RN 205', '205 mm', 56, 5600),
  ('RN 225', 'RN-225', 'Pino de balanca RN 225', '225 mm', 57, 5700),
  ('RO 215', 'RO-215', 'Pino de balanca RO 215', '215 mm', 63, 6300),
  ('RO 235', 'RO-235', 'Pino de balanca RO 235', '235 mm', 68, 6800)
ON CONFLICT (code) DO NOTHING;

INSERT INTO financial_categories (name, type)
VALUES
  ('Materia-prima', 'saida'),
  ('Frete', 'saida'),
  ('Ferramentas', 'saida'),
  ('Manutencao', 'saida'),
  ('Energia', 'saida'),
  ('Embalagens', 'saida'),
  ('Impostos', 'saida'),
  ('Taxas financeiras', 'saida'),
  ('Administrativo', 'saida'),
  ('Pro-labore', 'saida'),
  ('Investimentos', 'saida'),
  ('Outros', 'saida'),
  ('Recebimento de cliente', 'entrada'),
  ('Aporte dos socios', 'entrada'),
  ('Ajuste autorizado', 'entrada')
ON CONFLICT (name, type) DO NOTHING;