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
  result:=private._flow_call('submit_correction',jsonb_build_object('item_id',item,'note','Repair complete and ready for supervisor review','evidence_exception_id',exception),(result->>'version')::bigint);
  finished:=finished+1;
  perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
  perform private._inspector_check((select ready_for_reinspection=(finished=2) from public.inspection_repair_readiness('c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001')),'readiness did not wait for every task');
 end loop;
 perform private._inspector_check((select count(*)=1 from public.notifications where recipient_user_id='c1000000-0000-4000-8000-000000000001' and title='Property repairs ready for review'),'superintendent readiness notification missing or duplicated');
 
 -- A contributor who performed the repair still needs review permission.
 select * into w from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid order by id limit 1;
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
 perform private._inspector_check(not (public.work_completion_context(w.organization_id,w.id)->>'can_review')::boolean,'contributor gained review authority by performing work');
 result:=public.execute_command('verify_correction',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'decision','accepted','method','remote','notes','Contributor cannot approve without permission')));
 perform private._inspector_check(not (result->>'ok')::boolean and result->'error'->>'code'='FORBIDDEN','contributor approved own work without permission');
 -- Inspector authority alone does not permit routine supervisor acceptance.
 select * into w from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid order by id limit 1;
 perform set_config('buildtrack.flow.direct',w.id::text,true);
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
 result:=public.execute_command('verify_correction',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'decision','accepted','method','remote','notes','Inspector cannot accept routine repairs')));
 perform private._inspector_check(not (result->>'ok')::boolean and result->'error'->>'code'='FORBIDDEN','unassigned Inspector could accept routine completion');
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
 perform private._inspector_check((public.work_completion_context(w.organization_id,w.id)->>'can_review')::boolean,'independent supervisor cannot review completion');
 result:=private._flow_call('verify_correction',jsonb_build_object('item_id',w.id,'decision','rejected','method','remote','notes','Align the remaining hinge'),w.version);
 perform private._inspector_check((select state='rework_required' from public.work_items where id=w.id),'return for correction did not reopen repair');
 select * into w from public.work_items where id=w.id;
 result:=private._flow_call('issue_evidence_exception',jsonb_build_object('item_id',w.id,'reason','Rollback fixture: updated repair evidence exception'),w.version);
 select id into exception from public.evidence_exceptions where work_item_id=w.id and consumed_by_attempt_id is null;
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
 select * into w from public.work_items where id=w.id;
 result:=private._flow_call('submit_correction',jsonb_build_object('item_id',w.id,'note','Remaining hinge aligned','evidence_exception_id',exception),w.version);
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
 select * into w from public.work_items where id=w.id;
 result:=private._flow_call('verify_correction',jsonb_build_object('item_id',w.id,'decision','accepted','method','remote','notes','Completion evidence accepted'),w.version);
 perform private._inspector_check((select state='verified' and reinspection_status is distinct from 'pending' from public.work_items where id=w.id),'routine repair did not close without reinspection');
 perform private._inspector_check((select count(*)=2 from public.correction_attempts where work_item_id=w.id),'return/resubmit did not preserve both attempts');
 result:=private._flow_call('bulk_review_observations',jsonb_build_object('organization_id','c2000000-0000-4000-8000-000000000001','action','reinspect','inspector_user_id','c1000000-0000-4000-8000-000000000006','reason','All property repair tasks complete','rows',(select jsonb_agg(jsonb_build_object('item_id',id,'expected_version',version)) from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid and state='ready_for_verification')));
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
 -- A supervisor cannot bypass an already requested independent reinspection.
 select * into w from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid and reinspection_status='pending' limit 1;
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
 result:=public.execute_command('verify_correction',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'decision','accepted','method','remote','notes','Bypass requested site inspection')));
 perform private._inspector_check(not (result->>'ok')::boolean and result->'error'->>'code'='INVALID_TRANSITION','supervisor bypassed pending reinspection');
 perform set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
 for w in select * from public.work_items where observation_id=current_setting('buildtrack.flow.observation')::uuid and reinspection_status='pending' order by id loop
  result:=private._flow_call('decide_reinspection',jsonb_build_object('item_id',w.id,'decision','accepted','notes','Repair checked on site and accepted'),w.version);
 end loop;
end; $$;
reset role;
select private._inspector_check((select readiness='ready_for_review' from public.home_summary where id='c4000000-0000-4000-8000-000000000001'),'accepted repairs did not restore property readiness');

