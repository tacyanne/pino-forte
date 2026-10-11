# CLAUDE.md — Pino Forte

Sistema web da Pino Forte (fabricação de peças para suspensão): catálogo de produtos, ordens de serviço/pedidos, clientes e distribuidores, financeiro e configurações, com autenticação própria.

> **Migração em andamento:** a branch `feat/migrar-para-vercel` contém a migração de vinext/OpenAI Sites para Next.js puro na Vercel (ainda não mergeada). Este documento descreve o estado atual da `main`. Não misture mudanças das duas branches.

## Stack (main)

- **Runtime/framework:** [vinext](https://github.com/cloudflare/vinext) (reimplementação do App Router do Next.js sobre Vite) rodando como Cloudflare Worker (`worker/index.ts`), hospedado via **OpenAI Sites** (`.openai/hosting.json`).
- **UI:** React 19, Next 16 (APIs `next/*`), Tailwind CSS 4, TypeScript 5.9.
- **Banco:** Supabase/Postgres (fonte oficial, ver `docs/adr-001-finance-phase1a.md`), via Drizzle ORM (`drizzle-orm/postgres-js`) + `postgres`, ou via REST do Supabase (`lib/supabase-rest.ts`) quando `SUPABASE_URL` + chave estão configurados. O binding D1 (`DB`) é legado do template.
- **Outros:** jsPDF (geração de PDF), ESLint 9, Prettier.
- Node `>=22.13.0`.

## Comandos

```bash
npm run install:ci        # npm ci controlado (scripts/install-ci.sh, Linux)
npm run dev               # servidor de desenvolvimento Vite/vinext
npm run build             # build + validação do artefato Sites (scripts/build-verified.sh)
npm run start             # sobe o app já buildado (vinext start)
npm test                  # build + node --test tests/*.test.mjs
npm run lint              # eslint
npm run validate:artifact # revalida o artefato gerado
npm run db:generate       # drizzle-kit generate (saída em supabase/drizzle)
npm run db:supabase:apply # aplica migration no Supabase (scripts/apply-supabase-migration.mjs)
npm run preview:local     # preview local (scripts/start-local-preview.mjs)
npm run import:production # importa dados de produção (scripts/import-production-data.mjs)
```

Os scripts shell (`scripts/*.sh`) assumem Linux/bash com GNU `timeout` e `flock`; no Windows use Git Bash/WSL.

## Estrutura

- `app/` — páginas e rotas (App Router). `app/page.tsx` concentra a maior parte da UI; `app/catalogo/` é o catálogo; `app/api/{auth,catalog,cep,finance,orders,settings}/route.ts` são as APIs.
- `lib/` — regras de negócio e acesso a dados (`auth.ts`, `finance.ts`, `supabase-rest.ts`, `supabase-mappers.ts`, imagens de produto/catálogo).
- `db/` — conexão Postgres (`index.ts`) e schema Drizzle (`schema.ts`).
- `supabase/migrations/` — migrations SQL oficiais do Supabase. `drizzle/` — migrations antigas (era D1/SQLite).
- `worker/index.ts` — entry point do Cloudflare Worker. `build/` — plugin Vite do Sites.
- `scripts/` — instalação, build, validação, migrations, import de dados, gerador de PDF do catálogo.
- `tests/` — testes `node:test` (`*.test.mjs`).
- `docs/` — ADRs e kit de identidade visual (`docs/brand-identity/`).
- `examples/` — exemplos do template (D1).

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
- `HOST`, `PORT` — preview local.
- Bindings do Worker: `ASSETS`, `IMAGES`, `DB` (D1, legado).

## Deploy

Na `main`, o deploy é feito pelo OpenAI Sites: o builder remoto roda `npm run build` sobre o commit enviado (ver README). Não há `wrangler.jsonc` nem `vercel.json` na `main`.
