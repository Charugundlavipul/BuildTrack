begin;

-- Vendor administration is intentionally split by capability:
--   organization admin: company identity, coverage, lifecycle, all local work
--   division admin: contact/services, team, eligibility in the division
--   neighborhood admin: team and eligibility in assigned neighborhoods
-- Smaller authority numbers remain stronger and higher grants stay protected.
create or replace function private.company_team_level(p_org uuid,p_actor uuid,p_company uuid) returns smallint
language sql stable security definer set search_path='' as $$
  select min(private.management_level(p_org,p_actor,'access.manage','neighborhood',null,n.id,null))::smallint
  from public.neighborhoods n
  where n.organization_id=p_org and n.status='active' and private.company_covers(p_org,p_company,n.id)
    and private.management_level(p_org,p_actor,'access.manage','neighborhood',null,n.id,null) is not null;
$$;

create or replace function private.company_team_visible(p_org uuid,p_actor uuid,p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_actor) and (
    private.vendor_admin(p_org,p_actor,p_company) or private.company_team_level(p_org,p_actor,p_company) is not null
  );
$$;

create or replace function private.can_manage_company_member(p_actor uuid,p_member public.company_memberships) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(private.company_team_level(p_member.organization_id,p_actor,p_member.company_id)<=p_member.authority_level,false)
    or (p_member.authority_level=4 and private.vendor_admin(p_member.organization_id,p_actor,p_member.company_id));
$$;

