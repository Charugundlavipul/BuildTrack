-- Run after migrations and the isolated fixture seed. Never run against production.
begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select extensions.throws_ok($$select public.platform_list_organizations()$$,'42501',null,'tenant administrator cannot enumerate platform organizations');
select extensions.throws_ok($$select public.save_role_definition(null,null,'Tenant escalation attempt','',array['organization']::public.scope_kind[],array['access.manage'],true,true,false,null)$$,'42501',null,'tenant administrator cannot create shared platform roles');
select extensions.throws_ok($$insert into public.platform_administrators(user_id) values('10000000-0000-0000-0000-000000000001')$$,'42501',null,'tenant cannot grant themselves platform access');
select extensions.lives_ok($$select public.save_role_definition('20000000-0000-0000-0000-000000000001',null,'Tenant A closeout role','Private to tenant A',array['home']::public.scope_kind[],array['work.read_scope'],true,false,false,null)$$,'organization administrator creates a private role');
select extensions.is((select count(*)::bigint from public.roles where label='Tenant A closeout role' and organization_id='20000000-0000-0000-0000-000000000001'),1::bigint,'private role is owned by its organization');

reset role;
insert into public.roles(code,label,allowed_scope_kinds,organization_id,default_for_new_organizations,immutable_seed)
  values('tenant_b_private_test','Tenant B private test','{home}','20000000-0000-0000-0000-000000000002',false,false);
set local role authenticated;
select extensions.is((select count(*)::bigint from public.roles where code='tenant_b_private_test'),0::bigint,'tenant A cannot read tenant B private definitions');
select extensions.throws_ok($$select public.set_organization_role('20000000-0000-0000-0000-000000000002','superintendent',true)$$,'42501',null,'tenant administrator cannot change another organization catalog');
select extensions.throws_ok($$select public.save_role_definition('20000000-0000-0000-0000-000000000001','org_admin','Shared overwrite attempt','',array['organization']::public.scope_kind[],array['access.manage'],true,false,false,1)$$,'42501',null,'tenant cannot overwrite a shared template');
select public.set_organization_role('20000000-0000-0000-0000-000000000001','superintendent',false);
reset role;
select extensions.ok(not private.has_permission('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','work.read_scope','30000000-0000-0000-0000-000000000001',null),'removed default role no longer supplies backend permissions');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select extensions.is(jsonb_array_length(public.current_access('20000000-0000-0000-0000-000000000001')->'permissions'),0,'current_access also excludes removed role permissions');
select extensions.is((select count(*)::bigint from public.work_items),0::bigint,'assignment ownership cannot bypass a removed execution role');

select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select public.set_organization_role('20000000-0000-0000-0000-000000000001','superintendent',true);
set constraints all immediate;
select extensions.throws_ok($$select public.set_organization_role('20000000-0000-0000-0000-000000000001','org_admin',false)$$,'23514',null,'removing the last access administrator is rejected');
set constraints all deferred;

reset role;
insert into public.platform_administrators(user_id) values('10000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
select extensions.lives_ok($$select public.platform_list_organizations()$$,'authorized platform operator can list organizations without MFA');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select extensions.lives_ok($$select public.platform_list_organizations()$$,'verified platform operator can list organizations');
select extensions.is((select count(*)::bigint from public.work_items where organization_id='20000000-0000-0000-0000-000000000002'),0::bigint,'platform administration does not impersonate tenant users');
select extensions.throws_ok($$select public.manage_role_catalog(null)$$,'42501',null,'platform operator cannot read a global role catalog without Org Admin access');
select extensions.throws_ok($$select public.manage_role_catalog('20000000-0000-0000-0000-000000000002')$$,'42501',null,'platform operator without Org Admin membership cannot read an organization role catalog');
select extensions.throws_ok($$select public.set_organization_role('20000000-0000-0000-0000-000000000002','superintendent',true)$$,'42501',null,'platform operator without Org Admin membership cannot modify an organization role catalog');
select extensions.throws_ok($$select public.set_organization_role('20000000-0000-0000-0000-000000000001','tenant_b_private_test',true)$$,'22023',null,'org admin cannot attach another tenant private role');

-- Repeated onboarding requests recover the same organization rather than duplicating it.
select public.platform_save_organization(null,'Platform test organization','America/New_York','active','verifier@buildtrack.test','org_admin','99000000-0000-0000-0000-000000000001',null);
select public.platform_save_organization(null,'Platform test organization','America/New_York','active','verifier@buildtrack.test','org_admin','99000000-0000-0000-0000-000000000001',null);
reset role;
select extensions.is((select count(*)::bigint from public.organization_onboarding where request_id='99000000-0000-0000-0000-000000000001'),1::bigint,'onboarding is idempotent');
select extensions.is((select count(*)::bigint from public.organization_memberships where organization_id=(select organization_id from public.organization_onboarding where request_id='99000000-0000-0000-0000-000000000001')),0::bigint,'creating an organization does not grant an unverified administrator membership');
select extensions.is((select count(*)::bigint from public.organization_roles where organization_id=(select organization_id from public.organization_onboarding where request_id='99000000-0000-0000-0000-000000000001') and role_code='auditor'),0::bigint,'optional roles outside new-organization defaults are not silently enabled');
select extensions.ok((select count(*)>0 from public.platform_audit_events where action='organization.created'),'platform organization changes are audited');

select * from extensions.finish();
rollback;
