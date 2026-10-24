# Local development setup

## Prerequisites

- Node.js 22 or newer
- Supabase CLI (installed by `npm ci`)
- An isolated hosted Supabase development/test project
- Google Chrome for the configured Playwright projects

## Bootstrap

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Copy only the hosted development Supabase URL and publishable key into `.env.local`. Never expose a database password, service-role key, Resend key, worker secret, or Cloudmersive key through a `VITE_` variable.

The seed uses synthetic identities documented in the repository README. Apply destructive reset fixtures only to a verified disposable test project, never the shared development tenant.

## Required validation

Run `npm run check` and `npm run test:e2e`. Run pgTAP only against an explicitly isolated disposable database environment. Regenerate `schema.sql` with `npm run schema:build` after any migration edit. Regenerate database types after migrations apply; a bootstrap type file is not acceptable release evidence.

## Troubleshooting

Do not run hostile-client or destructive database fixtures against a shared development tenant. Provision an isolated disposable test project for pgTAP and concurrency suites. Do not mark authorization, migration, Edge Function, Storage, or concurrency scenarios passed when the database suite did not execute.
