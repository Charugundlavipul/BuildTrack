# Plan and property inspection checklists

Create and publish reusable checklist categories under Inspections → Checklist creation. Categories such as Kitchen, Bedroom, and Bathroom contain checklist items for their room type.

Open a floor plan and search the checklist category dropdown for each space. Type a partial name to filter the published categories, then select a result with the mouse or arrow keys and Enter. Escape cancels the search. Use the plus button to add plan-specific items as separate rows within each space. Remove individual items with the trash button. Two bedrooms can share a category and still have different additional items. Duplicating a plan or space copies its checklist configuration.

When scheduling an inspection, the property's assigned floor plan supplies the checklist. Add property-only items against a named space before creating the inspection. These additions belong to that inspection and do not update the plan, category, or another property.

Scheduling creates a published snapshot with distinct question IDs for every space, including repeated categories. Subsequent changes to the plan do not alter scheduled inspections. New inspections use the plan's current configuration, with an optimistic version check if the plan changes while scheduling. Existing inspections and their responses remain available.

Deploy migration `202611030058_plan_space_checklists.sql` before the updated client. The existing command Edge Function continues calling `execute_command`; no function deployment is required for this change. Legacy scheduling payloads remain supported for compatibility.

Verification: `tests/e2e/plan-checklists.spec.ts` covers category assignments, independent plan items, property-only additions, and responsive layouts. `supabase/tests/plan_checklists_remote_smoke.sql` is a rollback-only database integration check for snapshot composition, repeated room categories, retries, property isolation, and later plan edits. Run it against a migrated test database before release.

## Supabase validation — November 3, 2026

Migration 058 was validated against the linked Supabase project in a rollback-only transaction, then applied with the Supabase CLI. The rollback-only integration smoke test also passed against the migrated database. Migration history and the snapshot column were verified, and the temporary test tenant was confirmed absent afterward. Docker was not used.

The public/private schema lint reported no checklist-function errors. It did find four existing issues outside this change: `admin_save_escalation_route` references missing `delay_minutes`, `admin_save_notification_rule` references missing `notification_trigger`, `admin_set_catalog_status` references removed `trade_specialties`, and `admin_save_business_calendar` calls an unavailable `append_audit` overload.

Work-category settings and fields have been removed from the app. Work drafts, priority changes, and inspection findings no longer read or submit work-category assignments. Migration 059 removes the retired database table, columns, RPC, and stored-function branches. Fresh-install schemas and seeds use the same model.

## Classification cleanup — November 3, 2026

Migration 059 was validated in a rollback-only transaction, applied to Supabase, and verified afterward. The retired table, both assignment columns, their foreign keys, the catalog RPC, and stored-function/view references are absent. The work-item view retains its remaining fields and security-invoker behavior. Generated TypeScript types were refreshed from the live schema.

The rollback-only `retired_classification_remote_smoke.sql` passed against the migrated database, covering work creation, draft changes, priority changes, checklist creation, work-list reads, inspection snapshots, retries, and property isolation. No test tenant remained afterward. Retired identifiers appear only in the removal migration and regression assertions that prevent their return.

## Starter space categories — November 3, 2026

Migration 060 populated BuildTrack Development with 151 separate published checklist categories, covering all 151 active space types. The categories contain 1,060 starter items. Names follow the live space-type labels, including Kitchen, Bedroom, Bathroom, and specialist service/outdoor areas. Each category is available for manual selection on plan spaces.

The reviewable item catalog is `supabase/catalogs/space-checklist-items.json`. Starter items cover visible completion and room-specific fittings; specialist systems include handover/inspection-documentation checks. These are editable starting points through new checklist versions.

The migration targets this project's existing organization, preserves existing published content, and does not change plan assignments. A double-run rollback validation confirmed publication, complete item ordering, and duplicate-free reruns. `space_checklist_catalog_remote_smoke.sql` verifies coverage and reads through the owning administrator's RLS permissions after deployment.
