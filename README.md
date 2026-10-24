# BuildTrack

BuildTrack is a mobile-responsive construction field operations and quality-management PWA. It gives internal teams, inspectors, and approved trade partners a scoped workspace for capturing work, assigning accountability, submitting correction evidence, and independently verifying completion.

It is installable on supported Android and iOS browsers. Authorized homes can be explicitly downloaded for 24-hour offline access, with field records, checklist responses, comments, and evidence queued until reconnection. See [the mobile/offline field guide](docs/mobile-offline-guide.md).

See [the persona and access guide](docs/persona-guide.md) for dashboard routing, role scopes, password recovery, invitations, and administrator handover.

This repository implements the BuildTrack field-operations platform from `Construction_Operations_Business_Requirements.docx` and `Supabase_LLM_Implementation_Specification.txt`. Each organization remains responsible for its approved safety, retention, procurement, and compliance policies.

## Architecture

- React + TypeScript + Vite PWA
- Supabase Auth, Postgres, private Storage, Edge Functions, and Cron
- IndexedDB/Dexie durable offline queue partitioned by user and organization
- Resend for invitation and operational email
- Cloudmersive for malware scanning and HEIC display conversion
- Vercel hosting for the static client

Database reads are protected by RLS. Workflow writes use the `execute_command` transaction envelope and cannot be performed through ordinary direct table updates.

## Local setup

Prerequisites: Node 22+, Supabase CLI, and a hosted Supabase project appropriate to the target environment. The supported setup does not require Docker.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Copy only the hosted Supabase API URL and publishable key into `.env.local`. Apply migrations with the linked Supabase CLI only to the explicitly selected project. Do not place service-role, Resend, worker, or Cloudmersive secrets in a Vite variable.

The optional seed dataset creates these sample accounts with password `BuildTrack-Seed-2026!`:

| Persona | Email |
| --- | --- |
| Organization administrator | `admin@buildtrack.local` |
| Superintendent | `superintendent@buildtrack.local` |
| Independent internal quality/verifier | `quality@buildtrack.local` |
| Home-scoped contributor | `contributor@buildtrack.local` |
| External inspector | `inspector@buildtrack.local` |
| Trade manager | `manager@buildtrack.local` |
| Trade technician | `technician@buildtrack.local` |
| Same-company trade manager + verifier | `dualrole@buildtrack.local` |
| Suspended member | `suspended@buildtrack.local` |
| Unaffiliated identity | `outsider@buildtrack.local` |

## Validation

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run db:lint
npm run test:e2e
```

`docs/traceability.md` maps business and acceptance identifiers to the implementation and required automated evidence. See `docs/decisions.md` when configuring organizational policies.

The latest factual test record is in [docs/acceptance-results.md](docs/acceptance-results.md). Operator procedures are under `docs/runbooks`, including setup, deployment, notification disable, backup/restore, rollback, incident response, and pilot exit.

## External provisioning

The configured deployment targets are:

- Supabase project `field-ops-dev`, `us-east-1`, micro compute, no HA
- Vercel project `buildtrack`
- Resend sender `BuildTrack <notifications@verified-domain>` after domain verification

Provisioning requires interactive account access and secrets. Follow [deployment.md](docs/runbooks/deployment.md); never paste secrets into source files, issues, or chat transcripts.
