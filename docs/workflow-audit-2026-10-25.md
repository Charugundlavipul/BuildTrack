# Workflow audit — October 25, 2026

Verdict: not ready for production sign-off. Property, member access, and vendor management now have identifiable management workflows, but several other domains still stop at creation. Passing layout checks does not establish workflow completeness.

This is a source-level audit of the current routes, rendered controls, query boundaries, and command payloads. It builds on the earlier browser review; no fresh browser or live-backend verification was performed for this audit. Findings below are confirmed in source; database behavior and proposed new capabilities need their own validation during implementation. No application code was changed in this audit.

## Priority findings

### P1 — Verification records facts the verifier never supplied

Evidence: `src/features/work/WorkDetailPage.tsx:232`.

Accept correction automatically chooses remote verification for standard work and on-site verification for safety work. Return for rework always records on-site verification. Both send canned notes. A safety requirement is not proof an on-site visit occurred. These controls can produce misleading operational history even if the backend correctly enforces authorization.

Required redesign: an explicit review form showing the correction and supporting evidence, decision, actual verification method, and notes. Require an actionable reason for rejection; constrain safety work to on-site verification and explicitly confirm completion. Disable duplicate submission and retain entered details on failure.

### P1 — Operational configuration is still create-only

Evidence: `src/features/admin/AdministrationCatalogs.tsx:131–150`. Category, calendar, engagement, escalation, notification, and milestone saves all pass a null record ID. Backend save functions already accept existing IDs. Generic activate/deactivate controls do not replace editing.

Required redesign: separate management destinations for Business calendars, Checklists, Inspector engagements, Escalations and notification rules. Each needs a searchable directory, detail/edit screen, readable status, related records, and appropriate lifecycle actions. Milestones and inspection requirements should also be reachable from the home they govern. Deep links must preserve record context.

### P1 — Inspector access can be granted but not managed afterward

Evidence: engagement form at `AdministrationCatalogs.tsx:138` always sends `p_id: null` and `p_revoke: false`. Existing engagements are fetched but not rendered as a management list.

Required redesign: inspect existing grants by inspector, home, and date window; edit or revoke a selected grant; distinguish scheduled, active, expired, and revoked access. Validate the end time against the start time and show neighborhood alongside repeated lot codes. A time-bounded grant needs an equally discoverable revocation path.

### P1 — Checklist drafts have no usable publication lifecycle

Evidence: checklist form at `AdministrationCatalogs.tsx:135–136`; `Template.versions` does not match the selected `checklist_versions` relationship. The summary reads `item.versions.length`, so a real nonempty query result can crash this screen. Also, the question splitter uses `/\\r?\\n/`, which matches escaped text rather than ordinary textarea line breaks.

The user can create an unpublished version, but there is no version directory, preview, or subsequent publish action. When creation succeeds and immediate publication fails, the combined operation reports failure without exposing the created draft, encouraging duplicate creation on retry.

Required redesign: template detail with numbered versions, draft/published state, question preview, separate create and publish actions, and recovery after partial success. Published versions stay immutable. Normalize the relationship shape and parse actual newlines; cover both cases with representative backend fixtures.

### P1 — Lists silently omit operational records

Evidence: `src/lib/data.ts:109,156,168` limits work to 250, homes to 500, and inspections to 250. `NotificationsPage.tsx:17` limits the inbox to 100. These surfaces provide no continuation through the remaining records. Work filters operate on the downloaded subset.

Impact: an older open item can disappear from the work queue; a home can disappear from selectors; an inspection can become undiscoverable. This is a workflow defect rather than a visual density decision.

Required redesign: server-side filtering and pagination with explicit totals or continuation. Query home detail directly by ID instead of depending on inclusion in a capped directory. Distinguish a filtered empty result from an incomplete or failed query. Inbox counts must reflect their actual scope.

### P1 — Inspection submission ignores unsaved edits

Evidence: `InspectionsPage.tsx:195,211`. Submit availability is based on saved responses, while radio inputs update separate local drafts. A previously saved response can be changed locally and then the inspection submitted with its older saved value.

Required redesign: visibly distinguish saved and unsaved answers; save pending edits before submission or block submission with a clear explanation. Offer a final review of failures, exceptions, and unanswered required questions. Preserve drafts through recoverable errors and warn before abandoning unsaved work.

### P2 — Blocker and resolution history uses canned text

Evidence: `WorkDetailPage.tsx:205,221`. Reporting a blocker sends cause `other` and “Blocked from work detail”; resuming blocked work sends “Work is ready to resume.” No user explanation is collected.

Required redesign: blocker cause and description form, followed by an explicit resolution form. Show the current blocker with its owner and age in the work record. Use the backend-supported causes and validation rules.

