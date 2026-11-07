# BuildTrack persona and access guide

## Identity, membership, and role are different

- A Supabase Auth identity proves who signed in. Its technical JWT role is `authenticated`.

- An active organization membership admits that identity to one BuildTrack tenant.

- One or more scoped BuildTrack roles decide what the person may see and do. A role can cover an organization, division, neighborhood, home, or company only when its definition permits the scope.

- Trade roles also require a company membership, and assignments require that company to have active neighborhood eligibility. Company categories describe the trade classification.

Platform administrators are separately provisioned operators with access to the internal organization and role catalog portal; they do not automatically receive tenant field permissions. There is no global tenant role stored on a profile. The same person may hold different scoped roles in different parts of an organization.

## Current roles and responsibilities

Eight current organization role templates are available, plus a separately provisioned platform Super Admin. Actual access also depends on active membership, enabled roles, scope, assignment, and any organization-specific role configuration.

| Role | Scope | Main responsibilities |

| --- | --- | --- |

| Super Admin | Platform | Onboard/block organizations, configure combined contract pricing, manage organization users and shared role catalogs/defaults, and review provider metadata. Platform privileges alone do not grant access to homes, daily work, inspections, evidence or conversations. |

| Org Admin | Organization | All organization permissions: settings, people/roles, divisions, neighborhoods, homes, floor plans, vendors, inspections, repair workflows, reports and audit. Subject to MFA and workflow safeguards. |

| Divisional Admin | Assigned divisions | Manage local users and access, create/manage neighborhoods and homes, maintain division plans, configure checklists, onboard vendors, expand approved vendor coverage within their authority, and oversee inspections/work/reports. Cannot remove protected higher-level vendor ownership/coverage. |

| Area Construction Manager | Assigned neighborhoods | Neighborhood administrator: onboard lots and customize copied plans, configure checklists, manage local users/vendors, schedule and oversee inspections, assign repairs, review escalations and monitor readiness. Cannot administer other divisions/neighborhoods or remove higher-level grants. |

| Construction Supervisor | Assigned division/neighborhood/home scope | Day-to-day field coordination: create and assign work, schedule inspections, review submitted findings, assign repairs, verify eligible completed work and approve milestones. Does not gain people/role administration by default. |

| Internal contributor | Assigned location scope | Report issues, complete assigned internal work, and add comments/progress. Add Inspector when the same person also conducts inspections. No default user administration, repair assignment or independent verification authority. |

| Inspector | Assigned locations, or own company with approved coverage | Additional role for internal staff or company users. Complete assigned inspections/checklists, record room observations and evidence, submit reports, and perform assigned independent reinspections. Does not grant general vendor/user administration or repair dispatch. |

| Vendor Manager | Own company and approved coverage | Manage own company users and eligible Inspector access, dispatch company repairs and inspection assignments to company personnel, and track company work. Cannot administer unrelated companies or expand own geographic authorization. |

| Vendor Tradesman | Own company and eligible assigned work | Carry out assigned repairs, post progress/shared comments, add evidence and submit completion. Cannot manage company users or grant access. |

Inspector is additive: an Internal contributor or vendor-company user can also hold Inspector. Separation of duties still prevents verifying one's own repair.

Sales Rep is a future, inactive role. Former Area manager, Assistant superintendent, Trade manager, Operations coordinator, Independent verifier, Auditor, Leadership viewer, Internal quality and External inspector templates have been retired or replaced. Historical grants may remain as compatibility roles; these are not recommended templates for new onboarding. Organizations can create private roles, so the table describes the shipped defaults rather than every possible custom role.

Navigation and actions are permission-aware, while Postgres RLS and transactional commands remain the authoritative enforcement layer.

## First organization setup

1. Sign in as the organization administrator and enroll TOTP MFA in Administration.

2. Create divisions and neighborhoods, then division floor plans. Every new home requires a standard plan or an explicit no-standard-plan choice with named rooms. CSV imports use one selected layout per batch. Existing rooms can be customized per home. Construction phases remain hidden.

3. Create categorized trade companies, then approve their neighborhood eligibility.

4. Create and publish at least one checklist version.

5. Configure business calendars, escalation routes, notification rules, milestones, and inspection requirements.

6. Invite internal staff, inspectors, and trade partners with the correct role and scope.

