# Requirement-to-test traceability

## Functional requirements

| Requirement | Implementation | Required evidence |
| --- | --- | --- |
| FR01 | Tenant-safe divisions, neighborhoods, homes, locations, common areas, duplicate lot constraint | SEC01, AT12, migration/FK tests |
| FR02 | Memberships, contextual role assignments, expiry, suspension, invitation acceptance | SEC02, SEC05–SEC07, AT03, AT07 |
| FR03 | Categorized companies, user associations, neighborhood eligibility, delegation | SEC04, AT04, FLOW04 |
| FR04 | Standalone work capture with origin, location, priority, safety, evidence metadata | AT01, FLOW01, OFF01 |
| FR05 | Published checklist versions, complete responses, findings, immutable submissions | AT02, AT10, FLOW02, FLOW08 |
| FR06 | Triage, duplicates, assignment episodes, due dates, bulk contract | AT01, AT02, AT04, CON01 |
| FR07 | Acknowledgment, start, blockers, resolution, correction attempts | AT05, FLOW01, FLOW03 |
| FR08 | Independent verification, rejection, reopening, immutable decisions | SEC07, AT01, AT05, FLOW03, CON04 |
| FR09 | Shared/internal comments and private attachment registry | SEC03, SEC08, AT09, AT11, OFF05 |
| FR10 | Deduplicated outbox, scheduler, leases, retries, reassignment suppression | AT08, NOT01–NOT03 |
| FR11 | My Work, scope/home summaries, readiness precedence, milestone approval | AT10, AT13, CON05 |
| FR12 | User/org-partitioned IndexedDB queue, explicit sync/conflict/access states | AT06, AT07, OFF01–OFF06 |
| FR13 | Security-invoker metrics, audit history, formula-safe CSV | SEC10, AT09, AT12, REP01–REP02 |
| FR14 | External references only; no payment table, command, or event | AT14, FLOW07 |
| FR15 | Categories, immutable checklist versions, calendars, rules, archive design | FLOW08, configuration integration tests |

## Acceptance scenarios

| ID | Automated journey |
| --- | --- |
| AT01 | Internal observation → assignment → acknowledgment → correction → independent acceptance |
| AT02 | External inspection with five failures submits five findings atomically |
| AT03 | Same user receives distinct actions/data across two neighborhood scopes |
| AT04 | Company manager delegates only to an active company technician |
| AT05 | Rejected first attempt remains immutable; second attempt is accepted |
| AT06 | Offline capture survives app restart and synchronizes once |
| AT07 | Membership revocation before reconnect rejects queued writes and purges cache |
| AT08 | Scheduler replay deduplicates and reassignment suppresses old recipients |
| AT09 | External direct requests cannot read internal comment or file |
| AT10 | Zero findings is valid, but `not_checked` keeps readiness incomplete |
| AT11 | Correction without ready evidence or approved exception is rejected |
| AT12 | Tenant B rows cannot be read, exported, or referenced from tenant A |
| AT13 | New submitted work or reopening invalidates active milestone approval |
| AT14 | Verification creates no payment instruction or external payment mutation |

## Current automated suites

- `supabase/tests/authorization.test.sql`: initial SEC01–SEC09 hostile-client coverage.
- `supabase/tests/invariants.test.sql`: tenant, accountability, independence, concurrency-index, and no-global-role checks.
- `tests/unit`: shared command/CSV contracts and no-backend setup boundary.
- `tests/e2e`: browser shell, installability, offline reload, recovery boundary, viewport, and release-language checks; full AT/FLOW/OFF/NOT/REP journeys require an isolated hosted Supabase verification project.

An acceptance report records pass/fail output for every scenario before an organizational rollout. Unexecuted scenarios remain explicitly identified in the release record.
