# UI/UX review — 25 October 2026

The original interface had a consistent visual identity, but its information architecture did not consistently support field work. The most serious problems were hidden mobile inspection context, administration presented as a wall of forms, and repeated implementation language in user-facing copy. This pass keeps the existing forest-green and amber identity and improves the actual working screens.

| Page / surface | Finding | Implemented response |
| --- | --- | --- |
| Shared shell | Mobile drawer lacked keyboard containment, Escape dismissal, and focus restoration. Hidden navigation could remain keyboard-accessible. | Focus management, Escape handling, body scroll lock, hidden closed drawer, skip link, and explicit expanded state. |
| Sign in | The marketing introduction pushed authentication below the first mobile viewport. | Compact mobile brand header, immediately visible sign-in form, clearer invitation guidance. |
| Password recovery | Backend identity wording and cramped return navigation. | Plain language, readable form widths, consistent spacing around the return link. |
| Password update | Expired-link instructions explained privacy implementation rather than the user's next step. | Direct recovery guidance and responsive account-card spacing. |
| Invitation | Membership activation copy read like an API description. | Clear acceptance language, separated feedback, and readable password-setup layout. |
| Organization selection | Selection always sent users to work, even if their role belonged elsewhere. | Route through the existing permission-aware organization landing page; simplify explanatory text. |
| Setup | Command text could exceed a narrow card. | Wrapping command text and mobile card spacing; retain the explicit deployment instructions. |
| My work | Bulk assignment interrupted the primary queue; filters used long state names; mobile metrics unnecessarily became four stacked cards. | Work queue before bulk tools, short filter labels with pressed states, two-column mobile metrics, wrapping task titles. |
| Neighborhoods | Low-density cards and an empty-state message could appear alongside request failures. | Tighter card geometry, readable counts, and distinct error versus empty states. |
| Neighborhood detail | No parent navigation; empty home list gave no explanation; mobile hid open-work counts. | Parent link, explicit empty state, and mobile rows retaining counts and readiness. |
| Home detail | Work section was labeled active while displaying closed work too; neighborhood was shown as a partial ID. | Accurate section label, real neighborhood name, parent navigation, and reliable detail/list breakpoints. |
| New work | Common-area input remained visible for a selected home; selected evidence was only a number. | Conditional location field, evidence filenames and sizes, individual removal, bounded form width. |
| Work detail | Long descriptions competed with titles; reassignment occupied a large always-open form; comments showed IDs. | Description inside the details panel, expandable reassignment, directory-backed author names, readable metadata and evidence rows. |
| Inspection list | Mobile CSS removed home, schedule, and revision information. | Responsive rows that retain all these fields, with status and a clear opening affordance. |
| Inspection detail | Weak return navigation and oversized desktop response-save control. | Parent link, consistent checklist spacing, touch-sized options, and a compact desktop save control. |
| Reports | Six inputs preceded the results; long category labels would be difficult to scan in vertical columns. | Expandable filter panel, three-column desktop filter layout, horizontal bar chart, and clearer sample-threshold language. |
| Administration | Unrelated tasks and numerous creation forms rendered in one continuous page. Summary cards looked like destinations but were not. | Permission-aware sections, a searchable member list, explicit role/scope editing, and links to dedicated property directories. Hidden sections retain unsaved input. |
| Account | A five-column policy grid was reused inside a narrow access sidebar. Profile errors carried a success icon. | Dedicated vertical access list and neutral feedback. |
| Notifications | Actions squeezed message text on phones; read failures were silent. | Actions below message text on mobile, restrained unread styling, visible action errors and bulk-action busy state. |
| Sync center | Technical language obscured what was saved and what still needed upload. | Direct status language and wrapping queue rows with accessible controls. |

Shared changes include stable page-title sizing, consistent 44px primary controls, readable input text, less decorative card chrome, wrapping long content, and earlier single-column detail layouts.

## Verification

`tests/e2e/layout.spec.ts` uses browser-only backend fixtures to render all 13 authenticated page types at 1440, 768, and 390 CSS pixels. It checks horizontal overflow, retained inspection context, administration section switching, browser runtime exceptions, and mobile keyboard navigation. Separate cases cover sign-in, recovery, expired recovery, invitation password setup, and organization selection. Screenshots are written to the Playwright test output directory for visual review.

The fixture suite does not validate real memberships, MFA enrollment, email delivery, file uploads, or database mutations. The setup screen is covered by the existing unit test and source review. Existing unit tests, TypeScript, lint, and the production build are checked alongside browser verification.

During route verification, a session-restoration race was found: organization guards could redirect a deep link before memberships loaded. Initial session restoration now waits for that membership request before releasing the loading boundary.

## Property management and access follow-up

The first review missed an information-architecture requirement: collapsible creation forms do not provide a management workflow. Property records now have dedicated directories, creation pages, and editable record pages, reached from **Property management** in the main navigation:

