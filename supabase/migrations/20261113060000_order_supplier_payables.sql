-- Conta a pagar automática ao fornecedor quando a OS com peças de revenda é entregue.
-- accounts_payable guarda de qual OS e de qual parcela a conta nasceu;
-- service_orders marca quando a conta foi gerada, para não gerar duas vezes.
ALTER TABLE public.accounts_payable
  ADD COLUMN IF NOT EXISTS service_order_id integer REFERENCES public.service_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installment_number integer;
CREATE INDEX IF NOT EXISTS accounts_payable_service_order_idx
  ON public.accounts_payable (service_order_id);

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS supplier_payable_at text;

NOTIFY pgrst, 'reload schema';
