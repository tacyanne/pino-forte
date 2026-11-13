-- Data da compra de cada conta a pagar (no cartão, a compra acontece antes do vencimento da fatura).
-- Opcional: contas antigas ficam sem data até serem editadas.
alter table public.accounts_payable add column if not exists purchase_date text;
