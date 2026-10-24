# BuildTrack persona and access guide

## Identity, membership, and role are different

- A Supabase Auth identity proves who signed in. Its technical JWT role is `authenticated`.
- An active organization membership admits that identity to one BuildTrack tenant.
- One or more scoped BuildTrack roles decide what the person may see and do. A role can cover an organization, neighborhood, or home only when that role permits the scope.
- Trade roles also require a company membership, and assignments require that company to have an active neighborhood specialty roster.

There is no global role stored on a profile. The same person can be a superintendent in one neighborhood and a read-only viewer in another.

## Persona landing areas

| Persona | Initial area | Main capabilities |
| --- | --- | --- |
| Organization administrator | Administration | People, roles, structure, companies, configuration, audit, delivery health |
| Area manager | My Work | Triage, assignment, verification, inspections, reports, milestone approval |
| Superintendent | My Work | Field creation, assignment, execution, verification, inspections, milestones |
| Assistant superintendent | My Work | Field creation, assignment, execution, inspection management |
| Internal quality inspector | Inspections | Checklist capture, findings, internal comments |
| External inspector | Inspections | Time- and home-bounded inspection capture and shared findings only |
| Independent verifier | My Work | Review ready corrections; separation-of-duties rules still apply |
| Trade manager | My Work | Act on work assigned to their company and coordinate eligible technicians |
| Trade technician | My Work | Act only on authorized assigned work |
| Operations coordinator | My Work | Create, triage, assign, and schedule inspections |
| Internal contributor | My Work | Create work, execute assigned work, and comment internally |
| Leadership viewer | Reports/My Work | Scoped read-only operational and reporting views |
| Auditor | Reports/My Work | Scoped read-only records, reports, and audit access |

Navigation and actions are permission-aware, while Postgres RLS and transactional commands remain the authoritative enforcement layer.

## First organization setup

1. Sign in as the organization administrator and enroll TOTP MFA in Administration.
2. Create divisions, neighborhoods, homes, and named home locations.
3. Create work categories, trade companies, specialties, and neighborhood rosters.
4. Create and publish at least one checklist version.
5. Configure business calendars, escalation routes, notification rules, milestones, and inspection requirements.
6. Invite internal staff, inspectors, and trade partners with the correct role and scope.
7. If the administrator also performs field work, edit that member and add an appropriate field role; `org_admin` intentionally does not grant field-operation authority.

## Password lifecycle

- From the sign-in page, choose **Forgot password?**, enter the verified email, and follow the recovery link.
- From **My account**, an authenticated user can change their password by entering the current password and a new value of at least 12 characters.
- A newly invited identity follows the Auth invitation link, creates a password, and then accepts the tenant invitation.
- Existing identities receive a tenant invitation link and sign in with their existing password.

Reset and invitation redirects must be listed in Supabase Auth URL configuration. Email delivery must be validated before onboarding real users.

## People management and handover

Administration > People and access lists active and suspended members plus invitation history. An MFA-elevated administrator can replace role scopes atomically, attach a company relationship, reactivate a suspended member, suspend access, or revoke a pending invitation. BuildTrack refuses to remove or suspend the last active organization administrator.

For a handover, first grant another person the organization-scoped `org_admin` role. Confirm their MFA-protected access, then suspend or remove the original administrator's organization role.
