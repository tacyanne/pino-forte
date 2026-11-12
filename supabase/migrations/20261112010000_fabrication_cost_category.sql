-- Categoria para contas a pagar que já estão dentro do custo de cada peça
-- (aço, serviço de torneiro). O Financeiro não soma essas contas de novo em "Quanto gastei".
insert into public.financial_categories (name, type)
values ('Custo de fabricacao', 'saida')
on conflict (name, type) do nothing;
