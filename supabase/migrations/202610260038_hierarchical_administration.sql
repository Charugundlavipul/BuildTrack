begin;

alter table public.role_assignments
  add column division_id uuid,
  add column company_id uuid,
  add column authority_level smallint not null default 1 check(authority_level between 1 and 4),
  add foreign key(organization_id,division_id) references public.divisions(organization_id,id),
  add foreign key(organization_id,company_id) references public.companies(organization_id,id);
alter table public.role_assignments drop constraint role_assignments_check;
alter table public.role_assignments add constraint role_assignment_scope_identifiers check(
  (scope_kind='organization' and division_id is null and neighborhood_id is null and home_id is null and company_id is null) or
  (scope_kind='division' and division_id is not null and neighborhood_id is null and home_id is null and company_id is null) or
  (scope_kind='neighborhood' and division_id is null and neighborhood_id is not null and home_id is null) or
  (scope_kind='home' and division_id is null and neighborhood_id is not null and home_id is not null) or
  (scope_kind='company' and company_id is not null and division_id is null and neighborhood_id is null and home_id is null)
);
create index role_assignments_division on public.role_assignments(organization_id,division_id) where revoked_at is null;

alter table public.companies
  add column owner_scope_kind public.scope_kind not null default 'organization',
  add column owner_division_id uuid,
  add column owner_neighborhood_id uuid,
  add column owner_authority_level smallint not null default 1 check(owner_authority_level between 1 and 3),
  add column created_by uuid references auth.users(id),
  add foreign key(organization_id,owner_division_id) references public.divisions(organization_id,id),
  add foreign key(organization_id,owner_neighborhood_id) references public.neighborhoods(organization_id,id),
  add constraint company_owner_scope check(
    (owner_scope_kind='organization' and owner_division_id is null and owner_neighborhood_id is null) or
    (owner_scope_kind='division' and owner_division_id is not null and owner_neighborhood_id is null) or
    (owner_scope_kind='neighborhood' and owner_division_id is null and owner_neighborhood_id is not null));
create table public.company_access_grants(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id), company_id uuid not null,
  scope_kind public.scope_kind not null, division_id uuid, neighborhood_id uuid,
  authority_level smallint not null check(authority_level between 1 and 3),
  granted_by uuid references auth.users(id), created_at timestamptz not null default now(), revoked_at timestamptz,
  revocation_level smallint check(revocation_level between 1 and 3), revoked_by uuid references auth.users(id),
  foreign key(organization_id,company_id) references public.companies(organization_id,id),
  foreign key(organization_id,division_id) references public.divisions(organization_id,id),
  foreign key(organization_id,neighborhood_id) references public.neighborhoods(organization_id,id),
  check((scope_kind='organization' and division_id is null and neighborhood_id is null) or
    (scope_kind='division' and division_id is not null and neighborhood_id is null) or
    (scope_kind='neighborhood' and division_id is null and neighborhood_id is not null))
);
create unique index company_access_current on public.company_access_grants(organization_id,company_id,scope_kind,coalesce(division_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(neighborhood_id,'00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
insert into public.company_access_grants(organization_id,company_id,scope_kind,authority_level)
  select organization_id,id,'organization',1 from public.companies;
alter table public.company_memberships add column granted_by uuid references auth.users(id),
  add column authority_level smallint not null default 1 check(authority_level between 1 and 4);
alter table public.neighborhood_trade_rosters add column granted_by uuid references auth.users(id),
  add column authority_level smallint not null default 1 check(authority_level between 1 and 3);
alter table public.invites add column authority_level smallint not null default 1 check(authority_level between 1 and 4);

insert into public.permissions(code,description) values('company.users.manage','Manage users of an authorized vendor company');
insert into public.roles(code,label,allowed_scope_kinds,description,requires_company,default_for_new_organizations) values
  ('division_admin','Division admin','{division}','Manage users, neighborhoods, homes, vendors, and operations inside assigned divisions.',false,true),
  ('neighborhood_admin','Neighborhood admin','{neighborhood}','Manage local users, homes, vendors, and operations inside assigned neighborhoods.',false,true),
  ('vendor_admin','Vendor admin','{company,neighborhood}','Manage users and assigned work of the linked vendor company.',true,true);
insert into public.role_permissions(role_code,permission_code)
  select 'org_admin',code from public.permissions on conflict do nothing;
insert into public.role_permissions(role_code,permission_code)
  select r,code from unnest(array['division_admin','neighborhood_admin']) r cross join public.permissions
  where code not in ('config.manage','company.users.manage');
insert into public.role_permissions(role_code,permission_code) values
  ('vendor_admin','company.users.manage'),('vendor_admin','work.execute_assigned'),('vendor_admin','comment.create_shared'),('vendor_admin','evidence.upload');
insert into public.organization_roles(organization_id,role_code,enabled)
  select o.id,r,true from public.organizations o cross join unnest(array['division_admin','neighborhood_admin','vendor_admin']) r;
update public.roles set label=case code when 'org_admin' then 'Organization admin' when 'superintendent' then 'Field manager'
  when 'operations_coordinator' then 'Field coordinator' when 'internal_contributor' then 'Field contributor'
  when 'internal_quality' then 'Internal inspector' when 'trade_technician' then 'Vendor technician'
  when 'leadership_viewer' then 'Viewer' else label end,version=version+1,updated_at=now();
update public.roles set allowed_scope_kinds=array_append(allowed_scope_kinds,'division'::public.scope_kind)
  where code in ('superintendent','operations_coordinator','internal_contributor','internal_quality','external_inspector','verifier','leadership_viewer','auditor');
update public.roles set allowed_scope_kinds='{company,neighborhood}' where code='trade_technician';

create function private.scope_contains(p_org uuid,p_outer public.scope_kind,p_division uuid,p_neighborhood uuid,p_home uuid,
  p_inner public.scope_kind,p_inner_division uuid,p_inner_neighborhood uuid,p_inner_home uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_outer='organization' then p_inner in ('organization','division','neighborhood','home')
    when p_outer='division' then (p_inner='division' and p_division=p_inner_division) or
      (p_inner in ('neighborhood','home') and exists(select 1 from public.neighborhoods n where n.organization_id=p_org and n.id=p_inner_neighborhood and n.division_id=p_division))
    when p_outer='neighborhood' then p_inner in ('neighborhood','home') and p_neighborhood=p_inner_neighborhood
    when p_outer='home' then p_inner='home' and p_neighborhood=p_inner_neighborhood and p_home=p_inner_home
    else false end;
$$;
create function private.company_covers(p_org uuid,p_company uuid,p_neighborhood uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.company_access_grants g join public.companies c on c.id=g.company_id and c.organization_id=g.organization_id
    join public.neighborhoods n on n.organization_id=g.organization_id and n.id=p_neighborhood
    where g.organization_id=p_org and g.company_id=p_company and g.revoked_at is null and c.status='active'
      and private.scope_contains(p_org,g.scope_kind,g.division_id,g.neighborhood_id,null,'neighborhood',null,n.id,null));
$$;
create or replace function private.role_grant_enabled(p_assignment public.role_assignments) returns boolean
language sql stable security definer set search_path='' as $$
  select private.role_enabled(p_assignment.organization_id,p_assignment.role_code) and exists(select 1 from public.roles r
    where r.code=p_assignment.role_code and p_assignment.scope_kind=any(r.allowed_scope_kinds)
    and (not r.requires_company or exists(select 1 from public.company_memberships cm join public.companies c on c.organization_id=cm.organization_id and c.id=cm.company_id
      where cm.organization_id=p_assignment.organization_id and cm.user_id=p_assignment.user_id and c.status='active'
      and (p_assignment.company_id is null or cm.company_id=p_assignment.company_id)
      and (r.code<>'vendor_admin' or cm.kind='manager') and (r.code<>'trade_technician' or cm.kind='technician')
      and cm.revoked_at is null and cm.active_from<=now() and (cm.active_to is null or cm.active_to>now()))));
$$;
create or replace function private.has_permission(p_organization_id uuid,p_user_id uuid,p_permission text,p_neighborhood_id uuid default null,p_home_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select private.active_member(p_organization_id,p_user_id) and exists(select 1 from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code
    where a.organization_id=p_organization_id and a.user_id=p_user_id and rp.permission_code=p_permission and private.role_grant_enabled(a)
    and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()) and
    ((a.scope_kind<>'company' and private.scope_contains(p_organization_id,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,
      case when p_home_id is not null then 'home'::public.scope_kind when p_neighborhood_id is not null then 'neighborhood'::public.scope_kind else 'organization'::public.scope_kind end,null,p_neighborhood_id,p_home_id)) or
      (a.scope_kind='company' and private.company_covers(p_organization_id,a.company_id,p_neighborhood_id))));
$$;
create or replace function private.has_any_scope(p_organization_id uuid,p_user_id uuid,p_neighborhood_id uuid default null,p_home_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select private.active_member(p_organization_id,p_user_id) and exists(select 1 from public.role_assignments a
    where a.organization_id=p_organization_id and a.user_id=p_user_id and private.role_grant_enabled(a)
    and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()) and
    ((a.scope_kind<>'company' and private.scope_contains(p_organization_id,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,
      case when p_home_id is not null then 'home'::public.scope_kind when p_neighborhood_id is not null then 'neighborhood'::public.scope_kind else 'organization'::public.scope_kind end,null,p_neighborhood_id,p_home_id)) or
    (a.scope_kind='company' and private.company_covers(p_organization_id,a.company_id,p_neighborhood_id) and exists(select 1 from public.work_items w
      join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id
      where w.organization_id=p_organization_id and w.neighborhood_id=p_neighborhood_id and (p_home_id is null or w.home_id=p_home_id)
      and ae.company_id=a.company_id and ae.ended_at is null and (ae.technician_user_id=p_user_id or private.active_company_membership(p_organization_id,a.company_id,p_user_id,'manager'))))));
$$;

-- Smaller levels have greater authority. A null level means no authority at this target.
create function private.management_level(p_org uuid,p_user uuid,p_permission text,p_scope public.scope_kind,p_division uuid default null,p_neighborhood uuid default null,p_home uuid default null)
returns smallint language sql stable security definer set search_path='' as $$
  select min(case a.scope_kind when 'organization' then 1 when 'division' then 2 when 'neighborhood' then 3 end)::smallint
  from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code=p_permission
  where a.organization_id=p_org and a.user_id=p_user and private.active_member(p_org,p_user) and private.role_grant_enabled(a)
    and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
    and private.scope_contains(p_org,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,p_scope,p_division,p_neighborhood,p_home);
$$;
create function private.admin_level(p_org uuid,p_user uuid,p_scope public.scope_kind,p_division uuid default null,p_neighborhood uuid default null,p_home uuid default null)
returns smallint language sql stable security definer set search_path='' as $$
  select private.management_level(p_org,p_user,'access.manage',p_scope,p_division,p_neighborhood,p_home);
$$;
create function private.vendor_admin(p_org uuid,p_user uuid,p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_user) and private.active_company_membership(p_org,p_company,p_user,'manager') and exists(
    select 1 from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='company.users.manage'
    where a.organization_id=p_org and a.user_id=p_user and a.company_id=p_company and a.scope_kind='company'
      and private.role_grant_enabled(a) and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()));
$$;
create function private.controls_company(p_org uuid,p_user uuid,p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.companies c where c.organization_id=p_org and c.id=p_company
    and private.admin_level(p_org,p_user,c.owner_scope_kind,c.owner_division_id,c.owner_neighborhood_id,null)<=c.owner_authority_level
    and not exists(select 1 from public.company_access_grants g where g.organization_id=p_org and g.company_id=c.id and g.revoked_at is null
      and (private.admin_level(p_org,p_user,g.scope_kind,g.division_id,g.neighborhood_id,null) is null
        or private.admin_level(p_org,p_user,g.scope_kind,g.division_id,g.neighborhood_id,null)>g.authority_level)));
$$;
create function private.can_read_company(p_org uuid,p_user uuid,p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_user) and (
    private.admin_level(p_org,p_user,'organization') is not null or
    exists(select 1 from public.company_memberships cm where cm.organization_id=p_org and cm.company_id=p_company and cm.user_id=p_user
      and cm.revoked_at is null and cm.active_from<=now() and (cm.active_to is null or cm.active_to>now())) or
    exists(select 1 from public.company_access_grants g join public.role_assignments a on a.organization_id=g.organization_id
      where g.organization_id=p_org and g.company_id=p_company and g.revoked_at is null and a.user_id=p_user
      and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()) and private.role_grant_enabled(a)
      and (exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code in ('roster.manage','work.assign')))
      and (private.scope_contains(p_org,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,g.scope_kind,g.division_id,g.neighborhood_id,null)
        or private.scope_contains(p_org,g.scope_kind,g.division_id,g.neighborhood_id,null,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id))));
$$;

create function private.delegation_level(p_org uuid,p_actor uuid,p_role text,p_scope public.scope_kind,
  p_division uuid,p_neighborhood uuid,p_home uuid,p_company uuid,p_start timestamptz,p_end timestamptz)
returns smallint language plpgsql stable security definer set search_path='' as $$
declare requested public.roles; level smallint; owner public.companies;
begin
  select * into requested from public.roles where code=p_role and private.role_enabled(p_org,code);
  if not found or not(p_scope=any(requested.allowed_scope_kinds)) or p_start is null or (p_end is not null and p_end<=p_start)
    or not private.active_member(p_org,p_actor) then return null; end if;
  if p_scope='organization' and (p_division is not null or p_neighborhood is not null or p_home is not null or p_company is not null) then return null; end if;
  if p_scope='division' and (p_division is null or p_neighborhood is not null or p_home is not null or p_company is not null or not exists(select 1 from public.divisions where organization_id=p_org and id=p_division and status='active')) then return null; end if;
  if p_scope in ('neighborhood','home') and (p_division is not null or p_neighborhood is null or (p_scope='neighborhood' and p_home is not null)
    or not exists(select 1 from public.neighborhoods where organization_id=p_org and id=p_neighborhood and status='active')) then return null; end if;
  if p_scope='home' and (p_home is null or not exists(select 1 from public.homes where organization_id=p_org and neighborhood_id=p_neighborhood and id=p_home and archived_at is null)) then return null; end if;
  if requested.requires_company and (p_company is null or not exists(select 1 from public.companies where organization_id=p_org and id=p_company and status='active')) then return null; end if;
  if p_scope='company' then
    if not requested.requires_company or p_company is null or p_division is not null or p_neighborhood is not null or p_home is not null then return null; end if;
    if private.vendor_admin(p_org,p_actor,p_company) and p_role in ('vendor_admin','trade_technician') and exists(
      select 1 from public.role_assignments a where a.organization_id=p_org and a.user_id=p_actor and a.role_code='vendor_admin' and a.company_id=p_company
      and a.revoked_at is null and a.starts_at<=now() and private.role_grant_enabled(a)
      and (a.ends_at is null or (p_end is not null and p_end<=a.ends_at))) then return 4; end if;
    if not private.controls_company(p_org,p_actor,p_company) then return null; end if;
    select * into owner from public.companies where organization_id=p_org and id=p_company;
    p_scope:=owner.owner_scope_kind; p_division:=owner.owner_division_id; p_neighborhood:=owner.owner_neighborhood_id;
  elsif requested.requires_company and (not private.company_covers(p_org,p_company,p_neighborhood)) then return null;
  end if;
  select min(case a.scope_kind when 'organization' then 1 when 'division' then 2 when 'neighborhood' then 3 end)::smallint into level
  from public.role_assignments a where a.organization_id=p_org and a.user_id=p_actor and a.revoked_at is null
    and a.starts_at<=now() and private.role_grant_enabled(a) and (a.ends_at is null or (p_end is not null and p_end<=a.ends_at))
    and exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code='access.manage')
    and private.scope_contains(p_org,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,p_scope,p_division,p_neighborhood,p_home)
    and (a.scope_kind='organization' or not exists(select 1 from public.role_permissions wanted where wanted.role_code=p_role and wanted.permission_code<>'company.users.manage'
      and not exists(select 1 from public.role_permissions held where held.role_code=a.role_code and held.permission_code=wanted.permission_code)));
  return level;
