# Platform administration

The internal portal lives at `/platform`. Platform operators manage organizations and shared role definitions independently of tenant memberships. A platform operator does not automatically gain access to tenant work, inspections, or reports.

## Operator access

Provision an existing Supabase Auth user in `public.platform_administrators` through a trusted database operator. There is no public self-enrollment or browser-side service credential. Access requires an active entry, a verified Auth email, and a TOTP MFA session before management queries or changes are allowed. The portal supports enrolling and verifying MFA.

Both administrator portals reuse an existing verified authenticator. An unfinished BuildTrack enrollment offers code entry or an explicit **Start setup again** action; only unfinished BuildTrack factors are replaced by that action. New sign-ins can require another MFA code without requiring another enrollment. Enrollment races recover the existing factor instead of surfacing duplicate-name errors.

For a new operator, send an Auth account invitation with an allowlisted redirect to `/auth/update-password?next=/platform`, then provision the returned user ID. Keep server credentials out of source and browser code. Initial operator provisioning is recorded in `platform_audit_events`.

## Organization onboarding

1. Open Organizations and choose **Onboard organization**.
2. Enter its name, timezone, first administrator email, and an organization-wide role containing `access.manage`.
3. Review the organization's Available roles. Remove optional defaults or enable other shared templates.
4. Send the administrator invitation explicitly. Delivery errors remain visible and can be retried.
5. The invited person verifies their email, sets a password if needed, and accepts the organization invitation. The organization then moves from pending administrator to ready.

Organization creation uses a request ID so a retry after a network interruption recovers the existing organization. Changing the pending administrator revokes old onboarding links; send a replacement after saving. Lifecycle changes require review and version checks. Activity and invitation history are available on the organization record.

## Role catalogs

Platform operators create or edit shared roles, their permission sets, allowed assignment scopes, company-membership requirement, publication status, and defaults for future organizations. Changing future defaults does not alter existing organizations.

The initial future-organization defaults are Organization administrator, Superintendent, Internal quality, Trade manager, Trade technician, and Leadership viewer. The chosen onboarding administrator role is also enabled. Existing organizations retained their prior role availability during migration.

Organization administrators can enable or remove shared roles for their own organization, create private roles, or copy a shared definition into a private role. Private definitions are isolated from other organizations. Shared definitions are editable only by platform operators. Enabling availability alone never assigns a role to a person.

Removing or retiring a role stops its existing grants from providing permissions without deleting their history. Administrative permissions require organization-wide scope. A ready active organization must retain at least one active permanent organization-wide grant containing `access.manage`; handovers can use custom administrator roles. Scope changes are rejected while existing grants use a scope being removed.

## Supabase deployment and verification

### Organization operations

Each organization now has dedicated People & invitations, Pricing, and Access & lifecycle sections.

- People lists active, suspended, and removed tenant memberships, current grants, and assignment counts. Platform operators can suspend membership, reactivate a suspended membership, or remove it with a recorded reason. Suspension preserves grants; removal revokes role and company grants. Removal affects only the selected tenant and does not delete the Auth account or operational history. Removed users require a new invitation. The last eligible permanent access administrator is protected even while the organization is blocked.
- Platform invitations support enabled organization-wide roles without a company requirement. Scoped and trade-company invitations remain in tenant People administration. Invitations require explicit review before delivery. Pending invitations can be revoked, and delivery errors remain visible. The history includes tenant-admin invitations as well as platform invitations.
- Pricing combines a base rate, per-active-user rate, and per-unarchived-home rate with included allowances. Agreements include currency, monthly or annual interval, subscription status, dates, billing email, and notes. Each rate is per selected interval. Current usage produces an estimate; taxes, proration, discounts, historical usage, invoices, and payment collection are not implemented. Subscription status and dates do not automatically block access. Changes are version checked and audited.
- Access & lifecycle provides block, activate, and archive controls with a reason and confirmation. Blocking and archiving stop online tenant authorization and revoke pending invitations. Previously downloaded offline data is retained on devices. Reactivation restores eligible existing memberships and grants. Archiving preserves records; there is no destructive tenant deletion control.

Migrations `202610260032` and `202610260033` were applied to the linked Supabase project, and `platform-invite` was redeployed. `platform_operations_remote_smoke.sql` passed in a rollback-only transaction, covering pricing validation and stale versions, member revocation and restoration, last-admin protection while blocked, cross-tenant invitation revocation, organization blocking and restoration, invitation cancellation, and restricted/MFA access. No emails were sent by the tests.

On October 26, 2026, migrations through `202610260031` were applied to linked project `dsojnswnfclafnhlgoby`. The `invite-user` and `platform-invite` Edge Functions were deployed with JWT verification. No seed data was loaded. The first authorized operator account invitation was accepted by the Auth invitation endpoint and its platform access was provisioned.

Tenant invitations use the server-only `APP_ORIGIN` and Auth redirect allowlist. New Auth users receive account invitations; existing users receive business invitations through `RESEND_API_KEY`. Configure the public application origin before onboarding users to a hosted frontend. The initial operator invitation targets the existing local origin `http://localhost:5173`.

`supabase/tests/platform_remote_smoke.sql` is self-contained and rolls back all temporary identities and data. It passed against the updated linked project, exercising role catalogs, onboarding idempotency, invitation acceptance, effective permissions, role removal, administrator handover, tenant isolation, and MFA enforcement. Do not run fixture seeds or the fixture-dependent pgTAP suite against a live project.

Browser tests mock backend traffic and do not deliver emails. The desktop platform suite and mobile platform/access suites passed. Screenshots cover desktop, tablet, and mobile layouts. The frontend is implemented and locally built; this backend deployment does not publish the frontend to a hosting provider.


## Metadata-only oversight and pending configuration (October 29)

Migration `202610280043_platform_provider_oversight_and_catalogs.sql` is **pending**, not deployed. It adds provider metadata/users/coverage views and global timezone/space-type/company-category/construction-phase configuration. The platform People response omits assigned-work counts. Providers never expose EIN, home records, inspections, evidence or conversations. A platform role does not grant tenant membership or bypass tenant RLS; independently granted tenant membership retains its normal scope.

The new local routes are `/platform/settings` and `/platform/organizations/:organizationId/providers` (with provider detail under `/:providerId`). Provider user links open platform People administration. Catalog codes remain stable, saves are version checked, and retiring company categories or space types preserves existing references while preventing new use. Construction phases remain free text with catalog suggestions. Rollback-only SQL tests cover privacy, MFA and catalog behavior. See `acceptance-results.md` for the remaining integration and release checks.
