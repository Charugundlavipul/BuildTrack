begin;

-- Platform oversight is deliberately metadata-only. No platform role is added
-- to organization memberships, RLS helpers, or construction-work permissions.
create function public.platform_list_providers(p_org uuid,p_search text default '',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  if not exists(select 1 from public.organizations where id=p_org) then raise no_data_found using message='Organization not found.'; end if;
  select jsonb_build_object('total',(select count(*) from public.companies c where c.organization_id=p_org and concat_ws(' ',c.name,c.contact_email,c.external_vendor_reference) ilike '%'||coalesce(p_search,'')||'%'),
    'rows',(select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]') from (
      select c.id,c.name,c.status,c.contact_email,c.phone_number,c.categories,c.external_vendor_reference,
        (select count(*) from public.company_memberships m where m.organization_id=p_org and m.company_id=c.id and m.revoked_at is null and m.active_from<=now() and (m.active_to is null or m.active_to>now())) member_count,
        (select count(*) from public.company_access_grants g where g.organization_id=p_org and g.company_id=c.id and g.revoked_at is null) coverage_count
      from public.companies c where c.organization_id=p_org and concat_ws(' ',c.name,c.contact_email,c.external_vendor_reference) ilike '%'||coalesce(p_search,'')||'%'
      order by c.name,c.id limit 25 offset greatest(coalesce(p_page,0),0)*25
    ) r)) into result;
  return result;
end; $$;

create function public.platform_get_provider(p_org uuid,p_company uuid,p_member_page integer default 0,p_coverage_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  if not exists(select 1 from public.companies where organization_id=p_org and id=p_company) then raise no_data_found using message='Provider not found in this organization.'; end if;
  select jsonb_build_object('company',(select jsonb_build_object('id',c.id,'name',c.name,'status',c.status,'contact_email',c.contact_email,'phone_number',c.phone_number,'physical_address',c.physical_address,
      'external_vendor_reference',c.external_vendor_reference,'categories',c.categories,'owner_scope_kind',c.owner_scope_kind,
      'owner_label',case c.owner_scope_kind when 'division' then (select name from public.divisions where organization_id=p_org and id=c.owner_division_id) when 'neighborhood' then (select name from public.neighborhoods where organization_id=p_org and id=c.owner_neighborhood_id) else 'Organization' end)
    from public.companies c where c.organization_id=p_org and c.id=p_company),
    'member_total',(select count(*) from public.company_memberships m where m.organization_id=p_org and m.company_id=p_company and m.revoked_at is null),
    'members',(select coalesce(jsonb_agg(to_jsonb(r) order by r.display_name,r.user_id),'[]') from (
      select m.user_id,p.display_name,p.first_name,p.last_name,u.email,p.phone_number,m.kind,om.status,m.active_from,m.active_to,
        (select coalesce(jsonb_agg(jsonb_build_object('label',r.label,'scope',a.scope_kind,'effective',private.active_member(p_org,m.user_id) and private.role_grant_enabled(a) and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())) order by r.label),'[]')
          from public.role_assignments a join public.roles r on r.code=a.role_code where a.organization_id=p_org and a.user_id=m.user_id and a.company_id=p_company and a.revoked_at is null) roles
      from public.company_memberships m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id join public.organization_memberships om on om.organization_id=m.organization_id and om.user_id=m.user_id
      where m.organization_id=p_org and m.company_id=p_company and m.revoked_at is null order by p.display_name,m.user_id limit 25 offset greatest(coalesce(p_member_page,0),0)*25
    ) r),
    'coverage_total',(select count(*) from public.company_access_grants g where g.organization_id=p_org and g.company_id=p_company and g.revoked_at is null),
    'coverage',(select coalesce(jsonb_agg(to_jsonb(r) order by r.scope,r.label,r.id),'[]') from (
      select g.id,g.scope_kind scope,case g.scope_kind when 'division' then d.name when 'neighborhood' then n.name else 'Organization' end label
      from public.company_access_grants g left join public.divisions d on d.organization_id=p_org and d.id=g.division_id left join public.neighborhoods n on n.organization_id=p_org and n.id=g.neighborhood_id
      where g.organization_id=p_org and g.company_id=p_company and g.revoked_at is null order by g.scope_kind,label,g.id limit 25 offset greatest(coalesce(p_coverage_page,0),0)*25
    ) r)) into result;
  return result;
end; $$;

