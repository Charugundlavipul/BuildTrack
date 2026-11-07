-- Rollback-only: no emails, external calls, or committed fixture data.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
grant usage on schema private to authenticated;
create function private._hierarchy_smoke_assert(p_condition boolean,p_message text) returns void language plpgsql as $$
begin if not coalesce(p_condition,false) then raise exception 'hierarchy check failed: %',p_message; end if; end; $$;
create function private._hierarchy_smoke_denied(p_statement text) returns void language plpgsql as $$
begin
  begin execute p_statement; exception when insufficient_privilege then return; end;
  raise exception 'expected forbidden operation: %',p_statement;
end; $$;
grant execute on function private._hierarchy_smoke_assert(boolean,text),private._hierarchy_smoke_denied(text) to authenticated;

insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
  select ('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'hierarchy-rollback-'||i||'@example.invalid',now(),now(),now(),'{}','{}' from generate_series(1,9) i;
insert into public.profiles(id,display_name,first_name,last_name,completed_at)
  select ('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Hierarchy test '||i,'Hierarchy','Test',now() from generate_series(1,9) i
  on conflict(id) do update set first_name='Hierarchy',last_name='Test',completed_at=now();
insert into public.organizations(id,name,timezone) values('b2000000-0000-4000-8000-000000000001','Rollback hierarchy tenant','America/New_York');
insert into public.organization_roles(organization_id,role_code,enabled) values('b2000000-0000-4000-8000-000000000001','internal_contributor',true) on conflict do nothing;
insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
  select 'b2000000-0000-4000-8000-000000000001',('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,case when i in (4,5,8) then 'external'::public.affiliation_kind else 'internal'::public.affiliation_kind end,'active',now()
  from generate_series(1,9) i where i<>8;
insert into public.divisions(id,organization_id,name) values
  ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Division A'),
  ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','Division B');
insert into public.neighborhoods(id,organization_id,division_id,code,name) values
  ('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','A1','Neighborhood A1'),
  ('b4000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','A2','Neighborhood A2'),
  ('b4000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','B1','Neighborhood B1');
insert into public.homes(id,organization_id,neighborhood_id,lot_code) values
  ('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','1'),
  ('b5000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000003','2');
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,division_id,neighborhood_id,granted_by,authority_level) values
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','org_admin','organization',null,null,'b1000000-0000-4000-8000-000000000001',1),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','division_admin','division','b3000000-0000-4000-8000-000000000001',null,'b1000000-0000-4000-8000-000000000001',1),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','neighborhood_admin','neighborhood',null,'b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',2),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000006','division_admin','division','b3000000-0000-4000-8000-000000000002',null,'b1000000-0000-4000-8000-000000000001',1),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000007','internal_contributor','neighborhood',null,'b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003',3),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000007','internal_contributor','neighborhood',null,'b4000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001',1),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000009','division_admin','division','b3000000-0000-4000-8000-000000000001',null,'b1000000-0000-4000-8000-000000000001',1),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000009','division_admin','division','b3000000-0000-4000-8000-000000000002',null,'b1000000-0000-4000-8000-000000000001',1);
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='b2000000-0000-4000-8000-000000000001'; n public.neighborhoods;
begin
  perform private._hierarchy_smoke_assert((select count(*)=1 from public.divisions where organization_id=org),'division directory leaked a sibling');
  perform private._hierarchy_smoke_assert(private.has_permission(org,auth.uid(),'work.assign','b4000000-0000-4000-8000-000000000002',null),'division operations not inherited');
  n:=public.admin_save_neighborhood(org,null,'b3000000-0000-4000-8000-000000000001','NEW','New neighborhood');
  perform private._hierarchy_smoke_denied(format('select public.admin_save_neighborhood(%L,null,%L,''BAD'',''Outside division'')',org,'b3000000-0000-4000-8000-000000000002'));
  perform private._hierarchy_smoke_denied(format('select public.admin_save_home(%L,%L,%L,''moved'')',org,'b5000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000001'));
  perform private._hierarchy_smoke_denied(format('select public.admin_create_invitation(%L,''bad@example.invalid'',''internal'',%L::jsonb,null,null,repeat(''a'',64),now()+interval ''1 day'')',org,'[{"role_code":"org_admin","scope_kind":"organization"}]'));
  perform private._hierarchy_smoke_denied(format('select public.admin_create_invitation(%L,''bad@example.invalid'',''internal'',%L::jsonb,null,null,repeat(''a'',64),now()+interval ''1 day'')',org,'[{"role_code":"neighborhood_admin","scope_kind":"neighborhood","neighborhood_id":"b4000000-0000-4000-8000-000000000003"}]'));
  perform private._hierarchy_smoke_assert(not exists(select 1 from jsonb_array_elements(public.admin_list_members(org)) m where m->>'user_id'='b1000000-0000-4000-8000-000000000006'),'member directory leaked another division');
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='b2000000-0000-4000-8000-000000000001'; vendor public.companies;
begin
  perform public.admin_save_home(org,null,'b4000000-0000-4000-8000-000000000001','3');
  perform private._hierarchy_smoke_denied(format('select public.admin_save_neighborhood(%L,null,%L,''BAD2'',''Not allowed'')',org,'b3000000-0000-4000-8000-000000000001'));
  vendor:=public.admin_onboard_vendor(org,'Rollback local vendor',null,'neighborhood',null,'b4000000-0000-4000-8000-000000000001');
  perform set_config('buildtrack.hierarchy.vendor',vendor.id::text,true);
  perform private._hierarchy_smoke_assert(vendor.owner_authority_level=3,'local vendor ownership level incorrect');
  perform public.admin_create_invitation(org,'hierarchy-rollback-4@example.invalid','external',jsonb_build_array(jsonb_build_object('role_code','vendor_admin','scope_kind','company','company_id',vendor.id)),vendor.id,'manager',encode(extensions.digest('hierarchy-vendor-token','sha256'),'hex'),now()+interval '1 day');
  perform private._hierarchy_smoke_assert(private.controls_company(org,auth.uid(),vendor.id),'local owner cannot manage newly onboarded company');
  perform public.admin_set_member_access(org,'b1000000-0000-4000-8000-000000000007','internal',jsonb_build_array(jsonb_build_object('role_code','internal_contributor','scope_kind','neighborhood','neighborhood_id','b4000000-0000-4000-8000-000000000001')),null,null);
