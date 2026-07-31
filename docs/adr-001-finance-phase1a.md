# ADR-001: Supabase/Postgres como banco oficial do Pino Forte

**Status:** Accepted
**Date:** 2026-07-31
**Deciders:** Pino Forte / RibeX AI

## Context
O projeto estava usando Cloudflare D1 com Drizzle SQLite. A direcao oficial agora e manter todo o banco no Supabase, usando o Postgres gerenciado como fonte unica para cadastros, OS, autenticacao propria, financeiro, auditoria e relatorios.

A tela Financeiro criada anteriormente e somente uma visao inicial. A persistencia definitiva deve ser Postgres/Supabase. D1 passa a ser tratado como legado temporario apenas se houver dados a extrair.

## Decision
Migrar a camada de persistencia do backend para Supabase/Postgres usando Drizzle ORM com `drizzle-orm/postgres-js` e connection string via `DATABASE_URL` ou `SUPABASE_DATABASE_URL`.

Manter a autenticacao existente do sistema em tabelas `app_users` e `app_sessions` dentro do Supabase, sem adotar Supabase Auth nesta fase. Isso reduz impacto na interface e preserva o fluxo atual de login.

## Options Considered

### Option A: Supabase/Postgres com Drizzle
| Dimension | Assessment |
|-----------|------------|
| Complexity | Media |
| Cost | Baixo a medio |
| Scalability | Boa para a fase atual |
| Team familiarity | Boa, por manter SQL relacional e Drizzle |

**Pros:** Postgres real, constraints fortes, transacoes, indices, relatorios financeiros melhores, caminho claro para auditoria.
**Cons:** Exige migration de D1/SQLite, variaveis seguras e revisao das rotas.

### Option B: Continuar em Cloudflare D1
| Dimension | Assessment |
|-----------|------------|
| Complexity | Baixa no curto prazo |
| Cost | Baixo |
| Scalability | Limitada para regras financeiras mais sofisticadas |
| Team familiarity | Ja existente |

**Pros:** Menos mudanca imediata.
**Cons:** Contraria a direcao oficial, limita integridade financeira, mantem dependencias D1.

## Consequences
- Todas as rotas privadas passam a depender de `DATABASE_URL`/`SUPABASE_DATABASE_URL`.
- Migrations oficiais novas ficam em `supabase/migrations`.
- A pasta `drizzle` antiga representa historico legado D1 e nao deve ser aplicada no Supabase.
- A migracao dos dados existentes precisara de um passo controlado de exportacao D1 -> importacao Supabase.
- A Fase 1B deve mover OS, Carteira e Financeiro para servicos transacionais no backend.

## Action Items
1. [x] Adicionar driver Postgres.
2. [x] Trocar `db/index.ts` para Postgres/Supabase.
3. [x] Trocar schema Drizzle para `pg-core`.
4. [x] Adaptar autenticacao propria para Postgres.
5. [x] Criar migration inicial Supabase.
6. [x] Configurar `DATABASE_URL` segura no ambiente local.
7. [x] Aplicar migration em banco Supabase vazio/teste.
8. [ ] Exportar dados legados e rodar importacao validada.
9. [x] Criar APIs financeiras iniciais com transacoes Postgres.
