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

grant usage on schema private to service_role;
create function private._upload_denied(statement text) returns void language plpgsql as $$
begin
 begin execute statement; exception when insufficient_privilege then return; end;
 raise exception 'Upload security check failed: expected forbidden: %',statement;
end; $$;
grant execute on function private._upload_denied(text) to authenticated,service_role;
insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
 values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','internal','active',now());
insert into public.roles(code,label,allowed_scope_kinds,organization_id,active) values('security_read_only','Read only security fixture','{neighborhood}','c2000000-0000-4000-8000-000000000001',true);
insert into public.role_permissions(role_code,permission_code) values('security_read_only','work.read_scope');
insert into public.organization_roles(organization_id,role_code,enabled) values('c2000000-0000-4000-8000-000000000001','security_read_only',true);
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,granted_by)
 values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','security_read_only','neighborhood','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$ declare result jsonb; begin
 result:=private._flow_call('create_and_assign_work_item','{"organization_id":"c2000000-0000-4000-8000-000000000001","home_id":"c4000000-0000-4000-8000-000000000001","neighborhood_id":"c3000000-0000-4000-8000-000000000001","title":"Evidence integrity repair","description":"Repair cabinet and preserve each attempt","assignment":{"accountable_internal_user_id":"c1000000-0000-4000-8000-000000000002","due_at":"2026-11-20T12:00:00Z"}}');
 perform set_config('buildtrack.security.work',result->>'id',true);
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
do $$ begin
 perform private._inspector_check(exists(select 1 from public.work_items where id=current_setting('buildtrack.security.work')::uuid),'read-only member cannot read fixture work');
 perform private._upload_denied(format('select public.request_attachment_slot(''c2000000-0000-4000-8000-000000000001'',''c3000000-0000-4000-8000-000000000001'',''c4000000-0000-4000-8000-000000000001'',%L,null,null,''shared'',''read-only.png'',''image/png'',8,''correction'')',current_setting('buildtrack.security.work')));
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
do $$ declare a public.attachments; begin
 perform private._upload_denied(format('select public.request_attachment_slot(''c2000000-0000-4000-8000-000000000001'',''c3000000-0000-4000-8000-000000000002'',''c4000000-0000-4000-8000-000000000001'',%L,null,null,''shared'',''wrong-scope.png'',''image/png'',8,''correction'')',current_setting('buildtrack.security.work')));
 a:=public.request_attachment_slot('c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',current_setting('buildtrack.security.work')::uuid,null,null,'shared','first-attempt.png','image/png',8,'correction');
 perform set_config('buildtrack.security.file',a.id::text,true);
 perform public.authorize_attachment_upload(a.id);
