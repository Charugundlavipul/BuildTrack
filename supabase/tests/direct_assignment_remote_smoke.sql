-- Self-contained, rollback-only verification. No seed, emails, or committed test data.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
values('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'buildtrack-platform-check@example.invalid',now(),now(),now(),'{"display_name":"Rollback verification"}','{}');
insert into public.profiles(id,display_name) values('a1000000-0000-4000-8000-000000000001','Rollback verification') on conflict(id) do nothing;
insert into public.platform_administrators(user_id) values('a1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare created jsonb; organization_id uuid; other_id uuid; request_id uuid:=gen_random_uuid();
  private_code text; admin_code text; global_code text; blocked boolean;
begin
  if not (public.platform_access()->>'administrator')::boolean then raise exception 'platform access verification failed'; end if;
  created:=public.platform_save_organization(null,'Rollback platform verification','America/New_York','active',
    'buildtrack-platform-check@example.invalid','org_admin',request_id,null);
  organization_id:=(created->'organization'->>'id')::uuid;
  perform set_config('buildtrack.smoke.organization',organization_id::text,true);
  created:=public.platform_save_organization(null,'Rollback platform verification','America/New_York','active',
    'buildtrack-platform-check@example.invalid','org_admin',request_id,null);
  if (created->'organization'->>'id')::uuid<>organization_id then raise exception 'onboarding idempotency failed'; end if;
  global_code:=public.save_role_definition(null,null,'Rollback shared role','',array['organization']::public.scope_kind[],array['work.read_scope'],true,false,false,null)->>'code';
  perform public.set_organization_role(organization_id,global_code,true);
  private_code:=public.save_role_definition(organization_id,null,'Rollback private role','',array['organization']::public.scope_kind[],array['work.create'],true,false,false,null)->>'code';
  perform public.platform_prepare_administrator_invitation(organization_id,
    '0b96b52f53cb2b8f4e836a507792f1906c276465c9229ca4f4873d280d32c2ff',now()+interval '1 day');
  perform public.save_my_profile('Rollback','Verifier','','','',(public.my_profile()->>'version')::bigint);
  perform public.accept_invitation('buildtrack-rollback-verification-token');
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  if not (public.current_access(organization_id)->'permissions') ? 'access.manage' then raise exception 'onboarding administrator access missing'; end if;
  perform public.admin_set_member_access(organization_id,auth.uid(),'internal',jsonb_build_array(
    jsonb_build_object('role_code','org_admin','scope_kind','organization'),
    jsonb_build_object('role_code',private_code,'scope_kind','organization')),null,null);
  if not (public.current_access(organization_id)->'permissions') ? 'work.create' then raise exception 'private role permissions missing'; end if;
  perform public.set_organization_role(organization_id,private_code,false);
  if exists(select 1 from jsonb_array_elements(public.current_access(organization_id)->'roles') grant_row where grant_row->>'role_code'=private_code) then raise exception 'removed role still supplies an effective grant'; end if;
  perform public.set_organization_role(organization_id,private_code,true);
  blocked:=false;
  begin
    perform public.set_organization_role(organization_id,'org_admin',false);
    execute 'set constraints all immediate';
  exception when check_violation then blocked:=true;
  end;
  execute 'set constraints all deferred';
  if not blocked then raise exception 'last administrator protection failed'; end if;
  admin_code:=public.save_role_definition(organization_id,null,'Rollback replacement administrator','',array['organization']::public.scope_kind[],array['access.manage'],true,false,false,null)->>'code';
  perform public.admin_set_member_access(organization_id,auth.uid(),'internal',jsonb_build_array(
    jsonb_build_object('role_code',admin_code,'scope_kind','organization')),null,null);
  perform public.set_organization_role(organization_id,'org_admin',false);
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  if not (public.current_access(organization_id)->'permissions') ? 'access.manage' then raise exception 'custom administrator handover failed'; end if;
  created:=public.platform_save_organization(null,'Rollback isolation verification','America/New_York','active',
    'buildtrack-platform-check@example.invalid','org_admin',gen_random_uuid(),null);
  other_id:=(created->'organization'->>'id')::uuid;
  perform set_config('buildtrack.smoke.other',other_id::text,true);
  blocked:=false;
  begin perform public.set_organization_role(other_id,private_code,true);
  exception when invalid_parameter_value then blocked:=true; end;
  if not blocked then raise exception 'cross-tenant private role isolation failed'; end if;
end; $$;
reset role;
do $$
declare org uuid:=current_setting('buildtrack.smoke.organization')::uuid; n uuid; h uuid; t uuid; v uuid; i uuid;
begin
 insert into public.neighborhoods(organization_id,code,name) values(org,'ROLLBACK','Rollback neighborhood') returning id into n;
 insert into public.homes(organization_id,neighborhood_id,lot_code,address_line1) values(org,n,'1','Rollback address') returning id into h;
 insert into public.checklist_templates(organization_id,name) values(org,'Rollback checklist') returning id into t;
 insert into public.checklist_versions(organization_id,template_id,number,created_by) values(org,t,1,'a1000000-0000-4000-8000-000000000001') returning id into v;
 insert into public.inspections(organization_id,neighborhood_id,home_id,type,template_version_id,lead_inspector_user_id) values(org,n,h,'internal_quality',v,'a1000000-0000-4000-8000-000000000001') returning id into i;
 perform set_config('buildtrack.smoke.neighborhood',n::text,true);
 perform set_config('buildtrack.smoke.home',h::text,true);
 perform set_config('buildtrack.smoke.inspection',i::text,true);
end; $$;
set local role authenticated;
do $$
declare org uuid:=current_setting('buildtrack.smoke.organization')::uuid; n uuid:=current_setting('buildtrack.smoke.neighborhood')::uuid;
 code text; base jsonb; envelope jsonb; result jsonb; replay jsonb; item uuid:=gen_random_uuid(); failed_item uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); finding uuid:=gen_random_uuid();
begin
 code:=public.save_role_definition(org,null,'Rollback work dispatcher','',array['organization']::public.scope_kind[],array['work.create','work.assign','work.read_scope','inspection.perform'],true,false,false,null)->>'code';
 perform public.admin_set_member_access(org,auth.uid(),'internal',(public.current_access(org)->'roles')||jsonb_build_array(jsonb_build_object('role_code',code,'scope_kind','organization')),null,null);
 base:=jsonb_build_object('organization_id',org,'neighborhood_id',n,'common_area_location','Playground','title','Rollback work item','description','Rollback description','priority','normal');
 envelope:=jsonb_build_object('operation_id',gen_random_uuid(),'captured_at',now(),'payload',base||jsonb_build_object('id',item,'assignment',jsonb_build_object('accountable_internal_user_id',auth.uid(),'due_at',now()+interval '1 day')));
 result:=public.execute_command('create_and_assign_work_item',envelope);
 if not coalesce((result->>'ok')::boolean,false) or result->'data'->>'state'<>'assigned' then raise exception 'direct create and assign failed: %',result; end if;
 replay:=public.execute_command('create_and_assign_work_item',envelope);
 if not (replay->>'replayed')::boolean then raise exception 'direct assignment replay failed'; end if;
 if (select count(*) from public.assignment_episodes where work_item_id=item)<>1 then raise exception 'replay duplicated assignment'; end if;
 if not exists(select 1 from public.work_items where id=item and submitted_at is not null) then raise exception 'direct assignment missing submission timestamp'; end if;
 result:=public.execute_command('create_and_assign_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',base||jsonb_build_object('id',failed_item,'assignment',jsonb_build_object('accountable_internal_user_id',gen_random_uuid(),'due_at',now()+interval '1 day'))));
 if (result->>'ok')::boolean or result->'error'->>'code'<>'ASSIGNEE_INELIGIBLE' then raise exception 'invalid assignee accepted or wrong error: %',result; end if;
 if exists(select 1 from public.work_items where id=failed_item) then raise exception 'failed assignment left an orphan draft'; end if;
 result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',base||jsonb_build_object('id',draft)));
 result:=public.execute_command('assign_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(result->'data'->>'version')::bigint,'payload',jsonb_build_object('item_id',draft,'accountable_internal_user_id',auth.uid(),'due_at',now()+interval '1 day')));
 if not (result->>'ok')::boolean then raise exception 'direct draft assignment failed: %',result; end if;
 result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',base||jsonb_build_object('id',finding,'origin','internal_inspection','common_area_location',null,'home_id',current_setting('buildtrack.smoke.home'),'inspection_id',current_setting('buildtrack.smoke.inspection'))));
 if not (result->>'ok')::boolean then raise exception 'finding fixture creation failed: %',result; end if;
 result:=public.execute_command('assign_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(result->'data'->>'version')::bigint,'payload',jsonb_build_object('item_id',finding,'accountable_internal_user_id',auth.uid(),'due_at',now()+interval '1 day')));
 if (result->>'ok')::boolean or result->'error'->>'code'<>'INVALID_TRANSITION' then raise exception 'inspection finding bypassed inspection submission: %',result; end if;
 perform public.save_role_definition(org,code,'Rollback reporter','',array['organization']::public.scope_kind[],array['work.create','work.read_scope'],true,false,false,1);
 failed_item:=gen_random_uuid();
 result:=public.execute_command('create_and_assign_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',base||jsonb_build_object('id',failed_item,'assignment',jsonb_build_object('accountable_internal_user_id',auth.uid(),'due_at',now()+interval '1 day'))));
 if (result->>'ok')::boolean or result->'error'->>'code'<>'FORBIDDEN' or exists(select 1 from public.work_items where id=failed_item) then raise exception 'reporter bypassed assignment permission: %',result; end if;
 draft:=gen_random_uuid();
 result:=public.execute_command('create_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'payload',base||jsonb_build_object('id',draft)));
 result:=public.execute_command('submit_work_item',jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',(result->'data'->>'version')::bigint,'payload',jsonb_build_object('item_id',draft)));
 if not (result->>'ok')::boolean or result->'data'->>'state'<>'submitted' then raise exception 'reporter submission failed: %',result; end if;
end; $$;
reset role;
update public.platform_administrators set active=false where user_id='a1000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare blocked boolean:=false; organization_id uuid:=current_setting('buildtrack.smoke.organization')::uuid;
begin
  begin perform public.platform_list_organizations(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'tenant can enumerate platform organizations'; end if;
  blocked:=false;
  begin perform public.save_role_definition(null,null,'Forbidden shared role','',array['organization']::public.scope_kind[],array['access.manage'],true,false,false,null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'tenant can create global roles'; end if;
  perform public.save_role_definition(organization_id,null,'Tenant-created private role','',array['home']::public.scope_kind[],array['work.read_scope'],true,false,false,null);
end; $$;
reset role;
update public.platform_administrators set active=true where user_id='a1000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare blocked boolean:=false;
begin
  begin perform public.platform_list_organizations(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'platform operation bypasses MFA'; end if;
end; $$;
reset role;
rollback;
select 'direct_assignment_smoke_passed_and_rolled_back' as result;
