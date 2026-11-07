begin;

-- Require organization administrator scope for organization-wide settings
create or replace function private.require_org_admin_permission(p_organization_id uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), p_permission, null, null) then
    raise exception using errcode = '42501', message = 'organization administrator permission required';
  end if;
end;
$$;

revoke all on function private.require_org_admin_permission(uuid, text) from public, anon, authenticated;

-- 1. Business calendars (Org admin only)
create or replace function public.admin_save_business_calendar(
  p_organization_id uuid,
  p_id uuid,
  p_name text,
  p_timezone text,
  p_working_weekdays smallint[],
  p_local_start_time time,
  p_local_end_time time,
  p_holiday_dates date[] default '{}'
)
returns public.business_calendars language plpgsql security definer set search_path = '' as $$
declare result public.business_calendars; before_row jsonb;
begin
  perform private.require_org_admin_permission(p_organization_id, 'config.manage');
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'invalid timezone';
  end if;
  if cardinality(p_working_weekdays) < 1 or exists(select 1 from unnest(p_working_weekdays) d where d < 0 or d > 6) then
    raise exception using errcode = '22023', message = 'working weekdays must contain values from 0 through 6';
  end if;
  if p_local_end_time <= p_local_start_time then
    raise exception using errcode = '22023', message = 'business day must end after it starts';
  end if;
  if p_id is null then
    insert into public.business_calendars(organization_id, name, timezone, working_weekdays, local_start_time, local_end_time, holiday_dates)
    values(p_organization_id, trim(p_name), p_timezone, p_working_weekdays, p_local_start_time, p_local_end_time, p_holiday_dates)
    returning * into result;
  else
    select to_jsonb(c) into before_row from public.business_calendars c where c.organization_id = p_organization_id and c.id = p_id for update;
    update public.business_calendars
    set name = trim(p_name), timezone = p_timezone, working_weekdays = p_working_weekdays,
        local_start_time = p_local_start_time, local_end_time = p_local_end_time,
        holiday_dates = p_holiday_dates, updated_at = now(), version = version + 1
    where organization_id = p_organization_id and id = p_id
    returning * into result;
  end if;
  perform private.append_audit(p_organization_id, 'catalog.business_calendar.saved', auth.uid(), jsonb_build_object('before', before_row, 'after', to_jsonb(result)));
  return result;
end;
$$;

