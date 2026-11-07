begin;

create or replace view public.work_item_list with (security_invoker = true) as
select
  w.id, w.organization_id, w.neighborhood_id, w.home_id, h.lot_code,
  nullif(concat_ws(', ', h.address_line1, h.city, h.state_code), '') as address,
  w.title, w.description, w.priority, w.state, w.safety_flag, w.due_at,
  coalesce(c.name, p.display_name) as assigned_party_name,
  w.updated_at, w.version, w.created_at
from public.work_items w
left join public.homes h on h.organization_id = w.organization_id and h.id = w.home_id
left join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id
left join public.companies c on c.organization_id = ae.organization_id and c.id = ae.company_id
left join public.profiles p on p.id = ae.internal_assignee_user_id;
grant select on public.work_item_list to authenticated;

create or replace function public.get_report_metrics(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  result jsonb;
  state_filter text := nullif(trim(p_filters->>'state'), '');
  priority_filter text := nullif(trim(p_filters->>'priority'), '');
  neighborhood_filter uuid := nullif(p_filters->>'neighborhood_id', '')::uuid;
  home_filter uuid := nullif(p_filters->>'home_id', '')::uuid;
  date_from_filter date := nullif(p_filters->>'date_from', '')::date;
  date_to_filter date := nullif(p_filters->>'date_to', '')::date;
begin
  if not exists (select 1 from public.my_organizations where id = p_organization_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if state_filter is not null and state_filter not in ('draft','submitted','assigned','acknowledged','in_progress','blocked','ready_for_verification','rework_required','verified','cancelled') then
    raise exception using errcode = '22023', message = 'invalid state filter';
  end if;
  if priority_filter is not null and priority_filter not in ('low','normal','high','critical') then
    raise exception using errcode = '22023', message = 'invalid priority filter';
  end if;
  if date_from_filter is not null and date_to_filter is not null and date_from_filter > date_to_filter then
    raise exception using errcode = '22023', message = 'invalid report date range';
  end if;

  with filtered_work as materialized (
    select w.*
    from public.work_items w
    where w.organization_id = p_organization_id
      and (neighborhood_filter is null or w.neighborhood_id = neighborhood_filter)
      and (home_filter is null or w.home_id = home_filter)
      and (state_filter is null or w.state::text = state_filter)
      and (priority_filter is null or w.priority::text = priority_filter)
      and (date_from_filter is null or w.created_at >= date_from_filter::timestamptz)
      and (date_to_filter is null or w.created_at < (date_to_filter + 1)::timestamptz)
  ),
  acknowledgment as (
    select
      round((percentile_cont(.5) within group (order by extract(epoch from (ae.acknowledged_at - ae.assigned_at))) / 3600)::numeric, 1) median_hours,
      count(*) sample
    from public.assignment_episodes ae
    join filtered_work w on w.organization_id = ae.organization_id and w.id = ae.work_item_id
    where ae.acknowledged_at is not null
  ),
  first_pass as (
    select
      round(100.0 * count(*) filter (where v.decision = 'accepted') / nullif(count(*), 0), 1) acceptance_pct,
      count(*) sample
    from public.correction_attempts ca
    join filtered_work w on w.organization_id = ca.organization_id and w.id = ca.work_item_id
    join public.verifications v on v.organization_id = ca.organization_id and v.correction_attempt_id = ca.id
    where ca.attempt_number = 1
  ),
  states as (
    select fw.state, count(*) total from filtered_work fw group by fw.state
  )
  select jsonb_build_object(
    'open_count', (select count(*) from filtered_work where state not in ('draft','verified','cancelled')),
    'overdue_count', (select count(*) from filtered_work where due_at < now() and state not in ('draft','verified','cancelled')),
    'acknowledgment_median_hours', case when acknowledgment.sample >= 10 then coalesce(acknowledgment.median_hours, 0) else null end,
    'acknowledgment_sample', acknowledgment.sample,
    'first_pass_acceptance_pct', case when first_pass.sample >= 10 then coalesce(first_pass.acceptance_pct, 0) else null end,
    'first_pass_sample', first_pass.sample,
    'small_sample_threshold', 10,
    'by_state', coalesce((select jsonb_agg(jsonb_build_object('label', replace(states.state::text, '_', ' '), 'value', states.total) order by states.state::text) from states), '[]'::jsonb),
    'filters', p_filters,
    'timezone', (select timezone from public.organizations where id = p_organization_id)
  ) into result
  from acknowledgment cross join first_pass;
  return result;
end;
$$;

revoke all on function public.get_report_metrics(uuid, jsonb) from public, anon;
grant execute on function public.get_report_metrics(uuid, jsonb) to authenticated;

commit;