end; $$;

create function private.can_remove_assignment(p_actor uuid,p_assignment public.role_assignments) returns boolean
language sql stable security definer set search_path='' as $$
  select case when p_assignment.scope_kind='company' then
    (private.controls_company(p_assignment.organization_id,p_actor,p_assignment.company_id) and
      (select private.admin_level(c.organization_id,p_actor,c.owner_scope_kind,c.owner_division_id,c.owner_neighborhood_id,null) from public.companies c where c.id=p_assignment.company_id)<=p_assignment.authority_level)
    or (p_assignment.authority_level=4 and private.vendor_admin(p_assignment.organization_id,p_actor,p_assignment.company_id))
  else coalesce(private.admin_level(p_assignment.organization_id,p_actor,p_assignment.scope_kind,p_assignment.division_id,p_assignment.neighborhood_id,p_assignment.home_id)<=p_assignment.authority_level,false) end;
$$;
create function private.can_manage_company_member(p_actor uuid,p_member public.company_memberships) returns boolean
language sql stable security definer set search_path='' as $$
  select (private.controls_company(p_member.organization_id,p_actor,p_member.company_id) and
    (select private.admin_level(c.organization_id,p_actor,c.owner_scope_kind,c.owner_division_id,c.owner_neighborhood_id,null) from public.companies c where c.id=p_member.company_id)<=p_member.authority_level)
    or (p_member.authority_level=4 and private.vendor_admin(p_member.organization_id,p_actor,p_member.company_id));
$$;
create function public.administration_context(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_organization_id,auth.uid()) then raise exception using errcode='42501',message='active membership required'; end if;
  return jsonb_build_object('organization_admin',coalesce(private.admin_level(p_organization_id,auth.uid(),'organization')=1,false),
    'companies',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)) from public.companies c where c.organization_id=p_organization_id and c.status='active'
      and (private.controls_company(p_organization_id,auth.uid(),c.id) or private.vendor_admin(p_organization_id,auth.uid(),c.id))),'[]'::jsonb),
    'grants',coalesce((select jsonb_agg(jsonb_build_object('scope_kind',a.scope_kind,'division_id',a.division_id,'neighborhood_id',a.neighborhood_id,'home_id',a.home_id,'company_id',a.company_id,'ends_at',a.ends_at,
        'permissions',(select jsonb_agg(rp.permission_code) from public.role_permissions rp where rp.role_code=a.role_code)))
      from public.role_assignments a
      where a.organization_id=p_organization_id and a.user_id=auth.uid() and a.revoked_at is null and a.starts_at<=now()
        and (a.ends_at is null or a.ends_at>now()) and private.role_grant_enabled(a)
        and exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code in ('access.manage','company.users.manage','structure.manage','roster.manage'))),'[]'::jsonb));
end; $$;

