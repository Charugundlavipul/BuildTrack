-- BuildTrack synthetic development fixtures. Never replace these with production data.

insert into public.permissions(code, description) values
  ('structure.manage','Manage divisions, neighborhoods, homes, locations, and milestones'),
  ('access.manage','Manage memberships, invitations, and scoped role grants'),
  ('roster.manage','Manage companies, specialties, and neighborhood rosters'),
  ('work.read_scope','Read authorized work within a granted scope'),
  ('work.create','Create field work and inspection findings'),
  ('work.triage','Classify, duplicate, and cancel work'),
  ('work.assign','Assign and reassign accountable parties and due dates'),
  ('work.execute_assigned','Act on work for which the user or company is accountable'),
  ('work.verify','Independently verify correction attempts'),
  ('inspection.manage','Schedule and administer inspections'),
  ('inspection.perform','Capture authorized inspection responses'),
  ('comment.internal','Read and create internal-only comments'),
  ('report.read_scope','Read scoped metrics and request exports'),
  ('audit.read_scope','Read scoped audit history'),
  ('config.manage','Manage calendars, notification rules, and checklist publication'),
  ('milestone.approve','Record operational milestone approval')
on conflict (code) do update set description = excluded.description;

insert into public.roles(code, label, allowed_scope_kinds, immutable_seed) values
  ('org_admin','Organization administrator','{organization}',true),
  ('area_manager','Area construction manager','{neighborhood,home}',true),
  ('superintendent','Superintendent','{neighborhood,home}',true),
  ('assistant_superintendent','Assistant superintendent','{neighborhood,home}',true),
  ('internal_quality','Internal quality inspector','{neighborhood,home}',true),
  ('external_inspector','External inspector','{neighborhood,home}',true),
  ('verifier','Independent verifier','{neighborhood,home}',true),
  ('trade_manager','Trade company manager','{neighborhood}',true),
  ('trade_technician','Trade technician','{neighborhood}',true),
  ('operations_coordinator','Operations coordinator','{neighborhood,home}',true),
  ('internal_contributor','Internal field contributor','{neighborhood,home}',true),
  ('leadership_viewer','Leadership viewer','{organization,neighborhood,home}',true),
  ('auditor','Auditor','{organization,neighborhood,home}',true)
on conflict (code) do update set label = excluded.label, allowed_scope_kinds = excluded.allowed_scope_kinds;

insert into public.role_permissions(role_code, permission_code) values
  ('org_admin','structure.manage'),('org_admin','access.manage'),('org_admin','roster.manage'),('org_admin','config.manage'),('org_admin','audit.read_scope'),
  ('area_manager','work.read_scope'),('area_manager','work.create'),('area_manager','work.triage'),('area_manager','work.assign'),('area_manager','work.verify'),('area_manager','inspection.manage'),('area_manager','comment.internal'),('area_manager','report.read_scope'),('area_manager','audit.read_scope'),('area_manager','milestone.approve'),
  ('superintendent','work.read_scope'),('superintendent','work.create'),('superintendent','work.triage'),('superintendent','work.assign'),('superintendent','work.execute_assigned'),('superintendent','work.verify'),('superintendent','inspection.manage'),('superintendent','comment.internal'),('superintendent','report.read_scope'),('superintendent','milestone.approve'),
  ('assistant_superintendent','work.read_scope'),('assistant_superintendent','work.create'),('assistant_superintendent','work.triage'),('assistant_superintendent','work.assign'),('assistant_superintendent','work.execute_assigned'),('assistant_superintendent','inspection.manage'),('assistant_superintendent','comment.internal'),
  ('internal_quality','work.read_scope'),('internal_quality','work.create'),('internal_quality','inspection.perform'),('internal_quality','comment.internal'),
  ('external_inspector','work.create'),('external_inspector','inspection.perform'),
  ('verifier','work.read_scope'),('verifier','work.verify'),
  ('trade_manager','work.execute_assigned'),
  ('trade_technician','work.execute_assigned'),
  ('operations_coordinator','work.read_scope'),('operations_coordinator','work.create'),('operations_coordinator','work.triage'),('operations_coordinator','work.assign'),('operations_coordinator','inspection.manage'),('operations_coordinator','comment.internal'),
  ('internal_contributor','work.read_scope'),('internal_contributor','work.create'),('internal_contributor','work.execute_assigned'),('internal_contributor','comment.internal'),
  ('leadership_viewer','work.read_scope'),('leadership_viewer','report.read_scope'),
  ('auditor','work.read_scope'),('auditor','report.read_scope'),('auditor','audit.read_scope')
