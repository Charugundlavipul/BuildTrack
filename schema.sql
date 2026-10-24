-- BuildTrack consolidated Supabase schema
-- Generated from versioned migrations. Safe for an empty Supabase project.
-- Contains the fixed permission/role catalog, but no synthetic users or fixture data.
-- Rebuild with: npm run schema:build

-- ============================================================================
-- SOURCE: supabase/migrations/202610230001_foundation.sql
-- ============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.organization_status as enum ('active', 'suspended', 'archived');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'removed');
create type public.affiliation_kind as enum ('internal', 'external');
create type public.scope_kind as enum ('organization', 'neighborhood', 'home');
create type public.work_state as enum ('draft', 'submitted', 'assigned', 'acknowledged', 'in_progress', 'blocked', 'ready_for_verification', 'rework_required', 'verified', 'cancelled');
create type public.work_priority as enum ('low', 'normal', 'high', 'critical');
create type public.work_origin as enum ('internal_observation', 'internal_inspection', 'external_inspection', 'walkthrough', 'manual_report');
create type public.inspection_status as enum ('draft', 'in_progress', 'submitted', 'amended', 'cancelled');
create type public.inspection_type as enum ('internal_quality', 'external_quality', 'pre_walkthrough', 'final_walkthrough', 'reinspection');
create type public.inspection_result as enum ('pass', 'fail', 'not_applicable', 'not_checked');
create type public.attachment_status as enum ('pending_upload', 'quarantined', 'ready', 'rejected', 'deleted');
create type public.comment_visibility as enum ('shared', 'internal');
create type public.notification_status as enum ('pending', 'leased', 'sent', 'failed', 'dead', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(display_name) between 1 and 120),
  preferred_locale text not null default 'en',
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  timezone text not null default 'America/New_York',
  status public.organization_status not null default 'active',
  default_calendar_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0)
);

create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  status public.organization_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.neighborhoods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  division_id uuid,
  code text not null,
  name text not null,
  timezone text,
  status public.organization_status not null default 'active',
  calendar_id uuid,
  supervisor_user_id uuid references auth.users(id) on delete restrict,
  escalation_route_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, division_id) references public.divisions(organization_id, id) on delete restrict
);

create table public.homes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid not null,
  lot_code text not null,
  address_line1 text,
  address_line2 text,
  city text,
  state_code text,
  postal_code text,
  phase text not null default 'planned',
  primary_supervisor_user_id uuid references auth.users(id) on delete restrict,
  external_reference text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, neighborhood_id, id),
  unique (organization_id, neighborhood_id, lot_code),
  foreign key (organization_id, neighborhood_id) references public.neighborhoods(organization_id, id) on delete restrict
);

create table public.home_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid not null,
  home_id uuid not null,
  name text not null,
  parent_location_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, home_id, id),
  foreign key (organization_id, neighborhood_id, home_id) references public.homes(organization_id, neighborhood_id, id) on delete restrict,
  foreign key (organization_id, home_id, parent_location_id) references public.home_locations(organization_id, home_id, id) on delete restrict,
  check (id is distinct from parent_location_id)
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  affiliation public.affiliation_kind not null,
  status public.membership_status not null default 'invited',
  joined_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, user_id)
);

create table public.roles (
  code text primary key,
  label text not null,
  allowed_scope_kinds public.scope_kind[] not null,
  immutable_seed boolean not null default true
);

create table public.permissions (
  code text primary key,
  description text not null
);

create table public.role_permissions (
  role_code text not null references public.roles(code) on delete restrict,
  permission_code text not null references public.permissions(code) on delete restrict,
  primary key (role_code, permission_code)
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role_code text not null references public.roles(code) on delete restrict,
  scope_kind public.scope_kind not null,
  neighborhood_id uuid,
  home_id uuid,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, neighborhood_id) references public.neighborhoods(organization_id, id) on delete restrict,
  foreign key (organization_id, neighborhood_id, home_id) references public.homes(organization_id, neighborhood_id, id) on delete restrict,
  check (
    (scope_kind = 'organization' and neighborhood_id is null and home_id is null) or
    (scope_kind = 'neighborhood' and neighborhood_id is not null and home_id is null) or
    (scope_kind = 'home' and neighborhood_id is not null and home_id is not null)
  )
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  external_vendor_reference text,
  status public.organization_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('manager', 'technician')),
  active_from timestamptz not null default now(),
  active_to timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, company_id) references public.companies(organization_id, id) on delete restrict
);
create unique index company_memberships_one_active on public.company_memberships(organization_id, company_id, user_id) where revoked_at is null and active_to is null;

create table public.trade_specialties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, code)
);

create table public.neighborhood_trade_rosters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid not null,
  company_id uuid not null,
  specialty_id uuid not null,
  status public.organization_status not null default 'active',
  active_from timestamptz not null default now(),
  active_to timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, neighborhood_id) references public.neighborhoods(organization_id, id) on delete restrict,
  foreign key (organization_id, company_id) references public.companies(organization_id, id) on delete restrict,
  foreign key (organization_id, specialty_id) references public.trade_specialties(organization_id, id) on delete restrict
);
create unique index neighborhood_trade_rosters_active on public.neighborhood_trade_rosters(organization_id, neighborhood_id, company_id, specialty_id) where status = 'active' and active_to is null;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  normalized_email text not null,
  proposed_membership jsonb not null,
  proposed_grants jsonb not null default '[]'::jsonb,
  proposed_company_id uuid,
  token_hash text not null unique,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  delivery_error text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, proposed_company_id) references public.companies(organization_id, id) on delete restrict
);

create table public.inspection_engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid not null,
  home_id uuid not null,
  inspector_user_id uuid not null references auth.users(id) on delete restrict,
  purpose text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, neighborhood_id, home_id) references public.homes(organization_id, neighborhood_id, id) on delete restrict,
  check (ends_at > starts_at)
);

create table public.work_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, code)
);

create table public.business_calendars (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  timezone text not null,
  working_weekdays smallint[] not null default '{1,2,3,4,5}',
  local_start_time time not null default '08:00',
  local_end_time time not null default '17:00',
  holiday_dates date[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id)
);

alter table public.organizations add constraint organizations_calendar_fk foreign key (id, default_calendar_id) references public.business_calendars(organization_id, id) on delete restrict;
alter table public.neighborhoods add constraint neighborhoods_calendar_fk foreign key (organization_id, calendar_id) references public.business_calendars(organization_id, id) on delete restrict;

create table public.home_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  home_id uuid not null,
  milestone_code text not null,
  planned_at timestamptz,
  actual_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, home_id, milestone_code),
  foreign key (organization_id, home_id) references public.homes(organization_id, id) on delete restrict
);

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230002_work_and_inspections.sql
-- ============================================================================

begin;

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id)
);

create table public.checklist_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  template_id uuid not null,
  number integer not null check (number > 0),
  published_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, template_id, number),
  foreign key (organization_id, template_id) references public.checklist_templates(organization_id, id) on delete restrict
);

create table public.checklist_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  version_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  section text not null,
  label text not null,
  category_id uuid,
  requires_response boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, version_id, ordinal),
  foreign key (organization_id, version_id) references public.checklist_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, category_id) references public.work_categories(organization_id, id) on delete restrict
);

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid not null,
  home_id uuid not null,
  type public.inspection_type not null,
  template_version_id uuid not null,
  scheduled_at timestamptz,
  lead_inspector_user_id uuid not null references auth.users(id) on delete restrict,
  status public.inspection_status not null default 'draft',
  current_revision integer not null default 1,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, neighborhood_id, home_id) references public.homes(organization_id, neighborhood_id, id) on delete restrict,
  foreign key (organization_id, template_version_id) references public.checklist_versions(organization_id, id) on delete restrict
);

create table public.inspection_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  inspection_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  can_edit_draft boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, inspection_id, user_id),
  foreign key (organization_id, inspection_id) references public.inspections(organization_id, id) on delete restrict
);

create table public.inspection_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  inspection_id uuid not null,
  question_id uuid not null,
  result public.inspection_result not null,
  explanation text,
  finding_work_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  unique (organization_id, inspection_id, question_id),
  foreign key (organization_id, inspection_id) references public.inspections(organization_id, id) on delete restrict,
  foreign key (organization_id, question_id) references public.checklist_questions(organization_id, id) on delete restrict,
  check ((result = 'fail' and finding_work_item_id is not null) or result <> 'fail'),
  check ((result in ('not_applicable', 'not_checked') and nullif(trim(explanation), '') is not null) or result not in ('not_applicable', 'not_checked'))
);

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid not null,
  home_id uuid,
  location_id uuid,
  common_area_location text,
  inspection_id uuid,
  origin public.work_origin not null,
  title text not null check (length(title) between 1 and 160),
  description text not null check (length(description) between 1 and 10000),
  category_id uuid,
  priority public.work_priority not null default 'normal',
  safety_flag boolean not null default false,
  state public.work_state not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  client_captured_at timestamptz,
  submitted_at timestamptz,
  current_assignment_id uuid,
  due_at timestamptz,
  blocked_from_state public.work_state,
  blocked_reason text,
  duplicate_of_id uuid,
  reopened_count integer not null default 0 check (reopened_count >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, neighborhood_id) references public.neighborhoods(organization_id, id) on delete restrict,
  foreign key (organization_id, home_id) references public.homes(organization_id, id) on delete restrict,
  foreign key (organization_id, home_id, location_id) references public.home_locations(organization_id, home_id, id) on delete restrict,
  foreign key (organization_id, inspection_id) references public.inspections(organization_id, id) on delete restrict,
  foreign key (organization_id, category_id) references public.work_categories(organization_id, id) on delete restrict,
  foreign key (organization_id, duplicate_of_id) references public.work_items(organization_id, id) on delete restrict,
  check ((home_id is not null and common_area_location is null) or (home_id is null and nullif(trim(common_area_location), '') is not null)),
  check (location_id is null or home_id is not null),
  check (duplicate_of_id is null or duplicate_of_id <> id),
  check (inspection_id is null or (home_id is not null and origin in ('internal_inspection', 'external_inspection', 'walkthrough')))
);

alter table public.inspection_responses add constraint inspection_responses_finding_fk
  foreign key (organization_id, finding_work_item_id) references public.work_items(organization_id, id) on delete restrict;

create table public.assignment_episodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  internal_assignee_user_id uuid references auth.users(id) on delete restrict,
  company_id uuid,
  technician_user_id uuid references auth.users(id) on delete restrict,
  specialty_id uuid,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  due_at timestamptz not null,
  acknowledged_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  reassignment_reason text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, work_item_id, id),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict,
  foreign key (organization_id, company_id) references public.companies(organization_id, id) on delete restrict,
  foreign key (organization_id, specialty_id) references public.trade_specialties(organization_id, id) on delete restrict,
  check ((internal_assignee_user_id is not null)::int + (company_id is not null)::int = 1),
  check (technician_user_id is null or company_id is not null)
);
create unique index assignment_episodes_one_open on public.assignment_episodes(organization_id, work_item_id) where ended_at is null;
alter table public.work_items add constraint work_items_current_assignment_fk foreign key (organization_id, id, current_assignment_id) references public.assignment_episodes(organization_id, work_item_id, id) on delete restrict;

create table public.evidence_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  authorized_by uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  consumed_by_attempt_id uuid,
  unique (organization_id, id),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict
);

create table public.correction_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  assignment_episode_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  completion_note text not null,
  evidence_exception_id uuid,
  accountable_company_id uuid,
  accountable_internal_user_id uuid,
  technician_user_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, work_item_id, attempt_number),
  foreign key (organization_id, work_item_id, assignment_episode_id) references public.assignment_episodes(organization_id, work_item_id, id) on delete restrict,
  foreign key (organization_id, evidence_exception_id) references public.evidence_exceptions(organization_id, id) on delete restrict
);
alter table public.evidence_exceptions add constraint evidence_exceptions_consumed_fk foreign key (organization_id, consumed_by_attempt_id) references public.correction_attempts(organization_id, id) on delete restrict;

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  correction_attempt_id uuid not null,
  decision text not null check (decision in ('accepted', 'rejected')),
  method text not null check (method in ('on_site', 'remote')),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, correction_attempt_id),
  foreign key (organization_id, correction_attempt_id) references public.correction_attempts(organization_id, id) on delete restrict,
  check (decision <> 'rejected' or nullif(trim(notes), '') is not null)
);

