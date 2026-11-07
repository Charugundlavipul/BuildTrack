begin;

create table public.inspection_observations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 inspection_id uuid not null, home_id uuid not null, neighborhood_id uuid not null,
 question_id uuid, location_id uuid, space_name text not null,
 title text not null check(length(trim(title)) between 2 and 160),
 description text not null check(length(trim(description)) between 2 and 10000),
 priority public.work_priority not null default 'normal', safety_flag boolean not null default false,
 status text not null default 'open' check(status in ('open','actioned','disregarded')),
 review_notes text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), version bigint not null default 1,
 unique(organization_id,id),
 foreign key(organization_id,inspection_id) references public.inspections(organization_id,id),
 foreign key(organization_id,home_id) references public.homes(organization_id,id),
 foreign key(organization_id,question_id) references public.checklist_questions(organization_id,id),
 foreign key(organization_id,home_id,location_id) references public.home_locations(organization_id,home_id,id)
);
create index inspection_observations_report on public.inspection_observations(organization_id,inspection_id,question_id);
create index inspection_observations_home on public.inspection_observations(organization_id,home_id,status);
alter table public.inspection_observations enable row level security;
grant select on public.inspection_observations to authenticated;
grant all on public.inspection_observations to service_role;
create policy observation_read on public.inspection_observations for select to authenticated using(private.can_read_inspection(auth.uid(),inspection_id));
create trigger inspection_observations_touch before update on public.inspection_observations for each row execute function private.touch_version();
alter table public.work_items add column observation_id uuid,
 add foreign key(organization_id,observation_id) references public.inspection_observations(organization_id,id);
create index work_items_observation on public.work_items(organization_id,observation_id) where observation_id is not null;

-- A failed answer points to a recorded issue, not a prematurely created task.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.inspection_responses'::regclass and contype='c' and pg_get_constraintdef(oid) like '%finding_work_item_id%' loop
  execute format('alter table public.inspection_responses drop constraint %I',c.conname);
 end loop;
end; $$;
create function private.guard_observation_workflow() returns trigger language plpgsql security definer set search_path='' as $$
declare i public.inspections; o public.inspection_observations;
begin
 if tg_table_name='inspection_responses' then
  select * into i from public.inspections where id=new.inspection_id and organization_id=new.organization_id;
  if not exists(select 1 from public.checklist_questions q where q.id=new.question_id and q.organization_id=new.organization_id and q.version_id=i.template_version_id) then
   raise check_violation using message='This checklist item does not belong to the inspection.';
  end if;
  if new.result='fail' and new.finding_work_item_id is null and not exists(select 1 from public.inspection_observations where organization_id=new.organization_id and inspection_id=new.inspection_id and question_id=new.question_id and status<>'disregarded') then
   raise check_violation using message='Add an observation describing what needs fixing before saving this result.';
  end if;
 elsif tg_table_name='work_items' then
  if new.observation_id is null then return new; end if;
  select * into o from public.inspection_observations where organization_id=new.organization_id and id=new.observation_id;
  if o.id is null or o.home_id is distinct from new.home_id or o.inspection_id is distinct from new.inspection_id or o.neighborhood_id is distinct from new.neighborhood_id then
   raise check_violation using message='A repair task must belong to its observation property and inspection.';
  end if;
 elsif tg_table_name='inspections' then
  if new.reviewed_at is not null and (new.reviewed_at is distinct from old.reviewed_at) and exists(
   select 1 from public.inspection_observations ob where ob.organization_id=new.organization_id and ob.inspection_id=new.id
    and (ob.status='open' or ob.status='actioned' and not exists(select 1 from public.work_items w where w.organization_id=ob.organization_id and w.observation_id=ob.id and w.state<>'cancelled'))
  ) then raise check_violation using message='Create repair tasks or disregard every observation before completing report review.'; end if;
 end if;
 return new;
end; $$;
create trigger guard_observation_response before insert or update on public.inspection_responses for each row execute function private.guard_observation_workflow();
create trigger guard_observation_work before insert or update on public.work_items for each row execute function private.guard_observation_workflow();
create trigger guard_observation_report_review before update on public.inspections for each row execute function private.guard_observation_workflow();

create table private.observation_command_receipts(
 operation_id uuid primary key, actor_id uuid not null, organization_id uuid not null,
 request_hash text not null, result jsonb not null, created_at timestamptz not null default now()
);
create function private.inspection_observation_command(p_name text,p_envelope jsonb) returns jsonb
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
  insert into public.inspection_observations(id,organization_id,inspection_id,home_id,neighborhood_id,question_id,location_id,space_name,title,description,priority,safety_flag,created_by)
  values(coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid()),i.organization_id,i.id,i.home_id,i.neighborhood_id,q.id,room_id,room,trim(payload->>'title'),trim(payload->>'description'),coalesce(nullif(payload->>'priority','')::public.work_priority,'normal'),coalesce((payload->>'safety_flag')::boolean,false),actor) returning * into o;
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
 else raise check_violation using message='Unknown observation action.';
 end if;
 perform private.append_audit(i.organization_id,actor,p_name,'inspection_observation',o.id,op,null,to_jsonb(o),jsonb_build_object('work_item_ids',ids));
 result:=private.command_success(op,jsonb_build_object('id',o.id,'version',o.version,'work_item_ids',ids));
 insert into private.observation_command_receipts values(op,actor,i.organization_id,fingerprint,result,now());
 return result;
