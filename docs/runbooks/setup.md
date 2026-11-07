# BuildTrack setup

## Prerequisites

- Node.js 22 or newer
- Supabase CLI (installed by `npm ci`)
- A hosted Supabase project appropriate to the target environment
- Google Chrome for the configured Playwright projects

## Bootstrap

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Copy only the hosted Supabase URL and publishable key into `.env.local`. Never expose a database password, service-role key, Resend key, worker secret, or Cloudmersive key through a `VITE_` variable.

The optional seed dataset uses the sample identities documented in the repository README. Automatic seeding is disabled. Set the SQL session setting `buildtrack.dev_seed_password` to a private password of at least 12 characters before explicitly running the fixture script. Apply fixtures only to a verified disposable test project, never an active tenant. CI supplies a random fixture password to its local database without printing it.

## Required validation

Run `npm run check`, `npm run test:e2e`, and `npm run db:lint`. Run pgTAP only against an explicitly isolated disposable hosted database environment. Regenerate `schema.sql` with `npm run schema:build` after any migration edit. Regenerate linked database types after migrations apply.

## Troubleshooting

Do not run hostile-client or destructive database fixtures against an active tenant. Provision an isolated disposable hosted project for pgTAP and concurrency suites. Record authorization, migration, Edge Function, Storage, and concurrency results from their actual executions.