create table public.blocker_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  assignment_episode_id uuid,
  cause text not null check (cause in ('access', 'material', 'dependency', 'instructions', 'other')),
  notes text not null,
  opened_at timestamptz not null default now(),
  opened_by uuid not null references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolution text,
  unique (organization_id, id),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict,
  foreign key (organization_id, assignment_episode_id) references public.assignment_episodes(organization_id, id) on delete restrict
);
create unique index blocker_events_one_open on public.blocker_events(organization_id, work_item_id) where resolved_at is null;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  author_id uuid not null references auth.users(id) on delete restrict,
  visibility public.comment_visibility not null default 'shared',
  body text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  redacted_at timestamptz,
  redaction_reason text,
  unique (organization_id, id),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid not null,
  home_id uuid,
  work_item_id uuid,
  inspection_id uuid,
  comment_id uuid,
  correction_attempt_id uuid,
  visibility public.comment_visibility not null default 'shared',
  uploader_id uuid not null references auth.users(id) on delete restrict,
  bucket text not null default 'evidence',
  object_key text not null unique,
  derivative_object_key text,
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 20971520),
  sha256 text,
  status public.attachment_status not null default 'pending_upload',
  purpose text not null check (purpose in ('observation', 'correction', 'report', 'comment')),
  scan_provider text,
  scan_reference text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, neighborhood_id) references public.neighborhoods(organization_id, id) on delete restrict,
  foreign key (organization_id, home_id) references public.homes(organization_id, id) on delete restrict,
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict,
  foreign key (organization_id, inspection_id) references public.inspections(organization_id, id) on delete restrict,
  foreign key (organization_id, comment_id) references public.comments(organization_id, id) on delete restrict,
  foreign key (organization_id, correction_attempt_id) references public.correction_attempts(organization_id, id) on delete restrict,
  check ((work_item_id is not null)::int + (inspection_id is not null)::int + (comment_id is not null)::int = 1),
  check (mime_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'))
);
create index attachments_parent_item on public.attachments(organization_id, work_item_id) where work_item_id is not null;

create table public.inspection_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  inspection_id uuid not null,
  revision_number integer not null,
  snapshot jsonb not null,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  amendment_reason text,
  previous_submission_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, inspection_id, revision_number),
  foreign key (organization_id, inspection_id) references public.inspections(organization_id, id) on delete restrict,
  foreign key (organization_id, previous_submission_id) references public.inspection_submissions(organization_id, id) on delete restrict
);

create table public.work_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null,
  assignment_episode_id uuid,
  event_type text not null,
  from_state public.work_state,
  to_state public.work_state,
  actor_id uuid references auth.users(id) on delete restrict,
  server_at timestamptz not null default now(),
  client_captured_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  operation_id uuid not null,
  unique (organization_id, id),
  unique (organization_id, operation_id, event_type, work_item_id),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict,
  foreign key (organization_id, assignment_episode_id) references public.assignment_episodes(organization_id, id) on delete restrict
);

create table public.milestone_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  home_id uuid not null,
  milestone_code text not null,
  required_inspection_type public.inspection_type not null,
  required boolean not null default true,
  unique (organization_id, id),
  unique (organization_id, home_id, milestone_code, required_inspection_type),
  foreign key (organization_id, home_id) references public.homes(organization_id, id) on delete restrict
);

create table public.milestone_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  home_id uuid not null,
  milestone_code text not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidation_reason text,
  snapshot jsonb not null,
  unique (organization_id, id),
  foreign key (organization_id, home_id) references public.homes(organization_id, id) on delete restrict
);
create unique index milestone_approvals_one_active on public.milestone_approvals(organization_id, home_id, milestone_code) where invalidated_at is null;

create index work_items_scope_state on public.work_items(organization_id, neighborhood_id, home_id, state);
create index work_items_due on public.work_items(organization_id, due_at) where state not in ('draft', 'verified', 'cancelled');
create index inspections_home_status on public.inspections(organization_id, home_id, status);
create index assignment_episodes_company_active on public.assignment_episodes(organization_id, company_id, technician_user_id) where ended_at is null;
create index work_events_cursor on public.work_events(organization_id, server_at, id);

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230003_operations.sql
-- ============================================================================

begin;

create table public.escalation_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id)
);

create table public.escalation_route_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  route_id uuid not null,
  level integer not null check (level between 1 and 10),
  recipient_kind text not null check (recipient_kind in ('assigned_company_manager', 'supervisor', 'area_manager', 'specific_user', 'org_admin')),
  recipient_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, route_id, level, recipient_kind, recipient_user_id),
  foreign key (organization_id, route_id) references public.escalation_routes(organization_id, id) on delete restrict
);

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  neighborhood_id uuid,
  trigger text not null check (trigger in ('assignment_unacknowledged', 'work_due', 'attempt_unreviewed', 'blocked', 'critical_created')),
  business_minutes integer,
  repeat_minutes integer,
  max_repeats integer not null default 1 check (max_repeats between 0 and 50),
  quiet_hours jsonb not null default '{}'::jsonb,
  escalation_route_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, neighborhood_id) references public.neighborhoods(organization_id, id) on delete restrict,
  foreign key (organization_id, escalation_route_id) references public.escalation_routes(organization_id, id) on delete restrict
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  work_item_id uuid,
  title text not null,
  body text not null,
  deep_link text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  invalidated_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  work_item_id uuid,
  assignment_episode_id uuid,
  channel text not null check (channel in ('in_app', 'email')),
  dedupe_key text not null,
  template_key text not null,
  payload jsonb not null,
  status public.notification_status not null default 'pending',
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, dedupe_key),
  foreign key (organization_id, work_item_id) references public.work_items(organization_id, id) on delete restrict,
  foreign key (organization_id, assignment_episode_id) references public.assignment_episodes(organization_id, id) on delete restrict
);
create index notification_outbox_claim on public.notification_outbox(status, available_at, leased_until) where status in ('pending', 'failed', 'leased');

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  operation_id uuid,
  occurred_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  unique (organization_id, id)
);
create index audit_events_entity on public.audit_events(organization_id, entity_type, entity_id, occurred_at desc);

create table private.client_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  command_name text not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, operation_id)
);
revoke all on private.client_operations from public, anon, authenticated;

create table private.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);
revoke all on private.rate_limit_buckets from public, anon, authenticated;

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  export_kind text not null,
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'failed', 'expired')),
  bucket text not null default 'exports',
  object_key text,
  row_count integer,
  expires_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create or replace function private.prevent_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'submitted historical records are immutable';
end;
$$;

create trigger inspection_submissions_immutable before update or delete on public.inspection_submissions for each row execute function private.prevent_mutation();
create trigger correction_attempts_immutable before update or delete on public.correction_attempts for each row execute function private.prevent_mutation();
create trigger verifications_immutable before update or delete on public.verifications for each row execute function private.prevent_mutation();
create trigger work_events_immutable before update or delete on public.work_events for each row execute function private.prevent_mutation();
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function private.prevent_mutation();

create or replace function private.touch_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organizations','divisions','neighborhoods','homes','home_locations','organization_memberships',
    'companies','trade_specialties','business_calendars','home_milestones','checklist_templates',
    'inspection_responses','inspections','work_items','escalation_routes','notification_rules'
  ] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function private.touch_version()', table_name, table_name);
  end loop;
end $$;

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230004_authorization.sql
-- ============================================================================

begin;

create or replace function private.active_member(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and o.status = 'active'
      and (m.ended_at is null or m.ended_at > now())
  );
$$;

create or replace function private.is_internal_member(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id and m.user_id = p_user_id
      and m.status = 'active' and m.affiliation = 'internal'
      and (m.ended_at is null or m.ended_at > now())
  );
$$;

create or replace function private.has_permission(
  p_organization_id uuid,
  p_user_id uuid,
  p_permission text,
  p_neighborhood_id uuid default null,
  p_home_id uuid default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.active_member(p_organization_id, p_user_id) and exists (
    select 1
    from public.role_assignments ra
    join public.role_permissions rp on rp.role_code = ra.role_code
    where ra.organization_id = p_organization_id
      and ra.user_id = p_user_id
      and rp.permission_code = p_permission
      and ra.starts_at <= now()
      and (ra.ends_at is null or ra.ends_at > now())
      and ra.revoked_at is null
      and (
        ra.scope_kind = 'organization'
        or (ra.scope_kind = 'neighborhood' and ra.neighborhood_id = p_neighborhood_id)
        or (ra.scope_kind = 'home' and ra.neighborhood_id = p_neighborhood_id and ra.home_id = p_home_id)
      )
  );
$$;

create or replace function private.has_any_scope(
  p_organization_id uuid,
  p_user_id uuid,
  p_neighborhood_id uuid default null,
  p_home_id uuid default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.active_member(p_organization_id, p_user_id) and exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = p_organization_id and ra.user_id = p_user_id
      and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now()) and ra.revoked_at is null
      and (
        ra.scope_kind = 'organization'
        or (ra.scope_kind = 'neighborhood' and ra.neighborhood_id = p_neighborhood_id)
        or (ra.scope_kind = 'home' and ra.neighborhood_id = p_neighborhood_id and ra.home_id = p_home_id)
      )
  );
$$;

create or replace function private.has_active_role(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.active_member(p_organization_id, p_user_id) and exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = p_organization_id and ra.user_id = p_user_id
      and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now()) and ra.revoked_at is null
  );
$$;

create or replace function private.active_company_membership(
  p_organization_id uuid, p_company_id uuid, p_user_id uuid, p_kind text default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.company_memberships cm
    where cm.organization_id = p_organization_id and cm.company_id = p_company_id and cm.user_id = p_user_id
      and (p_kind is null or cm.kind = p_kind)
      and cm.active_from <= now() and (cm.active_to is null or cm.active_to > now()) and cm.revoked_at is null
  );
$$;

create or replace function private.can_read_work(p_user_id uuid, p_work_item_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.work_items w
    left join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id
    where w.id = p_work_item_id
      and private.active_member(w.organization_id, p_user_id)
      and (
        (w.state = 'draft' and w.created_by = p_user_id)
        or private.has_permission(w.organization_id, p_user_id, 'work.read_scope', w.neighborhood_id, w.home_id)
        or private.has_permission(w.organization_id, p_user_id, 'work.verify', w.neighborhood_id, w.home_id)
        or ae.internal_assignee_user_id = p_user_id
        or (ae.company_id is not null and private.active_company_membership(w.organization_id, ae.company_id, p_user_id, 'manager'))
        or (ae.technician_user_id = p_user_id and private.active_company_membership(w.organization_id, ae.company_id, p_user_id, 'technician'))
        or exists (
          select 1 from public.inspection_participants ip
          join public.inspections i on i.organization_id = ip.organization_id and i.id = ip.inspection_id
          where w.inspection_id = i.id and ip.user_id = p_user_id
        )
      )
  );
$$;

create or replace function private.can_execute_work(p_user_id uuid, p_work_item_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.work_items w
    join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id and ae.ended_at is null
    where w.id = p_work_item_id
      and private.active_member(w.organization_id, p_user_id)
      and (
        (ae.internal_assignee_user_id = p_user_id and private.has_permission(w.organization_id, p_user_id, 'work.execute_assigned', w.neighborhood_id, w.home_id))
        or (ae.company_id is not null and private.active_company_membership(w.organization_id, ae.company_id, p_user_id, 'manager')
            and private.has_permission(w.organization_id, p_user_id, 'work.execute_assigned', w.neighborhood_id, w.home_id))
        or (ae.technician_user_id = p_user_id and private.active_company_membership(w.organization_id, ae.company_id, p_user_id, 'technician')
            and private.has_permission(w.organization_id, p_user_id, 'work.execute_assigned', w.neighborhood_id, w.home_id))
      )
  );
$$;

create or replace function private.can_read_inspection(p_user_id uuid, p_inspection_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.inspections i
    where i.id = p_inspection_id and private.active_member(i.organization_id, p_user_id)
      and (
        private.has_permission(i.organization_id, p_user_id, 'inspection.manage', i.neighborhood_id, i.home_id)
        or private.has_permission(i.organization_id, p_user_id, 'inspection.perform', i.neighborhood_id, i.home_id)
        or exists (select 1 from public.inspection_participants ip where ip.organization_id = i.organization_id and ip.inspection_id = i.id and ip.user_id = p_user_id)
        or exists (
          select 1 from public.inspection_engagements ie
          where ie.organization_id = i.organization_id and ie.home_id = i.home_id and ie.inspector_user_id = p_user_id
            and ie.starts_at <= now() and ie.ends_at > now() and ie.revoked_at is null
        )
      )
  );
$$;

create or replace function private.can_read_attachment(p_user_id uuid, p_attachment_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.attachments a
    where a.id = p_attachment_id
      and private.active_member(a.organization_id, p_user_id)
      and (
        (a.uploader_id = p_user_id and a.status in ('pending_upload', 'quarantined', 'ready'))
        or (
          a.status = 'ready'
          and (a.visibility = 'shared' or private.is_internal_member(a.organization_id, p_user_id))
          and (
            (a.work_item_id is not null and private.can_read_work(p_user_id, a.work_item_id))
            or (a.inspection_id is not null and private.can_read_inspection(p_user_id, a.inspection_id))
            or (a.comment_id is not null and exists (
              select 1 from public.comments c where c.id = a.comment_id and private.can_read_work(p_user_id, c.work_item_id)
                and (c.visibility = 'shared' or private.is_internal_member(c.organization_id, p_user_id))
            ))
          )
        )
      )
  );
$$;

create or replace function private.can_verify(p_user_id uuid, p_attempt_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.correction_attempts ca
    join public.work_items w on w.organization_id = ca.organization_id and w.id = ca.work_item_id
    where ca.id = p_attempt_id
      and ca.submitted_by <> p_user_id
      and private.has_permission(w.organization_id, p_user_id, 'work.verify', w.neighborhood_id, w.home_id)
      and not (
        ca.accountable_company_id is not null
        and private.active_company_membership(w.organization_id, ca.accountable_company_id, p_user_id, null)
      )
  );
