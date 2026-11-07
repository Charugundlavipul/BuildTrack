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
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; company public.companies;
begin
  perform private._inspector_check(exists(select 1 from jsonb_array_elements(public.available_roles(org)) r where r->>'code'='internal_contributor' and r->>'label'='Internal contributor'),'Internal contributor missing');
  perform private._inspector_check(not exists(select 1 from jsonb_array_elements(public.available_roles(org)) r where r->>'code' in ('internal_quality','external_inspector','verifier','auditor','operations_coordinator','leadership_viewer','sales_rep')),'obsolete or future role is assignable');
  perform public.admin_set_member_access(org,'c1000000-0000-4000-8000-000000000002','internal',jsonb_build_array(
    jsonb_build_object('role_code','internal_contributor','scope_kind','neighborhood','neighborhood_id','c3000000-0000-4000-8000-000000000001'),
    jsonb_build_object('role_code','inspector','scope_kind','neighborhood','neighborhood_id','c3000000-0000-4000-8000-000000000001')),null,null);
  company:=public.admin_onboard_vendor(org,'Rollback inspection company',null,'neighborhood',null,'c3000000-0000-4000-8000-000000000001');
  perform set_config('buildtrack.inspector.company',company.id::text,true);
  perform public.admin_create_invitation(org,'inspector-rollback-3@example.invalid','external',jsonb_build_array(jsonb_build_object('role_code','vendor_admin','scope_kind','company','company_id',company.id)),company.id,'manager',encode(extensions.digest('inspector-manager-token','sha256'),'hex'),now()+interval '1 day');
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.accept_invitation('inspector-manager-token');
select public.admin_create_invitation('c2000000-0000-4000-8000-000000000001','inspector-rollback-4@example.invalid','external',
  jsonb_build_array(jsonb_build_object('role_code','inspector','scope_kind','company','company_id',current_setting('buildtrack.inspector.company')::uuid)),
  current_setting('buildtrack.inspector.company')::uuid,'technician',encode(extensions.digest('company-inspector-token','sha256'),'hex'),now()+interval '1 day');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.accept_invitation('company-inspector-token');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; result jsonb; lead uuid;
begin
  perform private._inspector_check(exists(select 1 from public.inspection_lead_options(org,'c4000000-0000-4000-8000-000000000001') l where l.user_id='c1000000-0000-4000-8000-000000000002'),'Internal contributor plus Inspector not assignable');
  perform private._inspector_check(exists(select 1 from public.inspection_lead_options(org,'c4000000-0000-4000-8000-000000000001') l where l.user_id='c1000000-0000-4000-8000-000000000004'),'company Inspector not assignable');
  perform private._inspector_check(not exists(select 1 from public.inspection_lead_options(org,'c4000000-0000-4000-8000-000000000002') l where l.user_id='c1000000-0000-4000-8000-000000000004'),'company Inspector eligible outside approved coverage');
  perform private._inspector_check(not exists(select 1 from public.inspection_lead_options(org,'c4000000-0000-4000-8000-000000000001') l where l.user_id='c1000000-0000-4000-8000-000000000006'),'contributor without Inspector is assignable to inspections');
  foreach lead in array array['c1000000-0000-4000-8000-000000000002'::uuid,'c1000000-0000-4000-8000-000000000004'::uuid] loop
    result:=public.execute_command('schedule_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object(
      'organization_id',org,'home_id','c4000000-0000-4000-8000-000000000001','type','internal_quality','template_version_id','c6000000-0000-4000-8000-000000000001','lead_inspector_user_id',lead)));
    perform private._inspector_check((result->>'ok')::boolean,'inspection scheduling failed: '||result::text);
    perform set_config(case when lead='c1000000-0000-4000-8000-000000000002'::uuid then 'buildtrack.inspector.internal' else 'buildtrack.inspector.external' end,result->'data'->>'id',true);
  end loop;
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; inspection uuid:=current_setting('buildtrack.inspector.external')::uuid;
  internal_inspection uuid:=current_setting('buildtrack.inspector.internal')::uuid; finding uuid:=gen_random_uuid(); result jsonb; version bigint;
  payload jsonb:=jsonb_build_object('organization_id','c2000000-0000-4000-8000-000000000001','neighborhood_id','c3000000-0000-4000-8000-000000000001','home_id','c4000000-0000-4000-8000-000000000001','title','Cabinet finding','description','Cabinet panel is damaged','origin','internal_inspection');
