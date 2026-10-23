# Local development setup

## Prerequisites

- Node.js 22 or newer
- Docker Desktop with at least 8 GB of free disk space
- Supabase CLI (installed by `npm ci`)
- Google Chrome for the configured Playwright projects

## Bootstrap

```powershell
npm ci
npm run db:start
npm run db:reset
npm run db:test
npm run db:types
Copy-Item .env.example .env.local
npm run dev
```

Copy only the local Supabase URL and publishable/anon key printed by the CLI into `.env.local`. Never expose a database password, service-role key, Resend key, worker secret, or Cloudmersive key through a `VITE_` variable.

The seed uses synthetic identities documented in the repository README. Resetting the local database destroys local test records and restores those fixtures.

## Required validation

Run `npm run check`, `npm run db:test`, and `npm run test:e2e`. Regenerate `schema.sql` with `npm run schema:build` after any migration edit. Regenerate database types after migrations apply; a bootstrap type file is not acceptable release evidence.

## Troubleshooting

If the Supabase stack cannot start, confirm Docker Desktop is healthy and has enough free disk space before retrying. Do not mark authorization, migration, Edge Function, Storage, or concurrency scenarios passed when the database suite did not execute.
