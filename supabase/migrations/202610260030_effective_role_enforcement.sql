begin;

-- Keep every authorization surface consistent with organization role availability.

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
    where private.role_grant_enabled(ra) and ra.organization_id = p_organization_id
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
    where private.role_grant_enabled(ra) and ra.organization_id = p_organization_id and ra.user_id = p_user_id
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
    where private.role_grant_enabled(ra) and ra.organization_id = p_organization_id and ra.user_id = p_user_id
      and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now()) and ra.revoked_at is null
  );
$$;

create or replace function public.current_access(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.active_member(p_organization_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'active membership required';
  end if;
  select jsonb_build_object(
    'organization_id', p_organization_id,
    'user_id', auth.uid(),
    'membership', jsonb_build_object('affiliation', m.affiliation, 'status', m.status),
    'profile', jsonb_build_object('display_name', p.display_name, 'preferred_locale', p.preferred_locale, 'timezone', p.timezone),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ra.id,
        'role_code', ra.role_code,
        'role_label', (select label from public.roles where code=ra.role_code),
        'scope_kind', ra.scope_kind,
        'neighborhood_id', ra.neighborhood_id,
        'home_id', ra.home_id,
        'starts_at', ra.starts_at,
        'ends_at', ra.ends_at
      ) order by ra.role_code, ra.scope_kind, ra.neighborhood_id, ra.home_id)
      from public.role_assignments ra
      where ra.organization_id = p_organization_id and ra.user_id = auth.uid()
        and private.role_grant_enabled(ra) and ra.revoked_at is null and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now())
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(permission_code order by permission_code)
      from (
        select distinct rp.permission_code
        from public.role_assignments ra
        join public.role_permissions rp on rp.role_code = ra.role_code
        where ra.organization_id = p_organization_id and ra.user_id = auth.uid()
          and private.role_grant_enabled(ra) and ra.revoked_at is null and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now())
      ) permissions
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object('company_id', cm.company_id, 'kind', cm.kind) order by cm.company_id)
      from public.company_memberships cm
      where cm.organization_id = p_organization_id and cm.user_id = auth.uid()
        and cm.revoked_at is null and cm.active_from <= now() and (cm.active_to is null or cm.active_to > now())
    ), '[]'::jsonb)
  ) into result
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active';
  return result;
end;
$$;