create or replace function private.can_edit_company_profile(p_org uuid,p_actor uuid,p_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.vendor_admin(p_org,p_actor,p_company)
    or private.company_team_level(p_org,p_actor,p_company) in (1,2);
$$;

create or replace function private.delegation_level(p_org uuid,p_actor uuid,p_role text,p_scope public.scope_kind,
  p_division uuid,p_neighborhood uuid,p_home uuid,p_company uuid,p_start timestamptz,p_end timestamptz)
returns smallint language plpgsql stable security definer set search_path='' as $$
declare requested public.roles; level smallint;
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
    if private.vendor_admin(p_org,p_actor,p_company) and p_role in ('vendor_admin','trade_technician') then return 4; end if;
    level:=private.company_team_level(p_org,p_actor,p_company);
    if level is null then return null; end if;
    return level;
  elsif requested.requires_company and not private.company_covers(p_org,p_company,p_neighborhood) then return null;
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

-- Existing access editing can use a locally covered company, but the stored
-- authority level still prevents a local admin from changing/removing a member
-- granted by an organization or division administrator.
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.admin_onboard_vendor(uuid,text,text,public.scope_kind,uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if not private.require_aal2() or level is null or p_scope not in (''organization'',''division'',''neighborhood'') then';
  if strpos(definition,needle)=0 then raise exception 'vendor onboarding authority guard changed; review scoped vendor migration'; end if;
  definition:=replace(definition,needle,'if not private.require_aal2() or level is null or level>2 or p_scope not in (''organization'',''division'',''neighborhood'') then');
  execute definition;

  definition:=replace(pg_get_functiondef('public.admin_set_member_access(uuid,uuid,public.affiliation_kind,jsonb,uuid,text)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if not private.controls_company(p_organization_id,auth.uid(),p_company_id) and not private.vendor_admin(p_organization_id,auth.uid(),p_company_id) then raise exception using errcode=''42501'',message=''this company is outside your management authority''; end if;';
  if strpos(definition,needle)=0 then raise exception 'member company authority guard changed; review scoped vendor migration'; end if;
  definition:=replace(definition,needle,'if private.company_team_level(p_organization_id,auth.uid(),p_company_id) is null and not private.vendor_admin(p_organization_id,auth.uid(),p_company_id) then raise exception using errcode=''42501'',message=''this company team is outside your management authority''; end if;');
  needle:='select case when private.vendor_admin(p_organization_id,auth.uid(),p_company_id) and not private.controls_company(p_organization_id,auth.uid(),p_company_id) then 4'||chr(10)||
    '      else private.admin_level(p_organization_id,auth.uid(),c.owner_scope_kind,c.owner_division_id,c.owner_neighborhood_id,null) end into company_level from public.companies c where c.id=p_company_id;';
  if strpos(definition,needle)=0 then raise exception 'member company level calculation changed; review scoped vendor migration'; end if;
  definition:=replace(definition,needle,'select case when private.vendor_admin(p_organization_id,auth.uid(),p_company_id) then 4 else private.company_team_level(p_organization_id,auth.uid(),p_company_id) end into company_level;');
  execute definition;

  definition:=replace(pg_get_functiondef('public.admin_set_vendor_coverage(uuid,uuid,public.scope_kind,uuid,uuid,uuid,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='begin'||chr(10)||'  if auth.uid() is null or not private.require_aal2() then';
  if strpos(definition,needle)=0 then raise exception 'vendor coverage guard changed; review scoped vendor migration'; end if;
  definition:=replace(definition,needle,'begin'||chr(10)||'  if private.admin_level(p_organization_id,auth.uid(),''organization'') is distinct from 1::smallint then raise exception using errcode=''42501'',message=''only an organization administrator may change approved vendor coverage''; end if;'||chr(10)||'  if auth.uid() is null or not private.require_aal2() then');
  execute definition;
end; $migration$;

create or replace function public.administration_context(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_organization_id,auth.uid()) then raise exception using errcode='42501',message='active membership required'; end if;
  return jsonb_build_object('organization_admin',coalesce(private.admin_level(p_organization_id,auth.uid(),'organization')=1,false),
    'companies',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.companies c where c.organization_id=p_organization_id and c.status='active'
      and private.company_team_visible(p_organization_id,auth.uid(),c.id)),'[]'::jsonb),
    'grants',coalesce((select jsonb_agg(jsonb_build_object('scope_kind',a.scope_kind,'division_id',a.division_id,'neighborhood_id',a.neighborhood_id,'home_id',a.home_id,'company_id',a.company_id,'ends_at',a.ends_at,
        'permissions',(select jsonb_agg(rp.permission_code) from public.role_permissions rp where rp.role_code=a.role_code)))
      from public.role_assignments a where a.organization_id=p_organization_id and a.user_id=auth.uid() and a.revoked_at is null and a.starts_at<=now()
        and (a.ends_at is null or a.ends_at>now()) and private.role_grant_enabled(a)
        and exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code in ('access.manage','company.users.manage','structure.manage','roster.manage'))),'[]'::jsonb));
end; $$;

create or replace function public.vendor_access_context(p_organization_id uuid,p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company public.companies; org_admin boolean; team_level smallint;
begin
  select * into company from public.companies where organization_id=p_organization_id and id=p_company_id;
  if not found or not private.can_read_company(p_organization_id,auth.uid(),p_company_id) then raise exception using errcode='42501',message='vendor is outside your access'; end if;
  org_admin:=coalesce(private.admin_level(p_organization_id,auth.uid(),'organization')=1,false);
  team_level:=private.company_team_level(p_organization_id,auth.uid(),p_company_id);
  return jsonb_build_object(
    'can_edit',org_admin,
    'can_edit_company_details',org_admin,
    'can_edit_profile',private.can_edit_company_profile(p_organization_id,auth.uid(),p_company_id),
    'can_deactivate',org_admin,
    'can_manage_coverage',org_admin,
    'can_manage_team',team_level is not null or private.vendor_admin(p_organization_id,auth.uid(),p_company_id),
    'can_manage_eligibility',exists(select 1 from public.neighborhoods n where n.organization_id=p_organization_id and n.status='active'
      and private.company_covers(p_organization_id,p_company_id,n.id)
      and private.management_level(p_organization_id,auth.uid(),'roster.manage','neighborhood',null,n.id,null) is not null),
    'owner_scope_kind',company.owner_scope_kind,
    'owner_label',case company.owner_scope_kind when 'organization' then 'Organization' when 'division' then (select name from public.divisions where id=company.owner_division_id) else (select name from public.neighborhoods where id=company.owner_neighborhood_id) end,
    'coverage',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('label',case g.scope_kind when 'organization' then 'Entire organization' when 'division' then (select name from public.divisions where id=g.division_id) else (select name from public.neighborhoods where id=g.neighborhood_id) end,
      'can_remove',org_admin)) from public.company_access_grants g where g.organization_id=p_organization_id and g.company_id=p_company_id and g.revoked_at is null),'[]'::jsonb));
end; $$;

create or replace function public.company_profile_context(p_org uuid,p_company uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare profile_editor boolean; ein_editor boolean;
begin
  if not private.can_read_company(p_org,auth.uid(),p_company) then raise insufficient_privilege using message='Company is unavailable.'; end if;
  profile_editor:=private.can_edit_company_profile(p_org,auth.uid(),p_company);
  ein_editor:=coalesce(private.admin_level(p_org,auth.uid(),'organization')=1,false) or private.vendor_admin(p_org,auth.uid(),p_company);
  return jsonb_build_object('can_edit',profile_editor,'can_edit_profile',profile_editor,'can_edit_ein',ein_editor,
    'ein',case when ein_editor then (select ein from public.company_private_details where organization_id=p_org and company_id=p_company) end);
end; $$;

create or replace function public.save_company_profile(p_org uuid,p_company uuid,p_email text,p_phone text,p_address text,p_ein text,p_categories text[],p_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.companies; ein_editor boolean;
begin
  select * into c from public.companies where organization_id=p_org and id=p_company for update;
  if not found or not private.require_aal2() or not private.can_edit_company_profile(p_org,auth.uid(),p_company) then raise insufficient_privilege using message='Contact and service management is unavailable for this company.'; end if;
  if c.version<>p_version then raise serialization_failure using message='Company changed. Refresh before saving.'; end if;
  if nullif(trim(p_email),'') is not null and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise check_violation using message='Enter a valid contact email.'; end if;
  if not coalesce(p_categories,'{}')<@array['plumbing','framing','third_party_inspection','drywall','electrical','roofing','hvac','landscaping','other'] or length(coalesce(p_phone,''))>40 or length(coalesce(p_address,''))>1000 then raise check_violation using message='Invalid company contact details or categories.'; end if;
  update public.companies set contact_email=nullif(trim(p_email),''),phone_number=nullif(trim(p_phone),''),physical_address=nullif(trim(p_address),''),categories=coalesce(p_categories,'{}'),updated_at=now(),version=version+1 where id=p_company returning * into c;
  ein_editor:=coalesce(private.admin_level(p_org,auth.uid(),'organization')=1,false) or private.vendor_admin(p_org,auth.uid(),p_company);
  if ein_editor then
    if nullif(trim(p_ein),'') is not null and p_ein !~ '^[0-9]{2}-?[0-9]{7}$' then raise check_violation using message='EIN must contain nine digits.'; end if;
    insert into public.company_private_details(organization_id,company_id,ein) values(p_org,p_company,nullif(trim(p_ein),'')) on conflict(company_id) do update set ein=excluded.ein;
  end if;
  perform private.append_audit(p_org,auth.uid(),'company.profile_updated','company',p_company,null,null,null,jsonb_build_object('categories',p_categories));
  return to_jsonb(c);
end; $$;

create or replace function public.admin_save_company(p_organization_id uuid,p_id uuid,p_name text,p_external_vendor_reference text default null,p_status public.organization_status default 'active')
returns public.companies language plpgsql security definer set search_path='' as $$
declare result public.companies; before_row jsonb;
begin
  if not private.require_aal2() or private.admin_level(p_organization_id,auth.uid(),'organization') is distinct from 1::smallint then
    raise exception using errcode='42501',message='only an organization administrator may change company identity details';
  end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception using errcode='22023',message='company name is required'; end if;
  if p_id is null then insert into public.companies(organization_id,name,external_vendor_reference,status) values(p_organization_id,trim(p_name),nullif(trim(p_external_vendor_reference),''),p_status) returning * into result;
  else select to_jsonb(c) into before_row from public.companies c where c.organization_id=p_organization_id and c.id=p_id for update;
    update public.companies set name=trim(p_name),external_vendor_reference=nullif(trim(p_external_vendor_reference),''),status=p_status,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000',message='company not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'company.saved','company',result.id,null,before_row,to_jsonb(result));
  return result;
end; $$;

create or replace function public.admin_save_roster(
  p_organization_id uuid,p_id uuid,p_neighborhood_id uuid,p_company_id uuid,
  p_status public.organization_status default 'active',p_active_from timestamptz default now(),p_active_to timestamptz default null
) returns public.neighborhood_trade_rosters language plpgsql security definer set search_path='' as $$
declare result public.neighborhood_trade_rosters; existing public.neighborhood_trade_rosters; before_row jsonb; actor_level smallint;
begin
  actor_level:=private.management_level(p_organization_id,auth.uid(),'roster.manage','neighborhood',null,p_neighborhood_id,null);
  if not private.require_aal2() or actor_level is null or not private.company_covers(p_organization_id,p_company_id,p_neighborhood_id) then
    raise exception using errcode='42501',message='vendor eligibility is outside your scope or approved coverage';
  end if;
  if p_active_to is not null and p_active_to<=p_active_from then raise exception using errcode='22023',message='roster end must follow its start'; end if;
  if not exists(select 1 from public.neighborhoods where organization_id=p_organization_id and id=p_neighborhood_id and status='active') then raise exception using errcode='22023',message='neighborhood is unavailable'; end if;
  if not exists(select 1 from public.companies where organization_id=p_organization_id and id=p_company_id and status='active') then raise exception using errcode='22023',message='company is unavailable'; end if;
  if p_id is not null then
    select * into existing from public.neighborhood_trade_rosters where organization_id=p_organization_id and id=p_id for update;
    if not found then raise exception using errcode='02000',message='roster entry not found'; end if;
    if private.management_level(p_organization_id,auth.uid(),'roster.manage','neighborhood',null,existing.neighborhood_id,null) is null then
      raise exception using errcode='42501',message='existing eligibility is outside your neighborhood authority';
    end if;
  end if;
  if p_id is null then
    insert into public.neighborhood_trade_rosters(organization_id,neighborhood_id,company_id,status,active_from,active_to,granted_by,authority_level)
      values(p_organization_id,p_neighborhood_id,p_company_id,p_status,p_active_from,p_active_to,auth.uid(),actor_level) returning * into result;
  else
    before_row:=to_jsonb(existing);
    update public.neighborhood_trade_rosters set neighborhood_id=p_neighborhood_id,company_id=p_company_id,status=p_status,active_from=p_active_from,active_to=p_active_to
      where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000',message='roster entry not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'roster.saved','neighborhood_trade_roster',result.id,null,before_row,to_jsonb(result));
  return result;
end; $$;

-- Company lifecycle remains an organization-level action. Eligibility status
-- changes retain the creator-level protection already used for people access.
do $status_guard$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.admin_set_catalog_status(uuid,text,uuid,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if required_permission is null then raise exception using errcode=''22023'',message=''unsupported catalog entity''; end if;';
  if strpos(definition,needle)=0 then raise exception 'catalog status validation changed; review scoped vendor migration'; end if;
  definition:=replace(definition,needle,needle||chr(10)||
    '  if p_entity=''company'' and private.admin_level(p_organization_id,auth.uid(),''organization'') is distinct from 1::smallint then raise exception using errcode=''42501'',message=''only an organization administrator may change company status''; end if;'||chr(10)||
    '  if p_entity=''roster'' and exists(select 1 from public.neighborhood_trade_rosters r where r.organization_id=p_organization_id and r.id=p_id and (private.management_level(p_organization_id,auth.uid(),''roster.manage'',''neighborhood'',null,r.neighborhood_id,null) is null or private.management_level(p_organization_id,auth.uid(),''roster.manage'',''neighborhood'',null,r.neighborhood_id,null)>r.authority_level)) then raise exception using errcode=''42501'',message=''eligibility status was set by a higher administrator''; end if;');
  execute definition;
end; $status_guard$;

revoke all on function private.company_team_level(uuid,uuid,uuid),private.company_team_visible(uuid,uuid,uuid),private.can_manage_company_member(uuid,public.company_memberships),private.can_edit_company_profile(uuid,uuid,uuid) from public,anon,authenticated;

notify pgrst, 'reload schema';

commit;
