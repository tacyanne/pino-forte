-- Boleto parcelado: prazos de 25/50/75 dias geram 1/2/3 parcelas (vencimentos a cada 25 dias).
-- accounts_receivable continua 1:1 com a OS e passa a ser o agregado das parcelas.
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS boleto_term_days integer
  CHECK (boleto_term_days IS NULL OR boleto_term_days IN (25, 50, 75));

CREATE TABLE IF NOT EXISTS public.receivable_installments (
  id serial PRIMARY KEY,
  account_receivable_id integer NOT NULL REFERENCES public.accounts_receivable(id) ON DELETE CASCADE,
  service_order_id integer NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number >= 1),
  total_installments integer NOT NULL CHECK (total_installments >= 1),
  due_date text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  received_cents integer NOT NULL DEFAULT 0 CHECK (received_cents >= 0),
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  status text NOT NULL DEFAULT 'Pendente',
  paid_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text
);
CREATE UNIQUE INDEX IF NOT EXISTS receivable_installments_receivable_number_unique
  ON public.receivable_installments (account_receivable_id, number);
CREATE INDEX IF NOT EXISTS receivable_installments_service_order_idx
  ON public.receivable_installments (service_order_id);
CREATE INDEX IF NOT EXISTS receivable_installments_due_status_idx
  ON public.receivable_installments (due_date, status);

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS installment_id integer REFERENCES public.receivable_installments(id) ON DELETE SET NULL;

-- Backfill: OS Boleto existentes viram 1 parcela preservando o vencimento atual (sem recalcular datas).
INSERT INTO public.receivable_installments
  (account_receivable_id, service_order_id, number, total_installments, due_date,
   amount_cents, received_cents, balance_cents, status, paid_at)
SELECT ar.id, ar.service_order_id, 1, 1, ar.due_date,
       ar.original_amount_cents, LEAST(ar.received_amount_cents, ar.original_amount_cents), ar.balance_cents, ar.status,
       CASE WHEN ar.balance_cents <= 0 THEN ar.updated_at ELSE NULL END
FROM public.accounts_receivable ar
JOIN public.service_orders so ON so.id = ar.service_order_id
WHERE so.payment_method = 'Boleto'
ON CONFLICT (account_receivable_id, number) DO NOTHING;

ALTER TABLE public.receivable_installments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receivable_installments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivable_installments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.receivable_installments_id_seq TO service_role;
NOTIFY pgrst, 'reload schema';
