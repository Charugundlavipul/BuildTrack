begin;

-- Enhance upsert_inspection_response to clean up open observations if response changes from fail
-- and enhance record_inspection_observation to update existing open observation for the same question.

create or replace function private.inspection_observation_command(p_name text,p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); payload jsonb:=p_envelope->'payload'; op uuid:=(p_envelope->>'operation_id')::uuid;
 i public.inspections; o public.inspection_observations; w public.work_items; q public.checklist_questions;
 receipt private.observation_command_receipts; fingerprint text; result jsonb; nested jsonb; task jsonb; ids jsonb:='[]'; room text; room_id uuid;
begin
 if actor is null then raise insufficient_privilege using message='Sign in to continue.'; end if;
 if op is null then raise check_violation using message='An operation ID is required.'; end if;
 if nullif(p_envelope->>'captured_at','')::timestamptz < now()-interval '90 days' then raise check_violation using message='This saved operation has expired.'; end if;
 if p_name='record_inspection_observation' then
  select * into i from public.inspections where id=(payload->>'inspection_id')::uuid for update;
 else
  select * into o from public.inspection_observations where id=(payload->>'observation_id')::uuid for update;
  select * into i from public.inspections where id=o.inspection_id for update;
 end if;
 if i.id is null or not private.active_member(i.organization_id,actor) or not private.can_read_inspection(actor,i.id)
  or (payload ? 'organization_id' and (payload->>'organization_id')::uuid<>i.organization_id) then raise insufficient_privilege using message='This inspection is outside your access.'; end if;
 if p_name='record_inspection_observation' then
  if not (private.has_permission(i.organization_id,actor,'inspection.manage',i.neighborhood_id,i.home_id) or
   private.has_permission(i.organization_id,actor,'inspection.perform',i.neighborhood_id,i.home_id) and (i.lead_inspector_user_id=actor or exists(select 1 from public.inspection_participants ip where ip.inspection_id=i.id and ip.user_id=actor and ip.can_edit_draft))) then
   raise insufficient_privilege using message='Only an assigned Inspector or inspection manager can add observations.';
  end if;
 else
  if not private.require_aal2() or not private.has_permission(i.organization_id,actor,'inspection.manage',i.neighborhood_id,i.home_id) then raise insufficient_privilege using message='Inspection management permission is required to review observations.'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(op::text,0));
 fingerprint:=encode(extensions.digest(jsonb_build_object('command',p_name,'envelope',p_envelope)::text,'sha256'),'hex');
 select * into receipt from private.observation_command_receipts where operation_id=op;
 if found then
  if receipt.actor_id<>actor or receipt.organization_id<>i.organization_id or receipt.request_hash<>fingerprint then return private.command_error(op,'OPERATION_REUSE','This operation was already used with different input.'); end if;
  return jsonb_set(receipt.result,'{replayed}','true');
 end if;
 if p_name='record_inspection_observation' then
  if i.status not in ('draft','in_progress','amended') then raise check_violation using message='Observations can only be added to an open inspection.'; end if;
  if nullif(payload->>'question_id','') is not null then
   select * into q from public.checklist_questions where organization_id=i.organization_id and version_id=i.template_version_id and id=(payload->>'question_id')::uuid;
   if not found then raise check_violation using message='Choose a checklist item from this inspection.'; end if;
   room:=q.section;
   select id into room_id from public.home_locations where organization_id=i.organization_id and home_id=i.home_id and active and name=q.section order by id limit 1;
  elsif nullif(payload->>'location_id','') is not null then
   select id,name into room_id,room from public.home_locations where organization_id=i.organization_id and home_id=i.home_id and active and id=(payload->>'location_id')::uuid;
   if not found then raise check_violation using message='Choose an active room from this property.'; end if;
  else room:='Whole property'; end if;

  if nullif(payload->>'question_id','') is not null and exists(
    select 1 from public.inspection_observations
    where organization_id=i.organization_id and inspection_id=i.id and question_id=(payload->>'question_id')::uuid and status='open'
  ) then
    update public.inspection_observations set
      title=coalesce(nullif(trim(payload->>'title'),''),title),
      description=trim(payload->>'description'),
      priority=coalesce(nullif(payload->>'priority','')::public.work_priority,'normal'),
      safety_flag=coalesce((payload->>'safety_flag')::boolean,false)
    where organization_id=i.organization_id and inspection_id=i.id and question_id=(payload->>'question_id')::uuid and status='open'
    returning * into o;
  else
    insert into public.inspection_observations(id,organization_id,inspection_id,home_id,neighborhood_id,question_id,location_id,space_name,title,description,priority,safety_flag,created_by)
    values(coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid()),i.organization_id,i.id,i.home_id,i.neighborhood_id,q.id,room_id,room,coalesce(nullif(trim(payload->>'title'),''),coalesce(q.label,'Observation')),trim(payload->>'description'),coalesce(nullif(payload->>'priority','')::public.work_priority,'normal'),coalesce((payload->>'safety_flag')::boolean,false),actor) returning * into o;
  end if;
 elsif p_name='create_observation_work' then
  if i.status<>'submitted' or o.status='disregarded' then raise check_violation using message='Submit the inspection before creating repair tasks from its observations.'; end if;
  if o.version is distinct from nullif(p_envelope->>'expected_version','')::bigint then raise serialization_failure using message='The observation changed. Refresh before creating tasks.'; end if;
  if jsonb_typeof(payload->'tasks') is distinct from 'array' or jsonb_array_length(payload->'tasks') not between 1 and 25 then raise check_violation using message='Add between 1 and 25 repair tasks.'; end if;
  for task in select value from jsonb_array_elements(payload->'tasks') loop
   nested:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object(
    'organization_id',i.organization_id,'neighborhood_id',i.neighborhood_id,'home_id',i.home_id,'location_id',o.location_id,
    'origin','internal_observation',
    'title',task->>'title','description',coalesce(nullif(trim(task->>'description'),''),o.description),'priority',coalesce(task->>'priority',o.priority::text),'safety_flag',o.safety_flag)));
   if not coalesce((nested->>'ok')::boolean,false) then raise check_violation using message=nested->'error'->>'message'; end if;
   select * into w from public.work_items where id=(nested->'data'->>'id')::uuid;
   update public.work_items set observation_id=o.id,inspection_id=i.id,origin=case when i.type='external_quality' then 'external_inspection'::public.work_origin else 'internal_inspection'::public.work_origin end,state='submitted',submitted_at=now() where id=w.id returning * into w;
   perform private.append_work_event(w,'work.submitted','draft','submitted',actor,op,jsonb_build_object('observation_id',o.id));
   nested:=public.execute_command('assign_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',
    coalesce(task->'assignment','{}')||jsonb_build_object('organization_id',i.organization_id,'item_id',w.id,'reason','Repair task created during observation review')));
   if not coalesce((nested->>'ok')::boolean,false) then raise check_violation using message=nested->'error'->>'message'; end if;
   ids:=ids||jsonb_build_array(w.id);
  end loop;
  update public.inspection_observations set status='actioned',reviewed_by=actor,reviewed_at=now() where id=o.id returning * into o;
 elsif p_name='disregard_inspection_observation' then
  if i.status<>'submitted' or o.version is distinct from nullif(p_envelope->>'expected_version','')::bigint then raise check_violation using message='Review the current submitted observation before disregarding it.'; end if;
  if length(trim(coalesce(payload->>'reason',''))) not between 2 and 2000 then raise check_violation using message='Record why no repair is needed.'; end if;
  if exists(select 1 from public.work_items where organization_id=i.organization_id and observation_id=o.id and state<>'cancelled') then raise check_violation using message='Cancel existing repair tasks before disregarding the observation.'; end if;
  update public.inspection_observations set status='disregarded',review_notes=trim(payload->>'reason'),reviewed_by=actor,reviewed_at=now() where id=o.id returning * into o;
 else raise check_violation using message='Unknown observation action.'; end if;
 result:=private.command_success(op,jsonb_build_object('id',o.id,'status',o.status,'version',o.version,'work_item_ids',ids));
 insert into private.observation_command_receipts(operation_id,actor_id,organization_id,request_hash,result)
 values(op,actor,i.organization_id,fingerprint,result);
 return result;
end; $$;

notify pgrst, 'reload schema';

commit;

