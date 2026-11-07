begin;

alter table public.home_locations
  add column level text,
  add column square_feet numeric(10,2),
  add constraint home_locations_level_length check(level is null or length(trim(level)) between 1 and 60),
  add constraint home_locations_square_feet_range check(square_feet is null or square_feet > 0 and square_feet <= 1000000);

create or replace function public.save_master_plan(p_org uuid,p_id uuid,p_division uuid,p_name text,p_spaces jsonb,p_active boolean,p_version bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.master_plans; previous public.master_plans;
begin
  if not private.active_member(p_org,auth.uid()) or not private.require_aal2() or not private.has_permission(p_org,auth.uid(),'plan.manage',null,null) and not exists(
    select 1 from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='plan.manage'
    where a.organization_id=p_org and a.user_id=auth.uid() and private.role_grant_enabled(a) and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
      and (a.scope_kind='organization' or a.scope_kind='division' and a.division_id=p_division)) then raise insufficient_privilege using message='Plan management in this division requires a verified administrator.'; end if;
  if jsonb_typeof(p_spaces)<>'array' or jsonb_array_length(p_spaces) not between 1 and 200 or exists(
    select 1 from jsonb_array_elements(p_spaces) s
    where nullif(trim(s->>'name'),'') is null or length(s->>'name')>120
      or not exists(select 1 from public.space_types t where t.code=s->>'type' and t.active)
      or s ? 'level' and s->'level' <> 'null'::jsonb and (jsonb_typeof(s->'level')<>'string' or length(trim(s->>'level')) not between 1 and 60)
      or s ? 'square_feet' and s->'square_feet' <> 'null'::jsonb and (jsonb_typeof(s->'square_feet')<>'number' or (s->>'square_feet')::numeric <= 0 or (s->>'square_feet')::numeric > 1000000)
  ) or (select count(*) from jsonb_array_elements(p_spaces))<>(select count(distinct lower(trim(s->>'name'))) from jsonb_array_elements(p_spaces) s) then
    raise check_violation using message='Choose a space type, unique name, valid level, and valid square footage for every space (1–200).';
  end if;
  if p_id is not null then
    select * into previous from public.master_plans where organization_id=p_org and id=p_id for update;
    if not found or previous.division_id<>p_division then raise insufficient_privilege using message='Plan is unavailable in this division.'; end if;
    if p_version is null or previous.version<>p_version then raise serialization_failure using message='This plan changed. Refresh before saving.'; end if;
    update public.master_plans set name=trim(p_name),spaces=p_spaces,active=p_active,version=version+1,updated_at=now() where id=p_id returning * into r;
  else insert into public.master_plans(organization_id,division_id,name,spaces,active) values(p_org,p_division,trim(p_name),p_spaces,p_active) returning * into r; end if;
  perform private.append_audit(p_org,auth.uid(),'plan.saved','master_plan',r.id,null,to_jsonb(previous),to_jsonb(r));
  return to_jsonb(r);
end; $$;

create or replace function public.apply_home_plan(p_org uuid,p_home uuid,p_plan uuid,p_home_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.homes; plan public.master_plans; space jsonb;
begin
  select * into h from public.homes where organization_id=p_org and id=p_home for update;
  if not found or not private.require_aal2() or not private.has_permission(p_org,auth.uid(),'structure.manage',h.neighborhood_id,h.id) then raise insufficient_privilege using message='Home management permission is required.'; end if;
  if h.version<>p_home_version then raise serialization_failure using message='Home changed. Refresh before applying a plan.'; end if;
  select p.* into plan from public.master_plans p join public.neighborhoods n on n.organization_id=p.organization_id and n.division_id=p.division_id where p.organization_id=p_org and p.id=p_plan and p.active and n.id=h.neighborhood_id;
  if not found then raise check_violation using message='Choose an active plan from this home’s division.'; end if;
  if exists(select 1 from public.home_locations where organization_id=p_org and home_id=p_home) then raise check_violation using message='Apply a plan before adding rooms. Existing rooms are preserved; customize them individually.'; end if;
  for space in select value from jsonb_array_elements(plan.spaces) loop
    insert into public.home_locations(organization_id,neighborhood_id,home_id,name,space_type_code,source_plan_id,level,square_feet)
    values(p_org,h.neighborhood_id,h.id,trim(space->>'name'),space->>'type',plan.id,nullif(trim(space->>'level'),''),nullif(space->>'square_feet','')::numeric);
  end loop;
  update public.homes set master_plan_id=plan.id,master_plan_version=plan.version,master_plan_name=plan.name where id=h.id returning * into h;
  perform private.append_audit(p_org,auth.uid(),'home.plan_applied','home',h.id,null,null,to_jsonb(h));
  return to_jsonb(h);
end; $$;

create function public.save_home_space(p_org uuid,p_id uuid,p_home uuid,p_name text,p_parent uuid,p_active boolean,p_type text,p_level text,p_square_feet numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.home_locations;
begin
  if p_type is not null and not exists(select 1 from public.space_types where code=p_type and active) then raise check_violation using message='Choose an available space type.'; end if;
  if nullif(trim(p_level),'') is not null and length(trim(p_level))>60 then raise check_violation using message='Level must be 60 characters or fewer.'; end if;
  if p_square_feet is not null and (p_square_feet<=0 or p_square_feet>1000000) then raise check_violation using message='Square footage must be between 1 and 1,000,000.'; end if;
  r:=public.admin_save_home_location(p_org,p_id,p_home,p_name,p_parent,p_active);
  update public.home_locations set space_type_code=p_type,level=nullif(trim(p_level),''),square_feet=p_square_feet where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;

revoke all on function public.save_home_space(uuid,uuid,uuid,text,uuid,boolean,text,text,numeric) from public,anon;
grant execute on function public.save_home_space(uuid,uuid,uuid,text,uuid,boolean,text,text,numeric) to authenticated;

commit;