on conflict do nothing;

do $$
declare
  instance uuid := '00000000-0000-0000-0000-000000000000';
  user_row record;
begin
  for user_row in select * from (values
    ('10000000-0000-0000-0000-000000000001'::uuid,'admin@buildtrack.local','Avery Admin'),
    ('10000000-0000-0000-0000-000000000002'::uuid,'superintendent@buildtrack.local','Sam Superintendent'),
    ('10000000-0000-0000-0000-000000000003'::uuid,'quality@buildtrack.local','Quinn Quality'),
    ('10000000-0000-0000-0000-000000000004'::uuid,'contributor@buildtrack.local','Casey Contributor'),
    ('10000000-0000-0000-0000-000000000005'::uuid,'inspector@buildtrack.local','Elliot Inspector'),
    ('10000000-0000-0000-0000-000000000006'::uuid,'manager@buildtrack.local','Morgan Trade Manager'),
    ('10000000-0000-0000-0000-000000000007'::uuid,'technician@buildtrack.local','Taylor Technician'),
    ('10000000-0000-0000-0000-000000000008'::uuid,'secondtrade@buildtrack.local','Riley Second Trade'),
    ('10000000-0000-0000-0000-000000000009'::uuid,'dualrole@buildtrack.local','Jordan Dual Role'),
    ('10000000-0000-0000-0000-000000000010'::uuid,'suspended@buildtrack.local','Sydney Suspended'),
    ('10000000-0000-0000-0000-000000000011'::uuid,'outsider@buildtrack.local','Unaffiliated User')
  ) as users(id,email,display_name)
  loop
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,confirmation_token,email_change,email_change_token_new,recovery_token)
    values (instance,user_row.id,'authenticated','authenticated',user_row.email,extensions.crypt('BuildTrack-Dev-2026!',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('display_name',user_row.display_name),false,'','','','')
    on conflict (id) do nothing;
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    values (user_row.id,user_row.id,user_row.id::text,jsonb_build_object('sub',user_row.id::text,'email',user_row.email),'email',now(),now(),now())
    on conflict (id) do nothing;
    insert into public.profiles(id,display_name,preferred_locale,timezone)
    values (user_row.id,user_row.display_name,'en','America/New_York') on conflict (id) do update set display_name = excluded.display_name;
  end loop;
end $$;

insert into public.organizations(id,name,timezone,status) values
  ('20000000-0000-0000-0000-000000000001','Pioneer Residential','America/New_York','active'),
  ('20000000-0000-0000-0000-000000000002','Harborline Builders','America/Chicago','active')
on conflict (id) do nothing;

insert into public.business_calendars(id,organization_id,name,timezone,holiday_dates) values
  ('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Pioneer business calendar','America/New_York','{2026-11-26,2026-12-25}'),
  ('21000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Harborline business calendar','America/Chicago','{2026-11-26,2026-12-25}')
on conflict (id) do nothing;
update public.organizations set default_calendar_id = '21000000-0000-0000-0000-000000000001' where id = '20000000-0000-0000-0000-000000000001';
update public.organizations set default_calendar_id = '21000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000002';

insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','internal','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','internal','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','internal','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','internal','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','external','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','external','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','external','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000008','external','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','external','active',now()),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000010','external','suspended',now()),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','internal','active',now())
on conflict (organization_id,user_id) do nothing;

