-- Histórico do preço de venda de cada peça, por vigência (mesmo modelo do custo).
-- source: 'tela' (alteração feita no sistema), 'cadastro' (preço do cadastro da peça)
-- ou 'vendas' (reconstruído a partir dos preços praticados nas vendas antigas).
CREATE TABLE IF NOT EXISTS public.product_price_history (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  starts_at text NOT NULL,
  ends_at text,
  source text NOT NULL DEFAULT 'tela' CHECK (source IN ('tela', 'cadastro', 'vendas')),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);
CREATE INDEX IF NOT EXISTS product_price_history_product_start_idx
  ON public.product_price_history (product_id, starts_at);

ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_price_history FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_price_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.product_price_history_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
