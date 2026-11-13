-- Qual custo a peça usa a partir de cada data: 'comprada' (revenda) ou 'fabricada' (fabricação).
-- Vale a escolha mais recente até a data consultada. Sem escolha, segue a regra antiga
-- (o custo que começou a valer por último).
CREATE TABLE IF NOT EXISTS public.product_cost_in_use (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('fabricada', 'comprada')),
  starts_at text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  UNIQUE (product_id, starts_at)
);

ALTER TABLE public.product_cost_in_use ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_cost_in_use FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_cost_in_use TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.product_cost_in_use_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