create or replace function public.admin_set_member_access(p_organization_id uuid,p_user_id uuid,p_affiliation public.affiliation_kind,
  p_assignments jsonb,p_company_id uuid default null,p_company_kind text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment jsonb; prior public.role_assignments; member public.organization_memberships; item public.roles;
  level smallint; company_level smallint; company uuid; previous jsonb; new_access jsonb; builder boolean; old_company public.company_memberships; prepared jsonb:='[]'; editable_ids uuid[];
begin
  if auth.uid() is null or not private.require_aal2() then raise exception using errcode='42501',message='verify your authenticator before managing access'; end if;
  if not coalesce(private.can_read_member(p_organization_id,auth.uid(),p_user_id),false) then raise exception using errcode='42501',message='this person is outside your administration scope'; end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments)>20 then raise exception using errcode='22023',message='up to twenty role assignments are supported'; end if;
  builder:=private.admin_level(p_organization_id,auth.uid(),'organization')=1;
  select * into member from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id for update;
  if not found then
    if not coalesce(builder,false) then raise exception using errcode='22023',message='invite this person before editing their access'; end if;
    insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
      values(p_organization_id,p_user_id,p_affiliation,'active',now()) returning * into member;
  end if;
  if not coalesce(builder,false) and (member.status<>'active' or member.affiliation<>p_affiliation) then raise exception using errcode='42501',message='only an organization admin may change membership status or affiliation'; end if;
  if p_company_id is not null and (p_company_kind is null or p_company_kind not in ('manager','technician')) then raise exception using errcode='22023',message='choose a company member type'; end if;
  previous:=jsonb_build_object('membership',to_jsonb(member),'roles',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.role_assignments a where a.organization_id=p_organization_id and a.user_id=p_user_id and a.revoked_at is null));
  -- Lock the complete role set before checking protection or replacing local grants.
  perform 1 from public.role_assignments where organization_id=p_organization_id and user_id=p_user_id for update;
  for assignment in select value from jsonb_array_elements(p_assignments) loop
    -- Protected assignments may be submitted unchanged by the editor, never modified.
    select * into prior from public.role_assignments where id=nullif(assignment->>'id','')::uuid and organization_id=p_organization_id and user_id=p_user_id and revoked_at is null;
    if found and not private.can_remove_assignment(auth.uid(),prior) then
      if prior.role_code is distinct from assignment->>'role_code' or prior.scope_kind::text is distinct from assignment->>'scope_kind'
        or prior.division_id is distinct from nullif(assignment->>'division_id','')::uuid or prior.neighborhood_id is distinct from nullif(assignment->>'neighborhood_id','')::uuid
        or prior.home_id is distinct from nullif(assignment->>'home_id','')::uuid or prior.company_id is distinct from nullif(assignment->>'company_id','')::uuid
        or prior.starts_at is distinct from (assignment->>'starts_at')::timestamptz or prior.ends_at is distinct from nullif(assignment->>'ends_at','')::timestamptz then
        raise exception using errcode='42501',message='this access was granted by a higher administrator and is protected';
      end if;
      prepared:=prepared||jsonb_build_array(assignment);
      continue;
    end if;
    select * into item from public.roles where code=assignment->>'role_code';
    company:=case when item.requires_company then coalesce(nullif(assignment->>'company_id','')::uuid,p_company_id) else null end;
    level:=private.delegation_level(p_organization_id,auth.uid(),item.code,(assignment->>'scope_kind')::public.scope_kind,
      nullif(assignment->>'division_id','')::uuid,nullif(assignment->>'neighborhood_id','')::uuid,nullif(assignment->>'home_id','')::uuid,company,
      coalesce(nullif(assignment->>'starts_at','')::timestamptz,now()),nullif(assignment->>'ends_at','')::timestamptz);
    if level is null then raise exception using errcode='42501',message='role, location, or validity exceeds your authority'; end if;
    if item.requires_company and not exists(select 1 from public.company_memberships cm where cm.organization_id=p_organization_id and cm.company_id=company and cm.user_id=p_user_id and cm.revoked_at is null)
      and company is distinct from p_company_id then raise exception using errcode='22023',message='choose a company relationship for this role'; end if;
    prepared:=prepared||jsonb_build_array(assignment||jsonb_build_object('authority_level',level,'company_id',company));
  end loop;
  if p_company_id is not null then
    if not private.controls_company(p_organization_id,auth.uid(),p_company_id) and not private.vendor_admin(p_organization_id,auth.uid(),p_company_id) then raise exception using errcode='42501',message='this company is outside your management authority'; end if;
    select * into old_company from public.company_memberships cm where cm.organization_id=p_organization_id and cm.company_id=p_company_id and cm.user_id=p_user_id and cm.revoked_at is null and cm.active_to is null for update;
    if found and old_company.kind<>p_company_kind and not private.can_manage_company_member(auth.uid(),old_company) then raise exception using errcode='42501',message='company membership was granted by a higher administrator'; end if;
    select case when private.vendor_admin(p_organization_id,auth.uid(),p_company_id) and not private.controls_company(p_organization_id,auth.uid(),p_company_id) then 4
      else private.admin_level(p_organization_id,auth.uid(),c.owner_scope_kind,c.owner_division_id,c.owner_neighborhood_id,null) end into company_level from public.companies c where c.id=p_company_id;
  end if;
  select array_agg(a.id) into editable_ids from public.role_assignments a where a.organization_id=p_organization_id and a.user_id=p_user_id and a.revoked_at is null and private.can_remove_assignment(auth.uid(),a);
  update public.role_assignments a set revoked_at=now() where a.id=any(editable_ids);
  if coalesce(builder,false) then update public.organization_memberships set affiliation=p_affiliation,status='active',ended_at=null where id=member.id; end if;
  if p_company_id is not null and (old_company.id is null or old_company.kind<>p_company_kind) then
    if old_company.id is not null then update public.company_memberships set revoked_at=now() where id=old_company.id; end if;
    insert into public.company_memberships(organization_id,company_id,user_id,kind,granted_by,authority_level) values(p_organization_id,p_company_id,p_user_id,p_company_kind,auth.uid(),company_level);
  end if;
  for assignment in select value from jsonb_array_elements(prepared) loop
    if exists(select 1 from public.role_assignments a where a.id=nullif(assignment->>'id','')::uuid and a.revoked_at is null and a.organization_id=p_organization_id and a.user_id=p_user_id) then continue; end if;
    select * into item from public.roles where code=assignment->>'role_code';
    company:=case when item.requires_company then coalesce(nullif(assignment->>'company_id','')::uuid,p_company_id) else null end;
    level:=(assignment->>'authority_level')::smallint;
    insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,division_id,neighborhood_id,home_id,company_id,authority_level,starts_at,ends_at,granted_by)
      values(p_organization_id,p_user_id,item.code,(assignment->>'scope_kind')::public.scope_kind,nullif(assignment->>'division_id','')::uuid,nullif(assignment->>'neighborhood_id','')::uuid,nullif(assignment->>'home_id','')::uuid,company,level,
        coalesce(nullif(assignment->>'starts_at','')::timestamptz,now()),nullif(assignment->>'ends_at','')::timestamptz,auth.uid());
  end loop;
  new_access:=jsonb_build_object('user_id',p_user_id,'roles',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.role_assignments a where a.organization_id=p_organization_id and a.user_id=p_user_id and a.revoked_at is null));
  perform private.append_audit(p_organization_id,auth.uid(),'membership.access_changed','user',p_user_id,null,previous,new_access);
  return jsonb_build_object('user_id',p_user_id,'updated',true);
end; $$;

create or replace function public.admin_suspend_member(p_organization_id uuid,p_user_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare global_admin boolean; changed integer; removed integer; orphaned jsonb; role_ids uuid[]; company_ids uuid[];
begin
  if auth.uid() is null or not private.require_aal2() then raise exception using errcode='42501',message='verify your authenticator before removing access'; end if;
  global_admin:=coalesce(private.admin_level(p_organization_id,auth.uid(),'organization')=1,false);
  perform 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id for update;
  select array_agg(a.id) into role_ids from public.role_assignments a where a.organization_id=p_organization_id and a.user_id=p_user_id and a.revoked_at is null and private.can_remove_assignment(auth.uid(),a);
  select array_agg(cm.id) into company_ids from public.company_memberships cm where cm.organization_id=p_organization_id and cm.user_id=p_user_id and cm.revoked_at is null and private.can_manage_company_member(auth.uid(),cm);
  update public.role_assignments a set revoked_at=now() where a.id=any(role_ids);
  get diagnostics changed=row_count;
  update public.company_memberships cm set revoked_at=now() where cm.id=any(company_ids);
  get diagnostics removed=row_count;
  if not global_admin and changed+removed=0 then raise exception using errcode='42501',message='no removable access in your scope; higher-level grants are protected'; end if;
  if global_admin then update public.organization_memberships set status='suspended',ended_at=now() where organization_id=p_organization_id and user_id=p_user_id and status='active'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('work_item_id',w.id,'title',w.title)),'[]'::jsonb) into orphaned
    from public.work_items w join public.assignment_episodes ae on ae.id=w.current_assignment_id and ae.organization_id=w.organization_id
    where w.organization_id=p_organization_id and ae.internal_assignee_user_id=p_user_id and ae.ended_at is null
      and not private.has_permission(p_organization_id,p_user_id,'work.execute_assigned',w.neighborhood_id,w.home_id)
      and private.has_permission(p_organization_id,auth.uid(),'work.assign',w.neighborhood_id,w.home_id);
  perform private.append_audit(p_organization_id,auth.uid(),case when global_admin then 'membership.suspended' else 'membership.local_access_removed' end,'user',p_user_id,null,null,jsonb_build_object('reason',p_reason,'scope_only',not global_admin,'removed_roles',changed));
  return jsonb_build_object('user_id',p_user_id,'orphaned_work',orphaned,'scope_only',not global_admin);
end; $$;

create function private.company_team_visible(p_org uuid,p_actor uuid,p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_actor) and (private.vendor_admin(p_org,p_actor,p_company) or exists(
    select 1 from public.company_access_grants g join public.role_assignments a on a.organization_id=g.organization_id
      join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='access.manage'
    where g.organization_id=p_org and g.company_id=p_company and g.revoked_at is null and a.user_id=p_actor and a.revoked_at is null
      and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()) and private.role_grant_enabled(a)
      and (private.scope_contains(p_org,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,g.scope_kind,g.division_id,g.neighborhood_id,null)
        or private.scope_contains(p_org,g.scope_kind,g.division_id,g.neighborhood_id,null,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id))));
$$;

create function private.can_read_member(p_org uuid,p_actor uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_actor) and (private.admin_level(p_org,p_actor,'organization')=1 or
    exists(select 1 from public.role_assignments a where a.organization_id=p_org and a.user_id=p_user and a.revoked_at is null
      and (private.admin_level(p_org,p_actor,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id) is not null
        or (a.company_id is not null and private.company_team_visible(p_org,p_actor,a.company_id)))) or
    exists(select 1 from public.company_memberships cm where cm.organization_id=p_org and cm.user_id=p_user and cm.revoked_at is null
      and private.vendor_admin(p_org,p_actor,cm.company_id)));