insert into public.divisions(id,organization_id,name) values
  ('22000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Atlantic Division') on conflict do nothing;
insert into public.neighborhoods(id,organization_id,division_id,code,name,timezone,status,calendar_id,supervisor_user_id) values
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','OR','Oak Ridge','America/New_York','active','21000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','PV','Pine Valley','America/New_York','active','21000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002',null,'HC','Harbor Creek','America/Chicago','active','21000000-0000-0000-0000-000000000002',null)
on conflict do nothing;

insert into public.homes(id,organization_id,neighborhood_id,lot_code,address_line1,city,state_code,postal_code,phase,primary_supervisor_user_id) values
  ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','A-101','101 Alder Way','Raleigh','NC','27601','pre_walkthrough','10000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','A-102','103 Alder Way','Raleigh','NC','27601','under_construction','10000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','P-201','8 Pine Hollow','Raleigh','NC','27603','closing_preparation','10000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','B-001','1 Harbor Lane','Charleston','SC','29401','under_construction',null)
on conflict do nothing;

insert into public.home_locations(id,organization_id,neighborhood_id,home_id,name) values
  ('41000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Kitchen'),
  ('41000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Primary bathroom')
on conflict do nothing;

insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,home_id,granted_by) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','org_admin','organization',null,null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','superintendent','neighborhood','30000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','superintendent','neighborhood','30000000-0000-0000-0000-000000000002',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','internal_quality','neighborhood','30000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','verifier','neighborhood','30000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','internal_contributor','home','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','external_inspector','home','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','trade_manager','neighborhood','30000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','trade_technician','neighborhood','30000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','trade_manager','neighborhood','30000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','verifier','neighborhood','30000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','internal_quality','neighborhood','30000000-0000-0000-0000-000000000003',null,'10000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.companies(id,organization_id,name,status) values
  ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ClearLine Plumbing','active'),
  ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','FineFinish Drywall','active')
on conflict do nothing;
insert into public.company_memberships(organization_id,company_id,user_id,kind) values
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','manager'),
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','technician'),
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000009','manager'),
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000008','manager')
on conflict do nothing;
insert into public.trade_specialties(id,organization_id,code,name) values
  ('51000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','PLUMB','Plumbing'),
  ('51000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','DRYWALL','Drywall')
on conflict do nothing;
insert into public.neighborhood_trade_rosters(organization_id,neighborhood_id,company_id,specialty_id,status) values
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','active'),
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000002','active')
on conflict do nothing;

insert into public.work_categories(id,organization_id,code,name) values
  ('52000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','FINISH','Finish quality'),
  ('52000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','PLUMB','Plumbing'),
  ('52000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','SAFETY','Safety')
on conflict do nothing;

insert into public.checklist_templates(id,organization_id,name) values
  ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Pre-walkthrough quality checklist') on conflict do nothing;
