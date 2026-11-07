begin;

-- Platform access is provisioned by a trusted operator, never by a tenant role.
create table public.platform_administrators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.platform_audit_events (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
  organization_id uuid references public.organizations(id), action text not null,
  entity_id text, details jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.roles add column organization_id uuid references public.organizations(id),
  add column description text not null default '', add column active boolean not null default true,
  add column default_for_new_organizations boolean not null default true,
  add column requires_company boolean not null default false,
  add column version bigint not null default 1, add column updated_at timestamptz not null default now();
update public.roles set requires_company = true where code in ('trade_manager','trade_technician');
alter table public.organizations add column onboarding_status text not null default 'pending_admin'
  check (onboarding_status in ('pending_admin','ready'));
update public.organizations set onboarding_status = 'ready';
create table public.organization_roles (
  organization_id uuid not null references public.organizations(id),
  role_code text not null references public.roles(code), enabled boolean not null default true,
  updated_at timestamptz not null default now(), primary key (organization_id, role_code)
);
insert into public.organization_roles(organization_id,role_code)
  select o.id,r.code from public.organizations o cross join public.roles r;
update public.roles set default_for_new_organizations = code in
  ('org_admin','superintendent','internal_quality','trade_manager','trade_technician','leadership_viewer');
create table public.organization_onboarding (
  organization_id uuid primary key references public.organizations(id),
  request_id uuid unique not null, administrator_email text not null,
  administrator_role_code text not null references public.roles(code),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create function private.is_platform_admin(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.platform_administrators a join auth.users u on u.id=a.user_id where a.user_id=p_user_id and a.active and u.email_confirmed_at is not null);
$$;
create function private.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin(auth.uid()) or not private.require_aal2() then
    raise exception using errcode='42501',message='MFA-verified platform administrator access required';
  end if;
end; $$;
create function public.platform_access() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('administrator',private.is_platform_admin(auth.uid()),'verified',private.require_aal2());
$$;
create function private.role_enabled(p_organization_id uuid,p_role_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.roles r join public.organization_roles a on a.role_code=r.code
    where a.organization_id=p_organization_id and r.code=p_role_code and a.enabled and r.active
      and (r.organization_id is null or r.organization_id=p_organization_id));
$$;
create function private.role_grant_enabled(p_assignment public.role_assignments) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.role_enabled(p_assignment.organization_id,p_assignment.role_code) and exists(
    select 1 from public.roles r where r.code=p_assignment.role_code and p_assignment.scope_kind=any(r.allowed_scope_kinds)
      and (not r.requires_company or exists(select 1 from public.company_memberships cm
        where cm.organization_id=p_assignment.organization_id and cm.user_id=p_assignment.user_id and cm.revoked_at is null
          and cm.active_from<=now() and (cm.active_to is null or cm.active_to>now()))));
$$;

-- Role definitions and availability are read-only through ordinary table APIs.
alter table public.platform_administrators enable row level security;
alter table public.platform_audit_events enable row level security;
alter table public.organization_roles enable row level security;
alter table public.organization_onboarding enable row level security;
revoke all on public.platform_administrators,public.platform_audit_events,public.organization_roles,public.organization_onboarding from anon,authenticated;
grant select on public.organization_roles to authenticated;
create policy organization_role_read on public.organization_roles for select to authenticated
  using(private.active_member(organization_id,auth.uid()));
drop policy role_catalog_select on public.roles;
create policy role_catalog_select on public.roles for select to authenticated
  using(organization_id is null or private.active_member(organization_id,auth.uid()));
drop policy role_permission_catalog_select on public.role_permissions;
create policy role_permission_catalog_select on public.role_permissions for select to authenticated
  using(exists(select 1 from public.roles r where r.code=role_code));
grant all on public.platform_administrators,public.platform_audit_events,public.organization_roles,public.organization_onboarding to service_role;

create function private.populate_default_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_roles(organization_id,role_code)
    select new.id,code from public.roles where organization_id is null and active and default_for_new_organizations;
  return new;
end; $$;
create trigger organization_default_roles after insert on public.organizations for each row execute function private.populate_default_roles();

create function private.validate_role_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is null and (tg_op='INSERT' or (new.role_code,new.scope_kind,new.neighborhood_id,new.home_id,new.user_id,new.organization_id)
      is distinct from (old.role_code,old.scope_kind,old.neighborhood_id,old.home_id,old.user_id,old.organization_id)) then
    if not private.role_enabled(new.organization_id,new.role_code) or not exists(
      select 1 from public.roles r where r.code=new.role_code and new.scope_kind=any(r.allowed_scope_kinds)) then
      raise exception using errcode='22023',message='role is unavailable in this organization or does not allow this scope';
    end if;
  end if;
  return new;
end; $$;
create trigger role_assignment_catalog_guard before insert or update on public.role_assignments
  for each row execute function private.validate_role_assignment();

-- A deferred guard sees the complete handover transaction, not its intermediate revocations.
-- Organization row locks serialize competing attempts to remove the final administrator.
create function private.ensure_access_administrator(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare state text; ready text; has_administrator boolean;
begin
  select status::text,onboarding_status into state,ready from public.organizations where id=p_org for update;
  if not found then return; end if;
  select exists(select 1 from public.role_assignments ra
    join public.organization_memberships m on m.organization_id=ra.organization_id and m.user_id=ra.user_id
    join public.role_permissions rp on rp.role_code=ra.role_code and rp.permission_code='access.manage'
    where ra.organization_id=p_org and ra.scope_kind='organization' and ra.revoked_at is null
      and ra.starts_at<=now() and ra.ends_at is null and m.status='active' and m.ended_at is null
      and private.role_grant_enabled(ra)) into has_administrator;
  if ready='pending_admin' and has_administrator then
    update public.organizations set onboarding_status='ready' where id=p_org;
  elsif ready='ready' and state='active' and not has_administrator then
    raise exception using errcode='23514',message='retain at least one active organization-wide access administrator without an expiry before removing this access';
  end if;
end; $$;
create function private.guard_access_administrator() returns trigger
language plpgsql security definer set search_path = '' as $$
declare org uuid; codes text[];
begin
  if tg_table_name='roles' then
    codes:=array[coalesce(new.code,old.code)];
  elsif tg_table_name='role_permissions' then
    codes:=array[coalesce(new.role_code,old.role_code)];
  elsif tg_table_name='organizations' then
    perform private.ensure_access_administrator(coalesce(new.id,old.id)); return null;
  else
    perform private.ensure_access_administrator(coalesce(new.organization_id,old.organization_id)); return null;
  end if;
  for org in select distinct organization_id from public.role_assignments where role_code=any(codes) order by organization_id loop
    perform private.ensure_access_administrator(org);
  end loop;
  return null;
end; $$;
create constraint trigger preserve_access_admin after insert or update or delete on public.role_assignments
  deferrable initially deferred for each row execute function private.guard_access_administrator();
create constraint trigger preserve_access_admin after insert or update or delete on public.organization_memberships
  deferrable initially deferred for each row execute function private.guard_access_administrator();
create constraint trigger preserve_access_admin after insert or update or delete on public.organization_roles
  deferrable initially deferred for each row execute function private.guard_access_administrator();
create constraint trigger preserve_access_admin after insert or update or delete on public.role_permissions
  deferrable initially deferred for each row execute function private.guard_access_administrator();
create constraint trigger preserve_access_admin after update on public.roles
  deferrable initially deferred for each row execute function private.guard_access_administrator();
create constraint trigger preserve_access_admin after update on public.organizations
  deferrable initially deferred for each row execute function private.guard_access_administrator();

create function public.available_roles(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.active_member(p_organization_id,auth.uid()) then raise exception using errcode='42501',message='active organization membership required'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.label),'[]') from public.roles r where private.role_enabled(p_organization_id,r.code));
end; $$;

create function public.manage_role_catalog(p_organization_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_organization_id is null then perform private.require_platform_admin();
  elsif not private.is_platform_admin(auth.uid()) then
    if not private.has_permission(p_organization_id,auth.uid(),'access.manage',null,null) then raise exception using errcode='42501',message='organization access management permission required'; end if;
  else perform private.require_platform_admin(); end if;
  return jsonb_build_object('roles',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'enabled',case when p_organization_id is null then r.active else coalesce((select a.enabled from public.organization_roles a where a.organization_id=p_organization_id and a.role_code=r.code),false) end,
    'permissions',(select coalesce(jsonb_agg(permission_code order by permission_code),'[]') from public.role_permissions where role_code=r.code),
    'assignment_count',(select count(*) from public.role_assignments a where a.role_code=r.code and a.revoked_at is null and (p_organization_id is null or a.organization_id=p_organization_id))
  ) order by r.label),'[]') from public.roles r where (p_organization_id is null and r.organization_id is null) or
    (p_organization_id is not null and (r.organization_id is null or r.organization_id=p_organization_id))),
    'permissions',(select coalesce(jsonb_agg(to_jsonb(p) order by p.code),'[]') from public.permissions p));
