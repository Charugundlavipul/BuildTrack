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