$$;

create or replace function private.require_aal2()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','organizations','divisions','neighborhoods','homes','home_locations','organization_memberships',
    'roles','permissions','role_permissions','role_assignments','companies','company_memberships','trade_specialties',
    'neighborhood_trade_rosters','invites','inspection_engagements','work_categories','business_calendars','home_milestones',
    'checklist_templates','checklist_versions','checklist_questions','inspections','inspection_participants','inspection_responses',
    'inspection_submissions','work_items','assignment_episodes','evidence_exceptions','correction_attempts','verifications',
    'blocker_events','comments','attachments','work_events','milestone_requirements','milestone_approvals','escalation_routes',
    'escalation_route_steps','notification_rules','notifications','notification_outbox','audit_events','export_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid());
create policy organizations_member_select on public.organizations for select to authenticated using (private.active_member(id, auth.uid()));
create policy memberships_self_or_admin_select on public.organization_memberships for select to authenticated using (
  user_id = auth.uid() or private.has_permission(organization_id, auth.uid(), 'access.manage', null, null)
);
create policy role_catalog_select on public.roles for select to authenticated using (true);
create policy permission_catalog_select on public.permissions for select to authenticated using (true);
create policy role_permission_catalog_select on public.role_permissions for select to authenticated using (true);
create policy role_assignments_self_or_admin_select on public.role_assignments for select to authenticated using (
  user_id = auth.uid() or private.has_permission(organization_id, auth.uid(), 'access.manage', neighborhood_id, home_id)
);

create policy divisions_scoped_select on public.divisions for select to authenticated using (
  private.has_permission(organization_id, auth.uid(), 'structure.manage', null, null)
  or private.has_permission(organization_id, auth.uid(), 'report.read_scope', null, null)
);
create policy neighborhoods_scoped_select on public.neighborhoods for select to authenticated using (
  private.has_any_scope(organization_id, auth.uid(), id, null)
);
create policy homes_scoped_select on public.homes for select to authenticated using (
  private.has_any_scope(organization_id, auth.uid(), neighborhood_id, id)
);
create policy home_locations_scoped_select on public.home_locations for select to authenticated using (
  private.has_any_scope(organization_id, auth.uid(), neighborhood_id, home_id)
);

create policy companies_scoped_select on public.companies for select to authenticated using (
  private.has_permission(organization_id, auth.uid(), 'roster.manage', null, null)
  or exists (
    select 1 from public.neighborhood_trade_rosters r
    where r.organization_id = companies.organization_id and r.company_id = companies.id
      and private.has_permission(r.organization_id, auth.uid(), 'work.assign', r.neighborhood_id, null)
  )
  or exists (select 1 from public.company_memberships cm where cm.organization_id = companies.organization_id and cm.company_id = companies.id and cm.user_id = auth.uid() and cm.revoked_at is null)
);
create policy company_memberships_scoped_select on public.company_memberships for select to authenticated using (
  user_id = auth.uid() or private.has_permission(organization_id, auth.uid(), 'roster.manage', null, null)
);
create policy specialties_scoped_select on public.trade_specialties for select to authenticated using (
  private.has_active_role(organization_id, auth.uid()) or private.has_permission(organization_id, auth.uid(), 'roster.manage', null, null)
);
create policy rosters_scoped_select on public.neighborhood_trade_rosters for select to authenticated using (
  private.has_permission(organization_id, auth.uid(), 'roster.manage', neighborhood_id, null)
  or private.has_permission(organization_id, auth.uid(), 'work.assign', neighborhood_id, null)
  or exists (select 1 from public.company_memberships cm where cm.organization_id = neighborhood_trade_rosters.organization_id and cm.company_id = neighborhood_trade_rosters.company_id and cm.user_id = auth.uid() and cm.revoked_at is null)
);
create policy invites_admin_select on public.invites for select to authenticated using (private.has_permission(organization_id, auth.uid(), 'access.manage', null, null));
create policy engagements_self_or_manager_select on public.inspection_engagements for select to authenticated using (
  inspector_user_id = auth.uid() or private.has_permission(organization_id, auth.uid(), 'inspection.manage', neighborhood_id, home_id)
);

do $$
declare table_name text;
begin
  foreach table_name in array array['work_categories','business_calendars','home_milestones','checklist_templates','checklist_versions','checklist_questions','milestone_requirements','escalation_routes','escalation_route_steps','notification_rules'] loop
    execute format(
      'create policy %I_config_select on public.%I for select to authenticated using (private.has_active_role(organization_id, auth.uid()) or private.has_permission(organization_id, auth.uid(), ''config.manage'', null, null))',
      table_name, table_name
    );
  end loop;
end $$;

create policy inspections_authorized_select on public.inspections for select to authenticated using (private.can_read_inspection(auth.uid(), id));
create policy participants_authorized_select on public.inspection_participants for select to authenticated using (private.can_read_inspection(auth.uid(), inspection_id));
create policy responses_authorized_select on public.inspection_responses for select to authenticated using (private.can_read_inspection(auth.uid(), inspection_id));
create policy submissions_authorized_select on public.inspection_submissions for select to authenticated using (private.can_read_inspection(auth.uid(), inspection_id));
create policy work_items_authorized_select on public.work_items for select to authenticated using (private.can_read_work(auth.uid(), id));
create policy assignments_authorized_select on public.assignment_episodes for select to authenticated using (private.can_read_work(auth.uid(), work_item_id));
create policy evidence_exceptions_authorized_select on public.evidence_exceptions for select to authenticated using (private.can_read_work(auth.uid(), work_item_id));
create policy attempts_authorized_select on public.correction_attempts for select to authenticated using (private.can_read_work(auth.uid(), work_item_id));
create policy verifications_authorized_select on public.verifications for select to authenticated using (
  exists (select 1 from public.correction_attempts ca where ca.organization_id = verifications.organization_id and ca.id = verifications.correction_attempt_id and private.can_read_work(auth.uid(), ca.work_item_id))
);
create policy blockers_authorized_select on public.blocker_events for select to authenticated using (private.can_read_work(auth.uid(), work_item_id));
create policy comments_authorized_select on public.comments for select to authenticated using (
  private.can_read_work(auth.uid(), work_item_id) and (visibility = 'shared' or private.is_internal_member(organization_id, auth.uid()))
);
create policy attachments_authorized_select on public.attachments for select to authenticated using (private.can_read_attachment(auth.uid(), id));
create policy work_events_authorized_select on public.work_events for select to authenticated using (private.can_read_work(auth.uid(), work_item_id));
create policy approvals_authorized_select on public.milestone_approvals for select to authenticated using (
  exists (select 1 from public.homes h where h.organization_id = milestone_approvals.organization_id and h.id = milestone_approvals.home_id and private.has_any_scope(h.organization_id, auth.uid(), h.neighborhood_id, h.id))
);
create policy notifications_own_select on public.notifications for select to authenticated using (recipient_user_id = auth.uid() and private.active_member(organization_id, auth.uid()));
create policy outbox_admin_select on public.notification_outbox for select to authenticated using (private.has_permission(organization_id, auth.uid(), 'config.manage', null, null));
create policy audit_authorized_select on public.audit_events for select to authenticated using (private.has_permission(organization_id, auth.uid(), 'audit.read_scope', null, null));
create policy exports_own_select on public.export_jobs for select to authenticated using (
  requested_by = auth.uid() or private.has_permission(organization_id, auth.uid(), 'report.read_scope', null, null)
);

create policy notifications_own_update on public.notifications for update to authenticated using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());
grant update(read_at) on public.notifications to authenticated;

create or replace view public.my_organizations with (security_invoker = true) as
select o.id, o.name, o.timezone, o.status
from public.organizations o
join public.organization_memberships m on m.organization_id = o.id
where m.user_id = auth.uid() and m.status = 'active' and o.status = 'active';
grant select on public.my_organizations to authenticated;

create or replace view public.work_item_list with (security_invoker = true) as
select
  w.id, w.organization_id, w.neighborhood_id, w.home_id, h.lot_code,
  nullif(concat_ws(', ', h.address_line1, h.city, h.state_code), '') as address,
  w.title, w.description, w.priority, w.state, w.safety_flag, w.due_at,
  coalesce(c.name, p.display_name) as assigned_party_name,
  w.updated_at, w.version
from public.work_items w
left join public.homes h on h.organization_id = w.organization_id and h.id = w.home_id
left join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id
left join public.companies c on c.organization_id = ae.organization_id and c.id = ae.company_id
left join public.profiles p on p.id = ae.internal_assignee_user_id;
grant select on public.work_item_list to authenticated;

create or replace view public.home_summary with (security_invoker = true) as
select h.*,
  case
    when exists (select 1 from public.work_items w where w.organization_id = h.organization_id and w.home_id = h.id and w.priority = 'critical' and w.state not in ('draft','verified','cancelled'))
      or exists (
        select 1 from public.milestone_requirements mr
        where mr.organization_id = h.organization_id and mr.home_id = h.id and mr.required
          and not exists (select 1 from public.inspections i where i.organization_id = h.organization_id and i.home_id = h.id and i.type = mr.required_inspection_type and i.status = 'submitted')
      ) then 'not_ready'
    when exists (select 1 from public.work_items w where w.organization_id = h.organization_id and w.home_id = h.id and w.state = 'ready_for_verification') then 'pending_verification'
    when exists (select 1 from public.work_items w where w.organization_id = h.organization_id and w.home_id = h.id and w.state in ('submitted','assigned','acknowledged','in_progress','blocked','rework_required')) then 'open_work'
    else 'ready_for_review'
  end as readiness,
  (select count(*)::integer from public.work_items w where w.organization_id = h.organization_id and w.home_id = h.id and w.state not in ('draft','verified','cancelled')) as open_count
from public.homes h;
grant select on public.home_summary to authenticated;

create or replace view public.neighborhood_summary with (security_invoker = true) as
select n.*,
  (select count(*)::integer from public.homes h where h.organization_id = n.organization_id and h.neighborhood_id = n.id and h.archived_at is null) as home_count,
  (select count(*)::integer from public.work_items w where w.organization_id = n.organization_id and w.neighborhood_id = n.id and w.state not in ('draft','verified','cancelled')) as open_count,
  (select count(*)::integer from public.work_items w where w.organization_id = n.organization_id and w.neighborhood_id = n.id and w.due_at < now() and w.state not in ('draft','verified','cancelled')) as overdue_count
from public.neighborhoods n;
grant select on public.neighborhood_summary to authenticated;

create or replace view public.inspection_list with (security_invoker = true) as
select i.id, i.organization_id, i.neighborhood_id, i.home_id, i.type, i.status, i.scheduled_at,
  h.lot_code, h.address_line1, i.current_revision, i.updated_at, i.version
from public.inspections i
join public.homes h on h.organization_id = i.organization_id and h.id = i.home_id;
grant select on public.inspection_list to authenticated;

create or replace function public.get_dashboard_metrics(p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'open_count', count(*) filter (where state not in ('draft','verified','cancelled')),
    'overdue_count', count(*) filter (where due_at < now() and state not in ('draft','verified','cancelled')),
    'blocked_count', count(*) filter (where state = 'blocked'),
    'pending_verification_count', count(*) filter (where state = 'ready_for_verification'),
    'critical_count', count(*) filter (where priority = 'critical' and state not in ('draft','verified','cancelled'))
  ) from public.work_items where organization_id = p_organization_id;
$$;
grant execute on function public.get_dashboard_metrics(uuid) to authenticated;

create or replace function public.get_report_metrics(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare result jsonb;
begin
  if not private.active_member(p_organization_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select jsonb_build_object(
    'open_count', count(*) filter (where w.state not in ('draft','verified','cancelled')),
    'overdue_count', count(*) filter (where w.due_at < now() and w.state not in ('draft','verified','cancelled')),
    'acknowledgment_median_hours', coalesce((select round((percentile_cont(.5) within group (order by extract(epoch from (ae.acknowledged_at - ae.assigned_at))) / 3600)::numeric, 1) from public.assignment_episodes ae where ae.organization_id = p_organization_id and ae.acknowledged_at is not null), 0),
    'acknowledgment_sample', (select count(*) from public.assignment_episodes ae where ae.organization_id = p_organization_id and ae.acknowledged_at is not null),
    'first_pass_acceptance_pct', coalesce((select round(100.0 * count(*) filter (where v.decision = 'accepted') / nullif(count(*), 0), 1) from public.correction_attempts ca join public.verifications v on v.organization_id = ca.organization_id and v.correction_attempt_id = ca.id where ca.organization_id = p_organization_id and ca.attempt_number = 1), 0),
    'first_pass_sample', (select count(*) from public.correction_attempts ca join public.verifications v on v.organization_id = ca.organization_id and v.correction_attempt_id = ca.id where ca.organization_id = p_organization_id and ca.attempt_number = 1),
    'by_state', coalesce((select jsonb_agg(jsonb_build_object('label', replace(s.state::text, '_', ' '), 'value', s.total) order by s.state::text) from (select wi.state, count(*) total from public.work_items wi where wi.organization_id = p_organization_id group by wi.state) s), '[]'::jsonb),
    'timezone', (select timezone from public.organizations where id = p_organization_id)
  ) into result
  from public.work_items w where w.organization_id = p_organization_id;
  return result;
end;
$$;
grant execute on function public.get_report_metrics(uuid, jsonb) to authenticated;

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230005_commands.sql
-- ============================================================================

begin;

create or replace function private.command_error(
  p_operation_id uuid,
  p_code text,
  p_message text,
  p_retryable boolean default false,
  p_current_version bigint default null,
  p_field_errors jsonb default null
)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'ok', false,
    'operation_id', p_operation_id,
    'error', jsonb_build_object(
      'code', p_code,
      'message', p_message,
      'retryable', p_retryable,
      'current_version', p_current_version,
      'field_errors', p_field_errors
    )
  ));
