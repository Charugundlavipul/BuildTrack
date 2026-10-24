begin;

create or replace function private.add_business_minutes(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_start timestamptz,
  p_minutes integer
) returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  calendar_id uuid;
  working_weekdays smallint[];
  local_start_time time;
  local_end_time time;
  holiday_dates date[];
  timezone_name text;
  current_at timestamptz := p_start;
  remaining integer := abs(coalesce(p_minutes, 0));
  direction integer := case when coalesce(p_minutes, 0) < 0 then -1 else 1 end;
  local_date date;
  local_time time;
  day_start timestamptz;
  day_end timestamptz;
  available integer;
  guard integer := 0;
begin
  select bc.id,bc.working_weekdays,bc.local_start_time,bc.local_end_time,bc.holiday_dates,coalesce(n.timezone, bc.timezone, o.timezone, 'UTC')
    into calendar_id,working_weekdays,local_start_time,local_end_time,holiday_dates,timezone_name
  from public.organizations o
  left join public.neighborhoods n on n.organization_id = o.id and n.id = p_neighborhood_id
  left join public.business_calendars bc on bc.organization_id = o.id and bc.id = coalesce(n.calendar_id, o.default_calendar_id)
  where o.id = p_organization_id;
  if remaining = 0 then return current_at; end if;
  if calendar_id is null then return current_at + make_interval(mins => p_minutes); end if;

  while remaining > 0 loop
    guard := guard + 1;
    if guard > 4000 then raise exception using errcode = '54000', message = 'business calendar calculation exceeded safety limit'; end if;
    local_date := (current_at at time zone timezone_name)::date;
    local_time := (current_at at time zone timezone_name)::time;
    if extract(isodow from local_date)::smallint <> all(working_weekdays) or local_date = any(holiday_dates) then
      local_date := local_date + direction;
      current_at := (local_date + case when direction > 0 then local_start_time else local_end_time end) at time zone timezone_name;
      continue;
    end if;
    day_start := (local_date + local_start_time) at time zone timezone_name;
    day_end := (local_date + local_end_time) at time zone timezone_name;
    if direction > 0 then
      if local_time < local_start_time then current_at := day_start; end if;
      if current_at >= day_end then
        current_at := ((local_date + 1) + local_start_time) at time zone timezone_name;
        continue;
      end if;
      available := greatest(0, floor(extract(epoch from (day_end - current_at)) / 60)::integer);
      if available >= remaining then return current_at + make_interval(mins => remaining); end if;
      remaining := remaining - available;
      current_at := ((local_date + 1) + local_start_time) at time zone timezone_name;
    else
      if local_time > local_end_time then current_at := day_end; end if;
      if current_at <= day_start then
        current_at := ((local_date - 1) + local_end_time) at time zone timezone_name;
        continue;
      end if;
      available := greatest(0, floor(extract(epoch from (current_at - day_start)) / 60)::integer);
      if available >= remaining then return current_at - make_interval(mins => remaining); end if;
      remaining := remaining - available;
      current_at := ((local_date - 1) + local_end_time) at time zone timezone_name;
    end if;
  end loop;
  return current_at;
end;
$$;

create or replace function private.apply_quiet_hours(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_at timestamptz,
  p_quiet_hours jsonb
) returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  timezone_name text;
  quiet_start time;
  quiet_end time;
  local_value timestamp;
  target_date date;
begin
  if nullif(p_quiet_hours->>'start', '') is null or nullif(p_quiet_hours->>'end', '') is null then return p_at; end if;
  quiet_start := (p_quiet_hours->>'start')::time;
  quiet_end := (p_quiet_hours->>'end')::time;
  select coalesce(n.timezone, bc.timezone, o.timezone, 'UTC') into timezone_name
  from public.organizations o
  left join public.neighborhoods n on n.organization_id=o.id and n.id=p_neighborhood_id
  left join public.business_calendars bc on bc.organization_id=o.id and bc.id=coalesce(n.calendar_id,o.default_calendar_id)
  where o.id=p_organization_id;
  local_value := p_at at time zone timezone_name;
  if quiet_start < quiet_end and local_value::time >= quiet_start and local_value::time < quiet_end then
    return (local_value::date + quiet_end) at time zone timezone_name;
  elsif quiet_start > quiet_end and local_value::time >= quiet_start then
    target_date := local_value::date + 1;
    return (target_date + quiet_end) at time zone timezone_name;
  elsif quiet_start > quiet_end and local_value::time < quiet_end then
    return (local_value::date + quiet_end) at time zone timezone_name;
  end if;
  return p_at;
