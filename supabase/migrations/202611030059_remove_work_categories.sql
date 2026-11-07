begin;

-- Remove the retired classification model from existing and clean installations.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('public.execute_command_before_plan_checklists(text,jsonb)'::regprocedure) into definition;
  definition:=replace(definition,'origin, title, description, category_id, priority','origin, title, description, priority');
  definition:=replace(definition,'trim(v_payload ->> ''description''), nullif(v_payload ->> ''category_id'','''')::uuid,','trim(v_payload ->> ''description''),');
  definition:=replace(definition,'        category_id = coalesce(nullif(v_payload ->> ''category_id'','''')::uuid, category_id),' || chr(10),'');
  execute definition;
end; $migration$;

create or replace function public.admin_create_checklist_version(p_organization_id uuid,p_template_id uuid,p_template_name text,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare template_row public.checklist_templates; version_row public.checklist_versions; question jsonb; position integer:=0;
begin
  perform private.require_admin_permission(p_organization_id, 'config.manage');
  if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions)<1 or jsonb_array_length(p_questions)>250 then raise exception using errcode='22023', message='one to 250 checklist questions are required'; end if;
  if p_template_id is null then
    if length(trim(coalesce(p_template_name,''))) not between 1 and 160 then raise exception using errcode='22023', message='template name is required'; end if;
    insert into public.checklist_templates(organization_id,name) values(p_organization_id,trim(p_template_name)) returning * into template_row;
  else
    select * into template_row from public.checklist_templates where organization_id=p_organization_id and id=p_template_id and active for update;
    if not found then raise exception using errcode='02000', message='active checklist template not found'; end if;
  end if;
  insert into public.checklist_versions(organization_id,template_id,number,created_by)
    select p_organization_id,template_row.id,coalesce(max(number),0)+1,auth.uid() from public.checklist_versions where organization_id=p_organization_id and template_id=template_row.id returning * into version_row;
  for question in select value from jsonb_array_elements(p_questions) loop
    position:=position+1;
    if length(trim(coalesce(question->>'label','')))<2 then raise exception using errcode='22023', message='every checklist question requires a label'; end if;
    insert into public.checklist_questions(organization_id,version_id,ordinal,section,label,requires_response)
      values(p_organization_id,version_row.id,position,coalesce(nullif(trim(question->>'section'),''),'General'),trim(question->>'label'),coalesce((question->>'requires_response')::boolean,true));
  end loop;
  perform private.append_audit(p_organization_id,auth.uid(),'checklist.version_created','checklist_version',version_row.id,null,null,to_jsonb(version_row),jsonb_build_object('question_count',position));
  return jsonb_build_object('template_id',template_row.id,'version_id',version_row.id,'number',version_row.number,'question_count',position);
end; $$;

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

drop view public.work_item_list;
create view public.work_item_list with (security_invoker=true) as
select w.id,w.organization_id,w.neighborhood_id,w.home_id,h.lot_code,
 nullif(concat_ws(', ',h.address_line1,h.city,h.state_code),'') as address,
 w.title,w.description,w.priority,w.state,w.safety_flag,w.due_at,
 coalesce(c.name,p.display_name) as assigned_party_name,
 w.updated_at,w.version,w.created_at,w.inspection_id,w.reinspection_status,
 w.reinspection_assignee_user_id,w.reinspection_assigned_at,w.reinspection_completed_at,w.location_id
from public.work_items w
left join public.homes h on h.organization_id=w.organization_id and h.id=w.home_id
left join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id
left join public.companies c on c.organization_id=ae.organization_id and c.id=ae.company_id
left join public.profiles p on p.id=ae.internal_assignee_user_id;
grant select on public.work_item_list to authenticated,service_role;

drop function if exists public.admin_save_work_category(uuid,uuid,text,text,boolean);
alter table public.checklist_questions drop column if exists category_id;
alter table public.work_items drop column if exists category_id;
drop table if exists public.work_categories;

-- Fail if a live function still depends on the retired classification model.
do $$ begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and (p.prosrc ~* 'work_categor|category_id' or p.proname ~* 'work_categor')) then
 raise exception 'A stored function still references the retired classification model';
 end if;
end; $$;
notify pgrst,'reload schema';
commit;