$$;

create or replace function private.command_success(p_operation_id uuid, p_data jsonb, p_replayed boolean default false)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'server_time', now(),
    'replayed', p_replayed,
    'data', p_data
  );
$$;

create or replace function private.append_work_event(
  p_item public.work_items,
  p_event_type text,
  p_from_state public.work_state,
  p_to_state public.work_state,
  p_actor_id uuid,
  p_operation_id uuid,
  p_details jsonb default '{}'::jsonb,
  p_assignment_episode_id uuid default null,
  p_client_captured_at timestamptz default null
)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.work_events(
    organization_id, work_item_id, assignment_episode_id, event_type, from_state, to_state,
    actor_id, operation_id, details, client_captured_at
  ) values (
    p_item.organization_id, p_item.id, p_assignment_episode_id, p_event_type, p_from_state, p_to_state,
    p_actor_id, p_operation_id, p_details, p_client_captured_at
  );
$$;

create or replace function private.append_audit(
  p_organization_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_operation_id uuid,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.audit_events(
    organization_id, actor_id, event_type, entity_type, entity_id, operation_id, before_data, after_data, metadata
  ) values (
    p_organization_id, p_actor_id, p_event_type, p_entity_type, p_entity_id, p_operation_id,
    p_before, p_after, p_metadata
  );
$$;

create or replace function private.item_readiness_invalidate(p_item public.work_items, p_reason text, p_actor_id uuid, p_operation_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_item.home_id is null then return; end if;
  update public.milestone_approvals
    set invalidated_at = now(), invalidation_reason = p_reason
    where organization_id = p_item.organization_id and home_id = p_item.home_id and invalidated_at is null;
  if found then
    perform private.append_audit(p_item.organization_id, p_actor_id, 'milestone.invalidated', 'home', p_item.home_id, p_operation_id, null, null, jsonb_build_object('reason', p_reason));
  end if;
end;
$$;

create or replace function public.execute_command(p_command_name text, p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_operation_id uuid;
  v_expected_version bigint;
  v_captured_at timestamptz;
  v_payload jsonb := coalesce(p_envelope -> 'payload', '{}'::jsonb);
  v_request_hash text;
  v_organization_id uuid;
  v_item public.work_items%rowtype;
  v_item_before public.work_items%rowtype;
  v_episode public.assignment_episodes%rowtype;
  v_attempt public.correction_attempts%rowtype;
  v_inspection public.inspections%rowtype;
  v_old_state public.work_state;
  v_target_state public.work_state;
  v_result jsonb;
  v_existing private.client_operations%rowtype;
  v_id uuid;
  v_count integer;
  v_attempt_number integer;
  v_internal_user uuid;
  v_company_id uuid;
  v_technician_id uuid;
  v_specialty_id uuid;
  v_due_at timestamptz;
  v_decision text;
  v_method text;
  v_rows jsonb;
  v_row jsonb;
  v_row_result jsonb;
  v_row_results jsonb;
  v_row_index integer;
  v_success_count integer;
  v_row_id uuid;
begin
  if v_actor is null then
    return private.command_error(null, 'UNAUTHENTICATED', 'A valid authenticated session is required.');
  end if;

  begin
    v_operation_id := (p_envelope ->> 'operation_id')::uuid;
  exception when others then
    return private.command_error(null, 'VALIDATION_ERROR', 'operation_id must be a UUID.');
  end;
  if v_operation_id is null then
    return private.command_error(null, 'VALIDATION_ERROR', 'operation_id is required.');
  end if;
  begin
    v_expected_version := nullif(p_envelope ->> 'expected_version', '')::bigint;
    v_captured_at := nullif(p_envelope ->> 'captured_at', '')::timestamptz;
  exception when others then
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Invalid expected_version or captured_at.');
  end;

  if v_captured_at is not null and v_captured_at < now() - interval '90 days' then
    return private.command_error(v_operation_id, 'OPERATION_EXPIRED', 'Offline operation is older than the accepted retry window.');
  end if;

  begin
    if v_payload ? 'organization_id' then
      v_organization_id := (v_payload ->> 'organization_id')::uuid;
    elsif v_payload ? 'item_id' then
      select organization_id into v_organization_id from public.work_items where id = (v_payload ->> 'item_id')::uuid;
    elsif v_payload ? 'inspection_id' then
      select organization_id into v_organization_id from public.inspections where id = (v_payload ->> 'inspection_id')::uuid;
    elsif v_payload ? 'home_id' then
      select organization_id into v_organization_id from public.homes where id = (v_payload ->> 'home_id')::uuid;
    end if;
  exception when others then
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Invalid entity identifier.');
  end;

  if v_organization_id is null or not private.active_member(v_organization_id, v_actor) then
    return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested record was not found.');
  end if;

  v_request_hash := encode(extensions.digest((jsonb_build_object('command_name', p_command_name, 'envelope', p_envelope))::text, 'sha256'), 'hex');
  insert into private.client_operations(organization_id, user_id, operation_id, command_name, request_hash)
    values (v_organization_id, v_actor, v_operation_id, p_command_name, v_request_hash)
    on conflict (organization_id, user_id, operation_id) do nothing;

  select * into v_existing from private.client_operations
    where organization_id = v_organization_id and user_id = v_actor and operation_id = v_operation_id
    for update;
  if v_existing.request_hash <> v_request_hash or v_existing.command_name <> p_command_name then
    return private.command_error(v_operation_id, 'OPERATION_REUSE', 'This operation_id was already used with different input.');
  end if;
  if v_existing.created_at < now() - interval '90 days' then
    return private.command_error(v_operation_id, 'OPERATION_EXPIRED', 'The idempotency record has expired.');
  end if;
  if v_existing.result is not null then
    if not private.active_member(v_organization_id, v_actor) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested record was not found.');
    end if;
    return jsonb_set(v_existing.result, '{replayed}', 'true'::jsonb, true);
  end if;

  if p_command_name = 'create_work_item' then
    if not private.has_permission(v_organization_id, v_actor, 'work.create', (v_payload ->> 'neighborhood_id')::uuid, nullif(v_payload ->> 'home_id','')::uuid) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'You do not have permission to create work in this scope.');
    end if;
    v_id := coalesce(nullif(v_payload ->> 'id', '')::uuid, gen_random_uuid());
    insert into public.work_items(
      id, organization_id, neighborhood_id, home_id, location_id, common_area_location, inspection_id,
      origin, title, description, category_id, priority, safety_flag, created_by, client_captured_at
    ) values (
      v_id, v_organization_id, (v_payload ->> 'neighborhood_id')::uuid,
      nullif(v_payload ->> 'home_id','')::uuid, nullif(v_payload ->> 'location_id','')::uuid,
      nullif(trim(v_payload ->> 'common_area_location'), ''), nullif(v_payload ->> 'inspection_id','')::uuid,
      coalesce(v_payload ->> 'origin', 'internal_observation')::public.work_origin,
      trim(v_payload ->> 'title'), trim(v_payload ->> 'description'), nullif(v_payload ->> 'category_id','')::uuid,
      coalesce(v_payload ->> 'priority','normal')::public.work_priority, coalesce((v_payload ->> 'safety_flag')::boolean, false),
      v_actor, v_captured_at
    ) returning * into v_item;
    perform private.append_work_event(v_item, 'work.created', null, 'draft', v_actor, v_operation_id, '{}'::jsonb, null, v_captured_at);
    perform private.append_audit(v_organization_id, v_actor, 'work.created', 'work_item', v_item.id, v_operation_id, null, to_jsonb(v_item));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_item.id, 'version', v_item.version, 'state', v_item.state));

  elsif p_command_name in ('update_work_draft','submit_work_item','triage_work_item','assign_work_item','delegate_company_work','acknowledge_work','start_work','block_work','unblock_work','submit_correction','verify_correction','reopen_work','cancel_work','update_due_date','issue_evidence_exception') then
    select * into v_item from public.work_items where id = (v_payload ->> 'item_id')::uuid and organization_id = v_organization_id for update;
    if not found or not private.can_read_work(v_actor, v_item.id) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested work item was not found.');
    end if;
    if v_expected_version is null then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'expected_version is required.');
    end if;
    if v_expected_version <> v_item.version then
      return private.command_error(v_operation_id, 'VERSION_CONFLICT', 'The work item changed. Refresh before retrying.', false, v_item.version);
    end if;
    v_item_before := v_item;
    v_old_state := v_item.state;

    if p_command_name = 'update_work_draft' then
      if v_item.state <> 'draft' or not (v_item.created_by = v_actor or private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Only an authorized draft editor may change this item.');
      end if;
      update public.work_items set
        title = coalesce(nullif(trim(v_payload ->> 'title'), ''), title),
        description = coalesce(nullif(trim(v_payload ->> 'description'), ''), description),
        category_id = coalesce(nullif(v_payload ->> 'category_id','')::uuid, category_id),
        priority = coalesce(nullif(v_payload ->> 'priority','')::public.work_priority, priority),
        safety_flag = coalesce((v_payload ->> 'safety_flag')::boolean, safety_flag)
      where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.draft_updated', 'draft', 'draft', v_actor, v_operation_id);

    elsif p_command_name = 'submit_work_item' then
      if v_item.state <> 'draft' or not (v_item.created_by = v_actor or private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only an authorized draft can be submitted.');
      end if;
      if v_item.inspection_id is not null then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Inspection findings are submitted with their inspection.');
      end if;
      update public.work_items set state = 'submitted', submitted_at = now() where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.submitted', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, null, v_captured_at);
      perform private.item_readiness_invalidate(v_item, 'A new work item was submitted.', v_actor, v_operation_id);

    elsif p_command_name = 'triage_work_item' then
      if not private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Triage permission is required.');
      end if;
      update public.work_items set
        category_id = coalesce(nullif(v_payload ->> 'category_id','')::uuid, category_id),
        priority = coalesce(nullif(v_payload ->> 'priority','')::public.work_priority, priority)
      where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.triaged', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('notes', v_payload ->> 'notes'));

    elsif p_command_name = 'assign_work_item' then
      if not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Assignment permission is required.');
      end if;
      if v_item.state not in ('submitted','assigned','acknowledged','in_progress','blocked','rework_required') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This item cannot be assigned in its current state.');
      end if;
      v_internal_user := nullif(v_payload ->> 'accountable_internal_user_id','')::uuid;
      v_company_id := nullif(v_payload ->> 'company_id','')::uuid;
      v_technician_id := nullif(v_payload ->> 'technician_id','')::uuid;
      v_specialty_id := nullif(v_payload ->> 'specialty_id','')::uuid;
      v_due_at := nullif(v_payload ->> 'due_at','')::timestamptz;
      if (v_internal_user is not null)::int + (v_company_id is not null)::int <> 1 or v_due_at is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Exactly one accountable party and a due date are required.');
      end if;
      if v_internal_user is not null and not private.active_member(v_organization_id, v_internal_user) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The internal assignee is not an active organization member.');
      end if;
      if v_company_id is not null and not exists (
        select 1 from public.neighborhood_trade_rosters r where r.organization_id = v_organization_id
          and r.neighborhood_id = v_item.neighborhood_id and r.company_id = v_company_id
          and (v_specialty_id is null or r.specialty_id = v_specialty_id) and r.status = 'active'
          and r.active_from <= now() and (r.active_to is null or r.active_to > now())
      ) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The company is not actively rostered for this neighborhood and specialty.');
      end if;
      if v_technician_id is not null and not private.active_company_membership(v_organization_id, v_company_id, v_technician_id, 'technician') then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The technician is not an active member of the accountable company.');
      end if;
      update public.assignment_episodes set ended_at = now(), end_reason = 'reassigned', reassignment_reason = nullif(v_payload ->> 'reason','')
        where organization_id = v_organization_id and work_item_id = v_item.id and ended_at is null;
      update public.blocker_events set resolved_at = now(), resolved_by = v_actor, resolution = coalesce(v_payload ->> 'reason','Reassigned')
        where organization_id = v_organization_id and work_item_id = v_item.id and resolved_at is null;
      insert into public.assignment_episodes(
        organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id,
        assigned_by, due_at, reassignment_reason
      ) values (
        v_organization_id, v_item.id, v_internal_user, v_company_id, v_technician_id, v_specialty_id,
        v_actor, v_due_at, nullif(v_payload ->> 'reason','')
      ) returning * into v_episode;
      update public.work_items set current_assignment_id = v_episode.id, due_at = v_due_at, state = 'assigned', blocked_from_state = null, blocked_reason = null where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.assigned', v_old_state, v_item.state, v_actor, v_operation_id,
        jsonb_build_object('internal_assignee_user_id', v_internal_user, 'company_id', v_company_id, 'technician_id', v_technician_id, 'due_at', v_due_at, 'reason', v_payload ->> 'reason'), v_episode.id);
      if v_internal_user is not null then
        insert into public.notification_outbox(organization_id, recipient_user_id, work_item_id, assignment_episode_id, channel, dedupe_key, template_key, payload)
          values (v_organization_id, v_internal_user, v_item.id, v_episode.id, 'in_app', 'assignment:' || v_episode.id || ':in_app:' || v_internal_user, 'work_assigned', jsonb_build_object('work_item_id', v_item.id));
      end if;

    elsif p_command_name = 'delegate_company_work' then
      select * into v_episode from public.assignment_episodes where organization_id = v_organization_id and id = v_item.current_assignment_id and ended_at is null for update;
      if v_episode.company_id is null or not private.active_company_membership(v_organization_id, v_episode.company_id, v_actor, 'manager') then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Only an active manager of the accountable company may delegate.');
      end if;
      v_technician_id := nullif(v_payload ->> 'technician_id','')::uuid;
      if v_technician_id is not null and not private.active_company_membership(v_organization_id, v_episode.company_id, v_technician_id, 'technician') then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The technician does not belong to this company.');
      end if;
      update public.assignment_episodes set technician_user_id = v_technician_id where id = v_episode.id returning * into v_episode;
      update public.work_items set updated_at = now() where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.delegated', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('technician_id', v_technician_id), v_episode.id);

    elsif p_command_name = 'acknowledge_work' then
      if v_item.state <> 'assigned' or not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only the current accountable party may acknowledge assigned work.');
      end if;
      update public.assignment_episodes set acknowledged_at = coalesce(acknowledged_at, now()) where id = v_item.current_assignment_id returning * into v_episode;
      update public.work_items set state = 'acknowledged' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.acknowledged', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, v_episode.id, v_captured_at);

    elsif p_command_name = 'start_work' then
      if v_item.state not in ('acknowledged','rework_required') or not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only the current accountable party may start this work.');
      end if;
      update public.assignment_episodes set started_at = coalesce(started_at, now()) where id = v_item.current_assignment_id returning * into v_episode;
      update public.work_items set state = 'in_progress' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.started', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, v_episode.id, v_captured_at);

    elsif p_command_name = 'block_work' then
      if v_item.state not in ('assigned','acknowledged','in_progress','rework_required') or not (private.can_execute_work(v_actor, v_item.id) or private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This item cannot be blocked by the current user.');
      end if;
      if nullif(trim(v_payload ->> 'notes'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Blocker notes are required.');
      end if;
      insert into public.blocker_events(organization_id, work_item_id, assignment_episode_id, cause, notes, opened_by)
        values (v_organization_id, v_item.id, v_item.current_assignment_id, coalesce(v_payload ->> 'cause','other'), trim(v_payload ->> 'notes'), v_actor);
      update public.work_items set state = 'blocked', blocked_from_state = v_old_state, blocked_reason = trim(v_payload ->> 'notes') where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.blocked', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('cause', v_payload ->> 'cause', 'notes', v_payload ->> 'notes'), v_item.current_assignment_id, v_captured_at);

    elsif p_command_name = 'unblock_work' then
      if v_item.state <> 'blocked' or not (private.can_execute_work(v_actor, v_item.id) or private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This blocked item cannot be resumed by the current user.');
      end if;
      if nullif(trim(v_payload ->> 'resolution'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A blocker resolution is required.');
      end if;
      v_target_state := coalesce(v_item.blocked_from_state, 'assigned');
      update public.blocker_events set resolved_at = now(), resolved_by = v_actor, resolution = trim(v_payload ->> 'resolution')
        where organization_id = v_organization_id and work_item_id = v_item.id and resolved_at is null;
      update public.work_items set state = v_target_state, blocked_from_state = null, blocked_reason = null where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.unblocked', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('resolution', v_payload ->> 'resolution'), v_item.current_assignment_id);

    elsif p_command_name = 'submit_correction' then
      if v_item.state <> 'in_progress' or not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only the current accountable party may submit an in-progress correction.');
      end if;
      if nullif(trim(v_payload ->> 'note'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A completion note is required.');
      end if;
      select count(*) into v_count from public.attachments a
        where a.organization_id = v_organization_id and a.work_item_id = v_item.id and a.status = 'ready' and a.visibility = 'shared'
          and a.id in (select value::uuid from jsonb_array_elements_text(coalesce(v_payload -> 'attachment_ids','[]'::jsonb)));
      if v_count = 0 and nullif(v_payload ->> 'evidence_exception_id','') is null then
        return private.command_error(v_operation_id, 'EVIDENCE_NOT_READY', 'At least one ready shared evidence file or an approved exception is required.');
      end if;
      if nullif(v_payload ->> 'evidence_exception_id','') is not null and not exists (
        select 1 from public.evidence_exceptions ee where ee.id = (v_payload ->> 'evidence_exception_id')::uuid
          and ee.organization_id = v_organization_id and ee.work_item_id = v_item.id and ee.consumed_by_attempt_id is null
          and (ee.expires_at is null or ee.expires_at > now())
      ) then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'The evidence exception is unavailable or expired.');
      end if;
      select * into v_episode from public.assignment_episodes where id = v_item.current_assignment_id and organization_id = v_organization_id and ended_at is null for update;
      select coalesce(max(attempt_number),0) + 1 into v_attempt_number from public.correction_attempts where organization_id = v_organization_id and work_item_id = v_item.id;
      insert into public.correction_attempts(
        organization_id, work_item_id, assignment_episode_id, attempt_number, submitted_by, completion_note,
        evidence_exception_id, accountable_company_id, accountable_internal_user_id, technician_user_id
      ) values (
        v_organization_id, v_item.id, v_episode.id, v_attempt_number, v_actor, trim(v_payload ->> 'note'),
        nullif(v_payload ->> 'evidence_exception_id','')::uuid, v_episode.company_id, v_episode.internal_assignee_user_id, v_episode.technician_user_id
      ) returning * into v_attempt;
      update public.attachments set correction_attempt_id = v_attempt.id
        where organization_id = v_organization_id and work_item_id = v_item.id and status = 'ready'
          and id in (select value::uuid from jsonb_array_elements_text(coalesce(v_payload -> 'attachment_ids','[]'::jsonb)));
      update public.evidence_exceptions set consumed_by_attempt_id = v_attempt.id where id = v_attempt.evidence_exception_id;
      update public.work_items set state = 'ready_for_verification' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'correction.submitted', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('attempt_id', v_attempt.id, 'attempt_number', v_attempt.attempt_number), v_episode.id, v_captured_at);

    elsif p_command_name = 'verify_correction' then
      if v_item.state <> 'ready_for_verification' then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This item is not ready for verification.');
      end if;
      select ca.* into v_attempt from public.correction_attempts ca
        left join public.verifications v on v.organization_id = ca.organization_id and v.correction_attempt_id = ca.id
        where ca.organization_id = v_organization_id and ca.work_item_id = v_item.id and v.id is null
        order by ca.attempt_number desc limit 1 for update of ca;
      if not found or not private.can_verify(v_actor, v_attempt.id) then
        return private.command_error(v_operation_id, 'INDEPENDENCE_REQUIRED', 'Verification requires an eligible independent verifier.');
      end if;
      v_decision := v_payload ->> 'decision';
      v_method := v_payload ->> 'method';
      if v_decision not in ('accepted','rejected') or v_method not in ('on_site','remote') then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A valid decision and verification method are required.');
      end if;
      if v_item.safety_flag and v_method <> 'on_site' then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Safety-flagged work requires on-site verification.');
      end if;
      if v_decision = 'rejected' and nullif(trim(v_payload ->> 'notes'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A rejection reason is required.');
      end if;
      insert into public.verifications(organization_id, correction_attempt_id, decision, method, verified_by, notes)
        values (v_organization_id, v_attempt.id, v_decision, v_method, v_actor, nullif(trim(v_payload ->> 'notes'),''));
      if v_decision = 'accepted' then
        update public.assignment_episodes set ended_at = now(), end_reason = 'verified' where id = v_item.current_assignment_id;
        v_target_state := 'verified';
      else
        v_target_state := 'rework_required';
      end if;
      update public.work_items set state = v_target_state where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'correction.' || v_decision, v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('attempt_id', v_attempt.id, 'method', v_method, 'notes', v_payload ->> 'notes'), v_item.current_assignment_id);

    elsif p_command_name = 'reopen_work' then
      if v_item.state <> 'verified' or not private.has_permission(v_organization_id, v_actor, 'work.verify', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only an authorized verifier may reopen verified work.');
      end if;
      if nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A reopening reason is required.');
      end if;
      select * into v_episode from public.assignment_episodes where organization_id = v_organization_id and work_item_id = v_item.id order by assigned_at desc limit 1;
      if v_episode.company_id is not null and not exists (
        select 1 from public.neighborhood_trade_rosters r where r.organization_id = v_organization_id and r.neighborhood_id = v_item.neighborhood_id and r.company_id = v_episode.company_id and r.status = 'active'
      ) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The prior accountable company is no longer eligible; specify a replacement through assignment.');
      end if;
      if v_episode.internal_assignee_user_id is not null and not private.active_member(v_organization_id, v_episode.internal_assignee_user_id) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The prior internal assignee is no longer active.');
      end if;
      insert into public.assignment_episodes(organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id, assigned_by, due_at, reassignment_reason)
        values (v_organization_id, v_item.id, v_episode.internal_assignee_user_id, v_episode.company_id, v_episode.technician_user_id, v_episode.specialty_id, v_actor, coalesce(v_item.due_at, now() + interval '1 day'), 'Reopened: ' || trim(v_payload ->> 'reason'))
        returning * into v_episode;
      update public.work_items set state = 'rework_required', reopened_count = reopened_count + 1, current_assignment_id = v_episode.id where id = v_item.id returning * into v_item;
      perform private.item_readiness_invalidate(v_item, 'Verified work was reopened.', v_actor, v_operation_id);
      perform private.append_work_event(v_item, 'work.reopened', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('reason', v_payload ->> 'reason'), v_episode.id);

    elsif p_command_name = 'cancel_work' then
      if v_item.state = 'verified' or v_item.state = 'cancelled' then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Verified or cancelled work cannot be cancelled directly.');
      end if;
      if not ((v_item.state = 'draft' and v_item.created_by = v_actor) or private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Cancellation requires triage permission.');
      end if;
      if nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A cancellation reason is required.');
      end if;
      update public.assignment_episodes set ended_at = now(), end_reason = 'cancelled' where organization_id = v_organization_id and work_item_id = v_item.id and ended_at is null;
      update public.blocker_events set resolved_at = now(), resolved_by = v_actor, resolution = 'Cancelled' where organization_id = v_organization_id and work_item_id = v_item.id and resolved_at is null;
      update public.work_items set state = 'cancelled', duplicate_of_id = nullif(v_payload ->> 'duplicate_of_id','')::uuid, blocked_from_state = null, blocked_reason = null where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.cancelled', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('reason', v_payload ->> 'reason', 'duplicate_of_id', v_payload ->> 'duplicate_of_id'));

    elsif p_command_name = 'update_due_date' then
      if not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) or v_item.current_assignment_id is null then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Assignment permission and an active assignment are required.');
      end if;
      v_due_at := nullif(v_payload ->> 'new_due_at','')::timestamptz;
      if v_due_at is null or nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A new due date and reason are required.');
      end if;
      update public.assignment_episodes set due_at = v_due_at where id = v_item.current_assignment_id;
      update public.work_items set due_at = v_due_at where id = v_item.id returning * into v_item;
      update public.notification_outbox set status = 'cancelled', updated_at = now() where organization_id = v_organization_id and assignment_episode_id = v_item.current_assignment_id and status in ('pending','failed');
      perform private.append_work_event(v_item, 'work.due_date_changed', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('old_due_at', v_item_before.due_at, 'new_due_at', v_due_at, 'reason', v_payload ->> 'reason'), v_item.current_assignment_id);

    elsif p_command_name = 'issue_evidence_exception' then
      if not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Assignment permission is required to authorize an evidence exception.');
      end if;
      if nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'An exception reason is required.');
      end if;
      insert into public.evidence_exceptions(organization_id, work_item_id, authorized_by, reason, expires_at)
        values (v_organization_id, v_item.id, v_actor, trim(v_payload ->> 'reason'), nullif(v_payload ->> 'expires_at','')::timestamptz)
        returning id into v_id;
      update public.work_items set updated_at = now() where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'evidence.exception_issued', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('exception_id', v_id, 'reason', v_payload ->> 'reason'));
    end if;

    perform private.append_audit(v_organization_id, v_actor, p_command_name, 'work_item', v_item.id, v_operation_id, to_jsonb(v_item_before), to_jsonb(v_item));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_item.id, 'version', v_item.version, 'state', v_item.state, 'attempt_id', v_attempt.id));

  elsif p_command_name = 'add_comment' then
    select * into v_item from public.work_items where id = (v_payload ->> 'item_id')::uuid and organization_id = v_organization_id;
    if not found or not private.can_read_work(v_actor, v_item.id) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested work item was not found.');
    end if;
    if (v_payload ->> 'visibility') = 'internal' and not private.is_internal_member(v_organization_id, v_actor) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'External participants cannot create internal comments.');
    end if;
    insert into public.comments(organization_id, work_item_id, author_id, visibility, body)
      values (v_organization_id, v_item.id, v_actor, coalesce(v_payload ->> 'visibility','shared')::public.comment_visibility, trim(v_payload ->> 'body'))
      returning id into v_id;
    perform private.append_work_event(v_item, 'comment.added', v_item.state, v_item.state, v_actor, v_operation_id, jsonb_build_object('comment_id', v_id, 'visibility', v_payload ->> 'visibility'));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_id, 'work_item_id', v_item.id));

  elsif p_command_name = 'schedule_inspection' then
    select * into v_item from public.work_items where false;
    if not exists (
      select 1 from public.homes h where h.id = (v_payload ->> 'home_id')::uuid and h.organization_id = v_organization_id
        and private.has_permission(v_organization_id, v_actor, 'inspection.manage', h.neighborhood_id, h.id)
    ) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'Inspection management permission is required.');
    end if;
    select neighborhood_id into v_id from public.homes where organization_id = v_organization_id and id = (v_payload ->> 'home_id')::uuid;
    if not exists (
      select 1 from public.checklist_versions cv
      where cv.organization_id = v_organization_id and cv.id = (v_payload ->> 'template_version_id')::uuid and cv.published_at is not null
    ) then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A published checklist version is required.');
    end if;
    if not private.active_member(v_organization_id, (v_payload ->> 'lead_inspector_user_id')::uuid) or not (
      private.has_permission(v_organization_id, (v_payload ->> 'lead_inspector_user_id')::uuid, 'inspection.perform', v_id, (v_payload ->> 'home_id')::uuid)
      or private.has_permission(v_organization_id, (v_payload ->> 'lead_inspector_user_id')::uuid, 'inspection.manage', v_id, (v_payload ->> 'home_id')::uuid)
      or exists (
        select 1 from public.inspection_engagements ie
        where ie.organization_id = v_organization_id and ie.home_id = (v_payload ->> 'home_id')::uuid
          and ie.inspector_user_id = (v_payload ->> 'lead_inspector_user_id')::uuid
          and ie.starts_at <= now() and ie.ends_at > now() and ie.revoked_at is null
      )
    ) then
      return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The lead inspector is not eligible for this home.');
    end if;
    insert into public.inspections(organization_id, neighborhood_id, home_id, type, template_version_id, scheduled_at, lead_inspector_user_id)
      values (v_organization_id, v_id, (v_payload ->> 'home_id')::uuid, (v_payload ->> 'type')::public.inspection_type,
        (v_payload ->> 'template_version_id')::uuid, nullif(v_payload ->> 'scheduled_at','')::timestamptz, (v_payload ->> 'lead_inspector_user_id')::uuid)
      returning * into v_inspection;
    insert into public.inspection_participants(organization_id, inspection_id, user_id, can_edit_draft)
      values (v_organization_id, v_inspection.id, v_inspection.lead_inspector_user_id, true) on conflict do nothing;
    perform private.append_audit(v_organization_id, v_actor, 'inspection.scheduled', 'inspection', v_inspection.id, v_operation_id, null, to_jsonb(v_inspection));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status));

  elsif p_command_name in ('upsert_inspection_response','submit_inspection','begin_inspection_amendment','approve_milestone') then
    if p_command_name = 'approve_milestone' then
      select neighborhood_id into v_id from public.homes where id = (v_payload ->> 'home_id')::uuid and organization_id = v_organization_id;
      if v_id is null or not private.has_permission(v_organization_id, v_actor, 'milestone.approve', v_id, (v_payload ->> 'home_id')::uuid) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Milestone approval permission is required.');
      end if;
      perform 1 from public.homes where id = (v_payload ->> 'home_id')::uuid and organization_id = v_organization_id for update;
      if exists (select 1 from public.home_summary h where h.id = (v_payload ->> 'home_id')::uuid and h.readiness <> 'ready_for_review') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'The home is not ready for milestone review.');
      end if;
      insert into public.milestone_approvals(organization_id, home_id, milestone_code, approved_by, snapshot)
        values (v_organization_id, (v_payload ->> 'home_id')::uuid, v_payload ->> 'milestone_code', v_actor, jsonb_build_object('approved_at', now()))
        returning id into v_id;
      perform private.append_audit(v_organization_id, v_actor, 'milestone.approved', 'home', (v_payload ->> 'home_id')::uuid, v_operation_id, null, jsonb_build_object('approval_id', v_id));
      v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_id, 'status', 'approved'));
    else
      select * into v_inspection from public.inspections where id = (v_payload ->> 'inspection_id')::uuid and organization_id = v_organization_id for update;
      if not found or not private.can_read_inspection(v_actor, v_inspection.id) then
        return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested inspection was not found.');
      end if;
      if v_expected_version is null or v_expected_version <> v_inspection.version then
        return private.command_error(v_operation_id, 'VERSION_CONFLICT', 'The inspection changed. Refresh before retrying.', false, v_inspection.version);
      end if;
      if p_command_name = 'begin_inspection_amendment' then
        if not private.has_permission(v_organization_id, v_actor, 'inspection.manage', v_inspection.neighborhood_id, v_inspection.home_id) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'Inspection management permission is required to begin an amendment.');
        end if;
        if v_inspection.status <> 'submitted' then
          return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only a submitted inspection can be amended.');
        end if;
        update public.inspections set current_revision = current_revision + 1, status = 'amended' where id = v_inspection.id returning * into v_inspection;
        perform private.append_audit(v_organization_id, v_actor, 'inspection.amendment_started', 'inspection', v_inspection.id, v_operation_id, null, to_jsonb(v_inspection));
        v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status, 'revision', v_inspection.current_revision));
      elsif p_command_name = 'upsert_inspection_response' then
        if not (
          private.has_permission(v_organization_id, v_actor, 'inspection.perform', v_inspection.neighborhood_id, v_inspection.home_id)
          or private.has_permission(v_organization_id, v_actor, 'inspection.manage', v_inspection.neighborhood_id, v_inspection.home_id)
          or exists (select 1 from public.inspection_participants ip where ip.organization_id = v_organization_id and ip.inspection_id = v_inspection.id and ip.user_id = v_actor and ip.can_edit_draft)
        ) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'You cannot edit this inspection draft.');
        end if;
        if v_inspection.status not in ('draft','in_progress','amended') then
          return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Submitted inspection responses are immutable.');
        end if;
        insert into public.inspection_responses(organization_id, inspection_id, question_id, result, explanation, finding_work_item_id)
          values (v_organization_id, v_inspection.id, (v_payload ->> 'question_id')::uuid, (v_payload ->> 'response')::public.inspection_result,
            nullif(trim(v_payload ->> 'reason'),''), nullif(v_payload ->> 'finding_id','')::uuid)
          on conflict (organization_id, inspection_id, question_id) do update set result = excluded.result, explanation = excluded.explanation, finding_work_item_id = excluded.finding_work_item_id;
        update public.inspections set status = case when status = 'amended' then 'amended'::public.inspection_status else 'in_progress'::public.inspection_status end where id = v_inspection.id returning * into v_inspection;
        v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status));
      else
        if not (
          private.has_permission(v_organization_id, v_actor, 'inspection.perform', v_inspection.neighborhood_id, v_inspection.home_id)
          or private.has_permission(v_organization_id, v_actor, 'inspection.manage', v_inspection.neighborhood_id, v_inspection.home_id)
          or exists (select 1 from public.inspection_participants ip where ip.organization_id = v_organization_id and ip.inspection_id = v_inspection.id and ip.user_id = v_actor and ip.can_edit_draft)
        ) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'You cannot submit this inspection.');
        end if;
        if v_inspection.status not in ('draft','in_progress','amended') then
          return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This inspection cannot be submitted.');
        end if;
        if exists (
          select 1 from public.checklist_questions q
          where q.organization_id = v_organization_id and q.version_id = v_inspection.template_version_id and q.requires_response
            and not exists (select 1 from public.inspection_responses r where r.organization_id = v_organization_id and r.inspection_id = v_inspection.id and r.question_id = q.id)
        ) then
          return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Every required checklist question must have a response.');
        end if;
        update public.work_items set state = 'submitted', submitted_at = now()
          where organization_id = v_organization_id and inspection_id = v_inspection.id and state = 'draft';
        insert into public.inspection_submissions(organization_id, inspection_id, revision_number, snapshot, submitted_by)
          select v_organization_id, v_inspection.id, v_inspection.current_revision,
            jsonb_build_object(
              'inspection', to_jsonb(v_inspection),
              'responses', coalesce((select jsonb_agg(to_jsonb(r) order by q.ordinal) from public.inspection_responses r join public.checklist_questions q on q.organization_id = r.organization_id and q.id = r.question_id where r.organization_id = v_organization_id and r.inspection_id = v_inspection.id), '[]'::jsonb),
              'finding_ids', coalesce((select jsonb_agg(w.id) from public.work_items w where w.organization_id = v_organization_id and w.inspection_id = v_inspection.id), '[]'::jsonb),
              'attachment_ids', coalesce((select jsonb_agg(a.id) from public.attachments a where a.organization_id = v_organization_id and a.inspection_id = v_inspection.id and a.status = 'ready'), '[]'::jsonb)
            ), v_actor;
        update public.inspections set status = 'submitted' where id = v_inspection.id returning * into v_inspection;
        perform private.append_audit(v_organization_id, v_actor, 'inspection.submitted', 'inspection', v_inspection.id, v_operation_id, null, to_jsonb(v_inspection));
        v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status, 'revision', v_inspection.current_revision));
      end if;
    end if;
  elsif p_command_name = 'import_homes' then
    if not private.require_aal2() or not private.has_permission(v_organization_id, v_actor, 'structure.manage', null, null) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'Home import requires an aal2 administrator session.');
    end if;
    if not exists (select 1 from public.neighborhoods where organization_id = v_organization_id and id = (v_payload ->> 'neighborhood_id')::uuid) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The target neighborhood was not found.');
    end if;
    v_rows := coalesce(v_payload -> 'rows', '[]'::jsonb);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 or jsonb_array_length(v_rows) > 1000 then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Home import requires between 1 and 1000 rows.');
    end if;
    v_row_results := '[]'::jsonb;
    v_success_count := 0;
    for v_row, v_row_index in
      select value, (ordinality - 1)::integer from jsonb_array_elements(v_rows) with ordinality
    loop
      v_row_id := null;
      if nullif(trim(v_row ->> 'lot_code'), '') is null then
        v_row_result := jsonb_build_object('row', v_row_index, 'status', 'invalid', 'error', 'lot_code is required');
      elsif exists (
        select 1 from public.homes h where h.organization_id = v_organization_id
          and h.neighborhood_id = (v_payload ->> 'neighborhood_id')::uuid
          and lower(h.lot_code) = lower(trim(v_row ->> 'lot_code'))
      ) or (
        select count(*) from jsonb_array_elements(v_rows) candidate
        where lower(trim(candidate ->> 'lot_code')) = lower(trim(v_row ->> 'lot_code'))
      ) > 1 then
        v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'duplicate');
      elsif coalesce((v_payload ->> 'preview')::boolean, true) then
        v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'ready');
      else
        begin
          insert into public.homes(
            organization_id, neighborhood_id, lot_code, address_line1, address_line2, city, state_code,
            postal_code, phase, external_reference
          ) values (
            v_organization_id, (v_payload ->> 'neighborhood_id')::uuid, trim(v_row ->> 'lot_code'),
            nullif(trim(v_row ->> 'address_line1'), ''), nullif(trim(v_row ->> 'address_line2'), ''),
            nullif(trim(v_row ->> 'city'), ''), nullif(upper(trim(v_row ->> 'state_code')), ''),
            nullif(trim(v_row ->> 'postal_code'), ''), coalesce(nullif(trim(v_row ->> 'phase'), ''), 'planned'),
            nullif(trim(v_row ->> 'external_reference'), '')
          ) returning id into v_row_id;
          v_success_count := v_success_count + 1;
          v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'inserted', 'id', v_row_id);
          perform private.append_audit(v_organization_id, v_actor, 'home.imported', 'home', v_row_id, v_operation_id, null, v_row);
        exception when unique_violation or check_violation or foreign_key_violation then
          v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'invalid', 'error', 'The row failed validation.');
        end;
      end if;
      v_row_results := v_row_results || jsonb_build_array(v_row_result);
    end loop;
    v_result := private.command_success(v_operation_id, jsonb_build_object(
      'preview', coalesce((v_payload ->> 'preview')::boolean, true),
      'inserted_count', v_success_count,
      'rows', v_row_results
    ));

  elsif p_command_name = 'bulk_assign_work_items' then
    v_rows := coalesce(v_payload -> 'rows', '[]'::jsonb);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 or jsonb_array_length(v_rows) > 500 then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Bulk assignment requires between 1 and 500 rows.');
    end if;
    v_row_results := '[]'::jsonb;
    v_success_count := 0;
    for v_row, v_row_index in
      select value, (ordinality - 1)::integer from jsonb_array_elements(v_rows) with ordinality
    loop
      v_row_result := public.execute_command('assign_work_item', jsonb_build_object(
        'operation_id', gen_random_uuid(),
        'expected_version', v_row -> 'expected_version',
        'captured_at', coalesce(p_envelope -> 'captured_at', to_jsonb(now())),
        'payload', (v_row - 'expected_version') || jsonb_build_object('item_id', v_row ->> 'item_id')
      ));
      if coalesce((v_row_result ->> 'ok')::boolean, false) then v_success_count := v_success_count + 1; end if;
      v_row_results := v_row_results || jsonb_build_array(jsonb_build_object('row', v_row_index, 'item_id', v_row ->> 'item_id', 'result', v_row_result));
    end loop;
    v_result := private.command_success(v_operation_id, jsonb_build_object(
      'success_count', v_success_count,
      'failure_count', jsonb_array_length(v_rows) - v_success_count,
      'rows', v_row_results
    ));

  else
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Unknown command name.');
  end if;

  update private.client_operations set result = v_result where organization_id = v_organization_id and user_id = v_actor and operation_id = v_operation_id;
  return v_result;
