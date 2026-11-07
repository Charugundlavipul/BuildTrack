# BuildTrack acceptance and product audit

Recorded: 2026-10-29 (America/New_York).

This review covers local implementation and testing. No frontend was published, no Docker environment was started, and migrations 043 and 044 were not applied. Browser tests mock backend responses; they do not establish live email delivery or upload scanning. Previously recorded live quality-workflow checks are identified separately below.

## Requirement review

| Area | Implemented behavior | Acceptance boundary |

| --- | --- | --- |

| Organization administration | Onboarding invitations, configurable shared and organization roles, membership suspension/removal, organization blocking/archive/reactivation, combined contract pricing | Real invitation inbox delivery remains unverified. Billing is contract configuration and estimates. |

| Super Admin privacy | Organization setup, pricing, people, role catalog and provider metadata; no automatic organization membership or access to day-to-day construction records | New provider and global-catalog RPCs are in pending migration 043. Rollback SQL verifies denied tenant reads and commands. |

| Hierarchical administration | Org Admin, Divisional Admin and Area Construction Manager manage permitted areas, people and vendors; higher-level ownership protects removal and supports broader coverage | Browser and rollback fixtures exercise scope isolation; not a replacement for production acceptance with real operators. |

| Field roles | Construction Supervisor, Internal contributor, additive Inspector, Vendor Manager and Vendor Tradesman; vendor managers administer their own company | Inspector can belong to internal staff or a vendor. Shared obsolete roles are retired with compatibility retained for historical references. |

| Property management | Dedicated division, neighborhood and home management; home spaces; division-owned plans copied and customized at lot onboarding | Every new home and CSV import requires an explicit standard-plan or manual-room layout. Construction phases are intentionally hidden; existing values remain stored. |

| Inspection workflow | Individual/company assignment, company-manager dispatch, assigned/due/submitted/completed queues, room observations, supervisor review and bulk repair assignment | Previously verified with isolated live accounts through migration 042. Existing evidence must pass content validation. |

| Repair and reinspection | Original observation and communication thread retained; independent Inspector assigned to selected observations; home/room reinspection view hides unrelated assignments | Local tests cover room filtering, accepting a repair, offline reload and one automatic replay on reconnect. |

| Offline field work | Automatic viewed-home/inspection/reinspection caching, persistent operation queue and reconnect synchronization; cached access bounded to 24 hours or an earlier grant expiry | Browsers can evict storage. Direct field caches do not prefetch every historical evidence blob or conversation. Real mobile session-expiry, quota and long-disconnection scenarios remain unverified. |

| Master configuration | Platform timezone default; editable/retirable space types and company categories with stable codes and version checks | Pending migration 043; retired company categories and space types remain usable on existing records but are rejected for new assignments. The existing construction-phase catalog remains dormant and hidden from the UI. |

| Notifications | In-app events and delivery/scheduling code exist | No scheduled BuildTrack database jobs were found by the read-only scheduler audit. Worker configuration and automatic recurring invocation need provisioning and acceptance. |

## Current verification

| Check | Result / evidence |

| --- | --- |

| Lint, TypeScript, unit tests and production build | PASS: `npm run check`; 6 unit files / 24 tests. Build generated 64 PWA precache entries, about 2.10 MiB. Vite reports an ineffective dynamic-import warning for the already shared offline module. |

| Targeted desktop/mobile tests | All 24 scenarios passed across the initial run and a two-case retry. The platform case required completing its mock role-catalog response; the scheduling case passed on retry without a product change. |

| Broader local browser regression | PASS across the full run and corrected retries: 192 distinct desktop/mobile cases. Initial development-server run: 178 passed, 14 failed. Production-preview retry: 12 passed; the remaining role-availability test needed to restore the list filter after access refresh, then passed on both desktop/mobile. Tests were corrected for draft selection, hierarchical role scopes, hidden removed roles, and the removal of assignment counts from Super Admin. PWA checks ran against the production build. The lengthy settings layout test now divides viewport coverage between desktop/tablet and mobile. This was not a clean single 192-case run. |

| Migration 043 privacy/configuration behavior | PASS in one rollback-only transaction against linked schema 042: provider metadata, no EIN or daily records, tenant-read/command denial, catalog retirement, version controls, ordinary-user and MFA denial. Temporary identities/data rolled back. |

| Previous isolated live quality verification | `artifacts/live-quality/report.json`: 8 workflow checks, temporary tenant/accounts removed. This was performed before the current local-only testing request and was not repeated in this pass. |

| Scheduled jobs | Read-only metadata audit returned no BuildTrack jobs. This does not prove that an independently managed external scheduler exists. |

| CI workflow corrections | Local Supabase browser environment, explicit pgTAP files, matching Chrome installation, desktop and mobile suites. Workflow code updated; GitHub execution and local pgTAP not run in this pass. |

| Deployment state | Hosted database previously reached migration 042. Migrations 043 and 044 and their UI dependencies are local/pending. Consolidated `schema.sql` includes both for an empty-project build; generated database types still represent hosted 042. |

## Key unfinished portions

1. **Email activation and acceptance:** user deferred the Resend key. Sender is configured as `BuildTrack <support@vkr-ventures.com>`. Configure delivery credentials and verify the sender/domain, new-account Auth invitation path, existing-account invitation path, retries and real inbox receipt. Earlier live artifact predates sender configuration.