begin
  perform private._inspector_check((select count(*)=1 from public.inspections where organization_id=org),'Inspector can see another person inspection');
  perform private._inspector_check((select count(*)=1 from public.homes where organization_id=org),'company Inspector home access is missing or too broad');
  result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',payload||jsonb_build_object('id',gen_random_uuid())));
  perform private._inspector_check(not(result->>'ok')::boolean and result->'error'->>'code'='FORBIDDEN','company Inspector created unrelated ad hoc work');
  result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',payload||jsonb_build_object('id',gen_random_uuid(),'inspection_id',internal_inspection)));
  perform private._inspector_check(not(result->>'ok')::boolean and result->'error'->>'code'='FORBIDDEN','company Inspector attached a finding to an unassigned inspection');
  result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',payload||jsonb_build_object('id',finding,'inspection_id',inspection)));
  perform private._inspector_check((result->>'ok')::boolean,'assigned Inspector could not capture a finding: '||result::text);
  select i.version into version from public.inspections i where i.id=inspection;
  result:=public.execute_command('upsert_inspection_response',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',version,'payload',
    jsonb_build_object('organization_id',org,'inspection_id',inspection,'question_id','c7000000-0000-4000-8000-000000000001','response','fail','reason','Damaged panel','finding_id',finding)));
  perform private._inspector_check((result->>'ok')::boolean,'assigned Inspector could not answer the checklist: '||result::text);
  result:=public.execute_command('submit_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(result->'data'->>'version')::bigint,'payload',jsonb_build_object('organization_id',org,'inspection_id',inspection)));
  perform private._inspector_check((result->>'ok')::boolean,'assigned Inspector could not submit the inspection: '||result::text);
  perform private._inspector_check((select state='submitted' from public.work_items where id=finding),'inspection submission did not submit its finding');
  perform private._inspector_check(not private.has_permission(org,auth.uid(),'work.verify','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001'),'Inspector silently received repair verification authority');
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; access jsonb:=public.current_access('c2000000-0000-4000-8000-000000000001');
begin
  perform private._inspector_check(jsonb_array_length(access->'roles')=2,'Inspector replaced the contributor role instead of adding to it');
  perform private._inspector_check((select count(*)=1 from public.inspections where organization_id=org),'internal Inspector can see unassigned company inspection');
  perform private._inspector_check(private.has_permission(org,auth.uid(),'work.execute_assigned','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001'),'adding Inspector removed contributor duties');
end; $$;
reset role;

reset role;
insert into public.divisions(id,organization_id,name) values('c2200000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Workflow division');
update public.neighborhoods set division_id='c2200000-0000-4000-8000-000000000001' where organization_id='c2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; plan jsonb; home jsonb; company public.companies; result jsonb; version bigint; loc uuid;
begin
  plan:=public.save_master_plan(org,null,'c2200000-0000-4000-8000-000000000001','Monterey','[{"type":"kitchen","name":"Kitchen"},{"type":"bedroom","name":"Bedroom 1"},{"type":"patio","name":"Covered patio"}]',true,null);
  perform set_config('buildtrack.quality.plan',plan->>'id',true);
  select h.version into version from public.homes h where h.id='c4000000-0000-4000-8000-000000000001';
  perform public.apply_home_plan(org,'c4000000-0000-4000-8000-000000000001',(plan->>'id')::uuid,version);
  home:=public.onboard_home_with_plan(org,'{"neighborhood_id":"c3000000-0000-4000-8000-000000000001","lot_code":"3","phase":"framing","external_reference":"EXT-3"}',(plan->>'id')::uuid);
  perform private._inspector_check((select count(*)=3 from public.home_locations where home_id=(home->>'id')::uuid),'plan spaces not copied during home onboarding');
  select id into loc from public.home_locations where home_id=(home->>'id')::uuid and name='Covered patio';
  perform public.save_home_space(org,loc,(home->>'id')::uuid,'Covered patio',null,false,'patio');
  perform public.save_home_space(org,null,(home->>'id')::uuid,'Sunroom',null,true,'living');
  perform public.save_master_plan(org,(plan->>'id')::uuid,'c2200000-0000-4000-8000-000000000001','Monterey revised','[{"type":"kitchen","name":"New kitchen"}]',true,(plan->>'version')::bigint);
  perform private._inspector_check((select count(*)=3 from public.home_locations where home_id=(home->>'id')::uuid and active),'master plan update changed lot-specific rooms');
  select * into company from public.companies where id=current_setting('buildtrack.inspector.company')::uuid;
  perform public.save_company_profile(org,company.id,'qa@example.invalid','555-0100','123 Quality Avenue','12-3456789',array['third_party_inspection','plumbing'],company.version);
  perform private._inspector_check(exists(select 1 from jsonb_array_elements(public.inspection_company_options(org,'c4000000-0000-4000-8000-000000000001')) c where c->>'id'=company.id::text),'covered QA company not selectable');
  perform private._inspector_check(jsonb_array_length(public.inspection_company_options(org,'c4000000-0000-4000-8000-000000000002'))=0,'QA company selectable outside coverage');
  perform public.admin_set_member_access(org,'c1000000-0000-4000-8000-000000000004','external',jsonb_build_array(
    jsonb_build_object('role_code','inspector','scope_kind','company','company_id',company.id),jsonb_build_object('role_code','trade_technician','scope_kind','company','company_id',company.id)),company.id,'technician');
  result:=public.execute_command('schedule_company_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',org,'home_id','c4000000-0000-4000-8000-000000000001','company_id',company.id,'type','external_quality','template_version_id','c6000000-0000-4000-8000-000000000001')));
  perform private._inspector_check((result->>'ok')::boolean,'company scheduling failed '||result::text);
  perform set_config('buildtrack.quality.bucket',result->'data'->>'id',true);