end; $$;
reset role;
update public.role_assignments set revoked_at=now() where user_id='c1000000-0000-4000-8000-000000000002';
set local role authenticated;
select private._inspector_check(not exists(select 1 from public.attachments where id=current_setting('buildtrack.security.file')::uuid),'uploader retained file access after losing parent scope');
select private._upload_denied(format('select public.authorize_attachment_upload(%L)',current_setting('buildtrack.security.file')));
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select private._upload_denied(format('select public.finalize_attachment_record(%L,repeat(''a'',64),8,''image/png'',true,''rollback-scan'')',current_setting('buildtrack.security.file')));
reset role;
update public.role_assignments set revoked_at=null where user_id='c1000000-0000-4000-8000-000000000002';
set local role service_role;
select public.finalize_attachment_record(current_setting('buildtrack.security.file')::uuid,repeat('a',64),8,'image/png',true,'rollback-scan');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare w public.work_items; result jsonb; begin
 select * into w from public.work_items where id=current_setting('buildtrack.security.work')::uuid;
 result:=private._flow_call('submit_correction',jsonb_build_object('item_id',w.id,'note','Cabinet repaired','attachment_ids',jsonb_build_array(current_setting('buildtrack.security.file'))),w.version);
 perform set_config('buildtrack.security.first_attempt',(select correction_attempt_id::text from public.attachments where id=current_setting('buildtrack.security.file')::uuid),true);
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
do $$ declare w public.work_items; result jsonb; begin
 select * into w from public.work_items where id=current_setting('buildtrack.security.work')::uuid;
 result:=private._flow_call('verify_correction',jsonb_build_object('item_id',w.id,'decision','rejected','method','remote','notes','Adjust the remaining hinge'),w.version);
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
do $$ declare w public.work_items; result jsonb; a public.attachments; begin
 select * into w from public.work_items where id=current_setting('buildtrack.security.work')::uuid;
 result:=public.execute_command('submit_correction',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',jsonb_build_object('item_id',w.id,'note','Try reusing old evidence','attachment_ids',jsonb_build_array(current_setting('buildtrack.security.file')))));
 perform private._inspector_check(not (result->>'ok')::boolean and result->'error'->>'code'='EVIDENCE_NOT_READY','old attempt evidence was accepted again');
 perform private._inspector_check((select correction_attempt_id::text=current_setting('buildtrack.security.first_attempt') from public.attachments where id=current_setting('buildtrack.security.file')::uuid),'old evidence was moved to another attempt');
 a:=public.request_attachment_slot(w.organization_id,w.neighborhood_id,w.home_id,w.id,null,null,'shared','new-attempt.png','image/png',8,'correction');
 perform set_config('buildtrack.security.second_file',a.id::text,true);
end; $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.finalize_attachment_record(current_setting('buildtrack.security.second_file')::uuid,repeat('b',64),8,'image/png',true,'rollback-scan');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare w public.work_items; result jsonb; begin
 select * into w from public.work_items where id=current_setting('buildtrack.security.work')::uuid;
 result:=private._flow_call('submit_correction',jsonb_build_object('item_id',w.id,'note','Remaining hinge repaired','attachment_ids',jsonb_build_array(current_setting('buildtrack.security.second_file'))),w.version);
 perform private._inspector_check((select count(*)=2 from public.correction_attempts where work_item_id=w.id),'fresh evidence resubmission failed');
end; $$;
-- Submitting a report freezes it even if an old upload reservation still exists.
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
do $$ declare result jsonb; begin
 result:=private._flow_call('schedule_inspection','{"home_id":"c4000000-0000-4000-8000-000000000001","type":"internal_quality","template_version_id":"c6000000-0000-4000-8000-000000000001","lead_inspector_user_id":"c1000000-0000-4000-8000-000000000006"}');
 perform set_config('buildtrack.security.inspection',result->>'id',true);
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
do $$ declare a public.attachments; i public.inspections; result jsonb; begin
 a:=public.request_inspection_item_media(current_setting('buildtrack.security.inspection')::uuid,'c7000000-0000-4000-8000-000000000001','inspection.png','image/png',8);
 perform set_config('buildtrack.security.inspection_file',a.id::text,true);
 select * into i from public.inspections where id=current_setting('buildtrack.security.inspection')::uuid;
 result:=private._flow_call('upsert_inspection_response',jsonb_build_object('inspection_id',i.id,'question_id','c7000000-0000-4000-8000-000000000001','response','pass'),i.version);
 select * into i from public.inspections where id=i.id;
 result:=private._flow_call('submit_inspection',jsonb_build_object('inspection_id',i.id),i.version);
 perform private._upload_denied(format('select public.authorize_attachment_upload(%L)',a.id));
 perform private._upload_denied(format('select public.request_inspection_item_media(%L,''c7000000-0000-4000-8000-000000000001'',''late.png'',''image/png'',8)',i.id));
end; $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select private._upload_denied(format('select public.finalize_attachment_record(%L,repeat(''c'',64),8,''image/png'',true,''rollback-scan'')',current_setting('buildtrack.security.inspection_file')));
reset role;
-- Company managers can still delegate repairs and their assigned technicians
-- can upload, finalize and submit completion evidence through the same checks.
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare c public.companies; begin
 c:=public.admin_onboard_vendor('c2000000-0000-4000-8000-000000000001','Evidence fixture vendor',null,'neighborhood',null,'c3000000-0000-4000-8000-000000000001');
 perform set_config('buildtrack.security.company',c.id::text,true);
end; $$;
reset role;
insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
 select 'c2000000-0000-4000-8000-000000000001',('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'external','active',now() from generate_series(4,5) i;
insert into public.company_memberships(organization_id,company_id,user_id,kind)
 select 'c2000000-0000-4000-8000-000000000001',current_setting('buildtrack.security.company')::uuid,('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,case when i=5 then 'manager' else 'technician' end from generate_series(4,5) i;
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,company_id,granted_by)
 select 'c2000000-0000-4000-8000-000000000001',('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,case when i=5 then 'vendor_admin' else 'trade_technician' end,'company',current_setting('buildtrack.security.company')::uuid,'c1000000-0000-4000-8000-000000000001' from generate_series(4,5) i;
insert into public.neighborhood_trade_rosters(organization_id,company_id,neighborhood_id,status)
 values('c2000000-0000-4000-8000-000000000001',current_setting('buildtrack.security.company')::uuid,'c3000000-0000-4000-8000-000000000001','active');
set local role authenticated;
do $$ declare result jsonb; begin
 result:=private._flow_call('create_and_assign_work_item',jsonb_build_object('organization_id','c2000000-0000-4000-8000-000000000001','neighborhood_id','c3000000-0000-4000-8000-000000000001','home_id','c4000000-0000-4000-8000-000000000001','title','Vendor evidence fixture','description','Complete assigned company repair','assignment',jsonb_build_object('company_id',current_setting('buildtrack.security.company'),'due_at','2026-11-20T12:00:00Z')));
 perform set_config('buildtrack.security.vendor_work',result->>'id',true);
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',true);
do $$ declare w public.work_items; result jsonb; begin
 select * into w from public.work_items where id=current_setting('buildtrack.security.vendor_work')::uuid;
 result:=private._flow_call('delegate_company_work',jsonb_build_object('item_id',w.id,'technician_id','c1000000-0000-4000-8000-000000000004'),w.version);
end; $$;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
do $$ declare w public.work_items; a public.attachments; begin
 select * into w from public.work_items where id=current_setting('buildtrack.security.vendor_work')::uuid;
 a:=public.request_attachment_slot(w.organization_id,w.neighborhood_id,w.home_id,w.id,null,null,'shared','vendor-completion.png','image/png',8,'correction');
 perform public.authorize_attachment_upload(a.id);
 perform set_config('buildtrack.security.vendor_file',a.id::text,true);
end; $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.finalize_attachment_record(current_setting('buildtrack.security.vendor_file')::uuid,repeat('d',64),8,'image/png',true,'rollback-scan');
reset role;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$ declare w public.work_items; result jsonb; begin
 select * into w from public.work_items where id=current_setting('buildtrack.security.vendor_work')::uuid;
 result:=private._flow_call('submit_correction',jsonb_build_object('item_id',w.id,'note','Vendor repair complete','attachment_ids',jsonb_build_array(current_setting('buildtrack.security.vendor_file'))),w.version);
 perform private._inspector_check((select state='ready_for_verification' from public.work_items where id=w.id),'vendor evidence completion failed');
end; $$;
reset role;
select 'evidence_security_passed_and_rolled_back' result;
rollback;