create or replace function public.admin_set_member_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_affiliation public.affiliation_kind,
  p_assignments jsonb,
  p_company_id uuid default null,
  p_company_kind text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  assignment jsonb;
  role_row public.roles%rowtype;
  v_role_code text;
  v_requested_scope public.scope_kind;
  v_neighborhood_id uuid;
  v_home_id uuid;
  previous_access jsonb;
  new_access jsonb;
  retains_org_admin boolean := false;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) < 1 or jsonb_array_length(p_assignments) > 20 then
    raise exception using errcode = '22023', message = 'one to twenty role assignments are required';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception using errcode = '22023', message = 'identity does not exist'; end if;
  if p_company_id is not null then
    if p_company_kind not in ('manager','technician') then raise exception using errcode = '22023', message = 'company kind must be manager or technician'; end if;
    if not exists (select 1 from public.companies c where c.organization_id = p_organization_id and c.id = p_company_id and c.status = 'active') then raise exception using errcode = '22023', message = 'company is unavailable'; end if;
  elsif p_company_kind is not null then raise exception using errcode = '22023', message = 'company is required for company kind';
  end if;

  select jsonb_build_object(
    'membership', to_jsonb(m),
    'roles', coalesce((select jsonb_agg(to_jsonb(ra)) from public.role_assignments ra where ra.organization_id=p_organization_id and ra.user_id=p_user_id and ra.revoked_at is null),'[]'::jsonb),
    'companies', coalesce((select jsonb_agg(to_jsonb(cm)) from public.company_memberships cm where cm.organization_id=p_organization_id and cm.user_id=p_user_id and cm.revoked_at is null),'[]'::jsonb)
  ) into previous_access from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id;

  insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
    values(p_organization_id,p_user_id,p_affiliation,'active',now())
    on conflict(organization_id,user_id) do update set affiliation=excluded.affiliation,status='active',joined_at=coalesce(public.organization_memberships.joined_at,now()),ended_at=null;

  for assignment in select value from jsonb_array_elements(p_assignments) loop
    v_role_code:=nullif(assignment->>'role_code','');
    v_requested_scope:=nullif(assignment->>'scope_kind','')::public.scope_kind;
    v_neighborhood_id:=nullif(assignment->>'neighborhood_id','')::uuid;
    v_home_id:=nullif(assignment->>'home_id','')::uuid;
    select * into role_row from public.roles r where r.code=v_role_code and private.role_enabled(p_organization_id,r.code);
    if not found or v_requested_scope is null or not(v_requested_scope=any(role_row.allowed_scope_kinds)) then raise exception using errcode='22023',message='role and scope are incompatible'; end if;
    if (v_requested_scope='organization' and (v_neighborhood_id is not null or v_home_id is not null))
      or (v_requested_scope='neighborhood' and (v_neighborhood_id is null or v_home_id is not null))
      or (v_requested_scope='home' and (v_neighborhood_id is null or v_home_id is null)) then raise exception using errcode='22023',message='invalid role scope identifiers'; end if;
    if v_neighborhood_id is not null and not exists(select 1 from public.neighborhoods n where n.organization_id=p_organization_id and n.id=v_neighborhood_id and n.status='active') then raise exception using errcode='22023',message='neighborhood is unavailable'; end if;
    if v_home_id is not null and not exists(select 1 from public.homes h where h.organization_id=p_organization_id and h.neighborhood_id=v_neighborhood_id and h.id=v_home_id and h.archived_at is null) then raise exception using errcode='22023',message='home is unavailable'; end if;
    if role_row.requires_company and p_company_id is null then raise exception using errcode='22023',message='trade roles require a company association'; end if;
    if v_role_code='org_admin' and v_requested_scope='organization' then retains_org_admin:=true; end if;
  end loop;

  update public.role_assignments set revoked_at=now() where organization_id=p_organization_id and user_id=p_user_id and revoked_at is null;
  update public.company_memberships set revoked_at=now() where organization_id=p_organization_id and user_id=p_user_id and revoked_at is null;
  for assignment in select value from jsonb_array_elements(p_assignments) loop
    insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,home_id,starts_at,ends_at,granted_by)
    values(p_organization_id,p_user_id,assignment->>'role_code',(assignment->>'scope_kind')::public.scope_kind,nullif(assignment->>'neighborhood_id','')::uuid,nullif(assignment->>'home_id','')::uuid,coalesce(nullif(assignment->>'starts_at','')::timestamptz,now()),nullif(assignment->>'ends_at','')::timestamptz,auth.uid());
  end loop;
  if p_company_id is not null then insert into public.company_memberships(organization_id,company_id,user_id,kind) values(p_organization_id,p_company_id,p_user_id,p_company_kind); end if;

  select jsonb_build_object(
    'membership',to_jsonb(m),
    'roles',coalesce((select jsonb_agg(to_jsonb(ra)) from public.role_assignments ra where ra.organization_id=p_organization_id and ra.user_id=p_user_id and ra.revoked_at is null),'[]'::jsonb),
    'companies',coalesce((select jsonb_agg(to_jsonb(cm)) from public.company_memberships cm where cm.organization_id=p_organization_id and cm.user_id=p_user_id and cm.revoked_at is null),'[]'::jsonb)
  ) into new_access from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id;
  perform private.append_audit(p_organization_id,auth.uid(),'membership.access_changed','user',p_user_id,null,previous_access,new_access);
  return new_access;
end; $$;

