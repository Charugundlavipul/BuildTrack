# BuildTrack deployment runbook

## 1. Validate locally

1. Run `npm ci`, `npm run check`, and `npm run test:e2e`.
2. Link the intended hosted Supabase project, run `npm run db:lint`, and generate types with `npm run db:types`.
3. Review migration and generated-type changes before applying them.
4. Confirm the tenant dataset and enabled provider integrations match the approved deployment scope.

## 2. Create or link the Supabase project

Authenticate interactively with `supabase login`. Obtain the organization ID and a generated database password through a secure password manager.

```powershell
supabase projects create field-ops-dev --org-id <organization-id> --db-password <secure-prompt-value> --region us-east-1 --size micro
supabase link --project-ref <returned-project-ref>
supabase db push --linked --include-all
```

Do not place the database password in command history. Prefer an interactive prompt or ephemeral process environment. Select compute and high availability from the organization’s approved capacity and recovery requirements.

## 3. Configure server secrets

Set `APP_ORIGIN`, `RESEND_API_KEY`, `EMAIL_FROM`, `CLOUDMERSIVE_API_KEY`, and a generated `WORKER_SHARED_SECRET` through Supabase secrets. The service-role key is supplied to Edge Functions by Supabase and never belongs in Vercel.

Verify the chosen Resend domain with SPF and DKIM before enabling external delivery. Configure Supabase Auth SMTP with the same approved sender. Keep notification dispatch disabled until a controlled recipient test passes.

Deploy Edge Functions individually and confirm JWT requirements match `supabase/config.toml`.

### Website origins for Edge Functions

In the Supabase dashboard, open **Project Settings → Edge Functions → Secrets** and set `APP_ORIGIN` to the complete comma-separated list of approved website origins, for example `https://app.example.com,https://staging.example.com,http://localhost:5173`. Use scheme and host only, with no path or trailing slash. Setting the secret replaces the existing value, so retain every origin that still needs access. This is separate from **Authentication → URL Configuration**, which controls sign-in and password-reset redirects.

The current production origin `https://buildtrack-five-blush.vercel.app` is also explicitly allowed in `supabase/functions/_shared/http.ts` because the existing secret's complete value could not be read. When the full `APP_ORIGIN` list is confirmed and configured, remove that explicit fallback before redeploying. A shared-code change must be deployed to every affected function, not just `command`; verify browser OPTIONS requests from the new origin return 204, and an unapproved origin remains rejected. Never use a wildcard origin for authenticated commands.

## 4. Deploy the Vercel application

Create project `buildtrack` through the authenticated Vercel CLI or dashboard. Configure only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_ORIGIN`

Deploy the application, then add its exact HTTPS URL to Supabase Auth redirect URLs and `APP_ORIGIN`. Confirm CSP, sign-in, tenant selection, direct RLS denial, offline shell, and logout behavior.

## 5. Schedule workers

Run the database notification scheduler every five minutes and invoke `dispatch-notifications` with `x-worker-secret`. Invoke `scheduled-cleanup` hourly. Monitor dead rows before allowing live recipients.

Record the deployed versions, verification results, rollback point, and operational owner in the release record.
