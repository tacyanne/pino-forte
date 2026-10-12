# CLAUDE.md — Pino Forte

Sistema web da Pino Forte (fabricação de peças para suspensão): catálogo de produtos, ordens de serviço/pedidos, clientes e distribuidores, financeiro e configurações, com autenticação própria.

## Stack

- **Framework:** Next.js 16 (App Router), hospedado na **Vercel**. Migrado de vinext/OpenAI Sites (Cloudflare Worker) em `feat/migrar-para-vercel`.
- **UI:** React 19, Tailwind CSS 4, TypeScript 5.9.
- **Banco:** Supabase/Postgres (fonte oficial, ver `docs/adr-001-finance-phase1a.md`), via Drizzle ORM (`drizzle-orm/postgres-js`) + `postgres`, ou via REST do Supabase (`lib/supabase-rest.ts`) quando `SUPABASE_URL` + chave estão configurados. As migrations em `drizzle/` são legado da era D1/SQLite.
- **Outros:** jsPDF (geração de PDF), ESLint 9, Prettier.
- Node `>=22.13.0`.

## Comandos

```bash
npm run dev               # next dev
npm run build             # next build
npm run start             # next start (após build)
npm test                  # node --test tests/*.test.mjs
npm run lint              # eslint
npm run db:generate       # drizzle-kit generate (saída em supabase/drizzle)
npm run db:supabase:apply # aplica migration no Supabase (scripts/apply-supabase-migration.mjs)
npm run import:production # importa dados de produção (scripts/import-production-data.mjs)
```

## Estrutura

- `app/` — páginas e rotas (App Router). `app/page.tsx` concentra a maior parte da UI; `app/catalogo/` é o catálogo; `app/api/{auth,catalog,cep,finance,orders,settings}/route.ts` são as APIs.
- `lib/` — regras de negócio e acesso a dados (`auth.ts`, `finance.ts`, `supabase-rest.ts`, `supabase-mappers.ts`, imagens de produto/catálogo).
- `db/` — conexão Postgres (`index.ts`) e schema Drizzle (`schema.ts`).
- `supabase/migrations/` — migrations SQL oficiais do Supabase. `drizzle/` — migrations antigas (era D1/SQLite).
- `scripts/` — migrations, import de dados, gerador de PDF do catálogo.
- `tests/` — testes `node:test` (`*.test.mjs`).
- `docs/` — ADRs e kit de identidade visual (`docs/brand-identity/`).

## Convenções

- Idioma do produto, mensagens e docs: português do Brasil.
- Commits no padrão Conventional Commits em PT-BR (`feat:`, `fix:`, `docs:`, `chore:`...).
- Autenticação própria em `app_users`/`app_sessions` (cookie `pino_session`), sem Supabase Auth.
- Mudanças de schema: nova migration em `supabase/migrations/`; não editar migrations já aplicadas.
- Não commitar arquivos `.env*` (todos ignorados pelo `.gitignore`).

## Variáveis de ambiente (somente nomes)

Ver `.env.example`. Usadas no código:

- `DATABASE_URL` / `SUPABASE_DATABASE_URL` — connection string Postgres do Supabase.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SERVICE_KEY` / `SUPABASE_ANON_KEY`) — acesso REST ao Supabase.
- `PINO_LOCAL_NODE_POSTGRES` — `1` para usar o driver `postgres` do Node no dev local.
- `PRODUCTION_URL`, `PRODUCTION_EMAIL`, `PRODUCTION_PASSWORD` — usadas apenas por `scripts/import-production-data.mjs`.

## Deploy

Vercel com integração GitHub: cada PR gera um preview e o merge na `main` publica em produção. As variáveis de ambiente acima precisam estar configuradas no projeto `pino-forte` da Vercel.

## Fluxo de git (padronização C:\dev)

- Proibido push direto na `main`: toda mudança, inclusive só documentação, vai por **branch → PR → aprovação da Tacyanne → merge**.
- Nunca usar `--force` na `main`, nem `--no-verify`, nem fazer merge sem aprovação explícita da Tacyanne.
- Branch: `tipo/descricao-curta` (`feat/`, `fix/`, `docs/`, `chore/`). Commits em Conventional Commits, em português.
- Ao abrir o PR, informar o link e parar; o merge é decisão da Tacyanne.
- O repo local tem hook `pre-push` que bloqueia push para `main`.