exception when insufficient_privilege then return private.command_error(op,'FORBIDDEN',sqlerrm);
 when serialization_failure then return private.command_error(op,'VERSION_CONFLICT',sqlerrm);
 when check_violation or foreign_key_violation or not_null_violation or invalid_text_representation or unique_violation then return private.command_error(op,'VALIDATION_ERROR',sqlerrm);
end; $$;

-- Preserve the existing scheduling, assignment, repair, and reinspection engine.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure);
 definition:=replace(definition,'if p_command_name in (''schedule_inspection'',''schedule_company_inspection'')',
  'if p_command_name in (''record_inspection_observation'',''create_observation_work'',''disregard_inspection_observation'') then return private.inspection_observation_command(p_command_name,p_envelope); end if;
  if p_command_name in (''schedule_inspection'',''schedule_company_inspection'')');
 if strpos(definition,'private.inspection_observation_command')=0 then raise exception 'Observation command dispatch patch did not apply'; end if;
 execute definition;
 -- Freeze observations in the immutable submitted-report snapshot as well.
 definition:=pg_get_functiondef('public.execute_command_before_plan_checklists(text,jsonb)'::regprocedure);
 definition:=replace(definition,'''finding_ids'', coalesce(','''observations'', coalesce((select jsonb_agg(to_jsonb(ob) order by ob.created_at,ob.id) from public.inspection_observations ob where ob.organization_id=v_organization_id and ob.inspection_id=v_inspection.id),''[]''::jsonb),
              ''finding_ids'', coalesce(');
 execute definition;
end; $$;

create function private.property_repairs_ready(p_org uuid,p_home uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.inspection_observations where organization_id=p_org and home_id=p_home and status='actioned')
 and not exists(select 1 from public.inspection_observations o join public.inspections i on i.id=o.inspection_id where o.organization_id=p_org and o.home_id=p_home and o.status<>'disregarded'
  and (o.status='open' or i.status<>'submitted' or i.reviewed_at is null or not exists(select 1 from public.work_items w where w.organization_id=p_org and w.observation_id=o.id and w.state<>'cancelled')))
 and not exists(select 1 from public.work_items where organization_id=p_org and home_id=p_home and state not in ('ready_for_verification','verified','cancelled'))
 and exists(select 1 from public.work_items where organization_id=p_org and home_id=p_home and observation_id is not null and state='ready_for_verification');
$$;
create function public.inspection_repair_readiness(p_org uuid,p_home uuid default null) returns table(
 home_id uuid,lot_code text,address_line1 text,observation_count bigint,unreviewed_count bigint,repair_count bigint,incomplete_count bigint,ready_for_reinspection boolean)
language sql stable security definer set search_path='' as $$
 select h.id,h.lot_code,h.address_line1,
 (select count(*) from public.inspection_observations o where o.organization_id=p_org and o.home_id=h.id),
 (select count(*) from public.inspection_observations o join public.inspections i on i.id=o.inspection_id where o.organization_id=p_org and o.home_id=h.id and o.status<>'disregarded' and (o.status='open' or i.reviewed_at is null)),
 (select count(*) from public.work_items w where w.organization_id=p_org and w.home_id=h.id and w.observation_id is not null and w.state<>'cancelled'),
 (select count(*) from public.work_items w where w.organization_id=p_org and w.home_id=h.id and w.state not in ('ready_for_verification','verified','cancelled')),
 private.property_repairs_ready(p_org,h.id)
 from public.homes h where h.organization_id=p_org and (p_home is null or h.id=p_home) and private.has_permission(p_org,auth.uid(),'inspection.manage',h.neighborhood_id,h.id);
$$;
revoke all on function public.inspection_repair_readiness(uuid,uuid) from public,anon;
grant execute on function public.inspection_repair_readiness(uuid,uuid) to authenticated;

create table private.property_reinspection_state(home_id uuid primary key references public.homes(id),ready boolean not null default false);
create function private.notify_property_repairs_ready() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid:=new.organization_id; home uuid:=new.home_id; previous boolean; current_ready boolean; lot text;
begin
 if home is null or not exists(select 1 from public.inspection_observations where organization_id=org and home_id=home) then return new; end if;
 insert into private.property_reinspection_state(home_id) values(home) on conflict do nothing;
 select ready into previous from private.property_reinspection_state where home_id=home for update;
 current_ready:=private.property_repairs_ready(org,home);
 update private.property_reinspection_state set ready=current_ready where home_id=home;
 if current_ready and not previous then
  select lot_code into lot from public.homes where id=home;
  insert into public.notifications(organization_id,recipient_user_id,title,body,deep_link)
  select org,m.user_id,'Property ready for reinspection','Lot '||lot||': all repair tasks are complete and the inspection report has been reviewed.','/org/'||org||'/homes/'||home||'?tab=inspections'
   from public.organization_memberships m where m.organization_id=org and m.status='active' and private.has_permission(org,m.user_id,'inspection.manage',new.neighborhood_id,home);
 end if;
 return new;
end; $$;
create trigger notify_observation_readiness after insert or update on public.inspection_observations for each row execute function private.notify_property_repairs_ready();
create trigger notify_repair_readiness after insert or update on public.work_items for each row execute function private.notify_property_repairs_ready();
create trigger notify_report_repair_readiness after update on public.inspections for each row execute function private.notify_property_repairs_ready();
revoke all on function private.guard_observation_workflow(),private.inspection_observation_command(text,jsonb),private.property_repairs_ready(uuid,uuid),private.notify_property_repairs_ready() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