$$;
create or replace function public.admin_list_members(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_organization_id,auth.uid()) then raise exception using errcode='42501',message='active membership required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'display_name',p.display_name,
    'affiliation',m.affiliation,'status',m.status,'joined_at',m.joined_at,
    'can_suspend',private.admin_level(p_organization_id,auth.uid(),'organization')=1,
    'can_remove_access',exists(select 1 from public.role_assignments a where a.organization_id=m.organization_id and a.user_id=m.user_id and a.revoked_at is null and private.can_remove_assignment(auth.uid(),a)),
    'roles',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('role_label',r.label,'can_edit',private.can_remove_assignment(auth.uid(),a)))
      from public.role_assignments a join public.roles r on r.code=a.role_code where a.organization_id=m.organization_id and a.user_id=m.user_id
      and a.revoked_at is null and (private.admin_level(m.organization_id,auth.uid(),a.scope_kind,a.division_id,a.neighborhood_id,a.home_id) is not null
        or a.scope_kind='organization' or (a.company_id is not null and (private.company_team_visible(m.organization_id,auth.uid(),a.company_id))))),'[]'::jsonb),
    'companies',coalesce((select jsonb_agg(jsonb_build_object('company_id',cm.company_id,'company_name',c.name,'kind',cm.kind,'can_edit',private.can_manage_company_member(auth.uid(),cm)))
      from public.company_memberships cm join public.companies c on c.id=cm.company_id and c.organization_id=cm.organization_id where cm.organization_id=m.organization_id and cm.user_id=m.user_id
        and cm.revoked_at is null and cm.active_from<=now() and (cm.active_to is null or cm.active_to>now()) and private.company_team_visible(m.organization_id,auth.uid(),c.id)),'[]'::jsonb)
    ) order by p.display_name,u.email),'[]'::jsonb)
    from public.organization_memberships m join auth.users u on u.id=m.user_id join public.profiles p on p.id=m.user_id
    where m.organization_id=p_organization_id and private.can_read_member(p_organization_id,auth.uid(),m.user_id));
end; $$;

create or replace function public.admin_create_invitation(p_organization_id uuid,p_email text,p_affiliation public.affiliation_kind,
  p_grants jsonb,p_company_id uuid,p_company_kind text,p_token_hash text,p_expires_at timestamptz)
returns public.invites language plpgsql security definer set search_path='' as $$
declare result public.invites; grant_row jsonb; prepared jsonb:='[]'; level smallint; highest smallint:=4; company uuid; target public.organization_memberships;
begin
  if auth.uid() is null or not private.require_aal2() then raise exception using errcode='42501',message='verify your authenticator before inviting users'; end if;
  if p_email is null or length(trim(p_email))>254 or trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode='22023',message='enter a valid invitation email'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days 5 minutes' then raise exception using errcode='22023',message='invalid invitation token or expiry'; end if;
  if jsonb_typeof(p_grants) is distinct from 'array' or jsonb_array_length(p_grants) not between 1 and 20 then raise exception using errcode='22023',message='choose one to twenty role assignments'; end if;
  select m.* into target from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id and lower(u.email)=lower(trim(p_email));
  if found and private.admin_level(p_organization_id,auth.uid(),'organization') is distinct from 1::smallint and (target.status<>'active' or target.affiliation<>p_affiliation) then raise exception using errcode='42501',message='only an organization admin may change membership status or affiliation'; end if;
  for grant_row in select value from jsonb_array_elements(p_grants) loop
    company:=case when exists(select 1 from public.roles where code=grant_row->>'role_code' and requires_company) then coalesce(nullif(grant_row->>'company_id','')::uuid,p_company_id) else null end;
    if company is distinct from p_company_id then raise exception using errcode='22023',message='invitation company must match the role company'; end if;
    level:=private.delegation_level(p_organization_id,auth.uid(),grant_row->>'role_code',(grant_row->>'scope_kind')::public.scope_kind,
      nullif(grant_row->>'division_id','')::uuid,nullif(grant_row->>'neighborhood_id','')::uuid,nullif(grant_row->>'home_id','')::uuid,company,
      coalesce(nullif(grant_row->>'starts_at','')::timestamptz,now()),nullif(grant_row->>'ends_at','')::timestamptz);
    if level is null then raise exception using errcode='42501',message='this role or location exceeds your invitation authority'; end if;
    if grant_row->>'role_code'='vendor_admin' and p_company_kind is distinct from 'manager' then raise exception using errcode='22023',message='vendor admins must be company managers'; end if;
    highest:=least(highest,level);
    prepared:=prepared||jsonb_build_array((grant_row-'authority_level')||jsonb_build_object('authority_level',level,'company_id',company));
  end loop;
  if p_company_id is not null and (p_company_kind is null or p_company_kind not in ('manager','technician')) then raise exception using errcode='22023',message='choose a company member type'; end if;
  insert into public.invites(organization_id,normalized_email,proposed_membership,proposed_grants,proposed_company_id,token_hash,expires_at,invited_by,authority_level)
    values(p_organization_id,lower(trim(p_email)),jsonb_build_object('affiliation',p_affiliation,'company_kind',p_company_kind),prepared,p_company_id,p_token_hash,p_expires_at,auth.uid(),highest) returning * into result;
  perform private.append_audit(p_organization_id,auth.uid(),'invitation.created','invite',result.id,null,null,to_jsonb(result)-'token_hash');
  return result;
end; $$;

create or replace function public.accept_invitation(p_plaintext_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation public.invites; email text; grant_row jsonb; membership public.organization_memberships; level smallint; authority smallint; company uuid; platform_bootstrap boolean; existing_company public.company_memberships;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='sign in required'; end if;
  select lower(u.email) into email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if email is null then raise exception using errcode='42501',message='verify your account email first'; end if;
  select * into invitation from public.invites where token_hash=encode(extensions.digest(p_plaintext_token,'sha256'),'hex') for update;
  if not found or invitation.status<>'pending' or invitation.expires_at<=now() then raise exception using errcode='22023',message='invitation is invalid or expired'; end if;
  if invitation.normalized_email<>email then raise exception using errcode='42501',message='signed-in email does not match invitation'; end if;
  if not exists(select 1 from public.organizations where id=invitation.organization_id and status='active') then raise exception using errcode='42501',message='organization is not active'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and completed_at is not null and length(trim(first_name))>0 and length(trim(last_name))>0) then raise exception using errcode='22023',message='complete your first and last name before accepting this invitation'; end if;
  platform_bootstrap:=coalesce((invitation.proposed_membership->>'platform_onboarding')::boolean,false) and private.is_platform_admin(invitation.invited_by)
    and exists(select 1 from public.organization_onboarding o where o.organization_id=invitation.organization_id and o.administrator_email=email
      and invitation.proposed_grants=jsonb_build_array(jsonb_build_object('role_code',o.administrator_role_code,'scope_kind','organization','neighborhood_id',null,'home_id',null)));
  for grant_row in select value from jsonb_array_elements(invitation.proposed_grants) loop
    company:=coalesce(nullif(grant_row->>'company_id','')::uuid,invitation.proposed_company_id);
    level:=case when platform_bootstrap then 1 else private.delegation_level(invitation.organization_id,invitation.invited_by,grant_row->>'role_code',(grant_row->>'scope_kind')::public.scope_kind,
      nullif(grant_row->>'division_id','')::uuid,nullif(grant_row->>'neighborhood_id','')::uuid,nullif(grant_row->>'home_id','')::uuid,company,
      coalesce(nullif(grant_row->>'starts_at','')::timestamptz,now()),nullif(grant_row->>'ends_at','')::timestamptz) end;
    if level is null or not private.role_enabled(invitation.organization_id,grant_row->>'role_code') then raise exception using errcode='42501',message='the inviter no longer has authority for this access; request a new invitation'; end if;
  end loop;
  select * into membership from public.organization_memberships where organization_id=invitation.organization_id and user_id=auth.uid() for update;
  if found and invitation.authority_level>1 and (membership.status<>'active' or membership.affiliation::text<>invitation.proposed_membership->>'affiliation') then raise exception using errcode='42501',message='an organization admin must review this membership'; end if;
  insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
    values(invitation.organization_id,auth.uid(),(invitation.proposed_membership->>'affiliation')::public.affiliation_kind,'active',now())
    on conflict(organization_id,user_id) do update set status='active',ended_at=null,affiliation=excluded.affiliation,joined_at=coalesce(public.organization_memberships.joined_at,now()) returning * into membership;
  if invitation.proposed_company_id is not null then
    select * into existing_company from public.company_memberships where organization_id=invitation.organization_id and company_id=invitation.proposed_company_id and user_id=auth.uid() and revoked_at is null and active_to is null for update;
    if found and existing_company.kind is distinct from invitation.proposed_membership->>'company_kind' then
      if invitation.authority_level>existing_company.authority_level then raise exception using errcode='42501',message='company membership was granted by a higher administrator'; end if;
      update public.company_memberships set revoked_at=now() where id=existing_company.id;
      existing_company.id:=null;
    end if;
    if existing_company.id is null then insert into public.company_memberships(organization_id,company_id,user_id,kind,granted_by,authority_level)
      values(invitation.organization_id,invitation.proposed_company_id,auth.uid(),coalesce(invitation.proposed_membership->>'company_kind','technician'),invitation.invited_by,invitation.authority_level); end if;
  end if;
  for grant_row in select value from jsonb_array_elements(invitation.proposed_grants) loop
    authority:=coalesce(nullif(grant_row->>'authority_level','')::smallint,invitation.authority_level);
    insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,division_id,neighborhood_id,home_id,company_id,authority_level,starts_at,ends_at,granted_by)
      values(invitation.organization_id,auth.uid(),grant_row->>'role_code',(grant_row->>'scope_kind')::public.scope_kind,nullif(grant_row->>'division_id','')::uuid,
        nullif(grant_row->>'neighborhood_id','')::uuid,nullif(grant_row->>'home_id','')::uuid,
        case when exists(select 1 from public.roles where code=grant_row->>'role_code' and requires_company) then coalesce(nullif(grant_row->>'company_id','')::uuid,invitation.proposed_company_id) else null end,
        authority,coalesce(nullif(grant_row->>'starts_at','')::timestamptz,now()),nullif(grant_row->>'ends_at','')::timestamptz,invitation.invited_by);
  end loop;
  update public.invites set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
  perform private.append_audit(invitation.organization_id,auth.uid(),'invitation.accepted','invite',invitation.id,null,null,jsonb_build_object('membership_id',membership.id));
  return jsonb_build_object('organization_id',invitation.organization_id,'membership_id',membership.id);
