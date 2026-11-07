begin;

alter table public.master_plans
  add column if not exists levels integer not null default 1 check(levels between 1 and 50);

-- Convert legacy labels and numeric strings to bounded JSON numbers. A legacy
-- label such as "Main" becomes level 1 so every saved space follows one type.
update public.master_plans mp set spaces=normalized.spaces,levels=normalized.levels
from (
  select p.id,
    greatest(1,least(50,max(case when (s.value->>'level')~'^[0-9]+$' then (s.value->>'level')::int else 1 end))) levels,
    jsonb_agg(jsonb_set(s.value,'{level}',to_jsonb(greatest(1,least(50,case when (s.value->>'level')~'^[0-9]+$' then (s.value->>'level')::int else 1 end))),true) order by s.ordinality) spaces
  from public.master_plans p cross join lateral jsonb_array_elements(p.spaces) with ordinality s(value,ordinality)
  group by p.id
) normalized where normalized.id=mp.id;

drop function if exists public.save_master_plan(uuid,uuid,uuid,text,jsonb,boolean,bigint);

create or replace function public.save_master_plan(
  p_org uuid,
  p_id uuid,
  p_division uuid,
  p_name text,
  p_spaces jsonb,
  p_active boolean,
  p_version bigint default null,
  p_levels integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.master_plans;
  previous public.master_plans;
  v_levels integer;
begin
  if not private.active_member(p_org,auth.uid()) or not private.require_aal2() or not private.has_permission(p_org,auth.uid(),'plan.manage',null,null) and not exists(
    select 1 from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='plan.manage'
    where a.organization_id=p_org and a.user_id=auth.uid() and private.role_grant_enabled(a) and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
      and (a.scope_kind='organization' or a.scope_kind='division' and a.division_id=p_division)) then
    raise insufficient_privilege using message='Plan management in this division requires a verified administrator.';
  end if;

  v_levels := coalesce(p_levels, (
    select coalesce(max(case
      when jsonb_typeof(s->'level') = 'number' then (s->>'level')::int
      when (s->>'level') ~ '^[0-9]+$' then (s->>'level')::int
      else 1 end), 1)
    from jsonb_array_elements(p_spaces) s
  ), 1);

  if v_levels not between 1 and 50 then
    raise check_violation using message='Number of levels must be between 1 and 50.';
  end if;

  if jsonb_typeof(p_spaces)<>'array' or jsonb_array_length(p_spaces) not between 1 and 200 or exists(
    select 1 from jsonb_array_elements(p_spaces) s
    where nullif(trim(s->>'name'),'') is null or length(s->>'name')>120
      or not exists(select 1 from public.space_types t where t.code=s->>'type' and (t.active or exists(select 1 from public.master_plans prior_plan where prior_plan.organization_id=p_org and prior_plan.id=p_id and exists(select 1 from jsonb_array_elements(prior_plan.spaces) old_space where old_space->>'type'=t.code))))
      or not (s ? 'level')
      or jsonb_typeof(s->'level') <> 'number'
      or (s->>'level')::numeric % 1 <> 0
      or (s->>'level')::int not between 1 and v_levels
      or s ? 'square_feet' and s->'square_feet' <> 'null'::jsonb and (jsonb_typeof(s->'square_feet')<>'number' or (s->>'square_feet')::numeric <= 0 or (s->>'square_feet')::numeric > 1000000)
  ) or (select count(*) from jsonb_array_elements(p_spaces))<>(select count(distinct lower(trim(s->>'name'))) from jsonb_array_elements(p_spaces) s) then
    raise check_violation using message='Choose a space type, unique name, valid level, and valid square footage for every space (1–200).';
  end if;

  if p_id is not null then
    select * into previous from public.master_plans where organization_id=p_org and id=p_id for update;
    if not found or previous.division_id<>p_division then raise insufficient_privilege using message='Plan is unavailable in this division.'; end if;
    if p_version is null or previous.version<>p_version then raise serialization_failure using message='This plan changed. Refresh before saving.'; end if;
    update public.master_plans set name=trim(p_name),spaces=p_spaces,levels=v_levels,active=p_active,version=version+1,updated_at=now() where id=p_id returning * into r;
  else
    insert into public.master_plans(organization_id,division_id,name,spaces,levels,active) values(p_org,p_division,trim(p_name),p_spaces,v_levels,p_active) returning * into r;
  end if;

  perform private.append_audit(p_org,auth.uid(),'plan.saved','master_plan',r.id,null,to_jsonb(previous),to_jsonb(r));
  return to_jsonb(r);
end; $$;

revoke all on function public.save_master_plan(uuid,uuid,uuid,text,jsonb,boolean,bigint,integer) from public,anon;
grant execute on function public.save_master_plan(uuid,uuid,uuid,text,jsonb,boolean,bigint,integer) to authenticated;

notify pgrst, 'reload schema';

commit;

