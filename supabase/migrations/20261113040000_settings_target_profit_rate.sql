-- Meta de lucro sobre o custo das peças (0.35 = 35%), usada em Preços e margem.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS target_profit_rate double precision NOT NULL DEFAULT 0.35;

NOTIFY pgrst, 'reload schema';
