# Development acceptance results

Recorded: 2026-10-24 (America/New_York)

This is a factual execution record, not a production sign-off.

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript compile | PASS | `npm run typecheck` completed with exit code 0 after the production-audit changes |
| ESLint | PASS | `npm run lint` completed with exit code 0 |
| Unit tests | PASS | 5 files, 11 tests |
| Production PWA build | PASS | Vite build generated the installable manifest, service worker, and 40 precache entries |
| Desktop/mobile shell E2E | PASS | 10 Playwright tests across desktop and Pixel 7 Chrome |
| PWA manifest/service worker | PASS | Browser tests verified install metadata, active worker, offline shell reload, and no horizontal overflow |
| Hosted migrations | PASS | Migrations 001-027 match the linked `field-ops-dev` project |
| Hosted database lint | PASS | No schema warnings or errors after migration 027 |
| Generated database types/no drift | PASS | Types regenerated from the linked project after migration 027 |
| Edge Function deployment | PASS | Eight hardened functions are ACTIVE; six user endpoints verify JWT and enforce allowed browser origins, while two worker endpoints require a separate worker secret |
| Auth configuration | PASS | Invitation-only sign-up, verified email, 12-character minimum, and local recovery/invitation redirects are configured |
| pgTAP authorization/invariants | BLOCKED | Docker use is explicitly prohibited. Remote hostile-client tests were not run against the shared development tenant because they require an isolated disposable test project. |
| Storage/upload lifecycle | NOT RUN | Cloudmersive fixture key is not configured, so a clean end-to-end scan/finalize/download test cannot run |
| AT01-AT14 and FLOW01-FLOW08 | PARTIAL | UI and database contracts are implemented; full multi-persona journeys still require isolated synthetic identities and provider fixtures |
| OFF01-OFF06 | PARTIAL | Offline shell restart passes on desktop/mobile and queue algorithms have unit coverage; live revocation, quota, and browser-eviction cases remain unexecuted |
| NOT01-NOT03 | PARTIAL | Rule-driven business-calendar scheduling, quiet hours, repeats, escalation routes, dedupe, leasing, retries, and recipient revalidation are deployed. Resend, verified DNS, worker secret, and external Edge invocation schedules are not configured. |
| REP01-REP02 | PARTIAL | Filtered/suppressed metrics and matching formula-safe CSV filters are deployed; exports include denominators plus UTC/local timestamps and reject silent truncation. Seeded multi-scope calculation fixtures were not available. |
| Restore drill | NOT RUN | Requires a controlled backup target and Storage fixture objects |
| Supabase development deployment | PASS | Linked project is healthy, migrations current, Auth config pushed, and Edge Functions active |
| Vercel development preview | BLOCKED | Vercel CLI is installed but reports `Logged out`; no external deployment was created |
| Catalog administration lifecycle | PARTIAL | Creation plus guarded, audited activate/deactivate controls are available. Full inline field editing for every catalog remains incomplete. |
| Bundle budget | PASS | Explicit vendor splitting reduced the application entry from about 718 KiB to about 82 KiB minified; no chunk exceeds the 500 KiB warning threshold. The full PWA precache remains about 1.26 MiB. |

The development application must not be called fully accepted until the partial, not-run, and blocked entries have real pass/fail evidence. Production remains separately blocked by the approvals in `decisions.md`.
