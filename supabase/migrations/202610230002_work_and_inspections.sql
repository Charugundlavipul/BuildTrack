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
