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