-- An authorized senior staff member can review and accept their own repair.
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare result jsonb; w public.work_items; exception uuid; begin
 result:=private._flow_call('create_and_assign_work_item',jsonb_build_object('organization_id','c2000000-0000-4000-8000-000000000001','home_id','c4000000-0000-4000-8000-000000000001','neighborhood_id','c3000000-0000-4000-8000-000000000001','title','Senior staff repair','description','Touch up the entry trim','safety_flag',true,'assignment',jsonb_build_object('accountable_internal_user_id',auth.uid(),'due_at',now()+interval '1 day')));
 select * into w from public.work_items where id=(result->>'id')::uuid;
 perform set_config('buildtrack.flow.senior',w.id::text,true);
 result:=private._flow_call('issue_evidence_exception',jsonb_build_object('item_id',w.id,'reason','Rollback fixture: evidence exception'),w.version);
 select id into exception from public.evidence_exceptions where work_item_id=w.id and consumed_by_attempt_id is null;
 select * into w from public.work_items where id=w.id;
 result:=private._flow_call('submit_correction',jsonb_build_object('item_id',w.id,'note','Trim repaired by senior member','evidence_exception_id',exception),w.version);
 select * into w from public.work_items where id=w.id;
 perform private._inspector_check((public.work_completion_context(w.organization_id,w.id)->>'can_review')::boolean,'authorized supervisor was blocked from own approval');
 result:=public.execute_command('bulk_review_observations',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',w.organization_id,'action','reinspect','inspector_user_id',auth.uid(),'reason','Optional Inspector checks must remain independent','rows',jsonb_build_array(jsonb_build_object('item_id',w.id,'expected_version',w.version)))));
 perform private._inspector_check(not (result->>'ok')::boolean,'routine self approval also bypassed optional Inspector independence');
 result:=public.execute_command('verify_correction',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'decision','accepted','method','remote','notes','Remote review is insufficient for safety work')));
 perform private._inspector_check(not (result->>'ok')::boolean and result->'error'->>'code'='VALIDATION_ERROR','self approval bypassed safety review method');
 perform private._inspector_check((select state='ready_for_verification' from public.work_items where id=w.id),'failed safety review changed repair state');
 result:=private._flow_call('verify_correction',jsonb_build_object('item_id',w.id,'decision','accepted','method','on_site','notes','Supervisor performed and checked the repair on site'),w.version);
 perform private._inspector_check((select state='verified' from public.work_items where id=w.id),'supervisor could not close own repair');
 perform private._inspector_check(exists(select 1 from public.verifications v join public.correction_attempts ca on ca.id=v.correction_attempt_id where ca.work_item_id=w.id and ca.submitted_by=auth.uid() and v.verified_by=auth.uid()),'self approval was not recorded with the actual reviewer');
end; $$;
reset role;
-- Company scheduling and batch response saving share the public gateway but
-- must preserve their separate allocation, draft access and replay rules.
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare c public.companies; begin
 c:=public.admin_onboard_vendor('c2000000-0000-4000-8000-000000000001','Rollback routing inspection company',null,'neighborhood',null,'c3000000-0000-4000-8000-000000000001');
 perform public.save_company_profile(c.organization_id,c.id,null,null,null,null,array['third_party_inspection'],c.version);
 perform set_config('buildtrack.flow.company',c.id::text,true);
end; $$;
reset role;
insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
 values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004','external','active',now());
insert into public.company_memberships(organization_id,company_id,user_id,kind)
 values('c2000000-0000-4000-8000-000000000001',current_setting('buildtrack.flow.company')::uuid,'c1000000-0000-4000-8000-000000000004','technician');
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,company_id,granted_by)
 select 'c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004',code,'company',current_setting('buildtrack.flow.company')::uuid,'c1000000-0000-4000-8000-000000000001'
 from unnest(array['trade_technician','inspector']) code;
