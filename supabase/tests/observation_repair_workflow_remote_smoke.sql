-- Separate observations, repair tasks, readiness, and reinspection. Always rolls back.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
grant usage on schema private to authenticated;
create function private._inspector_check(p_condition boolean,p_message text) returns void language plpgsql as $$
begin if not coalesce(p_condition,false) then raise exception 'Inspector role check failed: %',p_message; end if; end; $$;
grant execute on function private._inspector_check(boolean,text) to authenticated;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
  select ('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'inspector-rollback-'||i||'@example.invalid',now(),now(),now(),'{}','{}' from generate_series(1,6) i;
insert into public.profiles(id,display_name,first_name,last_name,completed_at)
  select ('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Inspector role test '||i,'Inspector','Test',now() from generate_series(1,6) i
  on conflict(id) do update set first_name='Inspector',last_name='Test',completed_at=now();
insert into public.organizations(id,name,timezone) values('c2000000-0000-4000-8000-000000000001','Rollback Inspector tenant','America/New_York');
insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
  select 'c2000000-0000-4000-8000-000000000001',('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'internal','active',now() from unnest(array[1,2,6]) i;
insert into public.neighborhoods(id,organization_id,code,name) values
  ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','QA1','Authorized neighborhood'),
  ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','QA2','Outside company coverage');
insert into public.homes(id,organization_id,neighborhood_id,lot_code) values
  ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','1'),
  ('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002','2');
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,granted_by) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','org_admin','organization',null,'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','internal_contributor','neighborhood','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000006','internal_contributor','neighborhood','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
insert into public.checklist_templates(id,organization_id,name) values('c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Rollback checklist');
insert into public.checklist_versions(id,organization_id,template_id,number,published_at,created_by)
  values('c6000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001',1,now(),'c1000000-0000-4000-8000-000000000001');
insert into public.checklist_questions(id,organization_id,version_id,ordinal,label,section,requires_response)
  values('c7000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001',1,'Cabinet is sound','Kitchen',true);
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,granted_by) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000006','inspector','neighborhood','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
create function private._flow_call(command text,payload jsonb,version bigint default null) returns jsonb language plpgsql as $$
declare result jsonb;
begin
 result:=public.execute_command(command,jsonb_build_object('operation_id',gen_random_uuid(),'captured_at',now(),'expected_version',version,'payload',payload));
 if not coalesce((result->>'ok')::boolean,false) then raise exception '% failed: %',command,result; end if;
 return result->'data';
end; $$;
grant execute on function private._flow_call(text,jsonb,bigint) to authenticated;
set local role authenticated;
do $$ declare result jsonb; begin
 result:=private._flow_call('schedule_inspection','{"home_id":"c4000000-0000-4000-8000-000000000001","type":"internal_quality","template_version_id":"c6000000-0000-4000-8000-000000000001","lead_inspector_user_id":"c1000000-0000-4000-8000-000000000006"}');
 perform set_config('buildtrack.flow.inspection',result->>'id',true);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare report uuid:=current_setting('buildtrack.flow.inspection')::uuid; result jsonb; envelope jsonb; repeat jsonb; v bigint; begin
 envelope:=jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('inspection_id',report,'question_id','c7000000-0000-4000-8000-000000000001','title','Cabinet panel damaged','description','Replace panel and adjust hinges','priority','normal'));
 result:=public.execute_command('record_inspection_observation',envelope);
 perform private._inspector_check((result->>'ok')::boolean,'assigned Inspector could not record checklist observation: '||result::text);
 repeat:=public.execute_command('record_inspection_observation',envelope);
 perform private._inspector_check(repeat->'data'=result->'data','observation retry created another issue');
 perform set_config('buildtrack.flow.observation',result->'data'->>'id',true);
 result:=private._flow_call('record_inspection_observation',jsonb_build_object('inspection_id',report,'title','Loose entry trim','description','Review entry trim finish'));
 perform set_config('buildtrack.flow.extra',result->>'id',true);
 perform private._inspector_check(not exists(select 1 from public.work_items where inspection_id=report),'Inspector observation prematurely created a work item');
 result:=public.execute_command('create_observation_work',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',1,'payload',jsonb_build_object('observation_id',current_setting('buildtrack.flow.observation'),'tasks','[]'::jsonb)));
 perform private._inspector_check(not (result->>'ok')::boolean and result->'error'->>'code'='FORBIDDEN','Inspector could create repair tasks');
 result:=public.execute_command('record_inspection_observation',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('inspection_id',report,'question_id','c7000000-0000-4000-8000-999999999999','title','Wrong question','description','Invalid checklist link')));
 perform private._inspector_check(not (result->>'ok')::boolean,'another checklist question was accepted');
 select version into v from public.inspections where id=report;
 result:=private._flow_call('upsert_inspection_response',jsonb_build_object('inspection_id',report,'question_id','c7000000-0000-4000-8000-000000000001','response','fail','reason','Panel and hinge require attention'),v);
 result:=private._flow_call('submit_inspection',jsonb_build_object('inspection_id',report),(result->>'version')::bigint);
 perform private._inspector_check((select readiness='not_ready' from public.home_summary where id='c4000000-0000-4000-8000-000000000001'),'unreviewed issues did not block final property readiness');
 perform private._inspector_check((select jsonb_array_length(snapshot->'observations')=2 from public.inspection_submissions where inspection_id=report),'submitted report did not freeze both observations');
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare report uuid:=current_setting('buildtrack.flow.inspection')::uuid; result jsonb; envelope jsonb; replay jsonb; v bigint; begin
 select version into v from public.inspections where id=report;
 result:=public.execute_command('review_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',v,'payload',jsonb_build_object('inspection_id',report,'action','complete')));
 perform private._inspector_check(not (result->>'ok')::boolean,'unresolved observations did not block report review');
 envelope:=jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',1,'payload',jsonb_build_object('observation_id',current_setting('buildtrack.flow.observation'),'tasks',jsonb_build_array(
 jsonb_build_object('title','Replace damaged panel','description','Install replacement cabinet panel','assignment',jsonb_build_object('accountable_internal_user_id','c1000000-0000-4000-8000-000000000002','due_at',now()+interval '1 day')),
 jsonb_build_object('title','Adjust cabinet hinges','description','Align hinges and check closing','assignment',jsonb_build_object('accountable_internal_user_id','c1000000-0000-4000-8000-000000000002','due_at',now()+interval '1 day')))));
 result:=public.execute_command('create_observation_work',jsonb_set(envelope,'{payload,tasks,1,assignment,accountable_internal_user_id}','"c1000000-0000-4000-8000-000000000004"'));
 perform private._inspector_check(not (result->>'ok')::boolean,'invalid second assignee was accepted');
 perform private._inspector_check(not exists(select 1 from public.work_items where inspection_id=report),'failed task batch left a partial repair behind');
 result:=public.execute_command('create_observation_work',envelope);
 perform private._inspector_check((result->>'ok')::boolean,'reviewer could not split observation into tasks: '||result::text);
 replay:=public.execute_command('create_observation_work',envelope);
 perform private._inspector_check(replay->'data'=result->'data','task creation retry changed the result');
 perform private._inspector_check((select count(*)=2 from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid and state='assigned'),'expected two assigned work items per observation');
 result:=private._flow_call('disregard_inspection_observation',jsonb_build_object('observation_id',current_setting('buildtrack.flow.extra'),'reason','Trim finish accepted after review'),1);
 select version into v from public.inspections where id=report;
 result:=private._flow_call('review_inspection',jsonb_build_object('inspection_id',report,'action','complete'),v);
 perform private._inspector_check(not (select ready_for_reinspection from public.inspection_repair_readiness('c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001')),'assigned repairs were marked ready');