end; $$;

create function public.save_role_definition(p_organization_id uuid,p_code text,p_label text,p_description text,
  p_scopes public.scope_kind[],p_permissions text[],p_active boolean,p_default boolean,p_requires_company boolean,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; previous public.roles; result public.roles;
begin
  if p_organization_id is null or private.is_platform_admin(auth.uid()) then perform private.require_platform_admin();
  else perform private.require_admin_permission(p_organization_id,'access.manage'); end if;
  if p_organization_id is not null then perform 1 from public.organizations where id=p_organization_id for update; end if;
  if length(trim(coalesce(p_label,''))) not between 2 and 120 or length(coalesce(p_description,''))>2000 or coalesce(cardinality(p_scopes),0)<1
    or coalesce(cardinality(p_permissions),0)<1 or cardinality(p_permissions)>30
    or exists(select 1 from unnest(p_permissions) v where not exists(select 1 from public.permissions where code=v)) then
    raise exception using errcode='22023',message='a role needs a name, valid scopes, and at least one catalog permission';
  end if;
  if p_permissions && array['structure.manage','access.manage','roster.manage','config.manage'] and
    (p_scopes<>array['organization']::public.scope_kind[] or p_requires_company) then
    raise exception using errcode='22023',message='administrative permissions require organization-only scope and cannot require a trade company';
  end if;
  if p_code is not null then
    select * into previous from public.roles where roles.code=p_code for update;
    if not found or previous.organization_id is distinct from p_organization_id then raise exception using errcode='42501',message='this role belongs to a different catalog'; end if;
    if previous.version is distinct from p_expected_version then raise exception using errcode='40001',message='role changed; reload before saving'; end if;
    if exists(select 1 from public.role_assignments where role_code=p_code and revoked_at is null and (ends_at is null or ends_at>now()) and not(scope_kind=any(p_scopes))) then
      raise exception using errcode='23514',message='reassign existing grants before removing their allowed scope';
    end if;
    v_code:=p_code;
    update public.roles r set label=trim(p_label),description=trim(p_description),allowed_scope_kinds=p_scopes,
      active=p_active,default_for_new_organizations=(p_organization_id is null and p_default),requires_company=p_requires_company,
      version=r.version+1,updated_at=now() where r.code=p_code returning * into result;
    delete from public.role_permissions where role_code=p_code;
  else
    v_code:='custom_'||replace(gen_random_uuid()::text,'-','');
    insert into public.roles(code,label,description,allowed_scope_kinds,organization_id,active,default_for_new_organizations,requires_company,immutable_seed)
      values(v_code,trim(p_label),trim(p_description),p_scopes,p_organization_id,p_active,p_organization_id is null and p_default,p_requires_company,false) returning * into result;
    if p_organization_id is not null then insert into public.organization_roles(organization_id,role_code) values(p_organization_id,v_code); end if;
  end if;
  insert into public.role_permissions(role_code,permission_code) select v_code,v from (select distinct unnest(p_permissions) v) p;
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details)
    values(auth.uid(),p_organization_id,'role.saved',v_code,jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(result),'permissions',p_permissions));
  if p_organization_id is not null then perform private.append_audit(p_organization_id,auth.uid(),'role.saved','role',null,null,to_jsonb(previous),to_jsonb(result),jsonb_build_object('code',v_code,'permissions',p_permissions)); end if;
  return to_jsonb(result);