### P2 — Business calendars and escalation routes overpromise their controls

Evidence: `AdministrationCatalogs.tsx:132,141–142`. Calendar payload always uses Monday–Friday, though its description says working days can be configured. Escalation UI describes ordered levels but sends exactly one step. The specific-user selector remains visible for every recipient type.

Required redesign: weekday toggles with validation, structured holiday dates, and timezone-aware preview. Ordered escalation step editor with add/remove/reorder and conditional recipient fields. Preserve existing values when editing rather than replacing them with hidden defaults.

### P2 — Sync problems are displayed without a recovery workflow

Evidence: `src/features/sync/SyncPage.tsx:34,65–67`. Conflicts are counted as needing attention, but have no compare, resolve, or discard action; deletion is disabled for conflicts. Rows expose an abbreviated aggregate ID rather than a navigable record title. Failed operations can be deleted immediately.

Required redesign: contextual record links, readable failure reasons, recoverable retry where permitted, conflict comparison against the current server record, and explicit discard confirmation that explains what local data will be lost. Never retry with a new version blindly. Coordinate these actions with the queue's dependency rules.

### P2 — Configuration loading and failures can look like an empty catalog

Evidence: `AdministrationCatalogs.tsx`. Neither the catalog query nor lifecycle query renders its error/loading state. Dependent forms remain visible with empty selectors. Its query also loads divisions, companies, and rosters after their management UI has moved elsewhere.

Required redesign: domain-specific queries and explicit loading/error/retry states; disable dependent saves until required data is available. Avoid making one unrelated catalog failure disable every settings workflow.

### P2 — Inspection scheduling can misreport successful creation

Evidence: `InspectionsPage.tsx:55`. The handler accesses `event.currentTarget.reset()` after asynchronous work. React's currentTarget is only valid during event dispatch. A successful command can be followed by a client exception, setting an error after the form closes.

Required correction: capture the form element synchronously, or remove the reset when closing unmounts the form. Add a successful scheduling regression that checks both the new record and the absence of an error. Scheduling also always assigns the signed-in administrator as lead; a real inspector assignment workflow needs eligibility-aware selection rather than an arbitrary member dropdown.

## Page coverage and remaining checks

| Surface | Workflow assessment |
| --- | --- |
| Sign-in, password recovery/update, invitation acceptance, organization selection | Entry routes exist; this pass found no new confirmed blocker. Delivery, expired token, and real multi-organization permission checks remain integration work. |
| My work | Queue and filters exist; silent cap is a production blocker. |
| Neighborhood and home field views | Management links exist; home lookup and related work depend on capped collections. Milestone configuration needs a contextual entry point. |
| Property directories and details | Create/edit/archive/restore and hierarchy are present. This pass does not certify backend dependency behavior or live authorization. |
| Work creation | Conditional location fields and evidence selection exist. Verify large home directories after pagination redesign. |
| Work detail | Assignment and state actions exist; verification and blocker payloads fail the standard for user-authored operational records. |
| Inspection directory and detail | Scheduling, answers, findings, amendments exist; discovery, save-state integrity, and scheduling success handling need correction. |
| Reports | Filtered metrics/export controls exist. Home selection inherits capped queries; reconcile metrics and export with a large representative dataset. |
| Vendor directories and details | Categorized company, neighborhood eligibility, team, and work management exist. No new confirmed blocker in this source pass; live eligibility and deactivation guards still need integration testing. |
| Administration: people | Invite and existing-member scope editing exist. Earlier conditional-field corrections are present. |
| Administration: configuration | Fails lifecycle completeness; split into manageable domains and repair checklist handling first. |
| Administration: import and activity | Preview/import and activity surfaces exist. Keep row errors actionable and verify representative partial failures against the backend. |
| Notifications | Read actions and contextual links exist; history and unread scope are capped. |
| Sync center | Queue visibility exists; conflict recovery is incomplete. |
| Account and access | Access details exist; no new confirmed blocker found in this pass. |

## Implementation order and acceptance standard

1. Repair verification facts, checklist shape/parsing, inspection dirty-state submission, and successful scheduling handling.
2. Build configuration directories/detail workflows, prioritizing inspector grant revocation and checklist publication recovery.
3. Replace silent collection caps with navigable server-filtered lists and direct record lookups.
4. Add contextual blocker/resolution and sync-conflict recovery flows.
5. Exercise the changed workflows at desktop, tablet, and mobile widths with permission-scoped fixtures, real relationship shapes, more than one page of data, and failed/partial commands. Follow with backend integration checks before production sign-off.