end; $$;
-- Complete each assigned repair using the existing evidence/repair lifecycle.
do $$ declare w public.work_items; result jsonb; item uuid; exception uuid; finished integer:=0; begin
 for item in select id from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid order by id loop
  perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
  select * into w from public.work_items where id=item;
  result:=private._flow_call('issue_evidence_exception',jsonb_build_object('item_id',item,'reason','Rollback fixture: supervisor confirms evidence exception'),w.version);
  select id into exception from public.evidence_exceptions where work_item_id=item and consumed_by_attempt_id is null;
  perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
  select * into w from public.work_items where id=item;
  result:=private._flow_call('acknowledge_work',jsonb_build_object('item_id',item),w.version);
  result:=private._flow_call('start_work',jsonb_build_object('item_id',item),(result->>'version')::bigint);
  result:=private._flow_call('submit_correction',jsonb_build_object('item_id',item,'note','Repair complete and ready for on-site inspection','evidence_exception_id',exception),(result->>'version')::bigint);
  finished:=finished+1;
  perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
  perform private._inspector_check((select ready_for_reinspection=(finished=2) from public.inspection_repair_readiness('c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001')),'readiness did not wait for every task');
 end loop;
 perform private._inspector_check((select count(*)=1 from public.notifications where recipient_user_id='c1000000-0000-4000-8000-000000000001' and title='Property repairs ready for review'),'superintendent readiness notification missing or duplicated');
 result:=private._flow_call('bulk_review_observations',jsonb_build_object('organization_id','c2000000-0000-4000-8000-000000000001','action','reinspect','inspector_user_id','c1000000-0000-4000-8000-000000000006','reason','All property repair tasks complete','rows',(select jsonb_agg(jsonb_build_object('item_id',id,'expected_version',version)) from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid)));
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
 for w in select * from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid order by id loop
  result:=private._flow_call('decide_reinspection',jsonb_build_object('item_id',w.id,'decision','accepted','notes','Repair checked on site and accepted'),w.version);
 end loop;
end; $$;
reset role;
select private._inspector_check((select readiness='ready_for_review' from public.home_summary where id='c4000000-0000-4000-8000-000000000001'),'accepted repairs did not restore property readiness');
select 'observation_repair_workflow_passed_and_rolled_back' as result;
rollback;