insert into public.checklist_versions(id,organization_id,template_id,number,published_at,created_by) values
  ('61000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1,now(),'10000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into public.checklist_questions(id,organization_id,version_id,ordinal,section,label,category_id,requires_response) values
  ('62000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',1,'Exterior','Exterior is clear and finish-ready','52000000-0000-0000-0000-000000000001',true),
  ('62000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',2,'Kitchen','Cabinets and counters are complete','52000000-0000-0000-0000-000000000001',true),
  ('62000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',3,'Plumbing','Fixtures operate without leaks','52000000-0000-0000-0000-000000000002',true)
on conflict do nothing;

insert into public.inspection_engagements(organization_id,neighborhood_id,home_id,inspector_user_id,purpose,starts_at,ends_at) values
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000005','External pre-walkthrough quality review',now()-interval '1 day',now()+interval '7 days')
on conflict do nothing;

insert into public.work_items(id,organization_id,neighborhood_id,home_id,location_id,origin,title,description,category_id,priority,safety_flag,state,created_by,submitted_at,due_at) values
  ('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','internal_observation','Kitchen sink supply line leaking','Slow leak visible below the hot-water shutoff. Protect cabinet base and repair connection.','52000000-0000-0000-0000-000000000002','critical',true,'assigned','10000000-0000-0000-0000-000000000004',now()-interval '2 days',now()-interval '4 hours'),
  ('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','internal_observation','Cabinet door alignment','Upper cabinet pair is visibly misaligned at the reveal.','52000000-0000-0000-0000-000000000001','normal',false,'blocked','10000000-0000-0000-0000-000000000004',now()-interval '1 day',now()+interval '1 day'),
  ('70000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',null,'manual_report','Drywall touch-up at stair landing','Repair visible seam and prepare for final paint.','52000000-0000-0000-0000-000000000001','high',false,'ready_for_verification','10000000-0000-0000-0000-000000000002',now()-interval '3 days',now()-interval '1 day'),
  ('70000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003',null,'internal_observation','Remove protective film from appliance','Remove shipping protection before final walkthrough.','52000000-0000-0000-0000-000000000001','low',false,'submitted','10000000-0000-0000-0000-000000000002',now(),null)
on conflict do nothing;

insert into public.assignment_episodes(id,organization_id,work_item_id,company_id,technician_user_id,specialty_id,assigned_by,assigned_at,due_at,acknowledged_at,started_at) values
  ('71000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','51000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',now()-interval '2 days',now()-interval '4 hours',null,null),
  ('71000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','51000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',now()-interval '1 day',now()+interval '1 day',now()-interval '22 hours',now()-interval '20 hours'),
  ('71000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002',null,'51000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',now()-interval '3 days',now()-interval '1 day',now()-interval '3 days',now()-interval '3 days')
on conflict do nothing;
update public.work_items set current_assignment_id='71000000-0000-0000-0000-000000000001' where id='70000000-0000-0000-0000-000000000001';
update public.work_items set current_assignment_id='71000000-0000-0000-0000-000000000002',blocked_from_state='in_progress',blocked_reason='Replacement hinge is delayed' where id='70000000-0000-0000-0000-000000000002';
update public.work_items set current_assignment_id='71000000-0000-0000-0000-000000000003' where id='70000000-0000-0000-0000-000000000003';
insert into public.blocker_events(organization_id,work_item_id,assignment_episode_id,cause,notes,opened_by) values
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','material','Replacement hinge is delayed','10000000-0000-0000-0000-000000000007') on conflict do nothing;
insert into public.correction_attempts(id,organization_id,work_item_id,assignment_episode_id,attempt_number,submitted_by,submitted_at,completion_note,accountable_company_id) values
  ('72000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003',1,'10000000-0000-0000-0000-000000000008',now()-interval '3 hours','Seam repaired, sanded, and ready for paint','50000000-0000-0000-0000-000000000002') on conflict do nothing;

insert into public.work_events(organization_id,work_item_id,assignment_episode_id,event_type,from_state,to_state,actor_id,server_at,operation_id,details) values
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','work.assigned','submitted','assigned','10000000-0000-0000-0000-000000000002',now()-interval '2 days','73000000-0000-0000-0000-000000000001','{}'),
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','work.blocked','in_progress','blocked','10000000-0000-0000-0000-000000000007',now()-interval '18 hours','73000000-0000-0000-0000-000000000002','{"cause":"material"}'),
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','correction.submitted','in_progress','ready_for_verification','10000000-0000-0000-0000-000000000008',now()-interval '3 hours','73000000-0000-0000-0000-000000000003','{"attempt_number":1}')
on conflict do nothing;

insert into public.comments(organization_id,work_item_id,author_id,visibility,body) values
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','shared','Please protect the cabinet base before opening the fitting.'),
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','internal','Safety flag requires an on-site verification.')
on conflict do nothing;

-- Local accounts all use: BuildTrack-Dev-2026!
