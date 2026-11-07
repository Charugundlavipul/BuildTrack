-- Exercises the actual invitation and inspection command paths. Always rolls back.
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
set local role authenticated;

reset role;
insert into public.divisions(id,organization_id,name) values('c2100000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Communication test division');
update public.neighborhoods set division_id='c2100000-0000-4000-8000-000000000001' where id='c3000000-0000-4000-8000-000000000001';
update public.role_assignments set neighborhood_id='c3000000-0000-4000-8000-000000000002' where user_id='c1000000-0000-4000-8000-000000000006';
select set_config('buildtrack.communication.previous_name',(select display_name from public.profiles where id='c1000000-0000-4000-8000-000000000002'),true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; n uuid:='c3000000-0000-4000-8000-000000000001'; h jsonb; replay jsonb; plan jsonb; request uuid:=gen_random_uuid(); details jsonb; conversation uuid; response jsonb;
begin
  details:=jsonb_build_object('neighborhood_id',n,'lot_code','MANUAL-101');
  begin perform public.onboard_home_layout(org,gen_random_uuid(),null,null,'[]',details); raise exception 'Missing layout accepted'; exception when check_violation then null; end;
  begin perform public.onboard_home_layout(org,gen_random_uuid(),'manual',null,'[]',details); raise exception 'Empty manual layout accepted'; exception when check_violation then null; end;
  begin perform public.onboard_home_layout(org,gen_random_uuid(),'plan',null,'[]',details); raise exception 'Missing plan accepted'; exception when check_violation then null; end;
  begin perform public.admin_save_home(org,null,n,'BYPASS-101'); raise exception 'Layout onboarding bypass accepted'; exception when check_violation then null; end;
  h:=public.onboard_home_layout(org,request,'manual',null,'[{"name":"Kitchen","type":"kitchen"}]',details);
  replay:=public.onboard_home_layout(org,request,'manual',null,'[{"name":"Kitchen","type":"kitchen"}]',details);
  perform private._inspector_check(h->>'id'=replay->>'id','Onboarding duplicated after retry');
  perform private._inspector_check(h->>'layout_mode'='manual' and (select count(*)=1 from public.home_locations where home_id=(h->>'id')::uuid),'Manual rooms were not atomically saved');
  begin perform public.onboard_home_layout(org,request,'manual',null,'[{"name":"Bath","type":"bathroom"}]',details); raise exception 'Request reuse changed layout'; exception when check_violation then null; end;
  begin perform public.onboard_home_layout(org,gen_random_uuid(),'manual',null,'[{"name":"Kitchen","type":"kitchen"},{"name":" kitchen ","type":"kitchen"}]',jsonb_build_object('neighborhood_id',n,'lot_code','BAD-101')); raise exception 'Duplicate room accepted'; exception when check_violation then null; end;
  perform private._inspector_check(not exists(select 1 from public.homes where lot_code='BAD-101'),'Failed onboarding left a home');
  plan:=public.save_master_plan(org,null,'c2100000-0000-4000-8000-000000000001','Copy plan','[{"name":"Kitchen","type":"kitchen"}]',true,null);
  h:=public.onboard_home_layout(org,gen_random_uuid(),'plan',(plan->>'id')::uuid,'[]',jsonb_build_object('neighborhood_id',n,'lot_code','PLAN-101'));
  perform private._inspector_check(h->>'layout_mode'='plan' and (select count(*)=1 from public.home_locations where home_id=(h->>'id')::uuid),'Standard plan was not copied');
  response:=public.execute_command('import_homes',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'neighborhood_id',n,'preview',true,'rows',jsonb_build_array(jsonb_build_object('lot_code','IMPORT-101')))));
  perform private._inspector_check(not(response->>'ok')::boolean,'CSV preview bypassed the layout choice');
  response:=public.execute_command('import_homes',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'neighborhood_id',n,'layout_mode','manual','spaces','[{"name":"Entry","type":"other"}]'::jsonb,'preview',false,'rows',jsonb_build_array(jsonb_build_object('lot_code','IMPORT-101')))));
  perform private._inspector_check((response->>'ok')::boolean and (response->'data'->>'inserted_count')::int=1,'CSV layout onboarding failed '||response::text);
  perform private._inspector_check(exists(select 1 from public.homes h join public.home_locations l on l.home_id=h.id where h.organization_id=org and h.lot_code='IMPORT-101' and h.layout_mode='manual' and l.name='Entry'),'CSV home has no rooms');
  conversation:=public.project_chat_create(org,gen_random_uuid(),'Team coordination',array['c1000000-0000-4000-8000-000000000002'::uuid]);
  perform set_config('buildtrack.communication.conversation',conversation::text,true);
  perform private._inspector_check(jsonb_array_length(public.project_chat_read(org,conversation)->'members')=2,'Conversation participants missing');
  begin perform public.project_chat_create(org,gen_random_uuid(),'Inactive participant',array['c1000000-0000-4000-8000-000000000005'::uuid]); raise exception 'Inactive participant added'; exception when check_violation then null; end;
  response:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'id','c4200000-0000-4000-8000-000000000099','neighborhood_id',n,'home_id','c4000000-0000-4000-8000-000000000001','title','Check history','description','Confirm full accountability','priority','normal','origin','internal_observation')));
  perform private._inspector_check((response->>'ok')::boolean,'Observation fixture failed '||response::text);
  response:=public.execute_command('add_comment',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'item_id','c4200000-0000-4000-8000-000000000099','body','Internal estimate must stay private','visibility','internal')));
  perform private._inspector_check((response->>'ok')::boolean,'Internal note failed');
  perform private._inspector_check(exists(select 1 from jsonb_array_elements(public.observation_activity(org,'c4200000-0000-4000-8000-000000000099')->'entries') e where e->>'body'='Internal estimate must stay private'),'Internal note missing from authorized history');
  response:=public.execute_command('submit_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(select version from public.work_items where id='c4200000-0000-4000-8000-000000000099'),'payload',jsonb_build_object('organization_id',org,'item_id','c4200000-0000-4000-8000-000000000099')));
  perform private._inspector_check((response->>'ok')::boolean,'History observation submit failed '||response::text);
  response:=public.execute_command('assign_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(select version from public.work_items where id='c4200000-0000-4000-8000-000000000099'),'payload',jsonb_build_object('organization_id',org,'item_id','c4200000-0000-4000-8000-000000000099','accountable_internal_user_id','c1000000-0000-4000-8000-000000000002','due_at',now()+interval '1 day','reason','Initial site responsibility')));
  perform private._inspector_check((response->>'ok')::boolean,'First history assignment failed '||response::text);
  response:=public.execute_command('assign_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(select version from public.work_items where id='c4200000-0000-4000-8000-000000000099'),'payload',jsonb_build_object('organization_id',org,'item_id','c4200000-0000-4000-8000-000000000099','accountable_internal_user_id','c1000000-0000-4000-8000-000000000001','due_at',now()+interval '2 days','reason','Hand over to supervising team')));
  perform private._inspector_check((response->>'ok')::boolean,'Reassignment failed '||response::text);
  perform private._inspector_check(exists(select 1 from jsonb_array_elements(public.observation_activity(org,'c4200000-0000-4000-8000-000000000099')->'entries') e where e->'details'->>'reason'='Hand over to supervising team' and e->'details'->>'previous_assignee_name'=current_setting('buildtrack.communication.previous_name') and e->'details'->>'assignee_name'=(select display_name from public.profiles where id='c1000000-0000-4000-8000-000000000001')),'Handover history lost previous/new people');

end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; c uuid:=current_setting('buildtrack.communication.conversation')::uuid; operation uuid:=gen_random_uuid(); envelope jsonb; result jsonb; snapshot jsonb; i integer;
begin
  envelope:=jsonb_build_object('operation_id',operation,'payload',jsonb_build_object('organization_id',org,'conversation_id',c,'body','Kitchen checked on site.'));
  result:=public.execute_command('send_project_message',envelope);
  perform private._inspector_check((result->>'ok')::boolean,'Project message failed '||result::text);
  perform set_config('buildtrack.communication.message',(result->'data'->>'id'),true);
  result:=public.execute_command('send_project_message',envelope);
  perform private._inspector_check((result->>'replayed')::boolean and (select count(*)=1 from public.project_messages where operation_id=operation),'Message replay duplicated');
  result:=public.execute_command('send_project_message',jsonb_set(envelope,'{payload,body}','"Changed content"'));
  perform private._inspector_check(not(result->>'ok')::boolean,'Message operation reuse accepted');
  for i in 1..54 loop
    result:=public.execute_command('send_project_message',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'conversation_id',c,'body','History message '||i)));
    perform private._inspector_check((result->>'ok')::boolean,'Message history fixture failed');
  end loop;
  snapshot:=public.project_chat_read(org,c);
  perform private._inspector_check(jsonb_array_length(snapshot->'messages')=50 and (snapshot->>'has_more')::boolean,'Message pagination truncated');
  snapshot:=public.project_chat_read(org,c,(snapshot->'messages'->49->>'seq')::bigint);
  perform private._inspector_check(jsonb_array_length(snapshot->'messages')=6,'Earlier messages were not reachable');
  begin perform public.project_chat_set_member(org,c,'c1000000-0000-4000-8000-000000000006',true); raise exception 'Ordinary member changed participants'; exception when insufficient_privilege then null; end;
  begin perform public.onboard_home_layout(org,gen_random_uuid(),'manual',null,'[{"name":"Kitchen","type":"kitchen"}]','{"neighborhood_id":"c3000000-0000-4000-8000-000000000001","lot_code":"UNAUTHORIZED"}'); raise exception 'Contributor onboarded home'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; c uuid:=current_setting('buildtrack.communication.conversation')::uuid; result jsonb; other uuid;
begin
  perform private._inspector_check((public.project_chat_inbox(org)->>'unread')::integer=55,'Unread count does not cover all messages');
  perform public.project_chat_mark_read(org,c,999999999);
  perform private._inspector_check((public.project_chat_inbox(org)->>'unread')::integer=0,'Read marker failed');
  other:=public.project_chat_create(org,gen_random_uuid(),'Other conversation',array['c1000000-0000-4000-8000-000000000002'::uuid]);
  perform set_config('buildtrack.communication.other',other::text,true);
  result:=public.execute_command('send_project_message',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'conversation_id',other,'body','Invalid reply','reply_to',current_setting('buildtrack.communication.message'))));
  perform private._inspector_check(not(result->>'ok')::boolean,'Reply crossed conversations');
  perform public.project_chat_set_member(org,c,'c1000000-0000-4000-8000-000000000002',false);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; c uuid:=current_setting('buildtrack.communication.conversation')::uuid; result jsonb;
