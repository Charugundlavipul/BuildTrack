# Development deployment runbook

## 1. Validate locally

1. Run `npm ci`, `npm run db:start`, `npm run db:reset`, and `npm run db:test`.
2. Generate types with `npm run db:types`; fail review if generated output differs unexpectedly.
3. Run `npm run check` and `npm run test:e2e`.
4. Confirm only synthetic data exists and the development banner is visible.

## 2. Create Supabase development project

Authenticate interactively with `supabase login`. Obtain the organization ID and a generated database password through a secure password manager.

```powershell
supabase projects create field-ops-dev --org-id <organization-id> --db-password <secure-prompt-value> --region us-east-1 --size micro
supabase link --project-ref <returned-project-ref>
supabase db push --linked --include-all
```

Do not place the database password in command history. Prefer an interactive prompt or ephemeral process environment. Do not enable high availability for this development project.

## 3. Configure server secrets

Set `APP_ORIGIN`, `RESEND_API_KEY`, `EMAIL_FROM`, `CLOUDMERSIVE_API_KEY`, and a generated `WORKER_SHARED_SECRET` through Supabase secrets. The service-role key is supplied to Edge Functions by Supabase and never belongs in Vercel.

Verify the chosen Resend domain with SPF and DKIM before enabling external delivery. Configure Supabase Auth SMTP with the same approved sender. Keep notification dispatch disabled until a controlled recipient test passes.

Deploy Edge Functions individually and confirm JWT requirements match `supabase/config.toml`.

## 4. Deploy Vercel preview

Create project `buildtrack` through the authenticated Vercel CLI or dashboard. Configure only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_ORIGIN`
- `VITE_ENVIRONMENT=development`

Deploy a preview, then add its exact URL to Supabase Auth redirect URLs and `APP_ORIGIN`. Confirm CSP, sign-in, tenant selection, direct RLS denial, offline shell, and logout behavior.

## 5. Schedule workers

Run the database notification scheduler every five minutes and invoke `dispatch-notifications` with `x-worker-secret`. Invoke `scheduled-cleanup` hourly. Monitor dead rows before allowing live recipients.

Production deployment is not authorized by this runbook.
