begin;

-- Restore working settings saves while retaining organization-wide authorization.
create or replace function public.admin_save_business_calendar(p_organization_id uuid,p_id uuid,p_name text,p_timezone text,p_working_weekdays smallint[],p_local_start_time time,p_local_end_time time,p_holiday_dates date[] default '{}')
returns public.business_calendars language plpgsql security definer set search_path = '' as $$
declare result public.business_calendars; before_row jsonb;
begin
  perform private.require_org_admin_permission(p_organization_id, 'config.manage');
  if length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception using errcode='22023',message='calendar name is required'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception using errcode='22023', message='invalid timezone'; end if;
  if p_working_weekdays is null or cardinality(p_working_weekdays)<1 or exists(select 1 from unnest(p_working_weekdays) d where d is null or d<0 or d>6) then raise exception using errcode='22023', message='working weekdays must contain values from 0 through 6'; end if;
  if p_local_start_time is null or p_local_end_time is null or p_local_end_time<=p_local_start_time then raise exception using errcode='22023', message='business day must end after it starts'; end if;
  if p_id is null then insert into public.business_calendars(organization_id,name,timezone,working_weekdays,local_start_time,local_end_time,holiday_dates) values(p_organization_id,trim(p_name),p_timezone,p_working_weekdays,p_local_start_time,p_local_end_time,p_holiday_dates) returning * into result;
  else select to_jsonb(c) into before_row from public.business_calendars c where c.organization_id=p_organization_id and c.id=p_id for update;
    update public.business_calendars set name=trim(p_name),timezone=p_timezone,working_weekdays=p_working_weekdays,local_start_time=p_local_start_time,local_end_time=p_local_end_time,holiday_dates=p_holiday_dates,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='calendar not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'calendar.saved','business_calendar',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_business_calendar(uuid,uuid,text,text,smallint[],time,time,date[]) from public,anon;
grant execute on function public.admin_save_business_calendar(uuid,uuid,text,text,smallint[],time,time,date[]) to authenticated;


create or replace function public.admin_save_escalation_route(p_organization_id uuid,p_id uuid,p_name text,p_active boolean,p_steps jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.escalation_routes; before_row jsonb; step jsonb; ordinal integer:=0;
begin
  perform private.require_org_admin_permission(p_organization_id,'config.manage');
  if length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception using errcode='22023',message='route name is required'; end if;
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps)<1 or jsonb_array_length(p_steps)>10 then raise exception using errcode='22023',message='one to ten escalation steps are required'; end if;
  if p_id is null then insert into public.escalation_routes(organization_id,name,active) values(p_organization_id,trim(p_name),p_active) returning * into result;
  else
    select jsonb_build_object('route',to_jsonb(r),'steps',(select coalesce(jsonb_agg(to_jsonb(s) order by s.level),'[]'::jsonb) from public.escalation_route_steps s where s.organization_id=p_organization_id and s.route_id=p_id)) into before_row from public.escalation_routes r where r.organization_id=p_organization_id and r.id=p_id for update;
    update public.escalation_routes set name=trim(p_name),active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000',message='escalation route not found'; end if;
    delete from public.escalation_route_steps where organization_id=p_organization_id and route_id=p_id;
  end if;
  for step in select value from jsonb_array_elements(p_steps) loop
    ordinal:=ordinal+1;
    if step->>'recipient_kind' is null or step->>'recipient_kind' not in ('assigned_company_manager','supervisor','area_manager','specific_user','org_admin') then raise exception using errcode='22023',message='invalid escalation recipient kind'; end if;
    if step->>'recipient_kind'='specific_user' and (nullif(step->>'recipient_user_id','') is null or not private.active_member(p_organization_id,(step->>'recipient_user_id')::uuid)) then raise exception using errcode='22023',message='specific escalation recipient must be an active member'; end if;
    insert into public.escalation_route_steps(organization_id,route_id,level,recipient_kind,recipient_user_id)
      values(p_organization_id,result.id,ordinal,step->>'recipient_kind',case when step->>'recipient_kind'='specific_user' then (step->>'recipient_user_id')::uuid else null end);
  end loop;
  perform private.append_audit(p_organization_id,auth.uid(),'escalation_route.saved','escalation_route',result.id,null,before_row,jsonb_build_object('route',to_jsonb(result),'steps',p_steps));
  return jsonb_build_object('id',result.id,'name',result.name,'step_count',ordinal);
end; $$;
revoke all on function public.admin_save_escalation_route(uuid,uuid,text,boolean,jsonb) from public,anon;
grant execute on function public.admin_save_escalation_route(uuid,uuid,text,boolean,jsonb) to authenticated;