end; $$;
reset role;
insert into public.neighborhood_trade_rosters(organization_id,neighborhood_id,company_id,status) values('c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',current_setting('buildtrack.inspector.company')::uuid,'active');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select private._inspector_check(not exists(select 1 from public.inspections where id=current_setting('buildtrack.quality.bucket')::uuid),'field Inspector sees unallocated company bucket');
select private._inspector_check(not exists(select 1 from public.company_private_details),'field Inspector sees company EIN');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare result jsonb; version bigint; inspection_key uuid:=current_setting('buildtrack.quality.bucket')::uuid;
begin
  select i.version into version from public.inspections i where i.id=inspection_key;
  perform private._inspector_check(version is not null,'company manager cannot see company inbox');
  result:=public.execute_command('allocate_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',version,'payload',jsonb_build_object('inspection_id',inspection_key,'inspector_user_id','c1000000-0000-4000-8000-000000000002','reason','Wrong company')));
  perform private._inspector_check(not(result->>'ok')::boolean,'manager assigned another company/person');
  result:=public.execute_command('allocate_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',version,'payload',jsonb_build_object('inspection_id',inspection_key,'inspector_user_id','c1000000-0000-4000-8000-000000000004','reason','Daily dispatch')));
  perform private._inspector_check((result->>'ok')::boolean,'company manager dispatch failed '||result::text);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare result jsonb; version bigint; inspection_key uuid:=current_setting('buildtrack.quality.bucket')::uuid; observation uuid:=gen_random_uuid(); discard uuid:=gen_random_uuid(); loc uuid;
