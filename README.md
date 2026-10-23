# BuildTrack

BuildTrack is a mobile-responsive construction field operations and quality-management PWA. It gives internal teams, inspectors, and approved trade partners a scoped workspace for capturing work, assigning accountability, submitting correction evidence, and independently verifying completion.

It is installable on supported Android and iOS browsers. Authorized homes can be explicitly downloaded for 24-hour offline access, with field records, checklist responses, comments, and evidence queued until reconnection. See [the mobile/offline field guide](docs/mobile-offline-guide.md).

This repository is a **development baseline** built from `Construction_Operations_Business_Requirements.docx` and `Supabase_LLM_Implementation_Specification.txt`. It must not be treated as an approved production policy or municipal, payment, procurement, or safety authority.

## Architecture

- React + TypeScript + Vite PWA
- Supabase Auth, Postgres, private Storage, Edge Functions, and Cron
- IndexedDB/Dexie durable offline queue partitioned by user and organization
- Resend for invitation and operational email
- Cloudmersive for malware scanning and HEIC display conversion
- Vercel development preview for the static client

Database reads are protected by RLS. Workflow writes use the `execute_command` transaction envelope and cannot be performed through ordinary direct table updates.

## Local setup

Prerequisites: Node 22+, Docker Desktop, and Supabase CLI.

```powershell
npm install
npm run db:start
npm run db:reset
npm run db:types
Copy-Item .env.example .env.local
npm run dev
```

Copy the local API URL and anon key printed by `npm run db:start` into `.env.local`. Do not place service-role, Resend, worker, or Cloudmersive secrets in a Vite variable.

Synthetic local accounts all use `BuildTrack-Dev-2026!`:

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
npm run db:test
npm run test:e2e
```

`docs/traceability.md` maps business and acceptance identifiers to the implementation and required automated evidence. See `docs/decisions.md` before any pilot or production configuration.

The latest factual test record is in [docs/acceptance-results.md](docs/acceptance-results.md). Operator procedures are under `docs/runbooks`, including setup, deployment, notification disable, backup/restore, rollback, incident response, and pilot exit.

## External provisioning

The requested development targets are:

- Supabase project `field-ops-dev`, `us-east-1`, micro compute, no HA
- Vercel project `buildtrack`, development preview only
- Resend sender `BuildTrack <notifications@verified-domain>` after domain verification

Provisioning requires interactive account access and secrets. Follow [deployment.md](docs/runbooks/deployment.md); never paste secrets into source files, issues, or chat transcripts.
