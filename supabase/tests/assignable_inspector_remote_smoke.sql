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
set constraints all immediate;
select 'assignable_inspector_checks_passed_and_rolled_back' as result;
rollback;