For each managed entity, completion means a user can find an existing record, understand its state and dependencies, edit supported fields, take allowed lifecycle actions, recover from failure, and return to the relevant parent or work record. A creation form and a status toggle alone do not satisfy this standard.

## Implementation follow-up

The findings above describe the state at audit time. Following authorization to proceed, the following changes were implemented locally:

| Finding | Change |
| --- | --- |
| Verification records invented facts | Explicit decision, actual method, findings, and attestation; safety work offers on-site verification only. The latest correction note is shown with its submission date. |
| Create-only operational configuration | Eight dedicated directories with new and existing-record routes under `/org/:org/settings/`: categories, calendars, checklists, engagements, escalations, notifications, milestones, and requirements. Search, status filtering, paging, permission checks, loading/error states, and supported lifecycle actions replace the old creation cards. |
| Inspector access lifecycle | Existing grants show home, inspector, purpose, and access window. Dates are editable, revocation requires confirmation, and restoration runs the normal eligibility validation. A dedicated revoke command avoids blocking revocation when a home is archived or a member becomes inactive. |
| Checklist relationship/parsing/publication failures | Removed the broken nested relationship and newline parser. A structured question editor captures sections, categories, required responses, and order. Template details list draft/published versions and preview questions. Creation and publication are separate operations, so publication failure retains the draft for retry. Versions can be copied into a new draft. |
| Silent collection caps | Work, inspections, and inbox now have server-filtered/count-aware paging. Home detail queries its ID directly. Remaining home selectors and related-record queries read all authorized rows in deterministic 500-row batches. |
| Unsaved inspection answers | Dirty answers are marked, submit is disabled until they are saved, simultaneous response saves are prevented, and leaving through a link or unloading warns about unsaved answers. Failed saves retain the draft. |
| Canned blocker history | Cause and explanation are collected; active blocker notes and dates are visible; resolution requires the user's explanation. Reopening controls now follow the backend's verification permission. |
| Calendar/escalation controls | Calendar editing preserves weekdays, hours, timezone, and holidays with local validation. Escalation levels can be added, removed, reordered, and assigned conditional recipients. Optional notification timings and quiet-hour controls preserve their meaning. |
| Sync conflict dead end | Review displays local intent beside the current server record and links to that record for deliberate recovery. Confirmed discard accounts for transitive dependent operations and unsent evidence; in-flight operations cannot be discarded. Synchronization checks that prerequisites actually succeeded before sending dependents. Conflicts are not blindly replayed with a newer version. |
| Configuration failures appear empty | Each settings domain owns its record/options queries and shows loading, failure, retry, and empty states. Errors remain visible and entered form values survive rejected saves. |
| Scheduling false error and implicit lead | The scheduling handler captures its form before awaiting. A home-scoped eligible-lead selector replaces automatic assignment to the administrator. |

Milestone planning remains protected by `structure.manage`; inspection requirements and other operational configuration require `config.manage`. Administrative writes require a verified MFA session. Home field and property-management pages link to the relevant home milestone and requirement directories.

### Database deployment dependency

`supabase/migrations/202610250028_inspector_grant_revocation.sql` adds:

- `admin_revoke_inspector_engagement`: scoped, MFA-protected, audited revocation that does not require an archived home or inactive inspector to become eligible again.
- `inspection_lead_options`: read-only eligible leads for a selected home, available only to someone who can manage inspections for that home. Its eligibility rules follow the scheduling command.

The generated client type declarations include these RPCs. The migration has **not** been applied to a live database. Browser checks intercept backend calls; they do not establish SQL execution, real RLS behavior, provider delivery, or production readiness. Apply the migration in the normal database release process and run database integration checks before deploying the dependent UI.

### Verification

- Production build and TypeScript pass.
- ESLint passes.
- Three offline dependency unit tests pass. A worker-startup timeout on the first attempt was resolved by running the single file with one worker and isolation disabled.
- Fifteen distinct workflow browser cases pass on desktop, including all 24 settings surfaces at 1440, 768, and 390 pixels; fourteen workflow cases pass in the mobile browser project. The existing workspace-wide layout regression also passes. The sync test was corrected to target the conflicting operation rather than its disabled queued dependent.
- Desktop and mobile settings screenshots were inspected. Tests assert no horizontal overflow on the settings surfaces and collect uncaught page errors during the route sweep.
- Final visual review corrected the mobile attestation layout and replaced raw sync JSON with labeled comparison fields plus an optional original-data disclosure. Six focused desktop/mobile checks for calendars, verification, and conflict recovery pass against the rebuilt app; the resulting mobile screenshots were inspected again.

No release, production database mutation, real invitation, or external message was performed.
