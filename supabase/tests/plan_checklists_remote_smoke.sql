-- Plan checklist integration smoke test. Uses materialized plan items after migration 064. Always rolls back.
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

insert into public.divisions(id,organization_id,name) values('c8000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Checklist test division');
update public.neighborhoods set division_id='c8000000-0000-4000-8000-000000000001' where organization_id='c2000000-0000-4000-8000-000000000001';
insert into public.master_plans(id,organization_id,division_id,name,spaces) values(
  'c9000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','Savoy checklist test',
  '[{"type":"kitchen","name":"Kitchen","level":1,"checklist_items":["Cabinet is sound","Check island clearance"]},{"type":"bedroom","name":"Bedroom 1","level":1,"checklist_items":["Cabinet is sound"]}]');
update public.homes set master_plan_id='c9000000-0000-4000-8000-000000000001' where organization_id='c2000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare org uuid:='c2000000-0000-4000-8000-000000000001'; result jsonb; retry jsonb; envelope jsonb; snapshot uuid; inspection uuid;
begin
  envelope:=jsonb_build_object('operation_id','ca000000-0000-4000-8000-000000000001','captured_at',now(),'payload',jsonb_build_object(
    'home_id','c4000000-0000-4000-8000-000000000001','type','internal_quality','lead_inspector_user_id','c1000000-0000-4000-8000-000000000001',
    'plan_checklist',true,'plan_version',1,'additional_items','[{"section":"Kitchen","label":"Verify repaired panel"}]'::jsonb));
  result:=public.execute_command('schedule_inspection',envelope);
  perform private._inspector_check((result->>'ok')::boolean,'plan inspection did not schedule: '||result::text);
  inspection:=(result->'data'->>'id')::uuid;
  select template_version_id into snapshot from public.inspections where id=inspection;
  perform private._inspector_check((select count(*)=4 from public.checklist_questions where version_id=snapshot),'expected repeated category items, plan addition, property addition');
  perform private._inspector_check((select count(distinct id)=2 from public.checklist_questions where version_id=snapshot and label='Cabinet is sound'),'shared categories must produce separate question IDs per space');
  retry:=public.execute_command('schedule_inspection',envelope);
  perform private._inspector_check(retry->'data'=result->'data','same operation must return the same inspection');
  envelope:=jsonb_set(envelope,'{operation_id}','"ca000000-0000-4000-8000-000000000002"');
  envelope:=jsonb_set(envelope,'{payload,home_id}','"c4000000-0000-4000-8000-000000000002"');
  envelope:=jsonb_set(envelope,'{payload,additional_items}','[]');
  result:=public.execute_command('schedule_inspection',envelope);
  perform private._inspector_check((result->>'ok')::boolean,'second property did not schedule');
  perform private._inspector_check(not exists(select 1 from public.checklist_questions q join public.inspections i on i.template_version_id=q.version_id where i.id=(result->'data'->>'id')::uuid and q.label='Verify repaired panel'),'property addition leaked to another home');
  envelope:=jsonb_set(envelope,'{operation_id}','"ca000000-0000-4000-8000-000000000003"');
  envelope:=jsonb_set(envelope,'{payload,lead_inspector_user_id}','"c1000000-0000-4000-8000-000000000002"');
  result:=public.execute_command('schedule_inspection',envelope);
  perform private._inspector_check(not (result->>'ok')::boolean,'contributor without Inspector role could be scheduled');
  perform private._inspector_check(not exists(select 1 from public.checklist_templates where id='ca000000-0000-4000-8000-000000000003'),'rejected schedule left an orphan snapshot');
end; $$;
reset role;
-- Later plan edits leave scheduled questions unchanged.
update public.master_plans set spaces='[{"type":"kitchen","name":"Kitchen","checklist_items":["Changed plan item"]}]',version=version+1 where id='c9000000-0000-4000-8000-000000000001';
select private._inspector_check(not exists(select 1 from public.checklist_questions q join public.checklist_templates t on t.snapshot_home_id is not null join public.checklist_versions v on v.template_id=t.id and v.id=q.version_id where q.label='Changed plan item'),'scheduled snapshot changed with plan');
rollback;