begin
  select l.id into loc from public.home_locations l where l.home_id='c4000000-0000-4000-8000-000000000001' and l.name='Kitchen';
  result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id','c2000000-0000-4000-8000-000000000001','id',observation,'home_id','c4000000-0000-4000-8000-000000000001','neighborhood_id','c3000000-0000-4000-8000-000000000001','location_id',loc,'inspection_id',inspection_key,'origin','external_inspection','title','Kitchen panel','description','Damaged cabinet panel')));
  perform private._inspector_check((result->>'ok')::boolean,'roaming observation failed '||result::text);
  perform set_config('buildtrack.quality.observation',observation::text,true);
  result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id','c2000000-0000-4000-8000-000000000001','id',discard,'home_id','c4000000-0000-4000-8000-000000000001','neighborhood_id','c3000000-0000-4000-8000-000000000001','inspection_id',inspection_key,'origin','external_inspection','title','Acceptable finish','description','For review')));
  perform private._inspector_check((result->>'ok')::boolean,'second observation failed '||result::text);
  perform set_config('buildtrack.quality.discard',discard::text,true);
  select i.version into version from public.inspections i where i.id=inspection_key;
  result:=public.execute_command('upsert_inspection_response',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',version,'payload',jsonb_build_object('inspection_id',inspection_key,'question_id','c7000000-0000-4000-8000-000000000001','response','pass')));
  perform private._inspector_check((result->>'ok')::boolean,'checklist response failed '||result::text);
  result:=public.execute_command('submit_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(result->'data'->>'version')::bigint,'payload',jsonb_build_object('inspection_id',inspection_key)));
  perform private._inspector_check((result->>'ok')::boolean,'company report submission failed '||result::text);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare result jsonb; w public.work_items; inspection_key uuid:=current_setting('buildtrack.quality.bucket')::uuid; version bigint;
begin
  select * into w from public.work_items where id=current_setting('buildtrack.quality.observation')::uuid;
  result:=public.execute_command('bulk_review_observations',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',w.organization_id,'action','assign','rows',jsonb_build_array(jsonb_build_object('item_id',w.id,'expected_version',w.version)),'company_id',current_setting('buildtrack.inspector.company'),'due_at',now()+interval '1 day','reason','Repair panel')));
  perform private._inspector_check((result->>'ok')::boolean,'bulk company assignment failed '||result::text);
  select * into w from public.work_items where id=current_setting('buildtrack.quality.discard')::uuid;
  result:=public.execute_command('bulk_review_observations',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',w.organization_id,'action','disregard','rows',jsonb_build_array(jsonb_build_object('item_id',w.id,'expected_version',w.version)),'reason','Within tolerance')));
  perform private._inspector_check((result->>'ok')::boolean,'bulk disregard failed '||result::text);
  select i.version into version from public.inspections i where i.id=inspection_key;
  result:=public.execute_command('review_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',version,'payload',jsonb_build_object('inspection_id',inspection_key,'action','escalate','reason','Buyer specification needs area manager decision')));
  perform private._inspector_check((result->>'ok')::boolean,'area manager escalation failed '||result::text);
  result:=public.execute_command('review_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(result->'data'->>'version')::bigint,'payload',jsonb_build_object('inspection_id',inspection_key,'action','resolve')));
  perform private._inspector_check((result->>'ok')::boolean,'area manager resolution failed '||result::text);
  result:=public.execute_command('review_inspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(result->'data'->>'version')::bigint,'payload',jsonb_build_object('inspection_id',inspection_key,'action','complete')));
  perform private._inspector_check((result->>'ok')::boolean,'report completion failed '||result::text);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare w public.work_items; result jsonb;
begin
  select * into w from public.work_items where id=current_setting('buildtrack.quality.observation')::uuid;
  result:=public.execute_command('delegate_company_work',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'technician_id','c1000000-0000-4000-8000-000000000004')));
  perform private._inspector_check((result->>'ok')::boolean,'repair dispatch failed '||result::text);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare w public.work_items; result jsonb; command text;
begin
  foreach command in array array['acknowledge_work','start_work'] loop
    select * into w from public.work_items where id=current_setting('buildtrack.quality.observation')::uuid;
    result:=public.execute_command(command,jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id)));
    perform private._inspector_check((result->>'ok')::boolean,command||' failed '||result::text);
  end loop;
end; $$;
reset role;
-- Insert an actual ready photo attachment fixture; no storage provider calls in this SQL transaction.
insert into public.attachments(id,organization_id,neighborhood_id,home_id,work_item_id,uploader_id,bucket,object_key,original_name,mime_type,byte_size,status,visibility,purpose)
values('c8100000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',current_setting('buildtrack.quality.observation')::uuid,'c1000000-0000-4000-8000-000000000004','evidence','quality-rollback-photo','repair.png','image/png',68,'ready','shared','correction');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare w public.work_items; result jsonb;
begin
  select * into w from public.work_items where id=current_setting('buildtrack.quality.observation')::uuid;
  result:=public.execute_command('submit_correction',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'note','Panel replaced. Ready for site verification.','attachment_ids',jsonb_build_array('c8100000-0000-4000-8000-000000000001'))));
  perform private._inspector_check((result->>'ok')::boolean,'repair submission failed '||result::text);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare w public.work_items; result jsonb; payload jsonb;
