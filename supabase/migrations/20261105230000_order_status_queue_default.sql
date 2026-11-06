-- Fluxo de status da OS: "Fila de produção" -> "Entregue" (e "Cancelada").
-- O padrão da coluna passa a ser "Fila de produção". Não altera linhas existentes.
alter table public.service_orders
  alter column production_status set default 'Fila de produção';
