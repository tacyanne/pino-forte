-- Origem do custo da peça: fabricada por nós ou comprada pronta de outro fornecedor.
-- O que já existe continua como 'fabricada'. Cada origem tem o próprio histórico de vigência.
ALTER TABLE public.product_cost_history
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'fabricada',
  ADD COLUMN IF NOT EXISTS supplier text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_cost_history_source_check') THEN
    ALTER TABLE public.product_cost_history
      ADD CONSTRAINT product_cost_history_source_check CHECK (source IN ('fabricada', 'comprada'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