create or replace function public.admin_save_notification_rule(
  p_organization_id uuid,p_id uuid,p_neighborhood_id uuid,p_trigger text,p_business_minutes integer,p_repeat_minutes integer,
  p_max_repeats integer,p_quiet_hours jsonb,p_escalation_route_id uuid,p_enabled boolean
)
returns public.notification_rules language plpgsql security definer set search_path = '' as $$
declare result public.notification_rules; before_row jsonb;
begin
  perform private.require_org_admin_permission(p_organization_id,'config.manage');
  if p_trigger is null or p_trigger not in ('assignment_unacknowledged','work_due','attempt_unreviewed','blocked','critical_created') then raise exception using errcode='22023',message='invalid notification trigger'; end if;
  if p_business_minutes is not null and p_business_minutes<0 or p_repeat_minutes is not null and p_repeat_minutes<1 or p_max_repeats is null or p_max_repeats not between 0 and 50 then raise exception using errcode='22023',message='invalid notification timing'; end if;
  if p_neighborhood_id is not null and not exists(select 1 from public.neighborhoods where organization_id=p_organization_id and id=p_neighborhood_id and status='active') then raise exception using errcode='22023',message='neighborhood is unavailable'; end if;
  if not exists(select 1 from public.escalation_routes where organization_id=p_organization_id and id=p_escalation_route_id and active) then raise exception using errcode='22023',message='escalation route is unavailable'; end if;
  if jsonb_typeof(p_quiet_hours) is distinct from 'object' then raise exception using errcode='22023',message='quiet hours must be an object'; end if;
  if p_id is null then insert into public.notification_rules(organization_id,neighborhood_id,trigger,business_minutes,repeat_minutes,max_repeats,quiet_hours,escalation_route_id,enabled)
    values(p_organization_id,p_neighborhood_id,p_trigger,p_business_minutes,p_repeat_minutes,p_max_repeats,p_quiet_hours,p_escalation_route_id,p_enabled) returning * into result;
  else select to_jsonb(n) into before_row from public.notification_rules n where n.organization_id=p_organization_id and n.id=p_id for update;
    update public.notification_rules set neighborhood_id=p_neighborhood_id,trigger=p_trigger,business_minutes=p_business_minutes,repeat_minutes=p_repeat_minutes,max_repeats=p_max_repeats,quiet_hours=p_quiet_hours,escalation_route_id=p_escalation_route_id,enabled=p_enabled,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000',message='notification rule not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'notification_rule.saved','notification_rule',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_notification_rule(uuid,uuid,uuid,text,integer,integer,integer,jsonb,uuid,boolean) from public,anon;
grant execute on function public.admin_save_notification_rule(uuid,uuid,uuid,text,integer,integer,integer,jsonb,uuid,boolean) to authenticated;


-- Preserve vendor ownership guards while restoring per-record scope checks.
-- The current audit call is also incompatible with the audit function signature.
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('public.admin_set_catalog_status(uuid,text,uuid,boolean)'::regprocedure);
 needle:='perform private.require_admin_permission(p_organization_id, required_permission);';
 if strpos(definition,needle)=0 then raise exception 'Review catalog authorization before applying security fix'; end if;
 definition:=replace(definition,needle,'perform private.require_catalog_authority(p_organization_id,p_entity,p_id,p_active);');
 definition:=replace(definition,'''company'',''specialty'',''roster''','''company'',''roster''');
 definition:=regexp_replace(definition,'  elsif p_entity=''specialty'' then.*?  elsif p_entity=''roster'' then','  elsif p_entity=''roster'' then','s');
 needle:='perform private.append_audit(p_organization_id,''catalog.''||p_entity||''.status_changed'',auth.uid(),jsonb_build_object(''before'',before_row,''after'',after_row));';
 if strpos(definition,needle)=0 then raise exception 'Review catalog audit call before applying security fix'; end if;
 definition:=replace(definition,needle,'if after_row is null then raise exception using errcode=''02000'',message=''catalog record not found''; end if;
  perform private.append_audit(p_organization_id,auth.uid(),''catalog.''||p_entity||''.status_changed'',p_entity,p_id,null,before_row,after_row);');
 execute definition;

 -- This revoked helper is only used for batch response saves. Correct the stale
 -- helper reference in its legacy work branch without changing public routing.
 definition:=pg_get_functiondef('public.execute_command_before_work_completion(text,jsonb)'::regprocedure);
 if strpos(definition,'private.can_read_work_item')=0 then raise exception 'Review archived batch helper before applying lint correction'; end if;
 execute replace(definition,'private.can_read_work_item','private.can_read_work');
end; $$;
notify pgrst,'reload schema';
commit;
