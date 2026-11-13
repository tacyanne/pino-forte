-- Estoque de peças prontas: lançamentos feitos à mão (contagem, entrada e saída).
-- As saídas por venda não são gravadas aqui: vêm das OS entregues.
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('contagem', 'entrada', 'saida')),
  quantity integer NOT NULL CHECK (quantity >= 0),
  movement_date text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_by integer,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);
CREATE INDEX IF NOT EXISTS stock_movements_product_date_idx
  ON public.stock_movements (product_id, movement_date);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_movements FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_movements_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