exception when invalid_datetime_format then
  return p_at;
end;
$$;

create or replace function private.schedule_due_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer := 0;
begin
  with events as materialized (
    select r.id rule_id,r.organization_id,w.neighborhood_id,w.home_id,w.id work_item_id,ae.id assignment_episode_id,ae.company_id,
      r.trigger,r.business_minutes,r.repeat_minutes,r.max_repeats,r.quiet_hours,r.escalation_route_id,
      'assignment:'||ae.id event_key,ae.assigned_at anchor_at,1 direction
    from public.notification_rules r join public.assignment_episodes ae on ae.organization_id=r.organization_id
    join public.work_items w on w.organization_id=ae.organization_id and w.id=ae.work_item_id
    where r.enabled and r.trigger='assignment_unacknowledged' and ae.ended_at is null and ae.acknowledged_at is null
      and w.state not in ('draft','verified','cancelled') and (r.neighborhood_id is null or r.neighborhood_id=w.neighborhood_id)
    union all
    select r.id,r.organization_id,w.neighborhood_id,w.home_id,w.id,ae.id,ae.company_id,r.trigger,r.business_minutes,r.repeat_minutes,r.max_repeats,r.quiet_hours,r.escalation_route_id,
      'due:'||w.id,w.due_at,-1
    from public.notification_rules r join public.work_items w on w.organization_id=r.organization_id
    left join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id
    where r.enabled and r.trigger='work_due' and w.due_at is not null and w.state not in ('draft','verified','cancelled')
      and (r.neighborhood_id is null or r.neighborhood_id=w.neighborhood_id)
    union all
    select r.id,r.organization_id,w.neighborhood_id,w.home_id,w.id,ca.assignment_episode_id,ae.company_id,r.trigger,r.business_minutes,r.repeat_minutes,r.max_repeats,r.quiet_hours,r.escalation_route_id,
      'attempt:'||ca.id,ca.submitted_at,1
    from public.notification_rules r join public.correction_attempts ca on ca.organization_id=r.organization_id
    join public.work_items w on w.organization_id=ca.organization_id and w.id=ca.work_item_id
    join public.assignment_episodes ae on ae.organization_id=ca.organization_id and ae.id=ca.assignment_episode_id
    where r.enabled and r.trigger='attempt_unreviewed' and not exists(select 1 from public.verifications v where v.organization_id=ca.organization_id and v.correction_attempt_id=ca.id)
      and (r.neighborhood_id is null or r.neighborhood_id=w.neighborhood_id)
    union all
    select r.id,r.organization_id,w.neighborhood_id,w.home_id,w.id,b.assignment_episode_id,ae.company_id,r.trigger,r.business_minutes,r.repeat_minutes,r.max_repeats,r.quiet_hours,r.escalation_route_id,
      'blocker:'||b.id,b.opened_at,1
    from public.notification_rules r join public.blocker_events b on b.organization_id=r.organization_id
    join public.work_items w on w.organization_id=b.organization_id and w.id=b.work_item_id
    left join public.assignment_episodes ae on ae.organization_id=b.organization_id and ae.id=b.assignment_episode_id
    where r.enabled and r.trigger='blocked' and b.resolved_at is null and w.state='blocked'
      and (r.neighborhood_id is null or r.neighborhood_id=w.neighborhood_id)
    union all
    select r.id,r.organization_id,w.neighborhood_id,w.home_id,w.id,ae.id,ae.company_id,r.trigger,r.business_minutes,r.repeat_minutes,r.max_repeats,r.quiet_hours,r.escalation_route_id,
      'critical:'||w.id,w.created_at,1
    from public.notification_rules r join public.work_items w on w.organization_id=r.organization_id
    left join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id
    where r.enabled and r.trigger='critical_created' and w.priority='critical' and w.state not in ('verified','cancelled')
      and (r.neighborhood_id is null or r.neighborhood_id=w.neighborhood_id)
  ), instances as materialized (
    select e.*,g.repeat_number,
      private.apply_quiet_hours(e.organization_id,e.neighborhood_id,
        private.add_business_minutes(e.organization_id,e.neighborhood_id,e.anchor_at,(coalesce(e.business_minutes,0)*e.direction)+(coalesce(e.repeat_minutes,0)*g.repeat_number)),e.quiet_hours) scheduled_at
    from events e cross join lateral generate_series(0,e.max_repeats) g(repeat_number)
    where g.repeat_number=0 or e.repeat_minutes is not null
  ), routed as materialized (
    select i.*,s.recipient_kind,s.recipient_user_id
    from instances i
    join lateral (
      select ers.recipient_kind,ers.recipient_user_id from public.escalation_route_steps ers
      where ers.organization_id=i.organization_id and ers.route_id=i.escalation_route_id
        and ers.level=least(i.repeat_number+1,(select max(level) from public.escalation_route_steps mx where mx.organization_id=i.organization_id and mx.route_id=i.escalation_route_id))
    ) s on true
    where i.scheduled_at <= now()+interval '7 days'
  ), recipients as materialized (
    select distinct r.*,candidate.user_id
    from routed r
    left join public.homes h on h.organization_id=r.organization_id and h.id=r.home_id
    join lateral (
      select r.recipient_user_id user_id where r.recipient_kind='specific_user'
      union select cm.user_id from public.company_memberships cm where r.recipient_kind='assigned_company_manager' and cm.organization_id=r.organization_id and cm.company_id=r.company_id and cm.kind='manager' and cm.revoked_at is null and cm.active_from<=now() and (cm.active_to is null or cm.active_to>now())
      union select coalesce(h.primary_supervisor_user_id,n.supervisor_user_id) from public.neighborhoods n where r.recipient_kind='supervisor' and n.organization_id=r.organization_id and n.id=r.neighborhood_id
      union select ra.user_id from public.role_assignments ra where r.recipient_kind='area_manager' and ra.organization_id=r.organization_id and ra.role_code='area_manager' and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now()) and (ra.scope_kind='organization' or (ra.scope_kind='neighborhood' and ra.neighborhood_id=r.neighborhood_id) or (ra.scope_kind='home' and ra.home_id=r.home_id))
      union select ra.user_id from public.role_assignments ra where r.recipient_kind='org_admin' and ra.organization_id=r.organization_id and ra.role_code='org_admin' and ra.scope_kind='organization' and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())
    ) candidate on candidate.user_id is not null
    where private.active_member(r.organization_id,candidate.user_id)
  )
  insert into public.notification_outbox(organization_id,recipient_user_id,work_item_id,assignment_episode_id,channel,dedupe_key,template_key,payload,available_at)
  select r.organization_id,r.user_id,r.work_item_id,r.assignment_episode_id,ch.channel,
    'rule:'||r.rule_id||':'||r.event_key||':'||r.repeat_number||':'||r.user_id||':'||ch.channel,
    r.trigger,jsonb_build_object('work_item_id',r.work_item_id,'rule_id',r.rule_id,'trigger',r.trigger,'event_key',r.event_key,'repeat_number',r.repeat_number,'recipient_kind',r.recipient_kind,'neighborhood_id',r.neighborhood_id,'home_id',r.home_id,'company_id',r.company_id),r.scheduled_at
  from recipients r cross join(values('in_app'::text),('email'::text)) ch(channel)
  on conflict(organization_id,dedupe_key) do nothing;
  get diagnostics inserted_count=row_count;
  return inserted_count;
end;
$$;

commit;