end; $$;

create function private.can_revoke_invitation(p_actor uuid,p_invite public.invites) returns boolean
language sql stable security definer set search_path='' as $$
  select private.active_member(p_invite.organization_id,p_actor) and (private.admin_level(p_invite.organization_id,p_actor,'organization')=1 or
    (jsonb_array_length(p_invite.proposed_grants)>0 and not exists(select 1 from jsonb_array_elements(p_invite.proposed_grants) g
      where coalesce(private.delegation_level(p_invite.organization_id,p_actor,g->>'role_code',(g->>'scope_kind')::public.scope_kind,
        nullif(g->>'division_id','')::uuid,nullif(g->>'neighborhood_id','')::uuid,nullif(g->>'home_id','')::uuid,
        coalesce(nullif(g->>'company_id','')::uuid,p_invite.proposed_company_id),coalesce(nullif(g->>'starts_at','')::timestamptz,now()),nullif(g->>'ends_at','')::timestamptz),5)
        >coalesce(nullif(g->>'authority_level','')::smallint,p_invite.authority_level))));
$$;
create or replace function public.admin_list_invitations(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_organization_id,auth.uid()) then raise exception using errcode='42501',message='active membership required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.normalized_email,'status',i.status,'expires_at',i.expires_at,
    'created_at',i.created_at,'delivery_error',i.delivery_error,'membership',i.proposed_membership,'grants',i.proposed_grants,'company_id',i.proposed_company_id,
    'can_revoke',private.can_revoke_invitation(auth.uid(),i)) order by i.created_at desc),'[]'::jsonb) from public.invites i where i.organization_id=p_organization_id
    and (private.can_revoke_invitation(auth.uid(),i) or i.invited_by=auth.uid()));
end; $$;
create or replace function public.admin_revoke_invitation(p_organization_id uuid,p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation public.invites;
begin
  if auth.uid() is null or not private.require_aal2() then raise exception using errcode='42501',message='verify your authenticator before revoking invitations'; end if;
  select * into invitation from public.invites where organization_id=p_organization_id and id=p_invitation_id and status='pending' for update;
  if not found or not private.can_revoke_invitation(auth.uid(),invitation) then raise exception using errcode='42501',message='invitation is unavailable or was granted by a higher administrator'; end if;
  update public.invites set status='revoked' where id=invitation.id;
  perform private.append_audit(p_organization_id,auth.uid(),'invitation.revoked','invite',invitation.id,null,null,null);
  return jsonb_build_object('id',invitation.id,'status','revoked');
end; $$;

create function public.admin_onboard_vendor(p_organization_id uuid,p_name text,p_reference text,p_scope public.scope_kind,
  p_division_id uuid default null,p_neighborhood_id uuid default null) returns public.companies
language plpgsql security definer set search_path='' as $$
declare result public.companies; level smallint;
begin
  level:=private.admin_level(p_organization_id,auth.uid(),p_scope,p_division_id,p_neighborhood_id,null);
  if not private.require_aal2() or level is null or p_scope not in ('organization','division','neighborhood') then raise exception using errcode='42501',message='vendor ownership must stay inside your administrative scope'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception using errcode='22023',message='vendor name is required'; end if;
  if p_scope='division' and not exists(select 1 from public.divisions where organization_id=p_organization_id and id=p_division_id and status='active') then raise exception using errcode='22023',message='division is unavailable'; end if;
  if p_scope='neighborhood' and not exists(select 1 from public.neighborhoods where organization_id=p_organization_id and id=p_neighborhood_id and status='active') then raise exception using errcode='22023',message='neighborhood is unavailable'; end if;
  insert into public.companies(organization_id,name,external_vendor_reference,owner_scope_kind,owner_division_id,owner_neighborhood_id,owner_authority_level,created_by)
    values(p_organization_id,trim(p_name),nullif(trim(p_reference),''),p_scope,p_division_id,p_neighborhood_id,level,auth.uid()) returning * into result;
  perform private.append_audit(p_organization_id,auth.uid(),'vendor.onboarded','company',result.id,null,null,to_jsonb(result));
  return result;
end; $$;
create function public.admin_set_vendor_coverage(p_organization_id uuid,p_company_id uuid,p_scope public.scope_kind,
  p_division_id uuid default null,p_neighborhood_id uuid default null,p_grant_id uuid default null,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.company_access_grants; level smallint; company public.companies; result public.company_access_grants;
begin
  if auth.uid() is null or not private.require_aal2() then raise exception using errcode='42501',message='verify your authenticator before changing vendor coverage'; end if;
  select * into company from public.companies where organization_id=p_organization_id and id=p_company_id for update;
  if not found or not private.can_read_company(p_organization_id,auth.uid(),p_company_id) then raise exception using errcode='42501',message='vendor is outside your access'; end if;
  if p_grant_id is not null then
    select * into existing from public.company_access_grants where id=p_grant_id and organization_id=p_organization_id and company_id=p_company_id and revoked_at is null for update;
    if not found or p_active then raise exception using errcode='22023',message='choose a current coverage entry to remove'; end if;
    level:=private.admin_level(p_organization_id,auth.uid(),existing.scope_kind,existing.division_id,existing.neighborhood_id,null);
    if level is null or level>existing.authority_level then raise exception using errcode='42501',message='coverage was granted by a higher administrator or is outside your scope'; end if;
    -- Removing coverage must not silently strand current assignments.
    if exists(select 1 from public.assignment_episodes ae join public.work_items w on w.organization_id=ae.organization_id and w.current_assignment_id=ae.id
      where ae.organization_id=p_organization_id and ae.company_id=p_company_id and ae.ended_at is null and w.state not in ('verified','cancelled')
        and private.scope_contains(p_organization_id,existing.scope_kind,existing.division_id,existing.neighborhood_id,null,'neighborhood',null,w.neighborhood_id,null)
        and not exists(select 1 from public.company_access_grants other where other.organization_id=p_organization_id and other.company_id=p_company_id and other.revoked_at is null and other.id<>existing.id
          and private.scope_contains(p_organization_id,other.scope_kind,other.division_id,other.neighborhood_id,null,'neighborhood',null,w.neighborhood_id,null))) then
      raise exception using errcode='23514',message='reassign or finish active work in this coverage before removing it';
    end if;
    update public.company_access_grants set revoked_at=now(),revocation_level=level,revoked_by=auth.uid() where id=existing.id returning * into result;
  else
    level:=private.admin_level(p_organization_id,auth.uid(),p_scope,p_division_id,p_neighborhood_id,null);
    if level is null or not p_active or company.status<>'active' or p_scope not in ('organization','division','neighborhood') then raise exception using errcode='42501',message='vendor coverage must stay inside your administrative scope'; end if;
    if p_scope='division' and not exists(select 1 from public.divisions where organization_id=p_organization_id and id=p_division_id and status='active') then raise exception using errcode='22023',message='division is unavailable'; end if;
    if p_scope='neighborhood' and not exists(select 1 from public.neighborhoods where organization_id=p_organization_id and id=p_neighborhood_id and status='active') then raise exception using errcode='22023',message='neighborhood is unavailable'; end if;
    if exists(select 1 from public.company_access_grants g where g.organization_id=p_organization_id and g.company_id=p_company_id
      and g.scope_kind=p_scope and g.division_id is not distinct from p_division_id and g.neighborhood_id is not distinct from p_neighborhood_id
      and g.revoked_at is not null and g.revocation_level<level) then raise exception using errcode='42501',message='a higher administrator removed this coverage; ask them to restore it'; end if;
    insert into public.company_access_grants(organization_id,company_id,scope_kind,division_id,neighborhood_id,authority_level,granted_by)
      values(p_organization_id,p_company_id,p_scope,p_division_id,p_neighborhood_id,level,auth.uid()) returning * into result;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),case when p_active then 'vendor.coverage_added' else 'vendor.coverage_removed' end,'company',p_company_id,null,to_jsonb(existing),to_jsonb(result));
  return to_jsonb(result);
end; $$;
create function public.vendor_access_context(p_organization_id uuid,p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company public.companies; controls boolean;
begin
  select * into company from public.companies where organization_id=p_organization_id and id=p_company_id;
  if not found or not private.can_read_company(p_organization_id,auth.uid(),p_company_id) then raise exception using errcode='42501',message='vendor is outside your access'; end if;
  controls:=private.controls_company(p_organization_id,auth.uid(),p_company_id);
  return jsonb_build_object('can_edit',controls,'can_deactivate',controls,'can_manage_team',controls or private.vendor_admin(p_organization_id,auth.uid(),p_company_id),
    'owner_scope_kind',company.owner_scope_kind,'owner_label',case company.owner_scope_kind when 'organization' then 'Organization' when 'division' then (select name from public.divisions where id=company.owner_division_id) else (select name from public.neighborhoods where id=company.owner_neighborhood_id) end,
    'coverage',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('label',case g.scope_kind when 'organization' then 'Entire organization' when 'division' then (select name from public.divisions where id=g.division_id) else (select name from public.neighborhoods where id=g.neighborhood_id) end,
      'can_remove',coalesce(private.admin_level(p_organization_id,auth.uid(),g.scope_kind,g.division_id,g.neighborhood_id,null)<=g.authority_level,false)))
      from public.company_access_grants g where g.organization_id=p_organization_id and g.company_id=p_company_id and g.revoked_at is null),'[]'::jsonb));
end; $$;