-- Remove even per-user assignment counts from the platform response. Billing
-- usage totals are retained; work identities and work progress are not exposed.
do $patch$
declare definition text;
begin
  definition:=pg_get_functiondef('public.platform_get_operations(uuid,text,integer)'::regprocedure);
  if strpos(definition,'FUNCTION public.platform_get_operations(')=0 then raise exception 'Platform operations definition changed'; end if;
  execute replace(definition,'FUNCTION public.platform_get_operations(','FUNCTION private.platform_operations_base(');
end; $patch$;
create or replace function public.platform_get_operations(p_organization_id uuid,p_search text default '',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.platform_operations_base(p_organization_id,p_search,p_page);
  return jsonb_set(result,'{members}',coalesce((select jsonb_agg(m-'assigned_work') from jsonb_array_elements(result->'members') m),'[]'));
end; $$;
revoke all on function private.platform_operations_base(uuid,text,integer) from public,anon,authenticated;

alter table public.space_types add column version bigint not null default 1,add column updated_at timestamptz not null default now();
create table public.master_catalog_entries(
  kind text not null check(kind in ('company_category','construction_phase')),code text not null check(code~'^[a-z][a-z0-9_]{0,63}$'),
  label text not null check(length(trim(label)) between 1 and 120),active boolean not null default true,sort_order integer not null default 0,
  version bigint not null default 1,updated_at timestamptz not null default now(),primary key(kind,code));
insert into public.master_catalog_entries(kind,code,label,sort_order) values
  ('company_category','plumbing','Plumbing',10),('company_category','framing','Framing',20),('company_category','third_party_inspection','Third-party inspection',30),
  ('company_category','drywall','Drywall',40),('company_category','electrical','Electrical',50),('company_category','roofing','Roofing',60),('company_category','hvac','Heating & cooling',70),('company_category','landscaping','Landscaping',80),('company_category','other','Other',90),
  ('construction_phase','planned','Planned',10),('construction_phase','site_preparation','Site preparation',20),('construction_phase','foundation','Foundation',30),('construction_phase','framing','Framing',40),('construction_phase','rough_in','Rough-in',50),('construction_phase','interior_finishes','Interior finishes',60),('construction_phase','final_walkthrough','Final walkthrough',70),('construction_phase','complete','Complete',80);
alter table public.master_catalog_entries enable row level security;
grant select on public.master_catalog_entries to authenticated;
create policy master_catalog_read on public.master_catalog_entries for select to authenticated using(true);
create table public.platform_settings(singleton boolean primary key default true check(singleton),default_timezone text not null default 'America/New_York',version bigint not null default 1,updated_at timestamptz not null default now());
insert into public.platform_settings(singleton) values(true);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public,anon,authenticated;

create function public.workspace_defaults() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise insufficient_privilege using message='Sign in required.'; end if;
  return (select jsonb_build_object('default_timezone',default_timezone) from public.platform_settings where singleton);
end; $$;
create function public.platform_get_configuration() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object('settings',(select to_jsonb(s)-'singleton' from public.platform_settings s where singleton),
    'catalogs',(select coalesce(jsonb_agg(to_jsonb(r) order by kind,sort_order,label,code),'[]') from (
      select 'space_type'::text kind,code,label,active,0 sort_order,version from public.space_types
      union all select kind,code,label,active,sort_order,version from public.master_catalog_entries
    ) r));
end; $$;
create function public.platform_save_settings(p_timezone text,p_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.platform_settings;
begin
  perform private.require_platform_admin();
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise check_violation using message='Enter a valid IANA timezone.'; end if;
  update public.platform_settings set default_timezone=p_timezone,version=version+1,updated_at=now() where singleton and version=p_version returning * into result;
  if not found then raise serialization_failure using message='Defaults changed. Refresh before saving.'; end if;
  insert into public.platform_audit_events(actor_id,action,details) values(auth.uid(),'platform.defaults_updated',jsonb_build_object('default_timezone',p_timezone));
  return to_jsonb(result)-'singleton';
end; $$;
create function public.platform_save_catalog_entry(p_kind text,p_code text,p_label text,p_active boolean,p_sort_order integer,p_version bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; existing_version bigint;
begin
  perform private.require_platform_admin();
  if p_code is null or p_code!~'^[a-z][a-z0-9_]{0,63}$' or length(trim(coalesce(p_label,''))) not between 1 and 120 or p_active is null or p_sort_order is null or p_sort_order not between 0 and 10000 then raise check_violation using message='Enter a stable code, label, and order between 0 and 10000.'; end if;
  if p_kind='space_type' then
    select version into existing_version from public.space_types where code=p_code for update;
    if found then
      if p_version is null or existing_version<>p_version then raise serialization_failure using message='Catalog entry changed. Refresh before saving.'; end if;
      update public.space_types set label=trim(p_label),active=p_active,version=version+1,updated_at=now() where code=p_code returning to_jsonb(space_types) into result;
    else
      if p_version is not null then raise no_data_found using message='Catalog entry no longer exists.'; end if;
      insert into public.space_types(code,label,active) values(p_code,trim(p_label),p_active) returning to_jsonb(space_types) into result;
    end if;
  elsif p_kind in ('company_category','construction_phase') then
    select version into existing_version from public.master_catalog_entries where kind=p_kind and code=p_code for update;
    if found then
      if p_version is null or existing_version<>p_version then raise serialization_failure using message='Catalog entry changed. Refresh before saving.'; end if;
      update public.master_catalog_entries set label=trim(p_label),active=p_active,sort_order=p_sort_order,version=version+1,updated_at=now() where kind=p_kind and code=p_code returning to_jsonb(master_catalog_entries) into result;
    else
      if p_version is not null then raise no_data_found using message='Catalog entry no longer exists.'; end if;
      insert into public.master_catalog_entries(kind,code,label,active,sort_order) values(p_kind,p_code,trim(p_label),p_active,p_sort_order) returning to_jsonb(master_catalog_entries) into result;
    end if;
  else raise check_violation using message='Choose a supported master catalog.'; end if;
  insert into public.platform_audit_events(actor_id,action,entity_id,details) values(auth.uid(),'catalog.entry_saved',p_kind||':'||p_code,jsonb_build_object('kind',p_kind,'entry',result));
  return result;
end; $$;

-- Company categories are now maintained in the master catalog. Existing retired
-- categories remain readable and can be retained, but cannot be assigned anew.
do $patch$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.save_company_profile(uuid,uuid,text,text,text,text,text[],bigint)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='not coalesce(p_categories,''{}'')<@array[''plumbing'',''framing'',''third_party_inspection'',''drywall'',''electrical'',''roofing'',''hvac'',''landscaping'',''other'']';
  if strpos(definition,needle)=0 then raise exception 'Company category validation changed'; end if;
  execute replace(definition,needle,'exists(select 1 from unnest(coalesce(p_categories,''{}'')) category where not exists(select 1 from public.master_catalog_entries e where e.kind=''company_category'' and e.code=category and (e.active or category=any(c.categories))))');
  definition:=replace(pg_get_functiondef('public.save_master_plan(uuid,uuid,uuid,text,jsonb,boolean,bigint)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='t.code=s->>''type'' and t.active';
  if strpos(definition,needle)=0 then raise exception 'Plan space validation changed'; end if;
  execute replace(definition,needle,'t.code=s->>''type'' and (t.active or exists(select 1 from public.master_plans prior_plan where prior_plan.organization_id=p_org and prior_plan.id=p_id and exists(select 1 from jsonb_array_elements(prior_plan.spaces) old_space where old_space->>''type''=t.code)))');
  definition:=replace(pg_get_functiondef('public.save_home_space(uuid,uuid,uuid,text,uuid,boolean,text)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='where code=p_type and active';
  if strpos(definition,needle)=0 then raise exception 'Home space validation changed'; end if;
  execute replace(definition,needle,'where code=p_type and (active or exists(select 1 from public.home_locations existing where existing.organization_id=p_org and existing.home_id=p_home and existing.id=p_id and existing.space_type_code=p_type))');
end; $patch$;

revoke all on function public.platform_list_providers(uuid,text,integer),public.platform_get_provider(uuid,uuid,integer,integer),public.platform_get_configuration(),public.platform_save_settings(text,bigint),public.platform_save_catalog_entry(text,text,text,boolean,integer,bigint),public.workspace_defaults() from public,anon;
grant execute on function public.platform_list_providers(uuid,text,integer),public.platform_get_provider(uuid,uuid,integer,integer),public.platform_get_configuration(),public.platform_save_settings(text,bigint),public.platform_save_catalog_entry(text,text,text,boolean,integer,bigint),public.workspace_defaults() to authenticated;
commit;