begin
  begin perform public.project_chat_read(org,c); raise exception 'Removed participant read conversation'; exception when insufficient_privilege then null; end;
  perform private._inspector_check(not exists(select 1 from public.project_messages where conversation_id=c),'Direct message RLS bypassed removal');
  begin
    result:=public.execute_command('send_project_message',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'conversation_id',c,'body','Offline replay after removal')));
    perform private._inspector_check(not(result->>'ok')::boolean,'Removed participant sent a queued message');
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  begin perform public.project_chat_read('c2000000-0000-4000-8000-000000000001',current_setting('buildtrack.communication.conversation')::uuid); raise exception 'Uninvited user read chat'; exception when insufficient_privilege then null; end;
  begin perform public.observation_activity('c2000000-0000-4000-8000-000000000001','c4200000-0000-4000-8000-000000000099'); raise exception 'Cross-project observation history read'; exception when insufficient_privilege then null; end;
  perform private._inspector_check(not exists(select 1 from public.project_conversations),'Uninvited RLS chat access');
end; $$;
reset role;

-- Active external members are available for partner conversations; internal notes stay private.
insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at) values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004','external','active',now());
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,home_id,neighborhood_id,granted_by) values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004','internal_contributor','home','c4000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform private._inspector_check(exists(select 1 from jsonb_array_elements(public.project_chat_people('c2000000-0000-4000-8000-000000000001','partners')) p where p->>'user_id'='c1000000-0000-4000-8000-000000000001'),'Organization partner audience did not return active members');
  perform private._inspector_check(not exists(select 1 from jsonb_array_elements(public.observation_activity('c2000000-0000-4000-8000-000000000001','c4200000-0000-4000-8000-000000000099')->'entries') e where e->>'visibility'='internal' or e->>'body'='Internal estimate must stay private'),'External participant reads internal notes');
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare c uuid;
begin
  c:=public.project_chat_create('c2000000-0000-4000-8000-000000000001',gen_random_uuid(),'Internal coordination',array['c1000000-0000-4000-8000-000000000002'::uuid],'internal');
  begin perform public.project_chat_set_member('c2000000-0000-4000-8000-000000000001',c,'c1000000-0000-4000-8000-000000000004',true); raise exception 'External user joined internal chat'; exception when check_violation then null; end;
  perform private._inspector_check(not exists(select 1 from jsonb_array_elements(public.project_chat_people('c2000000-0000-4000-8000-000000000001','internal')) p where p->>'user_id'='c1000000-0000-4000-8000-000000000004'),'External user offered in internal participant list');