end; $$;
reset role;
select private._hierarchy_smoke_assert(exists(select 1 from public.role_assignments where user_id='b1000000-0000-4000-8000-000000000007' and neighborhood_id='b4000000-0000-4000-8000-000000000003' and revoked_at is null),'editing local access removed protected sibling access');
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.accept_invitation('hierarchy-vendor-token');
do $$
declare org uuid:='b2000000-0000-4000-8000-000000000001'; company uuid:=current_setting('buildtrack.hierarchy.vendor')::uuid;
begin
  perform private._hierarchy_smoke_assert(private.vendor_admin(org,auth.uid(),company),'vendor administrator invitation did not establish company authority');
  perform public.admin_create_invitation(org,'hierarchy-rollback-8@example.invalid','external',jsonb_build_array(jsonb_build_object('role_code','trade_technician','scope_kind','company','company_id',company)),company,'technician',encode(extensions.digest('hierarchy-technician-token','sha256'),'hex'),now()+interval '1 day');
  perform private._hierarchy_smoke_denied(format('select public.admin_set_vendor_coverage(%L,%L,''division'',%L)',org,company,'b3000000-0000-4000-8000-000000000002'));
  perform private._hierarchy_smoke_denied(format('select public.admin_create_invitation(%L,''bad@example.invalid'',''internal'',%L::jsonb,null,null,repeat(''b'',64),now()+interval ''1 day'')',org,'[{"role_code":"neighborhood_admin","scope_kind":"neighborhood","neighborhood_id":"b4000000-0000-4000-8000-000000000001"}]'));
  perform private._hierarchy_smoke_denied(format('select public.admin_suspend_member(%L,%L,''cannot remove builder granted admin'')',org,auth.uid()));
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.accept_invitation('hierarchy-technician-token');
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.admin_suspend_member('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000008','Remove own technician');
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.admin_set_vendor_coverage('b2000000-0000-4000-8000-000000000001',current_setting('buildtrack.hierarchy.vendor')::uuid,'division','b3000000-0000-4000-8000-000000000001');
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='b2000000-0000-4000-8000-000000000001'; company uuid:=current_setting('buildtrack.hierarchy.vendor')::uuid; g uuid;
begin
  perform private._hierarchy_smoke_assert(not private.controls_company(org,auth.uid(),company),'local admin controls a vendor after parent promotion');
  perform private._hierarchy_smoke_denied(format('select public.admin_set_catalog_status(%L,''company'',%L,false)',org,company));
  select id into g from public.company_access_grants where company_id=company and scope_kind='division' and revoked_at is null;
  perform private._hierarchy_smoke_denied(format('select public.admin_set_vendor_coverage(%L,%L,''division'',null,null,%L,false)',org,company,g));
  perform public.admin_suspend_member(org,'b1000000-0000-4000-8000-000000000007','Remove local field access');