begin
  select * into w from public.work_items where id=current_setting('buildtrack.quality.observation')::uuid;
  payload:=jsonb_build_object('organization_id',w.organization_id,'action','reinspect','rows',jsonb_build_array(jsonb_build_object('item_id',w.id,'expected_version',w.version)),'reason','On-site panel review');
  result:=public.execute_command('bulk_review_observations',jsonb_build_object('operation_id',gen_random_uuid(),'payload',payload||jsonb_build_object('inspector_user_id','c1000000-0000-4000-8000-000000000004')));
  perform private._inspector_check(not(result->>'ok')::boolean,'repairer assigned to verify their own correction');
  result:=public.execute_command('bulk_review_observations',jsonb_build_object('operation_id',gen_random_uuid(),'payload',payload||jsonb_build_object('inspector_user_id','c1000000-0000-4000-8000-000000000002')));
  perform private._inspector_check((result->>'ok')::boolean,'independent reinspection assignment failed '||result::text);
  perform private._inspector_check((select reinspection_status='pending' from public.work_item_list where id=w.id),'pending reinspection missing from work view');
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare w public.work_items; result jsonb; operation uuid:=gen_random_uuid(); envelope jsonb;
begin
  select * into w from public.work_items where id=current_setting('buildtrack.quality.observation')::uuid;
  envelope:=jsonb_build_object('operation_id',operation,'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'decision','accepted','notes','Verified replaced panel on site.'));
  result:=public.execute_command('decide_reinspection',envelope);
  perform private._inspector_check((result->>'ok')::boolean,'assigned Inspector reinspection failed '||result::text);
  perform private._inspector_check(result->'data'->>'state'='verified','reinspection did not close original observation');
  result:=public.execute_command('decide_reinspection',envelope);
  perform private._inspector_check((result->>'replayed')::boolean,'retry was not idempotent');

end; $$;

reset role;
-- A second completed repair is rejected on its original observation, without
-- creating an inspection/task wrapper. History and manager notification persist.
insert into public.work_items(id,organization_id,neighborhood_id,home_id,origin,title,description,state,created_by) values('c4200000-0000-4000-8000-000000000042','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','manual_report','Second repair for return','Repair needs another pass.','ready_for_verification','c1000000-0000-4000-8000-000000000001');
insert into public.assignment_episodes(id,organization_id,work_item_id,company_id,assigned_by,due_at) values('c7100000-0000-4000-8000-000000000042','c2000000-0000-4000-8000-000000000001','c4200000-0000-4000-8000-000000000042',current_setting('buildtrack.inspector.company')::uuid,'c1000000-0000-4000-8000-000000000001',now()+interval '1 day');
update public.work_items set current_assignment_id='c7100000-0000-4000-8000-000000000042' where id='c4200000-0000-4000-8000-000000000042';
insert into public.correction_attempts(organization_id,work_item_id,assignment_episode_id,attempt_number,submitted_by,completion_note,accountable_company_id) values('c2000000-0000-4000-8000-000000000001','c4200000-0000-4000-8000-000000000042','c7100000-0000-4000-8000-000000000042',1,'c1000000-0000-4000-8000-000000000004','Ready for review',current_setting('buildtrack.inspector.company')::uuid);
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare w public.work_items; result jsonb;
begin
  select * into w from public.work_items where id='c4200000-0000-4000-8000-000000000042';
  result:=public.execute_command('bulk_review_observations',jsonb_build_object('operation_id',gen_random_uuid(),'payload',jsonb_build_object('organization_id',w.organization_id,'action','reinspect','rows',jsonb_build_array(jsonb_build_object('item_id',w.id,'expected_version',w.version)),'inspector_user_id','c1000000-0000-4000-8000-000000000002')));
  perform private._inspector_check((result->>'ok')::boolean,'rejection test assignment failed '||result::text);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare w public.work_items; result jsonb;
begin
  select * into w from public.work_items where id='c4200000-0000-4000-8000-000000000042';
  result:=public.execute_command('decide_reinspection',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'decision','rejected','notes','Replacement panel remains misaligned.')));
  perform private._inspector_check((result->>'ok')::boolean and result->'data'->>'state'='rework_required','reinspection rejection did not return repair '||result::text);
