-- Lote de compra: o que entrou de um fornecedor em uma data.
-- Cada entrada de estoque pode pertencer a um lote e guarda o custo pago por peça naquele lote.
CREATE TABLE IF NOT EXISTS public.purchase_batches (
  id serial PRIMARY KEY,
  supplier text NOT NULL,
  purchase_date text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_by integer,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS batch_id integer REFERENCES public.purchase_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_cost_cents integer CHECK (unit_cost_cents IS NULL OR unit_cost_cents > 0);
CREATE INDEX IF NOT EXISTS stock_movements_batch_idx ON public.stock_movements (batch_id);

ALTER TABLE public.purchase_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_batches FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_batches TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_batches_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