end; $$;

create function public.set_organization_role(p_organization_id uuid,p_role_code text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_platform_admin(auth.uid()) then perform private.require_platform_admin();
  else perform private.require_admin_permission(p_organization_id,'access.manage'); end if;
  perform 1 from public.organizations where id=p_organization_id for update;
  if not exists(select 1 from public.roles where code=p_role_code and (organization_id is null or organization_id=p_organization_id) and (active or not p_enabled)) then
    raise exception using errcode='22023',message='role is unavailable for this organization';
  end if;
  insert into public.organization_roles(organization_id,role_code,enabled) values(p_organization_id,p_role_code,p_enabled)
    on conflict(organization_id,role_code) do update set enabled=excluded.enabled,updated_at=now();
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details)
    values(auth.uid(),p_organization_id,'organization.role_availability_changed',p_role_code,jsonb_build_object('enabled',p_enabled));
  perform private.append_audit(p_organization_id,auth.uid(),'role.availability_changed','role',null,null,null,null,jsonb_build_object('code',p_role_code,'enabled',p_enabled));
  return jsonb_build_object('role_code',p_role_code,'enabled',p_enabled);
end; $$;

revoke all on function public.platform_access(), public.available_roles(uuid), public.manage_role_catalog(uuid),
  public.save_role_definition(uuid,text,text,text,public.scope_kind[],text[],boolean,boolean,boolean,bigint), public.set_organization_role(uuid,text,boolean) from public,anon;
grant execute on function public.platform_access(), public.available_roles(uuid), public.manage_role_catalog(uuid),
  public.save_role_definition(uuid,text,text,text,public.scope_kind[],text[],boolean,boolean,boolean,bigint), public.set_organization_role(uuid,text,boolean) to authenticated;

commit;
