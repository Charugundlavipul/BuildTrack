# Development acceptance results

Recorded: 2026-10-24 (America/New_York)

This is a factual execution record, not a production sign-off.

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript compile | PASS | `npm run typecheck` completed with exit code 0 after persona/admin additions |
| ESLint | PASS | `npm run lint` completed with exit code 0 |
| Unit tests | PASS | 5 files, 11 tests |
| Production PWA build | PASS | Vite build generated the installable manifest, service worker, and 40 precache entries |
| Desktop/mobile shell E2E | PASS | 10 Playwright tests across desktop and Pixel 7 Chrome |
| PWA manifest/service worker | PASS | Browser tests verified install metadata, active worker, offline shell reload, and no horizontal overflow |
| Hosted migrations | PASS | Migrations 001-016 match the linked `field-ops-dev` project |
| Hosted database lint | PASS WITH WARNING | No schema errors after migration 014; one non-security warning remains for the intentionally reserved `get_report_metrics.p_filters` parameter |
| Generated database types/no drift | PASS | Types regenerated from the linked project after migration 015 |
| Edge Function deployment | PASS | Eight functions are ACTIVE; six user endpoints verify JWT and two worker endpoints require a separate worker secret |
| Auth configuration | PASS | Invitation-only sign-up, verified email, 12-character minimum, and local recovery/invitation redirects are configured |
| pgTAP authorization/invariants | BLOCKED | Docker Desktop engine did not become available; remote execution was avoided because tests require isolated hostile-client fixtures |
| Storage/upload lifecycle | NOT RUN | Cloudmersive fixture key is not configured, so a clean end-to-end scan/finalize/download test cannot run |
| AT01-AT14 and FLOW01-FLOW08 | PARTIAL | UI and database contracts are implemented; full multi-persona journeys still require isolated synthetic identities and provider fixtures |
| OFF01-OFF06 | PARTIAL | Offline shell restart passes on desktop/mobile and queue algorithms have unit coverage; live revocation, quota, and browser-eviction cases remain unexecuted |
| NOT01-NOT03 | NOT RUN | Resend, verified DNS, worker secret, and external Edge invocation schedule are not configured |
| REP01-REP02 | NOT RUN | Endpoint is deployed, but seeded authorized export and calculation fixtures were not available |
| Restore drill | NOT RUN | Requires a controlled backup target and Storage fixture objects |
| Supabase development deployment | PASS | Linked project is healthy, migrations current, Auth config pushed, and Edge Functions active |
| Vercel development preview | BLOCKED | Vercel CLI is installed but reports `Logged out`; no external deployment was created |

The development application must not be called fully accepted until the partial, not-run, and blocked entries have real pass/fail evidence. Production remains separately blocked by the approvals in `decisions.md`.