end; $$;
reset role;
do $$ begin
  begin update public.work_events set event_type='tampered' where work_item_id='c4200000-0000-4000-8000-000000000099'; raise exception 'History was mutable'; exception when insufficient_privilege then null; end;
  begin update public.project_messages set body='tampered' where id=current_setting('buildtrack.communication.message')::uuid; raise exception 'Chat message was mutable'; exception when insufficient_privilege then null; end;
end; $$;
update public.role_assignments set revoked_at=now() where organization_id='c2000000-0000-4000-8000-000000000001' and user_id='c1000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$ begin
  perform private._inspector_check(public.project_chat_read('c2000000-0000-4000-8000-000000000001',current_setting('buildtrack.communication.other')::uuid)->'conversation' is not null,'Active organization member lost conversation after project role change');
end; $$;
reset role;
insert into public.platform_administrators(user_id) values('c1000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
begin
  begin perform public.project_chat_inbox('c2000000-0000-4000-8000-000000000001'); raise exception 'Platform role acquired tenant chat'; exception when insufficient_privilege then null; end;
  perform private._inspector_check(not exists(select 1 from public.project_messages),'Super Admin reads project messages');
end; $$;
reset role;
set constraints all immediate;
select 'home_layouts_project_chat_and_history_passed_and_rolled_back' result;
rollback;
