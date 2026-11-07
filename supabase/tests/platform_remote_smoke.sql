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
select 'platform_authorization_smoke_passed_and_rolled_back' as result;