exception
  when unique_violation then
    return private.command_error(v_operation_id, 'VERSION_CONFLICT', 'A concurrent operation changed this record. Refresh before retrying.', true);
  when check_violation or foreign_key_violation or not_null_violation or invalid_text_representation then
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'The command payload failed validation.');
end;
$$;

revoke all on function public.execute_command(text, jsonb) from public, anon;
grant execute on function public.execute_command(text, jsonb) to authenticated;

create or replace function public.update_my_profile(p_display_name text, p_preferred_locale text default 'en', p_timezone text default null)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'unauthenticated'; end if;
  insert into public.profiles(id, display_name, preferred_locale, timezone)
    values (auth.uid(), trim(p_display_name), p_preferred_locale, p_timezone)
    on conflict (id) do update set display_name = excluded.display_name, preferred_locale = excluded.preferred_locale, timezone = excluded.timezone, updated_at = now()
    returning * into result;
  return result;
end;
$$;
revoke all on function public.update_my_profile(text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text) to authenticated;

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230006_storage_and_workers.sql
-- ============================================================================

begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('evidence', 'evidence', false, 20971520, array['image/jpeg','image/png','image/heic','image/heif','application/pdf']),
  ('exports', 'exports', false, 52428800, array['text/csv','application/pdf','application/zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.request_attachment_slot(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_home_id uuid,
  p_work_item_id uuid,
  p_inspection_id uuid,
  p_comment_id uuid,
  p_visibility public.comment_visibility,
  p_original_name text,
  p_mime_type text,
  p_byte_size bigint,
  p_purpose text
)
returns public.attachments
language plpgsql security definer set search_path = '' as $$
declare
  v_result public.attachments;
  v_attachment_id uuid := gen_random_uuid();
  v_parent_count integer;
begin
  if auth.uid() is null or not private.active_member(p_organization_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_byte_size < 1 or p_byte_size > 20971520 then
    raise exception using errcode = '22023', message = 'file must be 20 MB or smaller';
  end if;
  if p_mime_type not in ('image/jpeg','image/png','image/heic','image/heif','application/pdf') then
    raise exception using errcode = '22023', message = 'unsupported file type';
  end if;
  if p_work_item_id is not null and not private.can_read_work(auth.uid(), p_work_item_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_inspection_id is not null and not private.can_read_inspection(auth.uid(), p_inspection_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_comment_id is not null and not exists (
    select 1 from public.comments c where c.organization_id = p_organization_id and c.id = p_comment_id and private.can_read_work(auth.uid(), c.work_item_id)
  ) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_visibility = 'internal' and not private.is_internal_member(p_organization_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'external participants cannot upload internal evidence';
  end if;
  select count(*) into v_parent_count from public.attachments a
    where a.organization_id = p_organization_id and a.status <> 'deleted'
      and (
        (p_work_item_id is not null and a.work_item_id = p_work_item_id)
        or (p_inspection_id is not null and a.inspection_id = p_inspection_id)
        or (p_comment_id is not null and a.comment_id = p_comment_id)
      );
  if v_parent_count >= 20 then
    raise exception using errcode = '23514', message = 'attachment quota reached';
  end if;
  insert into public.attachments(
    id, organization_id, neighborhood_id, home_id, work_item_id, inspection_id, comment_id,
    visibility, uploader_id, bucket, object_key, original_name, mime_type, byte_size, purpose
  ) values (
    v_attachment_id, p_organization_id, p_neighborhood_id, p_home_id, p_work_item_id, p_inspection_id, p_comment_id,
    p_visibility, auth.uid(), 'evidence', p_organization_id || '/' || v_attachment_id || '/original',
    regexp_replace(p_original_name, '[\\/\x00-\x1f]', '_', 'g'), p_mime_type, p_byte_size, p_purpose
  ) returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.request_attachment_slot(uuid,uuid,uuid,uuid,uuid,uuid,public.comment_visibility,text,text,bigint,text) from public, anon;
grant execute on function public.request_attachment_slot(uuid,uuid,uuid,uuid,uuid,uuid,public.comment_visibility,text,text,bigint,text) to authenticated;

create or replace function public.mark_attachment_quarantined(p_attachment_id uuid)
returns public.attachments language plpgsql security definer set search_path = '' as $$
declare result public.attachments;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.attachments set status = 'quarantined' where id = p_attachment_id and status = 'pending_upload' returning * into result;
  return result;
end;
$$;
revoke all on function public.mark_attachment_quarantined(uuid) from public, anon, authenticated;
grant execute on function public.mark_attachment_quarantined(uuid) to service_role;

create or replace function public.finalize_attachment_record(
  p_attachment_id uuid,
  p_sha256 text,
  p_actual_size bigint,
  p_actual_mime text,
  p_clean boolean,
  p_provider_reference text,
  p_derivative_object_key text default null,
  p_rejection_reason text default null
)
returns public.attachments language plpgsql security definer set search_path = '' as $$
declare result public.attachments;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.attachments set
    sha256 = p_sha256,
    byte_size = p_actual_size,
    mime_type = p_actual_mime,
    scan_provider = 'cloudmersive',
    scan_reference = p_provider_reference,
    derivative_object_key = p_derivative_object_key,
    status = case when p_clean then 'ready'::public.attachment_status else 'rejected'::public.attachment_status end,
    rejection_reason = case when p_clean then null else coalesce(p_rejection_reason, 'Content validation failed') end,
    ready_at = case when p_clean then now() else null end
  where id = p_attachment_id and status in ('pending_upload','quarantined')
  returning * into result;
  return result;
end;
$$;
revoke all on function public.finalize_attachment_record(uuid,text,bigint,text,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_attachment_record(uuid,text,bigint,text,boolean,text,text,text) to service_role;

create or replace function private.schedule_due_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer := 0;
begin
  insert into public.notification_outbox(
    organization_id, recipient_user_id, work_item_id, assignment_episode_id, channel,
    dedupe_key, template_key, payload, available_at
  )
  select ae.organization_id, recipient.user_id, ae.work_item_id, ae.id, channel.name,
    'due:' || ae.id || ':' || channel.name || ':' || recipient.user_id || ':' || to_char(ae.due_at, 'YYYYMMDDHH24MI'),
    'work_due', jsonb_build_object('work_item_id', ae.work_item_id, 'due_at', ae.due_at), now()
  from public.assignment_episodes ae
  join public.work_items w on w.organization_id = ae.organization_id and w.id = ae.work_item_id
  cross join lateral (
    select ae.internal_assignee_user_id as user_id where ae.internal_assignee_user_id is not null
    union
    select cm.user_id from public.company_memberships cm where cm.organization_id = ae.organization_id and cm.company_id = ae.company_id
      and cm.kind = 'manager' and cm.revoked_at is null and cm.active_from <= now() and (cm.active_to is null or cm.active_to > now())
  ) recipient
  cross join (values ('in_app'),('email')) as channel(name)
  where ae.ended_at is null and ae.due_at <= now() + interval '1 day'
    and w.state not in ('draft','verified','cancelled')
    and private.active_member(ae.organization_id, recipient.user_id)
  on conflict (organization_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.claim_notification_batch(p_limit integer, p_lease_token uuid)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  return query
  with claimable as (
    select id from public.notification_outbox
    where status in ('pending','failed','leased') and available_at <= now()
      and (leased_until is null or leased_until < now()) and attempts < max_attempts
    order by available_at, created_at
    for update skip locked limit greatest(1, least(p_limit, 100))
  )
  update public.notification_outbox o set status = 'leased', lease_token = p_lease_token,
    leased_until = now() + interval '2 minutes', attempts = attempts + 1, updated_at = now()
  from claimable c where o.id = c.id returning o.*;
end;
$$;
revoke all on function public.claim_notification_batch(integer,uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_batch(integer,uuid) to service_role;

create or replace function public.complete_notification(p_id uuid, p_lease_token uuid, p_provider_message_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.notification_outbox set status = 'sent', provider_message_id = p_provider_message_id,
    sent_at = now(), leased_until = null, lease_token = null, updated_at = now()
  where id = p_id and lease_token = p_lease_token and status = 'leased';
end;
$$;
revoke all on function public.complete_notification(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.complete_notification(uuid,uuid,text) to service_role;

create or replace function public.fail_notification(p_id uuid, p_lease_token uuid, p_error text, p_retryable boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.notification_outbox set
    status = case when not p_retryable or attempts >= max_attempts then 'dead'::public.notification_status else 'failed'::public.notification_status end,
    last_error = left(p_error, 1000),
    available_at = case when p_retryable then now() + (interval '1 minute' * power(2, least(attempts, 8))) else available_at end,
    leased_until = null, lease_token = null, updated_at = now()
  where id = p_id and lease_token = p_lease_token and status = 'leased';
end;
$$;
revoke all on function public.fail_notification(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.fail_notification(uuid,uuid,text,boolean) to service_role;

create or replace function private.cleanup_operational_artifacts()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op_count integer; attachment_count integer; export_count integer;
begin
  delete from private.client_operations where created_at < now() - interval '90 days';
  get diagnostics op_count = row_count;
  update public.attachments set status = 'deleted', rejection_reason = coalesce(rejection_reason, 'Orphaned upload expired')
    where status in ('pending_upload','quarantined') and created_at < now() - interval '24 hours'
      and correction_attempt_id is null;
  get diagnostics attachment_count = row_count;
  update public.export_jobs set status = 'expired', updated_at = now()
    where status = 'ready' and expires_at < now();
  get diagnostics export_count = row_count;
  return jsonb_build_object('operations_deleted', op_count, 'attachments_expired', attachment_count, 'exports_expired', export_count);
end;
$$;

do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.unschedule('buildtrack-notification-scheduler');
  exception when others then null;
  end;
  begin
    perform cron.schedule('buildtrack-notification-scheduler', '*/5 * * * *', 'select private.schedule_due_notifications()');
    perform cron.schedule('buildtrack-artifact-cleanup', '15 * * * *', 'select private.cleanup_operational_artifacts()');
  exception when others then null;
  end;
end $$;

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230007_onboarding_and_exports.sql
-- ============================================================================

begin;

create or replace function public.bootstrap_organization(p_name text, p_timezone text, p_admin_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare org_id uuid; calendar_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  insert into public.organizations(name, timezone) values (trim(p_name), p_timezone) returning id into org_id;
  insert into public.business_calendars(organization_id, name, timezone) values (org_id, 'Default business calendar', p_timezone) returning id into calendar_id;
  update public.organizations set default_calendar_id = calendar_id where id = org_id;
  insert into public.organization_memberships(organization_id, user_id, affiliation, status, joined_at)
    values (org_id, p_admin_user_id, 'internal', 'active', now());
  insert into public.role_assignments(organization_id, user_id, role_code, scope_kind, granted_by)
    values (org_id, p_admin_user_id, 'org_admin', 'organization', p_admin_user_id);
  insert into public.audit_events(organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (org_id, p_admin_user_id, 'organization.bootstrapped', 'organization', org_id, jsonb_build_object('controlled_operator', true));
  return org_id;
end;
$$;
revoke all on function public.bootstrap_organization(text,text,uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_organization(text,text,uuid) to service_role;

create or replace function public.admin_create_invitation(
  p_organization_id uuid,
  p_email text,
  p_affiliation public.affiliation_kind,
  p_grants jsonb,
  p_company_id uuid,
  p_company_kind text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.invites language plpgsql security definer set search_path = '' as $$
declare result public.invites;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '7 days 5 minutes' then
    raise exception using errcode = '22023', message = 'invitation expiry must be within seven days';
  end if;
  if jsonb_typeof(p_grants) <> 'array' then raise exception using errcode = '22023', message = 'grants must be an array'; end if;
  if p_company_id is not null and not exists (select 1 from public.companies c where c.organization_id = p_organization_id and c.id = p_company_id and c.status = 'active') then
    raise exception using errcode = '22023', message = 'company is unavailable';
  end if;
  insert into public.invites(
    organization_id, normalized_email, proposed_membership, proposed_grants, proposed_company_id,
    token_hash, expires_at, invited_by
  ) values (
    p_organization_id, lower(trim(p_email)), jsonb_build_object('affiliation', p_affiliation, 'company_kind', p_company_kind),
    p_grants, p_company_id, p_token_hash, p_expires_at, auth.uid()
  ) returning * into result;
  perform private.append_audit(p_organization_id, auth.uid(), 'invitation.created', 'invite', result.id, null, null, to_jsonb(result) - 'token_hash');
  return result;
end;
$$;
revoke all on function public.admin_create_invitation(uuid,text,public.affiliation_kind,jsonb,uuid,text,text,timestamptz) from public, anon;
grant execute on function public.admin_create_invitation(uuid,text,public.affiliation_kind,jsonb,uuid,text,text,timestamptz) to authenticated;

create or replace function public.accept_invitation(p_plaintext_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invitation public.invites%rowtype;
  user_email text;
  grant_row jsonb;
  membership_id uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'authenticated identity required'; end if;
  select lower(email) into user_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if user_email is null then raise exception using errcode = '42501', message = 'verified email required'; end if;
  select * into invitation from public.invites
    where token_hash = encode(extensions.digest(p_plaintext_token, 'sha256'), 'hex')
    for update;
  if not found or invitation.status <> 'pending' or invitation.expires_at <= now() then
    raise exception using errcode = '22023', message = 'invitation is invalid or expired';
  end if;
  if invitation.normalized_email <> user_email then
    raise exception using errcode = '42501', message = 'signed-in email does not match invitation';
  end if;
  insert into public.organization_memberships(organization_id, user_id, affiliation, status, joined_at)
    values (invitation.organization_id, auth.uid(), (invitation.proposed_membership ->> 'affiliation')::public.affiliation_kind, 'active', now())
    on conflict (organization_id, user_id) do update set status = 'active', affiliation = excluded.affiliation, joined_at = coalesce(public.organization_memberships.joined_at, now()), ended_at = null
    returning id into membership_id;
  for grant_row in select value from jsonb_array_elements(invitation.proposed_grants) loop
    if not exists (select 1 from public.roles r where r.code = grant_row ->> 'role_code' and (grant_row ->> 'scope_kind')::public.scope_kind = any(r.allowed_scope_kinds)) then
      raise exception using errcode = '22023', message = 'invitation contains an invalid role scope';
    end if;
    insert into public.role_assignments(
      organization_id, user_id, role_code, scope_kind, neighborhood_id, home_id, starts_at, ends_at, granted_by
    ) values (
      invitation.organization_id, auth.uid(), grant_row ->> 'role_code', (grant_row ->> 'scope_kind')::public.scope_kind,
      nullif(grant_row ->> 'neighborhood_id','')::uuid, nullif(grant_row ->> 'home_id','')::uuid,
      coalesce(nullif(grant_row ->> 'starts_at','')::timestamptz, now()), nullif(grant_row ->> 'ends_at','')::timestamptz,
      invitation.invited_by
    );
  end loop;
  if invitation.proposed_company_id is not null then
    insert into public.company_memberships(organization_id, company_id, user_id, kind)
      values (invitation.organization_id, invitation.proposed_company_id, auth.uid(), coalesce(invitation.proposed_membership ->> 'company_kind', 'technician'));
  end if;
  update public.invites set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = invitation.id;
  perform private.append_audit(invitation.organization_id, auth.uid(), 'invitation.accepted', 'invite', invitation.id, null, null, jsonb_build_object('membership_id', membership_id));
  return jsonb_build_object('organization_id', invitation.organization_id, 'membership_id', membership_id);
end;
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.admin_suspend_member(p_organization_id uuid, p_user_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare orphaned jsonb;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
  end if;
  if exists (
    select 1 from public.role_assignments ra where ra.organization_id = p_organization_id and ra.user_id = p_user_id and ra.role_code = 'org_admin'
      and ra.revoked_at is null and not exists (
        select 1 from public.role_assignments other
        join public.organization_memberships om on om.organization_id = other.organization_id and om.user_id = other.user_id and om.status = 'active'
        where other.organization_id = p_organization_id and other.user_id <> p_user_id and other.role_code = 'org_admin'
          and other.revoked_at is null and other.starts_at <= now() and (other.ends_at is null or other.ends_at > now())
      )
  ) then
    raise exception using errcode = '23514', message = 'cannot suspend the last active organization administrator';
  end if;
  update public.organization_memberships set status = 'suspended', ended_at = now() where organization_id = p_organization_id and user_id = p_user_id and status = 'active';
  if not found then raise exception using errcode = '02000', message = 'active membership not found'; end if;
  update public.role_assignments set revoked_at = now() where organization_id = p_organization_id and user_id = p_user_id and revoked_at is null;
  update public.company_memberships set revoked_at = now() where organization_id = p_organization_id and user_id = p_user_id and revoked_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('work_item_id', w.id, 'title', w.title)), '[]'::jsonb) into orphaned
  from public.work_items w join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id
  where w.organization_id = p_organization_id and ae.internal_assignee_user_id = p_user_id and ae.ended_at is null;
  perform private.append_audit(p_organization_id, auth.uid(), 'membership.suspended', 'user', p_user_id, null, null, jsonb_build_object('reason', p_reason, 'orphaned_work', orphaned));
  return jsonb_build_object('user_id', p_user_id, 'orphaned_work', orphaned);
end;
$$;
revoke all on function public.admin_suspend_member(uuid,uuid,text) from public, anon;
grant execute on function public.admin_suspend_member(uuid,uuid,text) to authenticated;

create or replace function public.create_export_job(p_organization_id uuid, p_export_kind text, p_filters jsonb)
returns public.export_jobs language plpgsql security definer set search_path = '' as $$
declare result public.export_jobs;
begin
  if not private.has_permission(p_organization_id, auth.uid(), 'report.read_scope', null, null) then
    raise exception using errcode = '42501', message = 'report permission required';
  end if;
  insert into public.export_jobs(organization_id, requested_by, export_kind, filters)
    values (p_organization_id, auth.uid(), p_export_kind, coalesce(p_filters, '{}'::jsonb)) returning * into result;
  return result;
end;
$$;
revoke all on function public.create_export_job(uuid,text,jsonb) from public, anon;
grant execute on function public.create_export_job(uuid,text,jsonb) to authenticated;

create or replace function public.complete_export_job(p_job_id uuid, p_status text, p_object_key text, p_row_count integer, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.export_jobs set status = p_status, object_key = p_object_key, row_count = p_row_count,
    error_message = p_error, expires_at = case when p_status = 'ready' then now() + interval '24 hours' else null end, updated_at = now()
  where id = p_job_id;
end;
$$;
revoke all on function public.complete_export_job(uuid,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.complete_export_job(uuid,text,text,integer,text) to service_role;

create or replace function public.participant_directory(p_organization_id uuid, p_neighborhood_id uuid default null)
returns table(user_id uuid, display_name text, affiliation public.affiliation_kind)
language sql stable security definer set search_path = '' as $$
  select distinct m.user_id, p.display_name, m.affiliation
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id and m.status = 'active'
    and private.active_member(p_organization_id, auth.uid())
    and (
      private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null)
      or exists (
        select 1 from public.role_assignments mine
        join public.role_assignments theirs on theirs.organization_id = mine.organization_id
        where mine.organization_id = p_organization_id and mine.user_id = auth.uid() and theirs.user_id = m.user_id
          and mine.revoked_at is null and theirs.revoked_at is null
          and (p_neighborhood_id is null or mine.scope_kind = 'organization' or mine.neighborhood_id = p_neighborhood_id)
          and (p_neighborhood_id is null or theirs.scope_kind = 'organization' or theirs.neighborhood_id = p_neighborhood_id)
      )
    );
$$;
revoke all on function public.participant_directory(uuid,uuid) from public, anon;
grant execute on function public.participant_directory(uuid,uuid) to authenticated;

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230008_worker_wrappers.sql
-- ============================================================================

begin;

create or replace function public.run_scheduled_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  return private.cleanup_operational_artifacts();
end;
$$;
revoke all on function public.run_scheduled_cleanup() from public, anon, authenticated;
grant execute on function public.run_scheduled_cleanup() to service_role;

create or replace function public.run_notification_scheduler()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  return private.schedule_due_notifications();
end;
$$;
revoke all on function public.run_notification_scheduler() from public, anon, authenticated;
grant execute on function public.run_notification_scheduler() to service_role;

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230009_fixed_authorization_catalog.sql
-- ============================================================================

begin;

-- Required application metadata, not development fixture data.
insert into public.permissions(code, description) values
  ('structure.manage','Manage divisions, neighborhoods, homes, locations, and milestones'),
  ('access.manage','Manage memberships, invitations, and scoped role grants'),
  ('roster.manage','Manage companies, specialties, and neighborhood rosters'),
  ('work.read_scope','Read authorized work within a granted scope'),
  ('work.create','Create field work and inspection findings'),
  ('work.triage','Classify, duplicate, and cancel work'),
  ('work.assign','Assign and reassign accountable parties and due dates'),
  ('work.execute_assigned','Act on work for which the user or company is accountable'),
  ('work.verify','Independently verify correction attempts'),
  ('inspection.manage','Schedule and administer inspections'),
  ('inspection.perform','Capture authorized inspection responses'),
  ('comment.internal','Read and create internal-only comments'),
  ('report.read_scope','Read scoped metrics and request exports'),
  ('audit.read_scope','Read scoped audit history'),
  ('config.manage','Manage calendars, notification rules, and checklist publication'),
  ('milestone.approve','Record operational milestone approval')
on conflict (code) do update set description = excluded.description;

insert into public.roles(code, label, allowed_scope_kinds, immutable_seed) values
  ('org_admin','Organization administrator','{organization}',true),
  ('area_manager','Area construction manager','{neighborhood,home}',true),
  ('superintendent','Superintendent','{neighborhood,home}',true),
  ('assistant_superintendent','Assistant superintendent','{neighborhood,home}',true),
  ('internal_quality','Internal quality inspector','{neighborhood,home}',true),
  ('external_inspector','External inspector','{neighborhood,home}',true),
  ('verifier','Independent verifier','{neighborhood,home}',true),
  ('trade_manager','Trade company manager','{neighborhood}',true),
  ('trade_technician','Trade technician','{neighborhood}',true),
  ('operations_coordinator','Operations coordinator','{neighborhood,home}',true),
  ('internal_contributor','Internal field contributor','{neighborhood,home}',true),
  ('leadership_viewer','Leadership viewer','{organization,neighborhood,home}',true),
  ('auditor','Auditor','{organization,neighborhood,home}',true)
on conflict (code) do update
set label = excluded.label,
    allowed_scope_kinds = excluded.allowed_scope_kinds,
    immutable_seed = true;

insert into public.role_permissions(role_code, permission_code) values
  ('org_admin','structure.manage'),('org_admin','access.manage'),('org_admin','roster.manage'),('org_admin','config.manage'),('org_admin','audit.read_scope'),
  ('area_manager','work.read_scope'),('area_manager','work.create'),('area_manager','work.triage'),('area_manager','work.assign'),('area_manager','work.verify'),('area_manager','inspection.manage'),('area_manager','comment.internal'),('area_manager','report.read_scope'),('area_manager','audit.read_scope'),('area_manager','milestone.approve'),
  ('superintendent','work.read_scope'),('superintendent','work.create'),('superintendent','work.triage'),('superintendent','work.assign'),('superintendent','work.execute_assigned'),('superintendent','work.verify'),('superintendent','inspection.manage'),('superintendent','comment.internal'),('superintendent','report.read_scope'),('superintendent','milestone.approve'),
  ('assistant_superintendent','work.read_scope'),('assistant_superintendent','work.create'),('assistant_superintendent','work.triage'),('assistant_superintendent','work.assign'),('assistant_superintendent','work.execute_assigned'),('assistant_superintendent','inspection.manage'),('assistant_superintendent','comment.internal'),
  ('internal_quality','work.read_scope'),('internal_quality','work.create'),('internal_quality','inspection.perform'),('internal_quality','comment.internal'),
  ('external_inspector','work.create'),('external_inspector','inspection.perform'),
  ('verifier','work.read_scope'),('verifier','work.verify'),
  ('trade_manager','work.execute_assigned'),
  ('trade_technician','work.execute_assigned'),
  ('operations_coordinator','work.read_scope'),('operations_coordinator','work.create'),('operations_coordinator','work.triage'),('operations_coordinator','work.assign'),('operations_coordinator','inspection.manage'),('operations_coordinator','comment.internal'),
  ('internal_contributor','work.read_scope'),('internal_contributor','work.create'),('internal_contributor','work.execute_assigned'),('internal_contributor','comment.internal'),
  ('leadership_viewer','work.read_scope'),('leadership_viewer','report.read_scope'),
  ('auditor','work.read_scope'),('auditor','report.read_scope'),('auditor','audit.read_scope')
on conflict do nothing;

commit;

-- ============================================================================
-- SOURCE: supabase/migrations/202610230010_service_role_backend_access.sql
-- ============================================================================

begin;

-- Edge Functions use the service role only for trusted server-side work.
-- RLS bypass does not itself confer table privileges, so grant the internal
-- role DML access without changing anon/authenticated client permissions.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

commit;

