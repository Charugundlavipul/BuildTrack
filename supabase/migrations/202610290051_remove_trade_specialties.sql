begin;

-- Company categories are now the only trade classification. Neighborhood
-- eligibility is defined by vendor, neighborhood, and active date window.
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));

  foreach needle in array array[
    '  v_specialty_id uuid;'||chr(10),
    '      v_specialty_id := nullif(v_payload ->> ''specialty_id'','''')::uuid;'||chr(10),
    '          and (v_specialty_id is null or r.specialty_id = v_specialty_id) and r.status = ''active'''||chr(10),
    '        return private.command_error(v_operation_id, ''ASSIGNEE_INELIGIBLE'', ''The company is not actively rostered for this neighborhood and specialty.'');',
    '        organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id,'||chr(10),
    '        v_organization_id, v_item.id, v_internal_user, v_company_id, v_technician_id, v_specialty_id,'||chr(10),
    '      insert into public.assignment_episodes(organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id, assigned_by, due_at, reassignment_reason)'||chr(10),
    '        values (v_organization_id, v_item.id, v_episode.internal_assignee_user_id, v_episode.company_id, v_episode.technician_user_id, v_episode.specialty_id, v_actor, coalesce(v_item.due_at, now() + interval ''1 day''), ''Reopened: '' || trim(v_payload ->> ''reason''))'||chr(10)
  ] loop
    if strpos(definition,needle)=0 then raise exception 'execute_command specialty fragment changed; review removal migration: %',needle; end if;
  end loop;

  definition:=replace(definition,'  v_specialty_id uuid;'||chr(10),'');
  definition:=replace(definition,'      v_specialty_id := nullif(v_payload ->> ''specialty_id'','''')::uuid;'||chr(10),'');
  definition:=replace(definition,'          and (v_specialty_id is null or r.specialty_id = v_specialty_id) and r.status = ''active'''||chr(10),'          and r.status = ''active'''||chr(10));
  definition:=replace(definition,'        return private.command_error(v_operation_id, ''ASSIGNEE_INELIGIBLE'', ''The company is not actively rostered for this neighborhood and specialty.'');','        return private.command_error(v_operation_id, ''ASSIGNEE_INELIGIBLE'', ''The company is not currently eligible for this neighborhood.'');');
  definition:=replace(definition,'        organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id,'||chr(10),'        organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id,'||chr(10));
  definition:=replace(definition,'        v_organization_id, v_item.id, v_internal_user, v_company_id, v_technician_id, v_specialty_id,'||chr(10),'        v_organization_id, v_item.id, v_internal_user, v_company_id, v_technician_id,'||chr(10));
  definition:=replace(definition,'      insert into public.assignment_episodes(organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id, assigned_by, due_at, reassignment_reason)'||chr(10),'      insert into public.assignment_episodes(organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, assigned_by, due_at, reassignment_reason)'||chr(10));
  definition:=replace(definition,'        values (v_organization_id, v_item.id, v_episode.internal_assignee_user_id, v_episode.company_id, v_episode.technician_user_id, v_episode.specialty_id, v_actor, coalesce(v_item.due_at, now() + interval ''1 day''), ''Reopened: '' || trim(v_payload ->> ''reason''))'||chr(10),'        values (v_organization_id, v_item.id, v_episode.internal_assignee_user_id, v_episode.company_id, v_episode.technician_user_id, v_actor, coalesce(v_item.due_at, now() + interval ''1 day''), ''Reopened: '' || trim(v_payload ->> ''reason''))'||chr(10));
  execute definition;

  definition:=replace(pg_get_functiondef('public.admin_set_catalog_status(uuid,text,uuid,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'when p_entity in (''company'',''specialty'',''roster'') then ''roster.manage''','when p_entity in (''company'',''roster'') then ''roster.manage''');
  needle:=$remove$
  elsif p_entity='specialty' then
    select to_jsonb(t) into before_row from public.trade_specialties t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.trade_specialties set active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(trade_specialties.*) into after_row;$remove$;
  if strpos(definition,needle)=0 then raise exception 'catalog specialty branch changed; review removal migration'; end if;
  execute replace(definition,needle,'');

  definition:=replace(pg_get_functiondef('private.require_catalog_authority(uuid,text,uuid,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'perform private.require_admin_permission(p_org,case when p_entity=''specialty'' then ''roster.manage'' else ''config.manage'' end);','perform private.require_admin_permission(p_org,''config.manage'');');
  execute definition;
end; $migration$;

drop function if exists public.admin_save_specialty(uuid,uuid,text,text,boolean);
drop function if exists public.admin_save_roster(uuid,uuid,uuid,uuid,uuid,public.organization_status,timestamptz,timestamptz);

-- Preserve useful legacy classifications on the company before removing the
-- redundant catalog. Existing company categories are retained.
update public.companies c set categories=(
  select array(
    select distinct value from unnest(
      coalesce(c.categories,'{}'::text[]) || coalesce((
        select array_agg(lower(s.code))
        from public.neighborhood_trade_rosters r
        join public.trade_specialties s on s.organization_id=r.organization_id and s.id=r.specialty_id
        where r.organization_id=c.organization_id and r.company_id=c.id
      ),'{}'::text[])
    ) value where nullif(trim(value),'') is not null order by value
  )
);

-- Multiple old specialty rows can represent the same vendor/neighborhood.
-- Keep the strongest current record before enforcing the new uniqueness rule.
with ranked as (
  select id,row_number() over(
    partition by organization_id,neighborhood_id,company_id
    order by (status='active') desc,(active_to is null) desc,active_from desc,created_at desc,id
  ) ordinal
  from public.neighborhood_trade_rosters
)
delete from public.neighborhood_trade_rosters r using ranked x where r.id=x.id and x.ordinal>1;

alter table public.assignment_episodes drop column if exists specialty_id;
alter table public.neighborhood_trade_rosters drop column if exists specialty_id;
drop table if exists public.trade_specialties;

create unique index neighborhood_trade_rosters_active
  on public.neighborhood_trade_rosters(organization_id,neighborhood_id,company_id)
  where status='active' and active_to is null;

create function public.admin_save_roster(
  p_organization_id uuid,p_id uuid,p_neighborhood_id uuid,p_company_id uuid,
  p_status public.organization_status default 'active',p_active_from timestamptz default now(),p_active_to timestamptz default null
) returns public.neighborhood_trade_rosters language plpgsql security definer set search_path='' as $$
declare result public.neighborhood_trade_rosters; before_row jsonb; actor_level smallint;
begin
  actor_level:=private.management_level(p_organization_id,auth.uid(),'roster.manage','neighborhood',null,p_neighborhood_id,null);
  if not private.require_aal2() or actor_level is null or not private.company_covers(p_organization_id,p_company_id,p_neighborhood_id) then
    raise exception using errcode='42501',message='vendor eligibility is outside your scope or approved coverage';
  end if;
  if p_id is not null and exists(
    select 1 from public.neighborhood_trade_rosters r where r.organization_id=p_organization_id and r.id=p_id
      and (private.management_level(p_organization_id,auth.uid(),'roster.manage','neighborhood',null,r.neighborhood_id,null) is null
        or private.management_level(p_organization_id,auth.uid(),'roster.manage','neighborhood',null,r.neighborhood_id,null)>r.authority_level)
  ) then raise exception using errcode='42501',message='eligibility was granted by a higher administrator'; end if;
  if p_active_to is not null and p_active_to<=p_active_from then raise exception using errcode='22023',message='roster end must follow its start'; end if;
  if not exists(select 1 from public.neighborhoods where organization_id=p_organization_id and id=p_neighborhood_id and status='active') then raise exception using errcode='22023',message='neighborhood is unavailable'; end if;
  if not exists(select 1 from public.companies where organization_id=p_organization_id and id=p_company_id and status='active') then raise exception using errcode='22023',message='company is unavailable'; end if;
  if p_id is null then
    insert into public.neighborhood_trade_rosters(organization_id,neighborhood_id,company_id,status,active_from,active_to,granted_by,authority_level)
      values(p_organization_id,p_neighborhood_id,p_company_id,p_status,p_active_from,p_active_to,auth.uid(),actor_level) returning * into result;
  else
    select to_jsonb(r) into before_row from public.neighborhood_trade_rosters r where r.organization_id=p_organization_id and r.id=p_id for update;
    update public.neighborhood_trade_rosters set neighborhood_id=p_neighborhood_id,company_id=p_company_id,status=p_status,active_from=p_active_from,active_to=p_active_to,
      granted_by=coalesce(granted_by,auth.uid()),authority_level=least(authority_level,actor_level)
      where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000',message='roster entry not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'roster.saved','neighborhood_trade_roster',result.id,null,before_row,to_jsonb(result));
  return result;
end; $$;

revoke all on function public.admin_save_roster(uuid,uuid,uuid,uuid,public.organization_status,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_save_roster(uuid,uuid,uuid,uuid,public.organization_status,timestamptz,timestamptz) to authenticated;

update public.permissions set description='Manage categorized companies and neighborhood eligibility' where code='roster.manage';

commit;
