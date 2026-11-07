begin;

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
  perform private.require_admin_permission(p_organization_id,required_permission);

  if p_entity='division' then
    select to_jsonb(t) into before_row from public.divisions t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.divisions set status=case when p_active then 'active' else 'archived' end,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(divisions.*) into after_row;
  elsif p_entity='neighborhood' then
    select to_jsonb(t) into before_row from public.neighborhoods t where t.organization_id=p_organization_id and t.id=p_id for update;
    if not p_active and exists(select 1 from public.work_items w where w.organization_id=p_organization_id and w.neighborhood_id=p_id and w.state not in ('verified','cancelled')) then raise exception using errcode='23514',message='neighborhood has open work'; end if;
    update public.neighborhoods set status=case when p_active then 'active' else 'archived' end,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(neighborhoods.*) into after_row;
  elsif p_entity='home' then
    select to_jsonb(t) into before_row from public.homes t where t.organization_id=p_organization_id and t.id=p_id for update;
    if not p_active and exists(select 1 from public.work_items w where w.organization_id=p_organization_id and w.home_id=p_id and w.state not in ('verified','cancelled')) then raise exception using errcode='23514',message='home has open work'; end if;
    update public.homes set archived_at=case when p_active then null else now() end,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(homes.*) into after_row;
  elsif p_entity='company' then
    select to_jsonb(t) into before_row from public.companies t where t.organization_id=p_organization_id and t.id=p_id for update;
    if not p_active and exists(select 1 from public.assignment_episodes ae join public.work_items w on w.organization_id=ae.organization_id and w.id=ae.work_item_id where ae.organization_id=p_organization_id and ae.company_id=p_id and ae.ended_at is null and w.state not in ('verified','cancelled')) then raise exception using errcode='23514',message='company has active assignments'; end if;
    update public.companies set status=case when p_active then 'active' else 'archived' end,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(companies.*) into after_row;
  elsif p_entity='specialty' then
    select to_jsonb(t) into before_row from public.trade_specialties t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.trade_specialties set active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(trade_specialties.*) into after_row;
  elsif p_entity='roster' then
    select to_jsonb(t) into before_row from public.neighborhood_trade_rosters t where t.organization_id=p_organization_id and t.id=p_id for update;
    update public.neighborhood_trade_rosters set status=case when p_active then 'active' else 'inactive' end,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning to_jsonb(neighborhood_trade_rosters.*) into after_row;
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
    update public.inspection_engagements set revoked_at=case when p_active then null else now() end where organization_id=p_organization_id and id=p_id returning to_jsonb(inspection_engagements.*) into after_row;
  end if;
  if before_row is null or after_row is null then raise exception using errcode='02000',message='catalog record not found'; end if;
  perform private.append_audit(p_organization_id,auth.uid(),'catalog.status_changed',p_entity,p_id,null,before_row,after_row,jsonb_build_object('active',p_active));
  return jsonb_build_object('id',p_id,'entity',p_entity,'active',p_active);
end;
$$;

revoke all on function public.admin_set_catalog_status(uuid,text,uuid,boolean) from public,anon;
grant execute on function public.admin_set_catalog_status(uuid,text,uuid,boolean) to authenticated;

commit;