2. **Validated media:** configure Cloudmersive or implement a chosen replacement. Verify clean/rejected files, HEIC conversion, finalization and authorized download. Until then, pending files must not count as usable evidence.

3. **Background workers:** provision worker authentication and recurring notification-generation/delivery/cleanup invocation, then verify retries, overdue reminders and escalation delivery over time.

4. **Release acceptance:** real iOS/Android offline/session-expiry/storage tests, load/soak testing and a database-plus-Storage backup/restore drill remain outstanding.

5. **Pending database change:** review and apply migrations 043 and 044 in a separately authorized deployment step, regenerate database types, and verify the new platform screens against that deployed schema.

Automatic payments/invoices, tax/proration/dunning and Sales Rep workflows are deferred scope. They are not implemented. Construction phases and phase transitions are intentionally deferred at the user’s request and hidden from the portal.

The core workflows are implemented, but the remaining integrations and operational acceptance prevent an unconditional production-ready claim.

## Public sales homepage addition - October 29

The public `/` route now presents BuildTrack to residential builders; sign-in remains at `/login`. The page includes an original GPT-image construction hero, Motion for React reveals, an interactive capture/assign/repair/verify walkthrough, team-role exploration, offline-work information, and an accessible demo-inquiry dialog. Demo inquiries prepare an email draft; they are not stored, automatically emailed, or represented as delivered leads. No site publishing or database migration was performed.

`npm run check` passed (lint, TypeScript, 24 unit tests and build). Eighteen targeted homepage/sign-in browser scenarios passed on desktop/mobile against the production preview, including PWA shell checks, reduced motion, the demo draft, and zero page errors. Visual review covered 1440px, 768px and 390px; a tablet hero-arrow wrap was corrected. Final layout and sign-in/home navigation checks were run after that correction. This addition was targeted testing; the earlier 192-case portal regression was not repeated in full.

The latest build has 67 precache entries (about 2.22 MiB); the hero is a separate local WebP asset of about 545 KiB. The persona guide now reflects the eight current organization role templates and separate platform administrator, rather than the retired legacy persona list.

## Required layouts and project communication - October 29

New homes require an explicit layout method. A standard plan must be active and belong to the neighborhood's division; its rooms are copied into the home. Choosing **No standard plan** requires at least one named room or exterior area. The home and rooms save atomically. CSV previews and commits require the same choice, applied to the whole batch. Editing the layout invalidates a previous preview. Existing homes retain their layout and stored phase data. Phase controls, labels and catalogs are hidden throughout the portal.

**Conversation & history** combines observation assignments, named previous/new assignees, reasons, messages, evidence and repair/reinspection decisions. New events preserve names at the time of action and have deterministic ordering, including actions in the same transaction. Internal notes remain restricted. Historical events without name snapshots may use current names, which the UI identifies. Earlier activity loads in pages.

**Messages** is available from organization navigation and its global unread icon, with a home-specific entry point. A neighborhood is the project boundary; home conversations can narrow it further. Conversations explicitly select participants, support replies and read markers, and separate internal-only discussion from shared vendor discussion. Current tenant membership, project/home scope and conversation membership are checked for reading and sending. Owners and participating scoped administrators can manage participants; removal preserves immutable messages and denies further reads/sends. Platform administrator privileges alone give no conversation access. Adding someone discloses complete conversation history, with a confirmation notice.

Opened conversations are cached within the existing access expiry. Unsent drafts and queued messages persist on the device, and the automatic queue retries on reconnect. The server rechecks access and operation identity before accepting a queued message. Realtime updates have a polling fallback. This iteration provides text conversations and replies; chat email/push delivery and chat file attachments are not implemented. Evidence remains attached to its observation.

Migration 044 compiled and passed rollback-only behavior checks alongside pending 043 against hosted schema 042. Checks include required layouts, atomic rooms, plan copying, CSV enforcement, retry fingerprints, observation reassignment history, internal-note privacy, message pagination/unread markers, duplicate-safe commands, cross-conversation reply rejection, participant removal, scope revocation, immutable history and platform/tenant separation. All temporary fixtures and schema changes rolled back.

Latest `npm run check`: PASS (lint, TypeScript, 24 unit tests, production build). Schema build includes migration 044. Browser backend responses are fixtures; live multi-user Realtime and deployed-schema acceptance remain pending.

Final targeted browser run: **54/54 passed in one clean run** against the production preview (desktop and mobile). It covers home navigation, required standard/manual layouts, CSV layout preview invalidation, hidden phases with preserved stored values, unified observation handovers, project replies/participants, durable offline messages with one automatic reconnect send, property administration, company inspection dispatch and room-based reinspection. Visual review covered desktop, 768px tablet and mobile. This does not repeat the earlier full 192-case regression.


## Space-type catalog expansion - October 29

Floor-plan spaces, manual-onboarding rooms and new home locations start with an explicit **Choose space type** dropdown rather than assuming Bedroom or another type. The persisted catalog is grouped consistently across all three editors. Pending migration 045 expands the standard catalog to 151 unique types in eight groups: living/shared rooms, bedrooms/bathrooms, circulation/access, storage/service, mechanical/building services, outdoor/site areas, shared building amenities and Other. Only persisted active types are offered for new selections; existing retired references are labelled retired. Administrator changes and retirements are preserved with conflict-safe inserts. Custom catalog entries appear under Additional types. Migration 045 is local and unapplied; additional choices require its deployment. Catalog source and SQL seed rows were checked for unique codes and labels and matching row counts.
