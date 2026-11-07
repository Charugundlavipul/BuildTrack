begin;

-- Unreviewed issues also block final property/milestone readiness.
create or replace view public.home_summary with (security_invoker = true) as
-- Keep the original view column order. Homes gained plan/layout columns after
-- this view was introduced; h.* would insert them before the computed fields
-- and PostgreSQL correctly refuses that incompatible replacement.
select h.id,h.organization_id,h.neighborhood_id,h.lot_code,h.address_line1,h.address_line2,
  h.city,h.state_code,h.postal_code,h.phase,h.primary_supervisor_user_id,h.external_reference,
  h.archived_at,h.created_at,h.updated_at,h.version,
  case
    when exists(select 1 from public.inspection_observations ob join public.inspections report on report.id=ob.inspection_id
      where ob.organization_id=h.organization_id and ob.home_id=h.id and (report.reviewed_at is null or
        ob.status<>'disregarded' and (ob.status='open' or not exists(select 1 from public.work_items repair where repair.organization_id=ob.organization_id and repair.observation_id=ob.id and repair.state<>'cancelled')))) then 'not_ready'
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

create or replace function public.inspection_repair_readiness(p_org uuid,p_home uuid default null) returns table(
 home_id uuid,lot_code text,address_line1 text,observation_count bigint,unreviewed_count bigint,repair_count bigint,incomplete_count bigint,ready_for_reinspection boolean)
language sql stable security definer set search_path='' as $$
 select h.id,h.lot_code,h.address_line1,
 (select count(*) from public.inspection_observations o where o.organization_id=p_org and o.home_id=h.id),
 (select count(*) from public.inspection_observations o join public.inspections i on i.id=o.inspection_id where o.organization_id=p_org and o.home_id=h.id and (i.reviewed_at is null or o.status<>'disregarded' and (o.status='open' or not exists(select 1 from public.work_items assigned where assigned.organization_id=p_org and assigned.observation_id=o.id and assigned.state<>'cancelled')))),
 (select count(*) from public.work_items w where w.organization_id=p_org and w.home_id=h.id and w.observation_id is not null and w.state<>'cancelled'),
 (select count(*) from public.work_items w where w.organization_id=p_org and w.home_id=h.id and w.state not in ('ready_for_verification','verified','cancelled')),
 private.property_repairs_ready(p_org,h.id)
 from public.homes h where h.organization_id=p_org and (p_home is null or h.id=p_home) and private.has_permission(p_org,auth.uid(),'inspection.manage',h.neighborhood_id,h.id);
$$;

create function private.invalidate_observation_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.milestone_approvals set invalidated_at=now(),invalidation_reason='A new inspection observation needs review.'
 where organization_id=new.organization_id and home_id=new.home_id and invalidated_at is null;
 if found then perform private.append_audit(new.organization_id,new.created_by,'milestone.invalidated','home',new.home_id,null,null,null,jsonb_build_object('observation_id',new.id)); end if;
 return new;
end; $$;
create trigger invalidate_observation_approval after insert on public.inspection_observations for each row execute function private.invalidate_observation_approval();
revoke all on function private.invalidate_observation_approval() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
