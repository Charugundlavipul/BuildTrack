# Repair completion and review

Validated November 5, 2026. Migrations `202611050075_supervisor_repair_review` and `202611050076_allow_supervisor_self_approval` are applied to the linked database.

## Workflow

1. The assigned company, technician, internal contributor, or senior staff member performs the repair and confirms completion with a note and evidence (or an authorized evidence exception).
2. An authorized supervisor reviews completion, including repairs they performed or submitted themselves. The supervisor can accept and close the work or return it for correction. Returning work preserves the previous attempt and allows a new completion.
3. Reinspection is optional. A supervisor may request a named independent Inspector's on-site check instead of closing directly. While that request is pending, the work waits for that Inspector's acceptance or rejection.
4. Safety-sensitive work requires an on-site check; a supervisor can perform that review without creating a separate Inspector assignment.

Authorized supervisors and senior staff with completion-review permission in the repair’s scope can approve their own completed repairs. Performing a repair does not grant review authority to contributors or vendor technicians. Optional Inspector reinspections still require an independent assigned Inspector. Having Inspector permission alone does not authorize routine supervisor acceptance. A complete property reassessment remains a separately scheduled inspection.

## Changes

- Restored command routing for observations, repair creation and assignment, company inspections, allocation, report review, and optional reinspection. Batch response saving retains its dedicated handler.
- Restored structured observation errors and transaction rollback when any task in a repair batch fails.
- Restored immutable floor-plan snapshots, including rollback when scheduling is rejected.
- Restricted batch draft editing to inspection managers or assigned Inspectors with edit access.
- Fixed submission using a stale version after saving answers.
- Updated work and report wording, review links, progress, notifications, and detail refreshes around supervisor acceptance. Cancelled repairs do not count toward closure progress.

## Validation

- Production build and targeted ESLint checks pass.
- Unit suite: 24 tests pass.
- Playwright work-completion and inspection-report suites: 18 tests pass across desktop and mobile Chromium. Screenshots were visually checked at desktop and phone widths.
- Linked database rollback scenarios pass for completion, return/resubmit, supervisor closure without reinspection, authorized supervisor self-approval and contributor permission enforcement, safety review, optional assigned reinspection, company scheduling/allocation, batch-save access and replay, immutable submission, and report review.
- Floor-plan scheduling rollback scenarios pass for snapshots, retries, home-specific additions, isolation from later plan changes, and rejected scheduling leaving no snapshot.

Browser tests mock service responses; linked SQL tests exercise the real command gateway with isolated fixtures and roll back all fixture data. No external email delivery or real file malware scanning was exercised by the SQL fixtures.

## Previously reported findings

The November 5 security review fixed the five errors below in migrations 077 and 079, including additional errors revealed after the first failures were removed. Linked database lint now reports no errors.

- `admin_save_escalation_route`: missing `escalation_route_steps.delay_minutes` column.
- `admin_save_notification_rule`: missing `notification_trigger` type.
- `admin_save_business_calendar`: obsolete `append_audit` signature.
- `admin_set_catalog_status`: reference to removed `trade_specialties` table.
- `execute_command_before_work_completion`: obsolete work branches. The revoked helper now contains only its working inspection batch-save path; work commands use the preserved audited engine.

The older broad `quality_workflows_remote_smoke.sql` also stops at an invitation-authority fixture. The focused current workflow test independently covers company scheduling, allocation, draft saving, submission, and report review without relying on that outdated invitation setup.