create or replace function public.admin_suspend_member(p_organization_id uuid, p_user_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare orphaned jsonb;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
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

create or replace function public.bootstrap_organization(p_name text, p_timezone text, p_admin_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare org_id uuid; calendar_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  insert into public.organizations(name, timezone) values (trim(p_name), p_timezone) returning id into org_id;
  insert into public.organization_roles(organization_id,role_code,enabled) values(org_id,'org_admin',true) on conflict(organization_id,role_code) do update set enabled=true;
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

create or replace function public.admin_list_members(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'access management permission required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'email', u.email,
    'display_name', p.display_name,
    'affiliation', m.affiliation,
    'status', m.status,
    'joined_at', m.joined_at,
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ra.id,
        'role_code', ra.role_code,
        'role_label', (select label from public.roles where code=ra.role_code),
        'scope_kind', ra.scope_kind,
        'neighborhood_id', ra.neighborhood_id,
        'home_id', ra.home_id,
        'starts_at', ra.starts_at,
        'ends_at', ra.ends_at
      ) order by ra.role_code, ra.scope_kind)
      from public.role_assignments ra
      where ra.organization_id = m.organization_id and ra.user_id = m.user_id and ra.revoked_at is null
        and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now())
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object('company_id', cm.company_id, 'company_name', c.name, 'kind', cm.kind))
      from public.company_memberships cm
      join public.companies c on c.organization_id = cm.organization_id and c.id = cm.company_id
      where cm.organization_id = m.organization_id and cm.user_id = m.user_id and cm.revoked_at is null
        and cm.active_from <= now() and (cm.active_to is null or cm.active_to > now())
    ), '[]'::jsonb)
  ) order by p.display_name, u.email), '[]'::jsonb) into result
  from public.organization_memberships m
  join auth.users u on u.id = m.user_id
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id;
  return result;
end;
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
        (w.state = 'draft' and w.created_by = p_user_id and private.has_permission(w.organization_id,p_user_id,'work.create',w.neighborhood_id,w.home_id))
        or private.has_permission(w.organization_id, p_user_id, 'work.read_scope', w.neighborhood_id, w.home_id)
        or private.has_permission(w.organization_id, p_user_id, 'work.verify', w.neighborhood_id, w.home_id)
        or (ae.internal_assignee_user_id = p_user_id and private.has_permission(w.organization_id,p_user_id,'work.execute_assigned',w.neighborhood_id,w.home_id))
        or (ae.company_id is not null and private.active_company_membership(w.organization_id, ae.company_id, p_user_id, 'manager') and private.has_permission(w.organization_id,p_user_id,'work.execute_assigned',w.neighborhood_id,w.home_id))
        or (ae.technician_user_id = p_user_id and private.active_company_membership(w.organization_id, ae.company_id, p_user_id, 'technician') and private.has_permission(w.organization_id,p_user_id,'work.execute_assigned',w.neighborhood_id,w.home_id))
        or exists (
          select 1 from public.inspection_participants ip
          join public.inspections i on i.organization_id = ip.organization_id and i.id = ip.inspection_id
          where w.inspection_id = i.id and ip.user_id = p_user_id and (private.has_permission(w.organization_id,p_user_id,'inspection.perform',w.neighborhood_id,w.home_id) or private.has_permission(w.organization_id,p_user_id,'inspection.manage',w.neighborhood_id,w.home_id))
        )
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
        or exists (select 1 from public.inspection_participants ip where ip.organization_id = i.organization_id and ip.inspection_id = i.id and ip.user_id = p_user_id and private.has_permission(i.organization_id,p_user_id,'inspection.perform',i.neighborhood_id,i.home_id))
        or exists (
          select 1 from public.inspection_engagements ie
          where ie.organization_id = i.organization_id and ie.home_id = i.home_id and ie.inspector_user_id = p_user_id
            and private.has_permission(i.organization_id,p_user_id,'inspection.perform',i.neighborhood_id,i.home_id) and ie.starts_at <= now() and ie.ends_at > now() and ie.revoked_at is null
        )
      )
  );
$$;

commit;
