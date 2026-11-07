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

do $$ declare org uuid:='b2000000-0000-4000-8000-000000000001'; result jsonb; begin
 perform private._hierarchy_smoke_denied(format('select public.admin_set_catalog_status(%L,''home'',%L,false)',org,'b5000000-0000-4000-8000-000000000002'));
 perform private._hierarchy_smoke_denied(format('select public.admin_set_catalog_status(%L,''division'',%L,false)',org,'b3000000-0000-4000-8000-000000000002'));
 perform private._hierarchy_smoke_denied(format('select public.admin_set_catalog_status(%L,''neighborhood'',%L,false)',org,'b4000000-0000-4000-8000-000000000003'));
 result:=public.admin_set_catalog_status(org,'home','b5000000-0000-4000-8000-000000000001',false);
 perform private._hierarchy_smoke_assert(result->>'archived_at' is not null,'division administrator could not archive own home');
 result:=public.admin_set_catalog_status(org,'home','b5000000-0000-4000-8000-000000000001',true);
 perform private._hierarchy_smoke_denied(format('select public.admin_save_business_calendar(%L,null,''Forbidden'',''UTC'',array[1]::smallint[],''08:00''::time,''17:00''::time)',org));
 perform private._hierarchy_smoke_denied(format('select public.admin_save_escalation_route(%L,null,''Forbidden'',true,''[{"recipient_kind":"org_admin"}]''::jsonb)',org));
end; $$;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
do $$ declare result jsonb; begin
 perform private._hierarchy_smoke_denied('select public.admin_set_catalog_status(''b2000000-0000-4000-8000-000000000001'',''neighborhood'',''b4000000-0000-4000-8000-000000000002'',false)');
 result:=public.admin_set_catalog_status('b2000000-0000-4000-8000-000000000001','home','b5000000-0000-4000-8000-000000000001',false);
 result:=public.admin_set_catalog_status('b2000000-0000-4000-8000-000000000001','home','b5000000-0000-4000-8000-000000000001',true);
end; $$;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
do $$ declare org uuid:='b2000000-0000-4000-8000-000000000001'; calendar public.business_calendars; route jsonb; rule public.notification_rules; rejected boolean:=false; begin
 calendar:=public.admin_save_business_calendar(org,null,'Weekdays','America/New_York',array[1,2,3,4,5]::smallint[],'08:00','17:00','{}');
 calendar:=public.admin_save_business_calendar(org,calendar.id,'Updated weekdays','America/New_York',array[1,2,3,4]::smallint[],'09:00','17:00','{}');
 perform private._hierarchy_smoke_assert(calendar.name='Updated weekdays','calendar save failed');
 route:=public.admin_save_escalation_route(org,null,'Repair review',true,'[{"recipient_kind":"supervisor"},{"recipient_kind":"org_admin"}]');
 perform private._hierarchy_smoke_assert(route->>'id' is not null,'new escalation route did not return an ID');
 route:=public.admin_save_escalation_route(org,(route->>'id')::uuid,'Repair escalation',true,'[{"recipient_kind":"specific_user","recipient_user_id":"b1000000-0000-4000-8000-000000000002"}]');
 perform private._hierarchy_smoke_assert((select count(*)=1 from public.escalation_route_steps where route_id=(route->>'id')::uuid),'escalation steps were not replaced');
 begin
  perform public.admin_save_escalation_route(org,(route->>'id')::uuid,'Invalid recipient',true,'[{"recipient_kind":"specific_user","recipient_user_id":"b1000000-0000-4000-8000-000000000008"}]');
 exception when invalid_parameter_value then rejected:=true; end;
 perform private._hierarchy_smoke_assert(rejected,'nonmember escalation recipient was accepted');
 perform private._hierarchy_smoke_assert((select name='Repair escalation' from public.escalation_routes where id=(route->>'id')::uuid),'failed update left partial changes');
 rule:=public.admin_save_notification_rule(org,null,null,'attempt_unreviewed',60,120,3,'{}',(route->>'id')::uuid,true);
 rule:=public.admin_save_notification_rule(org,rule.id,'b4000000-0000-4000-8000-000000000001','work_due',30,null,1,'{"start":"20:00","end":"07:00"}',(route->>'id')::uuid,true);
 perform private._hierarchy_smoke_assert(rule.trigger='work_due' and rule.business_minutes=30,'notification rule save failed');
 perform set_config('buildtrack.security.rule',rule.id::text,true);
 perform set_config('buildtrack.security.route',route->>'id',true);
 rejected:=false;
 begin perform public.admin_save_business_calendar(org,gen_random_uuid(),'Missing','UTC',array[1]::smallint[],'08:00','17:00','{}');
 exception when sqlstate '02000' then rejected:=true; end;
 perform private._hierarchy_smoke_assert(rejected,'updating missing calendar silently succeeded');
 rejected:=false;
 begin perform public.admin_set_catalog_status(org,'escalation_route',(route->>'id')::uuid,false);
 exception when check_violation then rejected:=true; end;
 perform private._hierarchy_smoke_assert(rejected,'active notification dependencies were ignored');
 perform public.admin_set_catalog_status(org,'notification_rule',rule.id,false);
 perform public.admin_set_catalog_status(org,'escalation_route',(route->>'id')::uuid,false);
 perform private._hierarchy_smoke_assert((select count(*)>=7 from public.audit_events where organization_id=org),'settings writes lost audit records');
end; $$;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select private._hierarchy_smoke_denied(format('select public.admin_set_catalog_status(''b2000000-0000-4000-8000-000000000001'',''notification_rule'',%L,true)',current_setting('buildtrack.security.rule')));
reset role;
insert into public.inspection_engagements(id,organization_id,neighborhood_id,home_id,inspector_user_id,purpose,starts_at,ends_at) values
 ('b9000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Rollback engagement',now(),now()+interval '1 day'),
 ('b9000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000003','b5000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','Outside scope engagement',now(),now()+interval '1 day');
set local role authenticated;
do $$ declare result jsonb; begin
 perform private._hierarchy_smoke_denied('select public.admin_set_catalog_status(''b2000000-0000-4000-8000-000000000001'',''inspection_engagement'',''b9000000-0000-4000-8000-000000000002'',false)');
 result:=public.admin_set_catalog_status('b2000000-0000-4000-8000-000000000001','inspection_engagement','b9000000-0000-4000-8000-000000000001',false);
 perform private._hierarchy_smoke_assert(result->>'revoked_at' is not null,'authorized engagement revocation failed');
 result:=public.admin_set_catalog_status('b2000000-0000-4000-8000-000000000001','inspection_engagement','b9000000-0000-4000-8000-000000000001',true);
 perform private._hierarchy_smoke_assert(result->>'revoked_at' is null,'authorized engagement reactivation failed');
end; $$;
reset role;
select 'security_and_settings_passed_and_rolled_back' result;
rollback;
