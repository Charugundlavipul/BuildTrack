-- Optional fixture data for a disposable tenant. Role definitions come from migrations.

begin;

do $$
declare
  instance uuid := '00000000-0000-0000-0000-000000000000';
  user_row record;
  seed_password text := nullif(current_setting('buildtrack.dev_seed_password', true), '');
begin
  if seed_password is null or length(seed_password)<12 then raise check_violation using message='Set buildtrack.dev_seed_password to a private password of at least 12 characters before running disposable fixtures.'; end if;
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
    values (instance,user_row.id,'authenticated','authenticated',user_row.email,extensions.crypt(seed_password,extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('display_name',user_row.display_name),false,'','','','')
    on conflict (id) do nothing;
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    values (user_row.id,user_row.id,user_row.id::text,jsonb_build_object('sub',user_row.id::text,'email',user_row.email),'email',now(),now(),now())
    on conflict (id) do nothing;
    insert into public.profiles(id,display_name,first_name,last_name,completed_at,preferred_locale,timezone)
    values (user_row.id,user_row.display_name,split_part(user_row.display_name,' ',1),regexp_replace(user_row.display_name,'^[^ ]+ ',''),now(),'en','America/New_York') on conflict (id) do update set display_name = excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name,completed_at=coalesce(public.profiles.completed_at,excluded.completed_at);
  end loop;
end $$;

insert into public.organizations(id,name,timezone,status) values
  ('20000000-0000-0000-0000-000000000001','Pioneer Residential','America/New_York','active'),
  ('20000000-0000-0000-0000-000000000002','Harborline Builders','America/Chicago','active')
on conflict (id) do nothing;

-- Fixture tenants exercise every shared role, rather than only new-tenant defaults.
insert into public.organization_roles(organization_id,role_code,enabled)
  select o.id,r.code,true from public.organizations o cross join public.roles r
  where o.id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002') and r.organization_id is null and r.active and r.release_state='available'
  on conflict(organization_id,role_code) do update set enabled=true;

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

insert into public.companies(id,organization_id,name,status,categories) values
  ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ClearLine Plumbing','active',array['plumbing']),
  ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','FineFinish Drywall','active',array['drywall'])
on conflict do nothing;
insert into public.company_access_grants(organization_id,company_id,scope_kind,authority_level,granted_by)
  select organization_id,id,'organization',1,'10000000-0000-0000-0000-000000000001'::uuid from public.companies
  where id in ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002')
on conflict do nothing;
insert into public.company_memberships(organization_id,company_id,user_id,kind) values
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','manager'),
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','technician'),
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000009','manager'),
  ('20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000008','manager')
on conflict do nothing;
insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,home_id,company_id,granted_by) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','org_admin','organization',null,null,null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','superintendent','neighborhood','30000000-0000-0000-0000-000000000001',null,null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','superintendent','neighborhood','30000000-0000-0000-0000-000000000002',null,null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','inspector','neighborhood','30000000-0000-0000-0000-000000000001',null,null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','superintendent','neighborhood','30000000-0000-0000-0000-000000000001',null,null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','internal_contributor','home','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','inspector','home','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003',null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','vendor_admin','company',null,null,'50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','trade_technician','company',null,null,'50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','vendor_admin','company',null,null,'50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','superintendent','neighborhood','30000000-0000-0000-0000-000000000001',null,null,'10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','inspector','neighborhood','30000000-0000-0000-0000-000000000003',null,null,'10000000-0000-0000-0000-000000000003')
on conflict do nothing;


insert into public.neighborhood_trade_rosters(organization_id,neighborhood_id,company_id,status) values
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','active'),
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','active')
on conflict do nothing;

insert into public.checklist_templates(id,organization_id,name) values
  ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Pre-walkthrough quality checklist') on conflict do nothing;
insert into public.checklist_versions(id,organization_id,template_id,number,published_at,created_by) values
  ('61000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1,now(),'10000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into public.checklist_questions(id,organization_id,version_id,ordinal,section,label,requires_response) values
  ('62000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',1,'Exterior','Exterior is clear and finish-ready',true),
  ('62000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',2,'Kitchen','Cabinets and counters are complete',true),
  ('62000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',3,'Plumbing','Fixtures operate without leaks',true)
on conflict do nothing;

insert into public.inspection_engagements(organization_id,neighborhood_id,home_id,inspector_user_id,purpose,starts_at,ends_at) values
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000005','External pre-walkthrough quality review',now()-interval '1 day',now()+interval '7 days')
on conflict do nothing;

insert into public.work_items(id,organization_id,neighborhood_id,home_id,location_id,origin,title,description,priority,safety_flag,state,created_by,submitted_at,due_at) values
  ('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','internal_observation','Kitchen sink supply line leaking','Slow leak visible below the hot-water shutoff. Protect cabinet base and repair connection.','critical',true,'assigned','10000000-0000-0000-0000-000000000004',now()-interval '2 days',now()-interval '4 hours'),
  ('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','internal_observation','Cabinet door alignment','Upper cabinet pair is visibly misaligned at the reveal.','normal',false,'blocked','10000000-0000-0000-0000-000000000004',now()-interval '1 day',now()+interval '1 day'),
  ('70000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',null,'manual_report','Drywall touch-up at stair landing','Repair visible seam and prepare for final paint.','high',false,'ready_for_verification','10000000-0000-0000-0000-000000000002',now()-interval '3 days',now()-interval '1 day'),
  ('70000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003',null,'internal_observation','Remove protective film from appliance','Remove shipping protection before final walkthrough.','low',false,'submitted','10000000-0000-0000-0000-000000000002',now(),null)
on conflict do nothing;

insert into public.assignment_episodes(id,organization_id,work_item_id,company_id,technician_user_id,assigned_by,assigned_at,due_at,acknowledged_at,started_at) values
  ('71000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000002',now()-interval '2 days',now()-interval '4 hours',null,null),
  ('71000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000002',now()-interval '1 day',now()+interval '1 day',now()-interval '22 hours',now()-interval '20 hours'),
  ('71000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002',null,'10000000-0000-0000-0000-000000000002',now()-interval '3 days',now()-interval '1 day',now()-interval '3 days',now()-interval '3 days')
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

-- Fixtures are loaded by a privileged database session, without an end-user JWT.
-- Restrict the service-role claim to this transaction so comment triggers accept the historical authors.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.comments(organization_id,work_item_id,author_id,visibility,body) values
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','shared','Please protect the cabinet base before opening the fitting.'),
  ('20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','internal','Safety flag requires an on-site verification.')
on conflict do nothing;

commit;