set local role authenticated;
do $$ declare result jsonb; i public.inspections; begin
 result:=private._flow_call('schedule_company_inspection',jsonb_build_object('home_id','c4000000-0000-4000-8000-000000000001','company_id',current_setting('buildtrack.flow.company'),'type','external_quality','template_version_id','c6000000-0000-4000-8000-000000000001'));
 select * into i from public.inspections where id=(result->>'id')::uuid;
 perform set_config('buildtrack.flow.company_inspection',i.id::text,true);
 result:=public.execute_command('allocate_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',i.version,'payload',jsonb_build_object('inspection_id',i.id,'inspector_user_id','c1000000-0000-4000-8000-000000000006','reason','Invalid company member')));
 perform private._inspector_check(not (result->>'ok')::boolean,'outside company Inspector was allocated');
 result:=private._flow_call('allocate_inspection',jsonb_build_object('inspection_id',i.id,'inspector_user_id','c1000000-0000-4000-8000-000000000004','reason','Allocate eligible company Inspector'),i.version);
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
do $$ declare result jsonb; begin
 result:=public.execute_command('save_inspection_responses',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',1,'payload',jsonb_build_object('inspection_id',current_setting('buildtrack.flow.company_inspection'),'responses','[]'::jsonb)));
 perform private._inspector_check(not (result->>'ok')::boolean,'unassigned Inspector could batch edit another inspection');
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
do $$ declare result jsonb; replay jsonb; envelope jsonb; i public.inspections; begin
 select * into i from public.inspections where id=current_setting('buildtrack.flow.company_inspection')::uuid;
 envelope:=jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',i.version,'payload',jsonb_build_object('inspection_id',i.id,'responses',jsonb_build_array(jsonb_build_object('question_id','c7000000-0000-4000-8000-000000000001','response','pass'))));
 result:=public.execute_command('save_inspection_responses',envelope);
 perform private._inspector_check((result->>'ok')::boolean,'assigned company Inspector could not batch save: '||result::text);
 replay:=public.execute_command('save_inspection_responses',envelope);
 perform private._inspector_check(replay->'data'=result->'data','batch save replay changed result');
 select * into i from public.inspections where id=i.id;
 result:=private._flow_call('submit_inspection',jsonb_build_object('inspection_id',i.id),i.version);
 perform private._inspector_check((select jsonb_array_length(snapshot->'responses')=1 from public.inspection_submissions where inspection_id=i.id),'company submission lost saved answers');
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
do $$ declare i public.inspections; result jsonb; begin
 select * into i from public.inspections where id=current_setting('buildtrack.flow.company_inspection')::uuid;
 result:=private._flow_call('review_inspection',jsonb_build_object('inspection_id',i.id,'action','complete'),i.version);
 perform private._inspector_check((select reviewed_at is not null from public.inspections where id=i.id),'company report review did not complete');
end; $$;
reset role;
insert into public.inspections(id,organization_id,neighborhood_id,home_id,type,template_version_id,lead_inspector_user_id) values ('c8000000-0000-4000-8000-000000000099','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000002','internal_quality','c6000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,granted_by) values ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','superintendent','neighborhood','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare i public.inspections; denied boolean:=false; begin
 select * into i from public.inspections where id=current_setting('buildtrack.flow.inspection')::uuid;
 begin perform public.remove_inspection(i.organization_id,i.id,i.version); exception when insufficient_privilege then denied:=true; end;
 perform private._inspector_check(denied,'inspector must not remove inspection');
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare i public.inspections; before_work bigint; before_submissions bigint; result jsonb; begin
 select * into i from public.inspections where id=current_setting('buildtrack.flow.inspection')::uuid;
 select count(*) into before_work from public.work_items where inspection_id=i.id;
 select count(*) into before_submissions from public.inspection_submissions where inspection_id=i.id;
 begin perform public.remove_inspection(i.organization_id,i.id,i.version-1); raise exception 'stale version accepted'; exception when serialization_failure then null; end;
 begin perform public.remove_inspection(i.organization_id,'c8000000-0000-4000-8000-000000000099',1); raise exception 'out-of-scope removal accepted'; exception when insufficient_privilege then null; end;
 perform private._inspector_check(before_work>0 and before_submissions>0,'fixture must include linked work and submission');
 result:=public.remove_inspection(i.organization_id,i.id,i.version);
 perform private._inspector_check((result->>'removed')::boolean,'supervisor removal failed');
 perform private._inspector_check(not exists(select 1 from public.inspection_list where id=i.id),'removed inspection remains in active list');
 perform private._inspector_check((select status='cancelled' and removed_at is not null and status_before_removal='submitted' from public.inspections where id=i.id),'history status missing');
 perform private._inspector_check((select count(*)=before_work from public.work_items where inspection_id=i.id),'linked work changed');
 perform private._inspector_check((select count(*)=before_submissions from public.inspection_submissions where inspection_id=i.id),'submissions changed');
end $$;
reset role;
select 'inspection_removal_checks_passed' as result;
rollback;


