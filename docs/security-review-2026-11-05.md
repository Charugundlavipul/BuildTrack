# Security and reliability review — November 5, 2026

## Applied fixes

Migrations `202611050077` through `202611050079` are applied to the linked database. The `request-upload`, `finalize-upload`, and `request-export` Edge Functions are deployed. Frontend changes are in the workspace and production build.

| Area | Confirmed issue and correction |
| --- | --- |
| Administrative scope | Catalog status changes had lost their per-record division/neighborhood checks. Restored those checks while retaining vendor ownership and higher-administrator protections. |
| Settings and audit | Calendar, escalation, notification, and catalog updates contained obsolete audit calls, columns, or types. Restored working saves, record-not-found errors, recipient validation, and audit records. Escalation creation now returns the record ID expected by the UI. |
| Evidence authorization | Generic upload reservations accepted read access without upload permission. Uploads now require permission in the actual parent record's scope, matching location metadata, and an editable inspection where applicable. Replacement upload URLs and finalization recheck access. |
| Revoked file access | Being the uploader previously bypassed loss of access to the parent record. Attachment RLS now requires current parent access for uploaders as well as other readers. |
| Completion history | A new completion could reuse and relink a previous attempt's evidence. Each attempt now retains its evidence; a new completion needs unused correction evidence or an authorized exception. The UI and offline home cache include the corresponding metadata. |
| Inspection evidence | Pending reservations could finalize after report submission. Parent locking and finalization checks now prevent that late change to a submitted inspection. |
| Scan validation | Truthy strings could be interpreted as a clean provider result. Validation now requires an explicit boolean clean result and rejects malformed unsafe flags; quarantine errors are checked. |
| Session isolation | Delayed organization/access responses could overwrite state after account or workspace changes. Responses are now bound to the current account, workspace, and request generation. Unavailable/full offline cache storage no longer blocks a valid online sign-in. |
| Exports | A request for 10,001 rows was silently capped by the API's 1,000-row setting. Exports now paginate with deterministic ordering, enforce the 10,000-row quota, and check job-finalization errors. |
| Offline inspection edits | Repeated queued saves could duplicate observations, while corrected passing answers left open observations in the local preview. The overlay now updates the existing open issue and reflects the corrected disposition. |
| Future fixtures | Removed embedded shared passwords, disabled automatic seeding, and require an explicitly supplied session password for disposable fixtures. CI supplies a random local-only password without printing it. Existing accounts and their passwords were preserved as requested. |

The internal batch-response handler was narrowed to its existing batch-save path, removing unreachable obsolete command copies. Supervisor self-approval, optional independent Inspector reinspection, and the existing MFA-disabled policy were preserved. Browser tests were updated for these previously accepted policies and the current tabs, dropdowns, and batch-save controls.

## Validation

- Full ESLint, TypeScript production build, and 37 unit tests pass.
- Deno TypeScript checks pass for all three changed Edge Functions.
- Linked database lint reports no errors.
- Rollback database tests pass for settings, local/sibling administration scope, engagement status changes, upload permission, revoked access, late inspection uploads, evidence history, vendor delegation/completion, supervisor self-approval, optional reinspection, company inspection allocation, batch-save replay, and floor-plan scheduling.
- Anonymous POST requests to deployed command, upload reservation, upload finalization, export, and download endpoints all return HTTP 401.
- Schema inspection found no public application tables without RLS, no authenticated direct insert/update/delete grants, and no readable public views missing security-invoker behavior.
- The complete desktop browser suite passes all 129 tests. The first run's 14 outdated expectations were updated for the current flows while retaining scope, validation, history, and unauthorized-access checks; the final suite includes a new evidence-history regression scenario.
- Targeted phone suite: 15 tests pass, including new evidence requirements, offline inspection editing/sync, report submission, and repair review.
- A final desktop sign-in, onboarding, and offline smoke run passes after the cache-storage failure handling change.
- Future-seed guards were executed without a password inside a rollback transaction; existing account and role-grant counts remained unchanged.

## Remaining limits

`npm audit --omit=dev` reports zero known production dependency vulnerabilities. The full audit reports 14 low/moderate development-tool findings and no high/critical findings. These involve the ESLint/Workbox toolchain; suggested fixes include major-version changes or downgrades. No forced dependency changes were made during this compatibility-focused repair. Relevant advisories are [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249), [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), and [deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4); the latter lists no patched release.

Existing development credentials were neither checked nor rotated, following the user's decision to preserve current logins. Repository hardening cannot establish whether previously seeded passwords have been changed.

The Docker daemon was unavailable, so a fresh local database reset and fixture-dependent pgTAP/complete CI run were not performed. Linked database tests use isolated fixtures and roll back their changes. Browser tests mock service responses; external email delivery and a real malware-provider upload were not exercised. This review does not establish that every possible vulnerability is absent.