-- 2. Escalation routes (Org admin only)
create or replace function public.admin_save_escalation_route(
  p_organization_id uuid,
  p_id uuid,
  p_name text,
  p_active boolean,
  p_steps jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.escalation_routes; before_row jsonb; step jsonb; ordinal integer := 0;
begin
  perform private.require_org_admin_permission(p_organization_id, 'config.manage');
  if length(trim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'route name is required';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) < 1 or jsonb_array_length(p_steps) > 10 then
    raise exception using errcode = '22023', message = 'one to ten escalation steps are required';
  end if;
  if p_id is null then
    insert into public.escalation_routes(organization_id, name, active)
    values(p_organization_id, trim(p_name), p_active)
    returning * into result;
  else
    select jsonb_build_object('route', to_jsonb(r), 'steps', (select coalesce(jsonb_agg(to_jsonb(s) order by s.level), '[]'::jsonb) from public.escalation_route_steps s where s.organization_id = p_organization_id and s.route_id = p_id))
    into before_row from public.escalation_routes r where r.organization_id = p_organization_id and r.id = p_id for update;
    update public.escalation_routes
    set name = trim(p_name), active = p_active, updated_at = now(), version = version + 1
    where organization_id = p_organization_id and id = p_id
    returning * into result;
    delete from public.escalation_route_steps where organization_id = p_organization_id and route_id = p_id;
  end if;
  for step in select * from jsonb_array_elements(p_steps) loop
    ordinal := ordinal + 1;
    insert into public.escalation_route_steps(organization_id, route_id, level, delay_minutes, recipient_kind, recipient_user_id)
    values(
      p_organization_id, result.id, ordinal,
      (step->>'delay_minutes')::integer,
      (step->>'recipient_kind')::public.escalation_recipient_kind,
      nullif(step->>'recipient_user_id', '')::uuid
    );
  end loop;
  perform private.append_audit(p_organization_id, 'catalog.escalation_route.saved', auth.uid(), jsonb_build_object('before', before_row, 'after', to_jsonb(result)));
  return jsonb_build_object('route', to_jsonb(result), 'steps', (select coalesce(jsonb_agg(to_jsonb(s) order by s.level), '[]'::jsonb) from public.escalation_route_steps s where s.organization_id = p_organization_id and s.route_id = result.id));
end;
$$;

-- 3. Notification rules (Org admin only)
create or replace function public.admin_save_notification_rule(
  p_organization_id uuid,
  p_id uuid,
  p_neighborhood_id uuid,
  p_trigger text,
  p_business_minutes integer,
  p_repeat_minutes integer,
  p_max_repeats integer,
  p_quiet_hours jsonb,
  p_escalation_route_id uuid,
  p_enabled boolean
)
returns public.notification_rules language plpgsql security definer set search_path = '' as $$
declare result public.notification_rules; before_row jsonb;
begin
  perform private.require_org_admin_permission(p_organization_id, 'config.manage');
  if p_trigger not in ('assignment_unacknowledged', 'work_due', 'attempt_unreviewed', 'blocked', 'critical_created') then
    raise exception using errcode = '22023', message = 'invalid notification trigger';
  end if;
  if p_business_minutes is not null and p_business_minutes < 0 or p_repeat_minutes is not null and p_repeat_minutes < 1 or p_max_repeats not between 0 and 50 then
    raise exception using errcode = '22023', message = 'invalid notification timing';
  end if;
  if p_neighborhood_id is not null and not exists(select 1 from public.neighborhoods where organization_id = p_organization_id and id = p_neighborhood_id and status = 'active') then
    raise exception using errcode = '22023', message = 'neighborhood is unavailable';
  end if;
  if p_escalation_route_id is not null and not exists(select 1 from public.escalation_routes where organization_id = p_organization_id and id = p_escalation_route_id and active) then
    raise exception using errcode = '22023', message = 'escalation route is unavailable';
  end if;
  if p_id is null then
    insert into public.notification_rules(organization_id, neighborhood_id, trigger, business_minutes, repeat_minutes, max_repeats, quiet_hours, escalation_route_id, enabled)
    values(p_organization_id, p_neighborhood_id, p_trigger::public.notification_trigger, p_business_minutes, p_repeat_minutes, p_max_repeats, coalesce(p_quiet_hours, '{}'::jsonb), p_escalation_route_id, p_enabled)
    returning * into result;
  else
    select to_jsonb(r) into before_row from public.notification_rules r where r.organization_id = p_organization_id and r.id = p_id for update;
    update public.notification_rules
    set neighborhood_id = p_neighborhood_id, trigger = p_trigger::public.notification_trigger,
        business_minutes = p_business_minutes, repeat_minutes = p_repeat_minutes,
        max_repeats = p_max_repeats, quiet_hours = coalesce(p_quiet_hours, '{}'::jsonb),
        escalation_route_id = p_escalation_route_id, enabled = p_enabled,
        updated_at = now(), version = version + 1
    where organization_id = p_organization_id and id = p_id
    returning * into result;
  end if;
  perform private.append_audit(p_organization_id, 'catalog.notification_rule.saved', auth.uid(), jsonb_build_object('before', before_row, 'after', to_jsonb(result)));
  return result;
end;
$$;

-- 4. Catalog status toggle (Escalation route & Notification rule require Org Admin)
create or replace function public.admin_set_catalog_status(
  p_organization_id uuid,
  p_entity text,
  p_id uuid,
  p_active boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare required_permission text; before_row jsonb; after_row jsonb;
begin
  required_permission := case
    when p_entity in ('division','neighborhood','home') then 'structure.manage'
    when p_entity in ('company','specialty','roster') then 'roster.manage'
    when p_entity in ('checklist_template','escalation_route','notification_rule','inspection_engagement') then 'config.manage'
    else null end;
  if required_permission is null then raise exception using errcode='22023',message='unsupported catalog entity'; end if;

  if p_entity in ('escalation_route', 'notification_rule') then
    perform private.require_org_admin_permission(p_organization_id, 'config.manage');
  else
    perform private.require_admin_permission(p_organization_id, required_permission);
  end if;

  if p_entity='division' then
    select to_jsonb(t) into before_row from public.divisions t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.divisions set status=(case when p_active then 'active' else 'archived' end)::public.organization_status,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(divisions.*) into after_row;
  elsif p_entity='neighborhood' then
    select to_jsonb(t) into before_row from public.neighborhoods t where t.organization_id=p_organization_id and t.id=p_id for update;
    if not p_active and exists(select 1 from public.work_items w where w.organization_id=p_organization_id and w.neighborhood_id=p_id and w.state not in ('verified','cancelled')) then raise exception using errcode='23514',message='neighborhood has open work'; end if;
    update public.neighborhoods set status=(case when p_active then 'active' else 'archived' end)::public.organization_status,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(neighborhoods.*) into after_row;
  elsif p_entity='home' then
    select to_jsonb(t) into before_row from public.homes t where t.organization_id=p_organization_id and t.id=p_id for update;
    if not p_active and exists(select 1 from public.work_items w where w.organization_id=p_organization_id and w.home_id=p_id and w.state not in ('verified','cancelled')) then raise exception using errcode='23514',message='home has open work'; end if;
    update public.homes set archived_at=case when p_active then null else now() end,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(homes.*) into after_row;
  elsif p_entity='company' then
    select to_jsonb(t) into before_row from public.companies t where t.organization_id=p_organization_id and t.id=p_id for update;
    if not p_active and exists(select 1 from public.assignment_episodes ae join public.work_items w on w.organization_id=ae.organization_id and w.id=ae.work_item_id where ae.organization_id=p_organization_id and ae.company_id=p_id and ae.ended_at is null and w.state not in ('verified','cancelled')) then raise exception using errcode='23514',message='company has active assignments'; end if;
    update public.companies set status=(case when p_active then 'active' else 'archived' end)::public.organization_status,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(companies.*) into after_row;
  elsif p_entity='specialty' then
    select to_jsonb(t) into before_row from public.trade_specialties t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.trade_specialties set active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(trade_specialties.*) into after_row;
  elsif p_entity='roster' then
    select to_jsonb(t) into before_row from public.neighborhood_trade_rosters t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.neighborhood_trade_rosters set status=(case when p_active then 'active' else 'archived' end)::public.organization_status,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(neighborhood_trade_rosters.*) into after_row;
  elsif p_entity='checklist_template' then
    select to_jsonb(t) into before_row from public.checklist_templates t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.checklist_templates set active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(checklist_templates.*) into after_row;
  elsif p_entity='escalation_route' then
    select to_jsonb(t) into before_row from public.escalation_routes t where t.organization_id=p_organization_id and t.id=p_id for update;
    if not p_active and exists(select 1 from public.notification_rules n where n.organization_id=p_organization_id and n.escalation_route_id=p_id and n.enabled) then raise exception using errcode='23514',message='disable dependent notification rules first'; end if;
    update public.escalation_routes set active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(escalation_routes.*) into after_row;
  elsif p_entity='notification_rule' then
    select to_jsonb(t) into before_row from public.notification_rules t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.notification_rules set enabled=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(notification_rules.*) into after_row;
  elsif p_entity='inspection_engagement' then
    select to_jsonb(t) into before_row from public.inspection_engagements t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.inspection_engagements set revoked_at=case when p_active then null else now() end,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(inspection_engagements.*) into after_row;
  end if;
  perform private.append_audit(p_organization_id,'catalog.'||p_entity||'.status_changed',auth.uid(),jsonb_build_object('before',before_row,'after',after_row));
  return after_row;
end;
$$;

commit;

