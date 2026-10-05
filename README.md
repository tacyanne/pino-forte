# Pino Forte

Sistema de pedidos, financeiro e catálogo da Pino Forte (pinos de balança).

- **Stack:** Next.js (App Router) + Supabase (Postgres)
- **Hospedagem:** Vercel, deploy automático a cada merge no `main`
- **Banco:** projeto Supabase `pino-forte`; migrations em `supabase/migrations/`

## Variáveis de ambiente

Configuradas no projeto `pino-forte` da Vercel. Para rodar localmente, crie `.env.local`:

| Variável | Uso |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | chave de serviço (somente servidor) |
| `DATABASE_URL` | connection string Postgres do Supabase (rotas que usam Drizzle) |

## Comandos

- `npm run dev`: servidor local em http://localhost:3000
- `npm run build`: build de produção
- `npm test`: testes (`tests/*.test.mjs`)
- `npm run lint`: ESLint
- `npm run db:generate`: gerar migrations Drizzle após mudar `db/schema.ts`
- `npm run db:supabase:apply`: aplicar migration no Supabase

## Histórico

Até outubro/2026 o projeto rodava no OpenAI Sites com vinext (Next sobre Vite/Cloudflare Workers). Foi migrado para Next.js na Vercel para seguir o mesmo padrão dos demais projetos.