-- Scoped structure commands keep their existing validation and audit behavior.
do $migration$
declare definition text; signature text; needle text;
begin
  signature:='public.admin_save_division(uuid,uuid,text,public.organization_status)';
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13)||chr(10),chr(10));
  needle:='perform private.require_admin_permission(p_organization_id, ''structure.manage'');';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'division command changed; review hierarchy guard'; end if;
  execute replace(definition,needle,$patch$
    if not private.require_aal2() or (p_id is null and private.admin_level(p_organization_id,auth.uid(),'organization') is null)
      or (p_id is not null and private.admin_level(p_organization_id,auth.uid(),'division',p_id) is null) then
      raise exception using errcode='42501',message='division is outside your administrative scope'; end if;
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_save_neighborhood(uuid,uuid,uuid,text,text,text,public.organization_status,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'neighborhood command changed; review hierarchy guard'; end if;
  execute replace(definition,needle,$patch$
    if not private.require_aal2() or (p_id is null and private.admin_level(p_organization_id,auth.uid(),'division',p_division_id) is null)
      or (p_id is not null and private.admin_level(p_organization_id,auth.uid(),'neighborhood',null,p_id) is null) then
      raise exception using errcode='42501',message='neighborhood is outside your administrative scope'; end if;
    if p_id is not null and exists(select 1 from public.neighborhoods n where n.organization_id=p_organization_id and n.id=p_id and n.division_id is distinct from p_division_id)
      and (private.admin_level(p_organization_id,auth.uid(),'division',p_division_id) is null or
        exists(select 1 from public.neighborhoods n where n.organization_id=p_organization_id and n.id=p_id and private.admin_level(p_organization_id,auth.uid(),'division',n.division_id) is null)) then
      raise exception using errcode='42501',message='moving neighborhoods requires authority over both divisions'; end if;
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_save_home(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,text,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'home command changed; review hierarchy guard'; end if;
  execute replace(definition,needle,$patch$
    if not private.require_aal2() or not private.has_permission(p_organization_id,auth.uid(),'structure.manage',p_neighborhood_id,null)
      or (p_id is not null and not exists(select 1 from public.homes h where h.organization_id=p_organization_id and h.id=p_id and private.has_permission(p_organization_id,auth.uid(),'structure.manage',h.neighborhood_id,h.id))) then
      raise exception using errcode='42501',message='home is outside your administrative scope'; end if;
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_save_home_location(uuid,uuid,uuid,text,uuid,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'home location command changed; review hierarchy guard'; end if;
  execute replace(definition,needle,$patch$
    if not private.require_aal2() or not exists(select 1 from public.homes h where h.organization_id=p_organization_id and h.id=p_home_id and private.has_permission(p_organization_id,auth.uid(),'structure.manage',h.neighborhood_id,h.id)) then
      raise exception using errcode='42501',message='home is outside your administrative scope'; end if;
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_save_home_milestone(uuid,uuid,uuid,text,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='perform private.require_admin_permission(p_organization_id,''structure.manage'');';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'milestone command changed; review hierarchy guard'; end if;
  execute replace(definition,needle,$patch$
    if not private.require_aal2() or not exists(select 1 from public.homes h where h.organization_id=p_organization_id and h.id=p_home_id and private.has_permission(p_organization_id,auth.uid(),'structure.manage',h.neighborhood_id,h.id)) then
      raise exception using errcode='42501',message='home is outside your administrative scope'; end if;
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_save_company(uuid,uuid,text,text,public.organization_status)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='perform private.require_admin_permission(p_organization_id, ''roster.manage'');';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'company command changed; review hierarchy guard'; end if;
  execute replace(definition,needle,$patch$
    if p_id is null then perform private.require_admin_permission(p_organization_id,'roster.manage');
    elsif not private.require_aal2() or not private.controls_company(p_organization_id,auth.uid(),p_id) then
      raise exception using errcode='42501',message='vendor is controlled by a higher administrator or outside your scope'; end if;
    perform 1 from public.companies where organization_id=p_organization_id and id=p_id for update;
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_save_roster(uuid,uuid,uuid,uuid,uuid,public.organization_status,timestamptz,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'roster command changed; review hierarchy guard'; end if;
  definition:=replace(definition,needle,$patch$
    if not private.require_aal2() or private.admin_level(p_organization_id,auth.uid(),'neighborhood',null,p_neighborhood_id) is null
      or not private.company_covers(p_organization_id,p_company_id,p_neighborhood_id) then raise exception using errcode='42501',message='vendor eligibility is outside your scope or approved coverage'; end if;
    if p_id is not null and exists(select 1 from public.neighborhood_trade_rosters r where r.organization_id=p_organization_id and r.id=p_id
      and (private.admin_level(p_organization_id,auth.uid(),'neighborhood',null,r.neighborhood_id) is null or private.admin_level(p_organization_id,auth.uid(),'neighborhood',null,r.neighborhood_id)>r.authority_level)) then
      raise exception using errcode='42501',message='eligibility was granted by a higher administrator'; end if;
  $patch$);
  definition:=replace(definition,'perform private.append_audit(p_organization_id,auth.uid(),''roster.saved''',
    'update public.neighborhood_trade_rosters set granted_by=coalesce(granted_by,auth.uid()),authority_level=least(authority_level,private.admin_level(p_organization_id,auth.uid(),''neighborhood'',null,p_neighborhood_id)) where id=result.id; perform private.append_audit(p_organization_id,auth.uid(),''roster.saved''');
  -- A new grant starts at its creator level; existing higher-level ownership stays protected.
  definition:=replace(definition,'(organization_id,neighborhood_id,company_id,specialty_id,status,active_from,active_to) values(p_organization_id,p_neighborhood_id,p_company_id,p_specialty_id,p_status,p_active_from,p_active_to)',
    '(organization_id,neighborhood_id,company_id,specialty_id,status,active_from,active_to,granted_by,authority_level) values(p_organization_id,p_neighborhood_id,p_company_id,p_specialty_id,p_status,p_active_from,p_active_to,auth.uid(),private.admin_level(p_organization_id,auth.uid(),''neighborhood'',null,p_neighborhood_id))');
  execute definition;
end; $migration$;

create function private.require_catalog_authority(p_org uuid,p_entity text,p_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
declare neighborhood uuid; division uuid; home uuid; level smallint; roster public.neighborhood_trade_rosters;
begin
  if auth.uid() is null or not private.require_aal2() then raise exception using errcode='42501',message='verify your authenticator before administrative changes'; end if;
  if p_entity='division' then
    if private.admin_level(p_org,auth.uid(),'division',p_id) is null then raise exception using errcode='42501',message='division is outside your authority'; end if;
  elsif p_entity='neighborhood' then
    if private.admin_level(p_org,auth.uid(),'neighborhood',null,p_id) is null then raise exception using errcode='42501',message='neighborhood is outside your authority'; end if;
  elsif p_entity='home' then
    select neighborhood_id into neighborhood from public.homes where organization_id=p_org and id=p_id;
    if neighborhood is null or not private.has_permission(p_org,auth.uid(),'structure.manage',neighborhood,p_id) then raise exception using errcode='42501',message='home is outside your authority'; end if;
  elsif p_entity='company' then
    perform 1 from public.companies where organization_id=p_org and id=p_id for update;
    if not private.controls_company(p_org,auth.uid(),p_id) then raise exception using errcode='42501',message='vendor has protected ownership or coverage outside your authority'; end if;
    update public.companies c set owner_authority_level=least(c.owner_authority_level,private.admin_level(p_org,auth.uid(),c.owner_scope_kind,c.owner_division_id,c.owner_neighborhood_id,null))
      where c.organization_id=p_org and c.id=p_id;
  elsif p_entity='roster' then
    select * into roster from public.neighborhood_trade_rosters where organization_id=p_org and id=p_id for update;
    level:=private.admin_level(p_org,auth.uid(),'neighborhood',null,roster.neighborhood_id);
    if level is null or level>roster.authority_level or (p_active and not private.company_covers(p_org,roster.company_id,roster.neighborhood_id)) then
      raise exception using errcode='42501',message='eligibility is protected or outside your authority or vendor coverage'; end if;
  elsif p_entity='inspection_engagement' then
    select neighborhood_id,home_id into neighborhood,home from public.inspection_engagements where organization_id=p_org and id=p_id;
    if not private.has_permission(p_org,auth.uid(),'inspection.manage',neighborhood,home) then raise exception using errcode='42501',message='inspection engagement is outside your authority'; end if;
  else
    perform private.require_admin_permission(p_org,case when p_entity='specialty' then 'roster.manage' else 'config.manage' end);
  end if;
end; $$;
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.admin_set_catalog_status(uuid,text,uuid,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='perform private.require_admin_permission(p_organization_id,required_permission);';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'catalog lifecycle changed; review hierarchy guard'; end if;
  execute replace(definition,needle,'perform private.require_catalog_authority(p_organization_id,p_entity,p_id,p_active);');
  definition:=replace(pg_get_functiondef('public.current_access(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='''scope_kind'', ra.scope_kind,';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'current_access changed; review scope serialization'; end if;
  execute replace(definition,needle,needle||'''division_id'',ra.division_id,''company_id'',ra.company_id,''authority_level'',ra.authority_level,');
  definition:=replace(pg_get_functiondef('public.admin_save_company(uuid,uuid,text,text,public.organization_status)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if length(trim(coalesce(p_name,'''')))';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'company validation changed'; end if;
  execute replace(definition,needle,$patch$
    if p_status<>'active' and exists(select 1 from public.assignment_episodes ae join public.work_items w on w.organization_id=ae.organization_id and w.current_assignment_id=ae.id
      where ae.organization_id=p_organization_id and ae.company_id=p_id and ae.ended_at is null and w.state not in ('verified','cancelled')) then
      raise exception using errcode='23514',message='vendor has active assignments'; end if;
    if p_id is not null then update public.companies c set owner_authority_level=least(c.owner_authority_level,private.admin_level(p_organization_id,auth.uid(),c.owner_scope_kind,c.owner_division_id,c.owner_neighborhood_id,null))
      where c.organization_id=p_organization_id and c.id=p_id and c.status is distinct from p_status; end if;
    if length(trim(coalesce(p_name,'')))
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_save_inspector_engagement(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='perform private.require_admin_permission(p_organization_id, ''config.manage'');';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'engagement command changed'; end if;
  execute replace(definition,needle,$patch$
    if not private.require_aal2() or not private.has_permission(p_organization_id,auth.uid(),'inspection.manage',p_neighborhood_id,p_home_id)
      or (p_id is not null and not exists(select 1 from public.inspection_engagements e where e.organization_id=p_organization_id and e.id=p_id and private.has_permission(p_organization_id,auth.uid(),'inspection.manage',e.neighborhood_id,e.home_id))) then
      raise exception using errcode='42501',message='inspection engagement is outside your authority'; end if;
  $patch$);
  definition:=replace(pg_get_functiondef('public.admin_revoke_inspector_engagement(uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'engagement revocation changed'; end if;
  execute replace(definition,needle,'perform private.require_catalog_authority(p_organization_id,''inspection_engagement'',p_id,false);');
end; $migration$;

alter table public.company_access_grants enable row level security;
revoke all on public.company_access_grants from public,anon,authenticated;
grant select on public.company_access_grants to authenticated;
grant all on public.company_access_grants to service_role;
create policy company_access_visible on public.company_access_grants for select to authenticated using(private.can_read_company(organization_id,auth.uid(),company_id));
drop policy companies_scoped_select on public.companies;
create policy companies_scoped_select on public.companies for select to authenticated using(private.can_read_company(organization_id,auth.uid(),id));
drop policy company_memberships_scoped_select on public.company_memberships;
create policy company_memberships_scoped_select on public.company_memberships for select to authenticated using(
  user_id=auth.uid() or private.vendor_admin(organization_id,auth.uid(),company_id) or private.controls_company(organization_id,auth.uid(),company_id)
  or (private.can_read_company(organization_id,auth.uid(),company_id) and exists(select 1 from public.role_assignments mine
    join public.role_permissions rp on rp.role_code=mine.role_code and rp.permission_code='access.manage'
    where mine.organization_id=company_memberships.organization_id and mine.user_id=auth.uid() and mine.revoked_at is null and mine.starts_at<=now()
      and (mine.ends_at is null or mine.ends_at>now()) and private.role_grant_enabled(mine))));
drop policy memberships_self_or_admin_select on public.organization_memberships;
create policy memberships_self_or_admin_select on public.organization_memberships for select to authenticated using(user_id=auth.uid() or private.can_read_member(organization_id,auth.uid(),user_id));
drop policy role_assignments_self_or_admin_select on public.role_assignments;
create policy role_assignments_self_or_admin_select on public.role_assignments for select to authenticated using(user_id=auth.uid()
  or private.admin_level(organization_id,auth.uid(),scope_kind,division_id,neighborhood_id,home_id) is not null
  or (company_id is not null and (private.controls_company(organization_id,auth.uid(),company_id) or private.vendor_admin(organization_id,auth.uid(),company_id))));
drop policy divisions_scoped_select on public.divisions;
create policy divisions_scoped_select on public.divisions for select to authenticated using(private.active_member(organization_id,auth.uid()) and
  exists(select 1 from public.role_assignments a where a.organization_id=divisions.organization_id and a.user_id=auth.uid() and a.revoked_at is null
    and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()) and private.role_grant_enabled(a) and
    (a.scope_kind='organization' or (a.scope_kind='division' and a.division_id=divisions.id) or
      (a.scope_kind in ('neighborhood','home') and exists(select 1 from public.neighborhoods n where n.organization_id=a.organization_id and n.id=a.neighborhood_id and n.division_id=divisions.id)))));
drop policy invites_admin_select on public.invites;
create policy invites_admin_select on public.invites for select to authenticated using(private.can_revoke_invitation(auth.uid(),invites) or (invited_by=auth.uid() and private.active_member(organization_id,auth.uid())));

-- New company-scoped permissions never grant broad access to other vendors' work.
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('private.has_permission(uuid,uuid,text,uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='a.scope_kind=''company'' and private.company_covers';
  execute replace(definition,needle,'a.scope_kind=''company'' and p_permission in (''work.execute_assigned'',''comment.create_shared'',''evidence.upload'',''company.users.manage'') and private.company_covers');
  definition:=replace(pg_get_functiondef('public.save_role_definition(uuid,text,text,text,public.scope_kind[],text[],boolean,boolean,boolean,bigint)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:=$needle$if p_permissions && array['structure.manage','access.manage','roster.manage','config.manage'] and
    (p_scopes<>array['organization']::public.scope_kind[] or p_requires_company) then
    raise exception using errcode='22023',message='administrative permissions require organization-only scope and cannot require a trade company';
  end if;$needle$;
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'role definition validation changed; review hierarchy restrictions'; end if;
  execute replace(definition,needle,$patch$
    if 'config.manage'=any(p_permissions) and (p_scopes<>array['organization']::public.scope_kind[] or p_requires_company) then
      raise exception using errcode='22023',message='organization configuration requires organization-only scope'; end if;
    if p_permissions && array['structure.manage','access.manage','roster.manage'] and
      (not(p_scopes<@array['organization','division','neighborhood']::public.scope_kind[]) or p_requires_company) then
      raise exception using errcode='22023',message='builder administration requires organization, division, or neighborhood scope'; end if;
    if 'company'=any(p_scopes) and (not p_requires_company or not(p_permissions<@array['company.users.manage','work.execute_assigned','comment.create_shared','evidence.upload'])) then
      raise exception using errcode='22023',message='company scope supports only company users and assigned-work permissions'; end if;
    if 'company.users.manage'=any(p_permissions) and not('access.manage'=any(p_permissions)) and (not p_requires_company or p_scopes<>array['company']::public.scope_kind[]) then
      raise exception using errcode='22023',message='vendor user administration requires company-only scope'; end if;
  $patch$);
end; $migration$;

create function private.initialize_vendor_coverage() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.company_access_grants(organization_id,company_id,scope_kind,division_id,neighborhood_id,authority_level,granted_by)
    values(new.organization_id,new.id,new.owner_scope_kind,new.owner_division_id,new.owner_neighborhood_id,new.owner_authority_level,coalesce(new.created_by,auth.uid()));
  return new;
end; $$;
create trigger initialize_vendor_coverage after insert on public.companies for each row execute function private.initialize_vendor_coverage();

create function private.company_work_permission(p_org uuid,p_user uuid,p_company uuid,p_neighborhood uuid,p_home uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_user) and private.company_covers(p_org,p_company,p_neighborhood) and exists(
    select 1 from public.role_assignments a join public.roles r on r.code=a.role_code join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='work.execute_assigned'
    where a.organization_id=p_org and a.user_id=p_user and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
      and private.role_grant_enabled(a) and (not r.requires_company or a.company_id is null or a.company_id=p_company)
      and ((a.scope_kind='company' and a.company_id=p_company) or private.scope_contains(p_org,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,
        case when p_home is null then 'neighborhood'::public.scope_kind else 'home'::public.scope_kind end,null,p_neighborhood,p_home)));
$$;
create or replace function private.can_execute_work(p_user_id uuid,p_work_item_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.work_items w join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id and ae.ended_at is null
    where w.id=p_work_item_id and private.active_member(w.organization_id,p_user_id) and
      ((ae.internal_assignee_user_id=p_user_id and private.has_permission(w.organization_id,p_user_id,'work.execute_assigned',w.neighborhood_id,w.home_id)) or
        (private.company_work_permission(w.organization_id,p_user_id,ae.company_id,w.neighborhood_id,w.home_id) and
          (private.active_company_membership(w.organization_id,ae.company_id,p_user_id,'manager') or
            (ae.technician_user_id=p_user_id and private.active_company_membership(w.organization_id,ae.company_id,p_user_id,'technician'))))));
$$;
create or replace function private.can_read_work(p_user_id uuid,p_work_item_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.work_items w left join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id
    where w.id=p_work_item_id and private.active_member(w.organization_id,p_user_id) and
    ((w.state='draft' and w.created_by=p_user_id and private.has_permission(w.organization_id,p_user_id,'work.create',w.neighborhood_id,w.home_id)) or
      private.has_permission(w.organization_id,p_user_id,'work.read_scope',w.neighborhood_id,w.home_id) or
      private.has_permission(w.organization_id,p_user_id,'work.verify',w.neighborhood_id,w.home_id) or
      private.can_execute_work(p_user_id,w.id) or
      (ae.internal_assignee_user_id=p_user_id and private.has_permission(w.organization_id,p_user_id,'work.execute_assigned',w.neighborhood_id,w.home_id)) or
      (private.company_work_permission(w.organization_id,p_user_id,ae.company_id,w.neighborhood_id,w.home_id) and
        (private.active_company_membership(w.organization_id,ae.company_id,p_user_id,'manager') or (ae.technician_user_id=p_user_id and private.active_company_membership(w.organization_id,ae.company_id,p_user_id,'technician')))) or
      exists(select 1 from public.inspection_participants ip join public.inspections i on i.organization_id=ip.organization_id and i.id=ip.inspection_id
        where ip.user_id=p_user_id and w.inspection_id=i.id and (private.has_permission(w.organization_id,p_user_id,'inspection.perform',w.neighborhood_id,w.home_id) or private.has_permission(w.organization_id,p_user_id,'inspection.manage',w.neighborhood_id,w.home_id)))));
$$;

-- Member directories expose only overlapping administration areas or the vendor's own team.

drop policy company_memberships_scoped_select on public.company_memberships;
create policy company_memberships_scoped_select on public.company_memberships for select to authenticated using(user_id=auth.uid() or private.company_team_visible(organization_id,auth.uid(),company_id));


create or replace function public.participant_directory(p_organization_id uuid,p_neighborhood_id uuid default null)
returns table(user_id uuid,display_name text,affiliation public.affiliation_kind)
language sql stable security definer set search_path='' as $$
  select distinct m.user_id,p.display_name,m.affiliation from public.organization_memberships m join public.profiles p on p.id=m.user_id
  where m.organization_id=p_organization_id and m.status='active' and private.active_member(p_organization_id,auth.uid()) and
    (m.user_id=auth.uid() or private.can_read_member(p_organization_id,auth.uid(),m.user_id) or
      exists(select 1 from public.role_assignments mine join public.role_assignments theirs on theirs.organization_id=mine.organization_id
        where mine.organization_id=p_organization_id and mine.user_id=auth.uid() and theirs.user_id=m.user_id and mine.revoked_at is null and theirs.revoked_at is null
          and mine.starts_at<=now() and (mine.ends_at is null or mine.ends_at>now()) and theirs.starts_at<=now() and (theirs.ends_at is null or theirs.ends_at>now())
          and private.role_grant_enabled(mine) and private.role_grant_enabled(theirs) and mine.scope_kind<>'company' and theirs.scope_kind<>'company'
          and exists(select 1 from public.neighborhoods n where n.organization_id=p_organization_id and (p_neighborhood_id is null or n.id=p_neighborhood_id)
            and private.scope_contains(p_organization_id,mine.scope_kind,mine.division_id,mine.neighborhood_id,mine.home_id,'neighborhood',null,n.id,null)
            and private.scope_contains(p_organization_id,theirs.scope_kind,theirs.division_id,theirs.neighborhood_id,theirs.home_id,'neighborhood',null,n.id,null))))
    and (p_neighborhood_id is null or exists(select 1 from public.role_assignments theirs where theirs.organization_id=p_organization_id and theirs.user_id=m.user_id and theirs.revoked_at is null
      and theirs.starts_at<=now() and (theirs.ends_at is null or theirs.ends_at>now()) and private.role_grant_enabled(theirs)
      and (private.scope_contains(p_organization_id,theirs.scope_kind,theirs.division_id,theirs.neighborhood_id,theirs.home_id,'neighborhood',null,p_neighborhood_id,null)
        or (theirs.scope_kind='company' and private.company_covers(p_organization_id,theirs.company_id,p_neighborhood_id)))));
$$;

revoke all on function public.administration_context(uuid),public.admin_onboard_vendor(uuid,text,text,public.scope_kind,uuid,uuid),
  public.admin_set_vendor_coverage(uuid,uuid,public.scope_kind,uuid,uuid,uuid,boolean),public.vendor_access_context(uuid,uuid) from public,anon;
grant execute on function public.administration_context(uuid),public.admin_onboard_vendor(uuid,text,text,public.scope_kind,uuid,uuid),
  public.admin_set_vendor_coverage(uuid,uuid,public.scope_kind,uuid,uuid,uuid,boolean),public.vendor_access_context(uuid,uuid) to authenticated;

-- Retired role records remain in history. Existing grants are migrated without silently adding builder-administration rights.
do $migration$
declare invitation public.invites; g jsonb; grants jsonb; compatibility_needed boolean;
begin
  compatibility_needed:=exists(select 1 from public.role_assignments where role_code='area_manager' and revoked_at is null)
    or exists(select 1 from public.invites where status='pending' and expires_at>now() and exists(select 1 from jsonb_array_elements(proposed_grants) entry where entry->>'role_code'='area_manager'));
  if compatibility_needed then
    insert into public.roles(code,label,allowed_scope_kinds,description,default_for_new_organizations)
      select 'field_oversight','Field oversight',allowed_scope_kinds,'Compatibility role preserving former area-manager operations without adding user administration.',false from public.roles where code='area_manager';
    insert into public.role_permissions select 'field_oversight',permission_code from public.role_permissions where role_code='area_manager';
    insert into public.organization_roles(organization_id,role_code,enabled) select organization_id,'field_oversight',enabled from public.organization_roles where role_code='area_manager';
    update public.role_assignments set role_code='field_oversight' where role_code='area_manager' and revoked_at is null;
  end if;
  insert into public.organization_roles(organization_id,role_code,enabled)
    select distinct a.organization_id,r,true from public.role_assignments a cross join unnest(array['operations_coordinator','internal_contributor']) r where a.role_code='assistant_superintendent' and a.revoked_at is null
    on conflict(organization_id,role_code) do update set enabled=true;
  insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,home_id,starts_at,ends_at,granted_by,authority_level)
    select organization_id,user_id,r,scope_kind,neighborhood_id,home_id,starts_at,ends_at,granted_by,authority_level from public.role_assignments a
      cross join unnest(array['operations_coordinator','internal_contributor']) r where a.role_code='assistant_superintendent' and a.revoked_at is null;
  update public.role_assignments set revoked_at=now() where role_code='assistant_superintendent' and revoked_at is null;
  update public.role_assignments a set role_code='vendor_admin',company_id=(select cm.company_id from public.company_memberships cm where cm.organization_id=a.organization_id and cm.user_id=a.user_id and cm.kind='manager' and cm.revoked_at is null order by cm.created_at limit 1)
    where role_code='trade_manager' and revoked_at is null;
  for invitation in select * from public.invites where status='pending' and exists(select 1 from jsonb_array_elements(proposed_grants) entry where entry->>'role_code' in ('area_manager','assistant_superintendent','trade_manager')) loop
    grants:='[]';
    for g in select value from jsonb_array_elements(invitation.proposed_grants) loop
      if g->>'role_code'='assistant_superintendent' then grants:=grants||jsonb_build_array(g||jsonb_build_object('role_code','operations_coordinator'),g||jsonb_build_object('role_code','internal_contributor'));
      elsif g->>'role_code'='trade_manager' then grants:=grants||jsonb_build_array(g||jsonb_build_object('role_code','vendor_admin','company_id',invitation.proposed_company_id));
      elsif g->>'role_code'='area_manager' then grants:=grants||jsonb_build_array(g||jsonb_build_object('role_code','field_oversight'));
      else grants:=grants||jsonb_build_array(g); end if;
    end loop;
    update public.invites set proposed_grants=grants where id=invitation.id;
  end loop;
end; $migration$;
update public.roles set active=false,default_for_new_organizations=false,version=version+1,updated_at=now() where code in ('area_manager','assistant_superintendent','trade_manager');
update public.organization_roles set enabled=false where role_code in ('area_manager','assistant_superintendent','trade_manager');

-- Fine-grained custom management roles retain their existing permission boundaries.
do $migration$
declare definition text; signature text;
begin
  definition:=replace(pg_get_functiondef('private.controls_company(uuid,uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  execute replace(definition,'private.admin_level(p_org,p_user,','private.management_level(p_org,p_user,''roster.manage'',');
  foreach signature in array array['public.admin_onboard_vendor(uuid,text,text,public.scope_kind,uuid,uuid)',
    'public.admin_set_vendor_coverage(uuid,uuid,public.scope_kind,uuid,uuid,uuid,boolean)','public.vendor_access_context(uuid,uuid)',
    'public.admin_save_company(uuid,uuid,text,text,public.organization_status)','public.admin_save_roster(uuid,uuid,uuid,uuid,uuid,public.organization_status,timestamptz,timestamptz)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13)||chr(10),chr(10));
    execute replace(definition,'private.admin_level(p_organization_id,auth.uid(),','private.management_level(p_organization_id,auth.uid(),''roster.manage'',');
  end loop;
  foreach signature in array array['public.admin_save_division(uuid,uuid,text,public.organization_status)',
    'public.admin_save_neighborhood(uuid,uuid,uuid,text,text,text,public.organization_status,uuid)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13)||chr(10),chr(10));
    execute replace(definition,'private.admin_level(p_organization_id,auth.uid(),','private.management_level(p_organization_id,auth.uid(),''structure.manage'',');
  end loop;
  definition:=replace(pg_get_functiondef('private.require_catalog_authority(uuid,text,uuid,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'private.admin_level(p_org,auth.uid(),''division''','private.management_level(p_org,auth.uid(),''structure.manage'',''division''');
  definition:=replace(definition,'private.admin_level(p_org,auth.uid(),''neighborhood'',null,p_id)','private.management_level(p_org,auth.uid(),''structure.manage'',''neighborhood'',null,p_id)');
  definition:=replace(definition,'private.admin_level(p_org,auth.uid(),''neighborhood'',null,roster.neighborhood_id)','private.management_level(p_org,auth.uid(),''roster.manage'',''neighborhood'',null,roster.neighborhood_id)');
  definition:=replace(definition,'private.admin_level(p_org,auth.uid(),c.owner_scope_kind','private.management_level(p_org,auth.uid(),''roster.manage'',c.owner_scope_kind');
  execute definition;
end; $migration$;

create or replace function public.available_roles(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_organization_id,auth.uid()) then raise exception using errcode='42501',message='active organization membership required'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('permissions',(select coalesce(jsonb_agg(permission_code),'[]'::jsonb) from public.role_permissions where role_code=r.code)) order by r.label),'[]'::jsonb)
    from public.roles r where private.role_enabled(p_organization_id,r.code));
end; $$;

-- Keep existing escalation route identifiers compatible while routing division escalation to the new role.
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('private.schedule_due_notifications()'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='ra.role_code=''area_manager''';
  needle:=replace(needle,chr(13)||chr(10),chr(10));
  if strpos(definition,needle)=0 then raise exception 'notification scheduler changed; review division escalation'; end if;
  definition:=replace(definition,needle,'ra.role_code=''division_admin'' and private.role_grant_enabled(ra)');
  definition:=replace(definition,'(ra.scope_kind=''organization'' or (ra.scope_kind=''neighborhood'' and ra.neighborhood_id=r.neighborhood_id) or (ra.scope_kind=''home'' and ra.home_id=r.home_id))',
    'private.scope_contains(r.organization_id,ra.scope_kind,ra.division_id,ra.neighborhood_id,ra.home_id,''neighborhood'',null,r.neighborhood_id,null)');
  execute definition;
  definition:=replace(pg_get_functiondef('public.company_delegation_options(uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'if not found or episode.company_id is null or not private.active_company_membership',
    'if not found or episode.company_id is null or not private.can_read_work(auth.uid(),p_work_item_id) or not private.active_company_membership');
  execute definition;
end; $migration$;

-- Home-specific configuration is subject to the same geographic read boundary as the home itself.
drop policy home_milestones_config_select on public.home_milestones;
create policy home_milestones_config_select on public.home_milestones for select to authenticated using(exists(
  select 1 from public.homes h where h.organization_id=home_milestones.organization_id and h.id=home_milestones.home_id and private.has_any_scope(h.organization_id,auth.uid(),h.neighborhood_id,h.id)));
drop policy milestone_requirements_config_select on public.milestone_requirements;
create policy milestone_requirements_config_select on public.milestone_requirements for select to authenticated using(exists(
  select 1 from public.homes h where h.organization_id=milestone_requirements.organization_id and h.id=milestone_requirements.home_id and private.has_any_scope(h.organization_id,auth.uid(),h.neighborhood_id,h.id)));

commit;