| Directory | Record page | Main actions |
| --- | --- | --- |
| `/org/:org/properties/divisions` | `/divisions/:id` | Edit division, view and add its neighborhoods, archive or restore. |
| `/org/:org/properties/neighborhoods` | `/neighborhoods/:id` | Edit name, code, division, and timezone; view and add homes; archive or restore. |
| `/org/:org/properties/homes` | `/homes/:id` | Edit lot, address, phase, and external reference; manage rooms/areas; archive or restore; open field view. |

Each directory supports search, status filtering, and pagination. Neighborhoods filter by division; homes filter by neighborhood. Parent context carries into creation forms. Existing record data is preserved when editing, and saves invalidate the related directories and field summaries. Rooms/areas can be renamed, nested, and made inactive; the parent selector excludes the edited location and its descendants. Changes use the existing scoped administration RPCs and require an elevated session. Backend archive refusals remain visible.

Invitation and member-edit forms now use the same role catalog for allowed scopes. Organization-wide access shows no neighborhood/home controls; neighborhood access shows only a neighborhood; home access requires a home filtered to its neighborhood. Changing scope or neighborhood clears incompatible selections, and hidden identifiers are omitted or sent as actual SQL/JSON null values. Company member type appears only after a company is chosen, with company membership required for trade roles.

To change an existing user, open **Administration → People & access**, search for their name/email/role, then choose **Edit roles & scope**. Role summaries show neighborhood names and lot codes. Optional start/end dates use local time in the editor. Failed saves remain visible, and changes to the signed-in user's own access trigger an access refresh.

`property-management.spec.ts` covers all nine new directory/create/record surfaces at desktop, tablet, and mobile widths, the create/edit hierarchy, room nesting, archive/restore, error handling, MFA restrictions, and permission denial. `access-management.spec.ts` checks conditional invite fields, valid role scopes, hidden identifier normalization, filtered homes, existing-user scope changes, and rejected updates. All backend writes in these browser tests are intercepted by fixtures; they do not send invitations or change real memberships/property records.

## Vendor management

The company and neighborhood-eligibility creation cards had the same missing management workflow. They are replaced by **Vendor management** in the primary navigation, with two connected directories:

| Directory | Record management |
| --- | --- |
| `/org/:org/vendors` | Create/edit a vendor's name, company categories, and external reference; review neighborhood eligibility; see its current team and authorized assigned work; deactivate or restore. |
| `/org/:org/vendors/rosters` | Create/edit the vendor–neighborhood relationship and its start/end dates, deactivate or restore. |

Both directories include search, filters, and pagination. Eligibility distinguishes eligible, scheduled, expired, and inactive entries. A current date window alone does not make a roster eligible: the vendor, neighborhood, and roster must also be active. Company categories provide trade classification. Status is recalculated when the directory refreshes, including a periodic refresh. Work is associated through current assignment IDs, and the work panel is omitted when the user lacks work access.

Vendor team actions reuse identity administration. **Manage member** opens People & access filtered to the relevant person; **Invite vendor member** opens an invitation with that company and the trade-manager role preselected. Identity-management actions appear only with access-management permission, and inactive vendors cannot initiate new vendor invitations. Property/vendor/configuration entry points now respect their corresponding permissions; the old vendor forms and duplicate generic lifecycle controls are removed.

Vendor changes use `admin_save_company`, `admin_save_roster`, and `admin_set_catalog_status`. An elevated session is required for writes. Active-assignment refusals remain visible and do not falsely report success. No new contact, billing, or payment fields are fabricated beyond the existing company model.

`vendor-management.spec.ts` covers nine vendor surfaces at 1440, 768, and 390 CSS pixels, create/edit workflows, date validation and eligibility filtering, company/team links, lifecycle changes, active-assignment refusals, and permission/MFA restrictions. The vendor suite passes eight cases on desktop and eight on mobile using intercepted backend fixtures.
# Home navigation consolidation

The separate home summary and home management screens made users choose between two views of the same record. Homes now use one canonical page at `/org/:org/homes/:id`, with Work, Inspections, Details & rooms, and Milestones navigation. The address and lot header stay in place across sections.

Home editing, rooms, milestone plans, inspection requirements, and inspection scheduling stay within that page and retain its home scope. The previous management route redirects to the Details & rooms section. Home directories open the same workspace. “Open field view” and the header's management/settings button cluster are removed. Offline saving is explained in an Offline access panel with a “Save for offline” action.

For property managers, the sidebar has one Properties entry rather than parallel Neighborhoods and Property management entries. Field-only members keep their neighborhood navigation and see only the permitted home sections.

Validation: production build and ESLint pass. Ten home-navigation cases pass across desktop and mobile; six existing property-management cases and the two workspace layout cases also pass. The checks cover legacy redirects, browser history, permission-filtered sections, home-scoped milestone creation/editing, inline inspection scheduling, and preservation of edit/archive/restore behavior. Layouts were checked at 1440, 768, and 390 pixels with intercepted backend fixtures, and desktop/mobile screenshots were inspected.