7. Organization administrators already have organization-wide permissions. Give other users the minimum roles and locations they need; MFA and independent-verification rules still apply.

## Password lifecycle

- From the sign-in page, choose **Forgot password?**, enter the verified email, and follow the recovery link.

- From **My account**, an authenticated user can change their password by entering the current password and a new value of at least 12 characters.

- A newly invited identity follows the Auth invitation link, creates a password, and then accepts the tenant invitation.

- Existing identities receive a tenant invitation link and sign in with their existing password.

Reset and invitation redirects must be listed in Supabase Auth URL configuration. Email delivery must be validated before onboarding real users.

## People management and handover

Administration > People and access lists active and suspended members plus invitation history. An MFA-elevated administrator can replace role scopes atomically, attach a company relationship, reactivate a suspended member, suspend access, or revoke a pending invitation. BuildTrack refuses to remove or suspend the last active organization administrator.

For a handover, first grant another person an enabled organization-scoped role with `access.manage`, such as the default `org_admin` role. Confirm their MFA-protected access, then suspend or remove the original administrator's organization role.

## Configurable role catalogs

The persona table describes the shipped templates. Platform administrators can configure shared templates and defaults for future organizations at `/platform/roles`. Each organization can enable or remove templates and define private roles in Administration > Manage role catalog. Availability does not grant access by itself: assign the role to a member with an allowed scope. Removed or retired roles immediately stop providing permissions. Ready organizations must retain an active permanent organization-wide access administrator. See [Platform administration](platform-administration.md) for onboarding and operator setup.

## Reporting and assigning work

Users with `work.create` and `work.assign` can choose **Assign now** when creating work, select a staff member or authorized vendor, and set a due date. **Create and assign** saves both together; failed assignment does not leave a draft. **Save draft** remains available, including offline capture. Ordinary saved drafts can be assigned directly without a separate submission action. Users without assignment permission save a draft and choose **Submit work item** when ready for review and assignment. Inspection findings become assignable after their inspection is submitted. Migration `202610260034` is applied to Supabase, with rollback-only checks for permissions, atomic failures, safe retries, draft assignment, and inspection safeguards.

## Basic profile details and invitation onboarding

Every user profile has required first and last names, optional phone number and contact email, and an optional timezone. The verified invitation/sign-in email remains the account identity; changing the contact email does not change sign-in or redirect notifications. Display names are built from first and last name.

New invitees verify their invitation email, set a password if needed, enter basic details, then accept organization access and land on their account/profile page. The database rejects invitation acceptance until required profile details are saved. Existing users with incomplete names are asked to complete them before entering protected pages; existing display names are not guessed or split automatically. Profile data is private to its owner and edits check the saved version.

Use **My profile** on the organization selector or the email link in the platform header to edit personal details, including users without organization membership. A user with previously confirmed profile completion can continue using downloaded work offline; first-time completion requires a connection. Migration `202610260035` is applied to Supabase. `profile_onboarding_remote_smoke.sql` verifies verified-identity requirements, optional fields, invitation gating, ownership, and concurrent edits without committing test data.

## Observation handovers and project messages

Keep work decisions in an observation’s **Conversation & history**. Before starting an assigned repair or reinspection, review who reported it, previous assignments, repair notes, evidence and review decisions. Explain changes in a shared comment; internal staff can select an internal note when vendor access would be inappropriate. Reassignment retains the observation and its history. New activity records actor and assignment names at the time. Older activity can show current profile names, as indicated in the feed.

Use **Messages** in navigation or the header for general coordination. Choose either **Internal team** or **Internal team and partners**, then search for and select the people to include. A direct conversation has two people; groups can include any active organization members allowed by the selected audience. Reply to a message to retain context. Observation-specific decisions should still be recorded on the observation.

Participants can see complete conversation history. Owners and participating scoped administrators can add/remove eligible people; removed members lose access while their messages remain. A person also loses access when their organization membership or required location scope ends. Super Admin has no automatic access to tenant conversations. Previously opened conversations can be read offline until cached authorization expires; messages saved offline send automatically when connected and authorized again. Keep the portal open for automatic synchronization.

These layout and communication features depend on pending migration 044 and require a coordinated deployment before live use. Browser fixtures and rollback database validation do not represent deployed multi-user acceptance.
