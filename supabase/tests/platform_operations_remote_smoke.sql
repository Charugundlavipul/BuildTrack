-- Self-contained, rollback-only verification. No seed, emails, or committed test data.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
values('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'buildtrack-platform-check@example.invalid',now(),now(),now(),'{"display_name":"Rollback verification"}','{}');
insert into public.profiles(id,display_name) values('a1000000-0000-4000-8000-000000000001','Rollback verification') on conflict(id) do nothing;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data) values('a1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','buildtrack-member-check@example.invalid',now(),now(),now(),'{}','{}');
insert into public.profiles(id,display_name) values('a1000000-0000-4000-8000-000000000002','Rollback member') on conflict(id) do nothing;
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
do $$
declare org uuid:=current_setting('buildtrack.smoke.organization')::uuid; other_org uuid:=current_setting('buildtrack.smoke.other')::uuid;
 member_id uuid:='a1000000-0000-4000-8000-000000000002'; saved jsonb; config jsonb; blocked boolean; invite jsonb; version bigint;
begin
 config:=jsonb_build_object('plan_name','Rollback combined pricing','currency','USD','billing_interval','monthly','subscription_status','active','base_rate',100,'user_rate',5,'home_rate',2,'included_users',1,'included_homes',10,'billing_email','billing@example.invalid','starts_on','2026-10-26','ends_on','','notes','rollback only');
 saved:=public.platform_save_pricing(org,config,null);
 if (saved->>'base_rate')::numeric<>100 then raise exception 'pricing save failed'; end if;
 blocked:=false;
 begin perform public.platform_save_pricing(org,config,null); exception when serialization_failure then blocked:=true; end;
 if not blocked then raise exception 'stale pricing protection failed'; end if;
 blocked:=false;
 begin perform public.platform_save_pricing(org,jsonb_set(config,'{user_rate}','-1'),1); exception when check_violation then blocked:=true; end;
 if not blocked then raise exception 'negative pricing accepted'; end if;
 perform public.admin_set_member_access(org,member_id,'internal',jsonb_build_array(jsonb_build_object('role_code',(select role_code from public.role_assignments where organization_id=org and user_id=auth.uid() and revoked_at is null limit 1),'scope_kind','organization')),null,null);
 -- Platform member actions must affect only this tenant.
 perform public.platform_set_member_status(org,member_id,'suspended','Rollback suspension','active');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated','aal','aal2')::text,true);
 blocked:=false; begin perform public.current_access(org); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'suspended member retained access'; end if;
 perform set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
 perform public.platform_set_member_status(org,member_id,'active','Rollback restoration','suspended');
 if not exists(select 1 from jsonb_array_elements(public.platform_get_operations(org)->'members') m where m->>'user_id'=member_id::text and m->>'status'='active') then raise exception 'reactivation failed'; end if;
 perform public.platform_set_member_status(org,member_id,'removed','Rollback removal','active');
 if exists(select 1 from public.role_assignments where organization_id=org and user_id=member_id and revoked_at is null) then raise exception 'removed role grants retained'; end if;
 blocked:=false;
 begin perform public.platform_set_member_status(org,member_id,'active','Invalid restoration','removed'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'removed member restored without grants'; end if;
 blocked:=false;
 begin perform public.platform_set_member_status(org,auth.uid(),'removed','Last administrator test','active'); exception when check_violation then blocked:=true; end;
 if not blocked then raise exception 'last administrator removed'; end if;
 invite:=public.platform_prepare_member_invitation(org,'new-user@example.invalid',(select role_code from public.role_assignments where organization_id=org and user_id=auth.uid() and revoked_at is null limit 1),repeat('a',64),now()+interval '1 day');
 blocked:=false;
 begin perform public.platform_revoke_invitation(other_org,(invite->>'id')::uuid,'Wrong tenant cancellation'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'cross tenant invitation revoked'; end if;
 saved:=public.platform_get_organization(org); version:=(saved->'organization'->>'version')::bigint;
 saved:=public.platform_set_organization_status(org,'suspended','Rollback organization block',version);
 blocked:=false; begin perform public.current_access(org); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'blocked organization retained access'; end if;
 blocked:=false; begin perform public.platform_set_member_status(org,auth.uid(),'removed','Blocked organization lockout test','active'); exception when check_violation then blocked:=true; end;
 if not blocked then raise exception 'blocked organization lost final administrator'; end if;
 if exists(select 1 from jsonb_array_elements(public.platform_get_operations(org)->'invitations') i where i->>'id'=invite->>'id' and i->>'status'='pending') then raise exception 'blocking retained invitations'; end if;
 blocked:=false;
 begin perform public.platform_prepare_member_invitation(org,'blocked@example.invalid','org_admin',repeat('b',64),now()+interval '1 day'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'blocked org invitation accepted'; end if;
 perform public.platform_set_organization_status(org,'active','Rollback organization restoration',(saved->>'version')::bigint);
 perform public.current_access(org);
 saved:=public.platform_get_operations(org);
 if jsonb_array_length(saved->'members')<>2 or (saved->'usage'->>'users')::int<>1 then raise exception 'operations member and usage counts failed'; end if;
end; $$;
reset role;
update public.platform_administrators set active=false where user_id='a1000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare blocked boolean:=false; organization_id uuid:=current_setting('buildtrack.smoke.organization')::uuid;
begin
  begin perform public.platform_get_operations(organization_id); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'tenant read platform operations'; end if;
  blocked:=false;
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
declare blocked boolean:=false; organization_id uuid:=current_setting('buildtrack.smoke.organization')::uuid;
begin
  begin perform public.platform_get_operations(organization_id); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'tenant read platform operations'; end if;
  blocked:=false;
  begin perform public.platform_list_organizations(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'platform operation bypasses MFA'; end if;
end; $$;
reset role;
rollback;
select 'platform_operations_smoke_passed_and_rolled_back' as result;
