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