end; $$;
reset role;
select private._inspector_check(exists(select 1 from public.notifications where organization_id='c2000000-0000-4000-8000-000000000001' and recipient_user_id='c1000000-0000-4000-8000-000000000003' and work_item_id='c4200000-0000-4000-8000-000000000042' and title='Repair returned for rework'),'repair manager was not notified of rejected reinspection');
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare i public.inspections; result jsonb;
begin
  select * into i from public.inspections where id=current_setting('buildtrack.quality.bucket')::uuid;
  result:=public.execute_command('begin_inspection_amendment',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',i.version,'payload',jsonb_build_object('inspection_id',i.id)));
  perform private._inspector_check((result->>'ok')::boolean,'amendment failed '||result::text);
  perform private._inspector_check((select reviewed_at is null and escalated_at is null from public.inspections where id=i.id),'amendment remained in completed report list');
end; $$;
reset role;
set constraints all immediate;
select private._inspector_check((select count(*)=3 from public.inspections where organization_id='c2000000-0000-4000-8000-000000000001'),'reinspection created a wrapper inspection task');

do $$
begin
  begin
    update public.companies set status='archived' where id=current_setting('buildtrack.inspector.company')::uuid;
    raise exception 'Company with an open inspection was archived';
  exception when check_violation then
    perform private._inspector_check(sqlerrm like '%open company inspections%','unexpected company archive validation');
  end;
end; $$;
update public.role_assignments set revoked_at=now() where organization_id='c2000000-0000-4000-8000-000000000001' and user_id='c1000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select private._inspector_check(not exists(select 1 from public.company_private_details),'removed Vendor Manager retains EIN access');
select private._inspector_check(not(public.company_profile_context('c2000000-0000-4000-8000-000000000001',current_setting('buildtrack.inspector.company')::uuid)->>'can_edit')::boolean,'removed Vendor Manager retains company profile editing');
reset role;
select 'complete_quality_workflows_passed_and_rolled_back' result;
rollback;