end; $$;
reset role;
do $$
begin
  perform private._hierarchy_smoke_assert((select status='active' from public.organization_memberships where organization_id='b2000000-0000-4000-8000-000000000001' and user_id='b1000000-0000-4000-8000-000000000007'),'local removal suspended the whole member');
  perform private._hierarchy_smoke_assert(exists(select 1 from public.role_assignments where user_id='b1000000-0000-4000-8000-000000000007' and neighborhood_id='b4000000-0000-4000-8000-000000000003' and revoked_at is null),'local removal deleted another division grant');
end; $$;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000009","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.admin_set_vendor_coverage('b2000000-0000-4000-8000-000000000001',current_setting('buildtrack.hierarchy.vendor')::uuid,'division','b3000000-0000-4000-8000-000000000002');
reset role;
-- A company relationship alone must not borrow another company's scoped role.
do $$
declare company uuid; item uuid; episode uuid; org uuid:='b2000000-0000-4000-8000-000000000001';
begin
  insert into public.companies(organization_id,name) values(org,'Rollback unrelated vendor') returning id into company;
  insert into public.company_memberships(organization_id,company_id,user_id,kind) values(org,company,'b1000000-0000-4000-8000-000000000004','manager');
  insert into public.work_items(organization_id,neighborhood_id,home_id,origin,title,description,created_by,state)
    values(org,'b4000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','internal_observation','Other vendor work','Must remain inaccessible','b1000000-0000-4000-8000-000000000001','assigned') returning id into item;
  insert into public.assignment_episodes(organization_id,work_item_id,company_id,assigned_by,due_at)
    values(org,item,company,'b1000000-0000-4000-8000-000000000001',now()+interval '1 day') returning id into episode;
  update public.work_items set current_assignment_id=episode where id=item;
  perform private._hierarchy_smoke_assert(not private.can_read_work('b1000000-0000-4000-8000-000000000004',item),'vendor role leaked another company work');
  perform private._hierarchy_smoke_assert(not private.can_execute_work('b1000000-0000-4000-8000-000000000004',item),'vendor role allowed another company work');
end; $$;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.admin_create_invitation('b2000000-0000-4000-8000-000000000001','hierarchy-rollback-5@example.invalid','external',
  jsonb_build_array(jsonb_build_object('role_code','trade_technician','scope_kind','company','company_id',current_setting('buildtrack.hierarchy.vendor')::uuid)),
  current_setting('buildtrack.hierarchy.vendor')::uuid,'technician',encode(extensions.digest('hierarchy-stale-token','sha256'),'hex'),now()+interval '1 day');
reset role;
update public.role_assignments set revoked_at=now() where user_id='b1000000-0000-4000-8000-000000000004' and role_code='vendor_admin';
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select private._hierarchy_smoke_denied('select public.accept_invitation(''hierarchy-stale-token'')');
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='b2000000-0000-4000-8000-000000000001'; company uuid:=current_setting('buildtrack.hierarchy.vendor')::uuid; g uuid;
begin
  perform private._hierarchy_smoke_assert(not exists(select 1 from public.permissions p where not private.has_permission(org,auth.uid(),p.code,'b4000000-0000-4000-8000-000000000003','b5000000-0000-4000-8000-000000000002')),'organization administrator is missing permissions');
  select id into g from public.company_access_grants where company_id=company and scope_kind='neighborhood' and revoked_at is null;
  perform public.admin_set_vendor_coverage(org,company,'neighborhood',null,null,g,false);
  perform public.admin_set_catalog_status(org,'company',company,false);
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$
declare org uuid:='b2000000-0000-4000-8000-000000000001'; company uuid:=current_setting('buildtrack.hierarchy.vendor')::uuid;
begin
  perform private._hierarchy_smoke_denied(format('select public.admin_set_catalog_status(%L,''company'',%L,true)',org,company));
end; $$;
reset role;
set constraints all immediate;
select 'hierarchical_access_checks_passed_and_rolled_back' as result;
rollback;
