begin;

insert into public.permissions(code,description) values('plan.manage','Create and maintain divisional floor plans');
insert into public.role_permissions(role_code,permission_code) values('org_admin','plan.manage'),('division_admin','plan.manage');

create table public.space_types(code text primary key,label text not null unique,active boolean not null default true);
insert into public.space_types(code,label) values('bedroom','Bedroom'),('bathroom','Bathroom'),('kitchen','Kitchen'),('garage','Garage'),('exterior','Exterior'),('living','Living area'),('dining','Dining area'),('laundry','Laundry'),('patio','Patio'),('other','Other');
create table public.master_plans(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),division_id uuid not null,
  name text not null check(length(trim(name)) between 2 and 120),spaces jsonb not null check(jsonb_typeof(spaces)='array' and jsonb_array_length(spaces) between 1 and 200),
  active boolean not null default true,version bigint not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(organization_id,id),foreign key(organization_id,division_id) references public.divisions(organization_id,id));
alter table public.homes add column master_plan_id uuid,add column master_plan_version bigint,add column master_plan_name text,
  add foreign key(organization_id,master_plan_id) references public.master_plans(organization_id,id);
alter table public.home_locations add column space_type_code text references public.space_types(code),add column source_plan_id uuid,
  add foreign key(organization_id,source_plan_id) references public.master_plans(organization_id,id);
alter table public.companies add column contact_email text,add column phone_number text,add column physical_address text,
  add column categories text[] not null default '{}';
create table public.company_private_details(organization_id uuid not null,company_id uuid primary key,ein text,
  foreign key(organization_id,company_id) references public.companies(organization_id,id));
alter table public.inspections alter column lead_inspector_user_id drop not null;
alter table public.inspections add column company_id uuid,add column reviewed_at timestamptz,add column reviewed_by uuid references auth.users(id),
  add column escalated_at timestamptz,add column escalation_reason text,add column escalation_resolved_at timestamptz,
  add foreign key(organization_id,company_id) references public.companies(organization_id,id),
  add check(lead_inspector_user_id is not null or company_id is not null);
alter table public.work_items add column reinspection_status text check(reinspection_status in ('pending','completed')),add column reinspection_assignee_user_id uuid references auth.users(id),add column reinspection_assigned_by uuid references auth.users(id),
  add column reinspection_assigned_at timestamptz,add column reinspection_completed_at timestamptz,
  add check(reinspection_status is distinct from 'pending' or reinspection_assignee_user_id is not null);
create index work_reinspection_inbox on public.work_items(organization_id,reinspection_assignee_user_id,home_id) where reinspection_status='pending';
create index inspection_company_inbox on public.inspections(organization_id,company_id,status) where company_id is not null;

create function private.quality_assignment_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; title text; body text; link text;
begin
  if tg_table_name='inspections' then
    link:='/org/'||new.organization_id||'/inspections/'||new.id;
    if (tg_op='INSERT' and new.company_id is not null and new.lead_inspector_user_id is null) then
      insert into public.notifications(organization_id,recipient_user_id,title,body,deep_link)
        select distinct new.organization_id,cm.user_id,'Inspection awaiting allocation','Select an eligible Inspector from your company.',link from public.company_memberships cm
        where cm.organization_id=new.organization_id and cm.company_id=new.company_id and private.company_inspection_manager(new.organization_id,cm.user_id,new.company_id,new.neighborhood_id);
    end if;
    if new.lead_inspector_user_id is not null and (tg_op='INSERT' or old.lead_inspector_user_id is distinct from new.lead_inspector_user_id) then
      insert into public.notifications(organization_id,recipient_user_id,title,body,deep_link) values(new.organization_id,new.lead_inspector_user_id,'Inspection assigned','Open the home layout, complete the inspection, and submit your report.',link);
    end if;
    if tg_op='UPDATE' and (old.status is distinct from new.status and new.status='submitted' or new.escalated_at is distinct from old.escalated_at and new.escalated_at is not null) then
      title:=case when new.escalated_at is distinct from old.escalated_at then 'Area manager review requested' else 'Inspection report submitted' end;
      body:=case when new.escalated_at is distinct from old.escalated_at then new.escalation_reason else 'Review the observations and assign or disregard each item.' end;
      for recipient in select m.user_id from public.organization_memberships m where m.organization_id=new.organization_id and private.has_permission(new.organization_id,m.user_id,'inspection.manage',new.neighborhood_id,new.home_id)
        and (new.escalated_at is not distinct from old.escalated_at or exists(select 1 from public.neighborhoods n where n.id=new.neighborhood_id and private.admin_level(new.organization_id,m.user_id,'neighborhood',n.division_id,n.id,null)<=3)) loop
        insert into public.notifications(organization_id,recipient_user_id,title,body,deep_link) values(new.organization_id,recipient,title,body,link);
      end loop;
    end if;
  elsif new.reinspection_status='pending' and (old.reinspection_status is distinct from new.reinspection_status or old.reinspection_assignee_user_id is distinct from new.reinspection_assignee_user_id or old.reinspection_assigned_at is distinct from new.reinspection_assigned_at) then
    insert into public.notifications(organization_id,recipient_user_id,work_item_id,title,body,deep_link) values(new.organization_id,new.reinspection_assignee_user_id,new.id,'Repair ready for reinspection',new.title,'/org/'||new.organization_id||'/work/'||new.id);
  end if;
  return new;
end; $$;
create trigger quality_inspection_notifications after insert or update on public.inspections for each row execute function private.quality_assignment_notifications();
create trigger quality_reinspection_notifications after update on public.work_items for each row execute function private.quality_assignment_notifications();

alter table public.space_types enable row level security;
alter table public.master_plans enable row level security;
alter table public.company_private_details enable row level security;
grant select on public.space_types,public.master_plans,public.company_private_details to authenticated;
create policy space_types_read on public.space_types for select to authenticated using(true);
create policy plans_read on public.master_plans for select to authenticated using(private.active_member(organization_id,auth.uid()) and
  (private.admin_level(organization_id,auth.uid(),'division',division_id,null,null)<=3 or exists(select 1 from public.neighborhoods n where n.organization_id=master_plans.organization_id and n.division_id=master_plans.division_id and private.has_permission(n.organization_id,auth.uid(),'structure.manage',n.id,null))));
create policy company_private_read on public.company_private_details for select to authenticated using(private.controls_company(organization_id,auth.uid(),company_id) or
  private.active_member(organization_id,auth.uid()) and private.active_company_membership(organization_id,company_id,auth.uid(),'manager'));

create function public.save_master_plan(p_org uuid,p_id uuid,p_division uuid,p_name text,p_spaces jsonb,p_active boolean,p_version bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.master_plans; previous public.master_plans;
begin
  if not private.active_member(p_org,auth.uid()) or not private.require_aal2() or not private.has_permission(p_org,auth.uid(),'plan.manage',null,null) and not exists(
    select 1 from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='plan.manage'
    where a.organization_id=p_org and a.user_id=auth.uid() and private.role_grant_enabled(a) and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
      and (a.scope_kind='organization' or a.scope_kind='division' and a.division_id=p_division)) then raise insufficient_privilege using message='Plan management in this division requires a verified administrator.'; end if;
  if jsonb_typeof(p_spaces)<>'array' or jsonb_array_length(p_spaces) not between 1 and 200 or exists(select 1 from jsonb_array_elements(p_spaces) s where nullif(trim(s->>'name'),'') is null or length(s->>'name')>120 or not exists(select 1 from public.space_types t where t.code=s->>'type' and t.active))
    or (select count(*) from jsonb_array_elements(p_spaces))<>(select count(distinct lower(trim(s->>'name'))) from jsonb_array_elements(p_spaces) s) then raise check_violation using message='Choose a space type and a unique name for every space (1–200).'; end if;
  if p_id is not null then
    select * into previous from public.master_plans where organization_id=p_org and id=p_id for update;
    if not found or previous.division_id<>p_division then raise insufficient_privilege using message='Plan is unavailable in this division.'; end if;
    if p_version is null or previous.version<>p_version then raise serialization_failure using message='This plan changed. Refresh before saving.'; end if;
    update public.master_plans set name=trim(p_name),spaces=p_spaces,active=p_active,version=version+1,updated_at=now() where id=p_id returning * into r;
  else insert into public.master_plans(organization_id,division_id,name,spaces,active) values(p_org,p_division,trim(p_name),p_spaces,p_active) returning * into r; end if;
  perform private.append_audit(p_org,auth.uid(),'plan.saved','master_plan',r.id,null,to_jsonb(previous),to_jsonb(r));
  return to_jsonb(r);
end; $$;

create function public.apply_home_plan(p_org uuid,p_home uuid,p_plan uuid,p_home_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.homes; plan public.master_plans; space jsonb;
begin
  select * into h from public.homes where organization_id=p_org and id=p_home for update;
  if not found or not private.require_aal2() or not private.has_permission(p_org,auth.uid(),'structure.manage',h.neighborhood_id,h.id) then raise insufficient_privilege using message='Home management permission is required.'; end if;
  if h.version<>p_home_version then raise serialization_failure using message='Home changed. Refresh before applying a plan.'; end if;
  select p.* into plan from public.master_plans p join public.neighborhoods n on n.organization_id=p.organization_id and n.division_id=p.division_id where p.organization_id=p_org and p.id=p_plan and p.active and n.id=h.neighborhood_id;
  if not found then raise check_violation using message='Choose an active plan from this home’s division.'; end if;
  if exists(select 1 from public.home_locations where organization_id=p_org and home_id=p_home) then raise check_violation using message='Apply a plan before adding rooms. Existing rooms are preserved; customize them individually.'; end if;
  for space in select value from jsonb_array_elements(plan.spaces) loop
    insert into public.home_locations(organization_id,neighborhood_id,home_id,name,space_type_code,source_plan_id) values(p_org,h.neighborhood_id,h.id,trim(space->>'name'),space->>'type',plan.id);
  end loop;
  update public.homes set master_plan_id=plan.id,master_plan_version=plan.version,master_plan_name=plan.name where id=h.id returning * into h;
  perform private.append_audit(p_org,auth.uid(),'home.plan_applied','home',h.id,null,null,to_jsonb(h));
  return to_jsonb(h);
end; $$;

create function public.save_company_profile(p_org uuid,p_company uuid,p_email text,p_phone text,p_address text,p_ein text,p_categories text[],p_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.companies;
begin
  select * into c from public.companies where organization_id=p_org and id=p_company for update;
  if not found or not private.require_aal2() or not (private.controls_company(p_org,auth.uid(),p_company) or private.vendor_admin(p_org,auth.uid(),p_company)) then raise insufficient_privilege using message='Company management permission is required.'; end if;
  if c.version<>p_version then raise serialization_failure using message='Company changed. Refresh before saving.'; end if;
  if nullif(trim(p_email),'') is not null and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise check_violation using message='Enter a valid contact email.'; end if;
  if nullif(trim(p_ein),'') is not null and p_ein !~ '^[0-9]{2}-?[0-9]{7}$' then raise check_violation using message='EIN must contain nine digits.'; end if;
  if not coalesce(p_categories,'{}')<@array['plumbing','framing','third_party_inspection','drywall','electrical','roofing','hvac','landscaping','other'] or length(coalesce(p_phone,''))>40 or length(coalesce(p_address,''))>1000 then raise check_violation using message='Invalid company contact details or categories.'; end if;
  update public.companies set contact_email=nullif(trim(p_email),''),phone_number=nullif(trim(p_phone),''),physical_address=nullif(trim(p_address),''),categories=coalesce(p_categories,'{}') where id=p_company returning * into c;
  insert into public.company_private_details(organization_id,company_id,ein) values(p_org,p_company,nullif(trim(p_ein),'')) on conflict(company_id) do update set ein=excluded.ein;
  perform private.append_audit(p_org,auth.uid(),'company.profile_updated','company',p_company,null,null,null,jsonb_build_object('categories',p_categories));
  return to_jsonb(c);
end; $$;

create function public.onboard_home_with_plan(p_org uuid,p_details jsonb,p_plan uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.homes;
begin
  h:=public.admin_save_home(p_org,null,(p_details->>'neighborhood_id')::uuid,p_details->>'lot_code',p_details->>'address_line1',p_details->>'address_line2',p_details->>'city',p_details->>'state_code',p_details->>'postal_code',coalesce(p_details->>'phase','planned'),null,p_details->>'external_reference',false);
  if p_plan is not null then return public.apply_home_plan(p_org,h.id,p_plan,h.version); end if;
  return to_jsonb(h);
end; $$;

create function private.company_inspection_manager(p_org uuid,p_user uuid,p_company uuid,p_neighborhood uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_user) and private.active_company_membership(p_org,p_company,p_user,'manager') and private.company_covers(p_org,p_company,p_neighborhood)
    and exists(select 1 from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='company.users.manage' where a.organization_id=p_org and a.user_id=p_user and a.company_id=p_company and private.role_grant_enabled(a) and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()));
$$;

create function public.onboard_vendor_with_profile(p_org uuid,p_name text,p_reference text,p_scope public.scope_kind,p_division uuid,p_neighborhood uuid,p_profile jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.companies;
begin
  c:=public.admin_onboard_vendor(p_org,p_name,p_reference,p_scope,p_division,p_neighborhood);
  return public.save_company_profile(p_org,c.id,p_profile->>'email',p_profile->>'phone',p_profile->>'address',p_profile->>'ein',array(select jsonb_array_elements_text(coalesce(p_profile->'categories','[]'))),c.version);
end; $$;

create function public.inspection_company_options(p_organization_id uuid,p_home_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name),'[]') from public.companies c join public.homes h on h.organization_id=c.organization_id and h.id=p_home_id
    where c.organization_id=p_organization_id and c.status='active' and 'third_party_inspection'=any(c.categories) and private.company_covers(c.organization_id,c.id,h.neighborhood_id)
      and private.has_permission(h.organization_id,auth.uid(),'inspection.manage',h.neighborhood_id,h.id);
$$;
create function public.inspection_allocation_options(p_organization_id uuid,p_inspection_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id',cm.user_id,'display_name',p.display_name) order by p.display_name),'[]') from public.inspections i
    join public.company_memberships cm on cm.organization_id=i.organization_id and cm.company_id=i.company_id join public.profiles p on p.id=cm.user_id
    where i.organization_id=p_organization_id and i.id=p_inspection_id and i.company_id is not null
      and (private.has_permission(i.organization_id,auth.uid(),'inspection.manage',i.neighborhood_id,i.home_id) or private.company_inspection_manager(i.organization_id,auth.uid(),i.company_id,i.neighborhood_id))
      and private.active_company_membership(i.organization_id,i.company_id,cm.user_id,null) and private.has_permission(i.organization_id,cm.user_id,'inspection.perform',i.neighborhood_id,i.home_id);
$$;

create function public.repair_technician_options(p_org uuid,p_company uuid,p_home uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id',cm.user_id,'display_name',p.display_name) order by p.display_name),'[]') from public.company_memberships cm
    join public.profiles p on p.id=cm.user_id join public.homes h on h.organization_id=cm.organization_id and h.id=p_home
    where cm.organization_id=p_org and cm.company_id=p_company and private.active_company_membership(p_org,p_company,cm.user_id,'technician')
      and private.company_work_permission(p_org,cm.user_id,p_company,h.neighborhood_id,h.id) and private.company_covers(p_org,p_company,h.neighborhood_id)
      and private.has_permission(p_org,auth.uid(),'work.assign',h.neighborhood_id,h.id);
$$;

create function public.save_home_space(p_org uuid,p_id uuid,p_home uuid,p_name text,p_parent uuid,p_active boolean,p_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.home_locations;
begin
  if p_type is not null and not exists(select 1 from public.space_types where code=p_type and active) then raise check_violation using message='Choose an available space type.'; end if;
  r:=public.admin_save_home_location(p_org,p_id,p_home,p_name,p_parent,p_active);
  update public.home_locations set space_type_code=p_type where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;

-- Managers see their company inbox; field inspectors see only their assignments.
do $patch$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('private.can_read_inspection(uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'private.has_permission(i.organization_id,p_user_id,''inspection.manage'',i.neighborhood_id,i.home_id) or',
    'private.has_permission(i.organization_id,p_user_id,''inspection.manage'',i.neighborhood_id,i.home_id) or private.company_inspection_manager(i.organization_id,p_user_id,i.company_id,i.neighborhood_id) or');
  execute definition;
  definition:=replace(pg_get_functiondef('private.can_read_work(uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'private.has_permission(w.organization_id,p_user_id,''work.read_scope'',w.neighborhood_id,w.home_id) or',
    '(w.reinspection_assignee_user_id=p_user_id and private.has_permission(w.organization_id,p_user_id,''inspection.perform'',w.neighborhood_id,w.home_id)) or private.has_permission(w.organization_id,p_user_id,''work.read_scope'',w.neighborhood_id,w.home_id) or');
  execute definition;
  definition:=replace(pg_get_functiondef('private.can_verify(uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'private.has_permission(w.organization_id, p_user_id, ''work.verify'', w.neighborhood_id, w.home_id)',
    '(private.has_permission(w.organization_id, p_user_id, ''work.verify'', w.neighborhood_id, w.home_id) or (w.state=''ready_for_verification'' and w.reinspection_status=''pending'' and w.reinspection_assignee_user_id=p_user_id and private.has_permission(w.organization_id,p_user_id,''inspection.perform'',w.neighborhood_id,w.home_id)))');
  execute definition;
end; $patch$;

-- A pending reinspection grants access to that home's metadata, including when
-- the Inspector belongs to a different inspection company than the original lead.
do $patch$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('private.has_any_scope(uuid,uuid,uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'(exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code=''inspection.perform'') and exists(',
    '(private.company_inspection_manager(p_organization_id,p_user_id,a.company_id,p_neighborhood_id)) or (exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code=''inspection.perform'') and exists(select 1 from public.work_items rw where rw.organization_id=p_organization_id and rw.neighborhood_id=p_neighborhood_id and (p_home_id is null or rw.home_id=p_home_id) and rw.reinspection_assignee_user_id=p_user_id)) or (exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code=''inspection.perform'') and exists(');
  execute definition;
end; $patch$;

create function private.quality_workflow_command(p_command text,p_payload jsonb,p_org uuid,p_actor uuid,p_operation uuid,p_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.inspections; h public.homes; w public.work_items; attempt public.correction_attempts; row jsonb; result jsonb; target uuid; company uuid; old_state public.work_state; n integer:=0; ids uuid[]; action text:=p_payload->>'action';
begin
  if p_command='schedule_company_inspection' then
    select * into h from public.homes where organization_id=p_org and id=(p_payload->>'home_id')::uuid and archived_at is null for share;
    company:=(p_payload->>'company_id')::uuid;
    if not found or not private.has_permission(p_org,p_actor,'inspection.manage',h.neighborhood_id,h.id) then raise insufficient_privilege using message='Inspection management permission is required.'; end if;
    if not exists(select 1 from public.companies c where c.organization_id=p_org and c.id=company and c.status='active' and 'third_party_inspection'=any(c.categories) and private.company_covers(p_org,c.id,h.neighborhood_id)) then raise check_violation using message='Choose an inspection company approved for this neighborhood.'; end if;
    if not exists(select 1 from public.checklist_versions where organization_id=p_org and id=(p_payload->>'template_version_id')::uuid and published_at is not null) then raise check_violation using message='Choose a published checklist.'; end if;
    insert into public.inspections(organization_id,neighborhood_id,home_id,type,template_version_id,scheduled_at,company_id) values(p_org,h.neighborhood_id,h.id,(p_payload->>'type')::public.inspection_type,(p_payload->>'template_version_id')::uuid,nullif(p_payload->>'scheduled_at','')::timestamptz,company) returning * into i;
    perform private.append_audit(p_org,p_actor,'inspection.company_assigned','inspection',i.id,p_operation,null,to_jsonb(i));
    return to_jsonb(i);
  elsif p_command in ('allocate_inspection','review_inspection') then
    select * into i from public.inspections where organization_id=p_org and id=(p_payload->>'inspection_id')::uuid for update;
    if not found or not private.can_read_inspection(p_actor,i.id) then raise insufficient_privilege using message='Inspection is unavailable.'; end if;
    if p_version is null or p_version<>i.version then raise serialization_failure using message='Inspection changed. Refresh and try again.'; end if;
    if p_command='allocate_inspection' then
      if i.status not in ('draft','in_progress','amended') or not (private.has_permission(p_org,p_actor,'inspection.manage',i.neighborhood_id,i.home_id) or private.company_inspection_manager(p_org,p_actor,i.company_id,i.neighborhood_id)) then raise insufficient_privilege using message='Only the supervising team or accountable company manager may allocate an open inspection.'; end if;
      target:=(p_payload->>'inspector_user_id')::uuid;
      if target is null or not private.has_permission(p_org,target,'inspection.perform',i.neighborhood_id,i.home_id) or (i.company_id is not null and not private.active_company_membership(p_org,i.company_id,target,null)) then raise check_violation using message='Choose an eligible inspector from the assigned company.'; end if;
      if exists(select 1 from public.inspection_responses where organization_id=p_org and inspection_id=i.id) and nullif(trim(p_payload->>'reason'),'') is null then raise check_violation using message='Record why an inspection with saved answers is being reassigned.'; end if;
      delete from public.inspection_participants where organization_id=p_org and inspection_id=i.id;
      insert into public.inspection_participants(organization_id,inspection_id,user_id,can_edit_draft) values(p_org,i.id,target,true);
      update public.inspections set lead_inspector_user_id=target where id=i.id returning * into i;
      perform private.append_audit(p_org,p_actor,'inspection.inspector_assigned','inspection',i.id,p_operation,null,to_jsonb(i),jsonb_build_object('reason',p_payload->>'reason'));
    else
      if i.status<>'submitted' or not private.has_permission(p_org,p_actor,'inspection.manage',i.neighborhood_id,i.home_id) then raise insufficient_privilege using message='A supervisor must review a submitted inspection.'; end if;
      if action='escalate' then
        if nullif(trim(p_payload->>'reason'),'') is null then raise check_violation using message='Explain why this report needs an area manager review.'; end if;
        update public.inspections set escalated_at=now(),escalation_reason=trim(p_payload->>'reason'),escalation_resolved_at=null where id=i.id returning * into i;
      elsif action in ('complete','resolve') then
        if action='resolve' and not exists(select 1 from public.neighborhoods nn where nn.id=i.neighborhood_id and private.admin_level(p_org,p_actor,'neighborhood',nn.division_id,nn.id,null)<=3) then raise insufficient_privilege using message='An area, division, or organization administrator must resolve this escalation.'; end if;
        if action='complete' and i.escalated_at is not null and i.escalation_resolved_at is null then raise check_violation using message='Resolve the area manager escalation before completing review.'; end if;
        if action='complete' and exists(select 1 from public.work_items where organization_id=p_org and inspection_id=i.id and state in ('draft','submitted')) then raise check_violation using message='Assign or disregard all observations before completing review.'; end if;
        update public.inspections set reviewed_at=case when action='complete' then now() else reviewed_at end,reviewed_by=case when action='complete' then p_actor else reviewed_by end,escalation_resolved_at=case when action='resolve' then now() else escalation_resolved_at end where id=i.id returning * into i;
      else raise check_violation using message='Choose a valid report review action.'; end if;
      perform private.append_audit(p_org,p_actor,'inspection.review_'||action,'inspection',i.id,p_operation,null,to_jsonb(i),jsonb_build_object('reason',p_payload->>'reason'));
    end if;
    return to_jsonb(i);
  elsif p_command='bulk_review_observations' then
    if jsonb_typeof(p_payload->'rows')<>'array' or jsonb_array_length(p_payload->'rows') not between 1 and 100 then raise check_violation using message='Select between 1 and 100 observations.'; end if;
    if action not in ('disregard','assign','reinspect') or action is null then raise check_violation using message='Choose a valid observation action.'; end if;
    select array_agg((x->>'item_id')::uuid) into ids from jsonb_array_elements(p_payload->'rows') x;
    if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise check_violation using message='An observation was selected more than once.'; end if;
    -- Consistent lock order keeps concurrent bulk operations safe.
    perform 1 from public.work_items where organization_id=p_org and id=any(ids) order by id for update;
    for row in select value from jsonb_array_elements(p_payload->'rows') loop
      select * into w from public.work_items where organization_id=p_org and id=(row->>'item_id')::uuid;
      if not found or not private.can_read_work(p_actor,w.id) then raise insufficient_privilege using message='An observation is outside your access.'; end if;
      if nullif(row->>'expected_version','')::bigint is null or (row->>'expected_version')::bigint<>w.version then raise serialization_failure using message='An observation changed. Refresh the list before applying this action.'; end if;
      if action='reinspect' then
        if w.state<>'ready_for_verification' or w.home_id is null or not private.has_permission(p_org,p_actor,'work.verify',w.neighborhood_id,w.home_id) then raise insufficient_privilege using message='Only completed repairs awaiting review can be sent for reinspection.'; end if;
        target:=(p_payload->>'inspector_user_id')::uuid;
        select * into attempt from public.correction_attempts ca where ca.organization_id=p_org and ca.work_item_id=w.id and not exists(select 1 from public.verifications v where v.correction_attempt_id=ca.id) order by ca.attempt_number desc limit 1;
        if target is null or not private.has_permission(p_org,target,'inspection.perform',w.neighborhood_id,w.home_id) or attempt.id is null or attempt.submitted_by=target or (attempt.accountable_company_id is not null and private.active_company_membership(p_org,attempt.accountable_company_id,target,null)) then raise check_violation using message='Choose an independent Inspector with access to every selected home.'; end if;
        old_state:=w.state;
        update public.work_items set reinspection_status='pending',reinspection_assignee_user_id=target,reinspection_assigned_by=p_actor,reinspection_assigned_at=now(),reinspection_completed_at=null where id=w.id returning * into w;
        perform private.append_work_event(w,'observation.reinspection_assigned',old_state,w.state,p_actor,p_operation,jsonb_build_object('inspector_user_id',target,'reason',p_payload->>'reason'),w.current_assignment_id);
      else
        result:=public.execute_command(case when action='disregard' then 'cancel_work' else 'assign_work_item' end,jsonb_build_object('operation_id',gen_random_uuid(),'expected_version',w.version,'payload',
          (p_payload-'rows'-'action')||jsonb_build_object('organization_id',p_org,'item_id',w.id,'reason',coalesce(nullif(trim(p_payload->>'reason'),''),case when action='disregard' then 'Disregarded during report review' else 'Assigned during report review' end))));
        if not coalesce((result->>'ok')::boolean,false) then raise check_violation using message=result->'error'->>'message'; end if;
      end if;
      n:=n+1;
    end loop;
    return jsonb_build_object('updated_count',n);
  elsif p_command='decide_reinspection' then
    select * into w from public.work_items where organization_id=p_org and id=(p_payload->>'item_id')::uuid for update;
    if not found or not private.can_read_work(p_actor,w.id) then raise insufficient_privilege using message='Observation is unavailable.'; end if;
    if p_version is null or w.version<>p_version then raise serialization_failure using message='Observation changed. Refresh and try again.'; end if;
    select * into attempt from public.correction_attempts ca where ca.organization_id=p_org and ca.work_item_id=w.id and not exists(select 1 from public.verifications v where v.correction_attempt_id=ca.id) order by ca.attempt_number desc limit 1 for update;
    if (w.state<>'ready_for_verification' or w.reinspection_status is distinct from 'pending') or w.reinspection_assignee_user_id<>p_actor or not private.can_verify(p_actor,attempt.id) then raise insufficient_privilege using message='Only the assigned independent Inspector can record this reinspection.'; end if;
    if p_payload->>'decision' not in ('accepted','rejected') or nullif(trim(p_payload->>'notes'),'') is null then raise check_violation using message='Record a decision and your on-site findings.'; end if;
    insert into public.verifications(organization_id,correction_attempt_id,decision,method,verified_by,notes) values(p_org,attempt.id,p_payload->>'decision','on_site',p_actor,trim(p_payload->>'notes'));
    if p_payload->>'decision'='accepted' then update public.assignment_episodes set ended_at=now(),end_reason='verified' where id=w.current_assignment_id; end if;
    update public.work_items set state=case when p_payload->>'decision'='accepted' then 'verified'::public.work_state else 'rework_required'::public.work_state end,reinspection_status='completed',reinspection_completed_at=now() where id=w.id returning * into w;
    perform private.append_work_event(w,'observation.reinspection_'||(p_payload->>'decision'),'ready_for_verification',w.state,p_actor,p_operation,jsonb_build_object('attempt_id',attempt.id,'notes',p_payload->>'notes'),w.current_assignment_id);
    return to_jsonb(w);
  end if;
  raise check_violation using message='Unknown quality workflow command.';
exception
  when serialization_failure then
    raise exception using errcode='BT001',message='Quality workflow changed',detail=private.command_error(p_operation,'VERSION_CONFLICT',sqlerrm)::text;
  when check_violation then
    raise exception using errcode='BT001',message='Quality workflow validation',detail=private.command_error(p_operation,'VALIDATION_ERROR',sqlerrm)::text;
end; $$;

-- Extend the existing command gateway, preserving its identity, idempotency,
-- version checks, offline replay protection, and transaction boundary.
do $patch$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if p_command_name in (''create_work_item'',''create_and_assign_work_item'') then';
  if strpos(definition,needle)=0 then raise exception 'Command gateway changed'; end if;
  definition:=replace(definition,needle,'if p_command_name in (''schedule_company_inspection'',''allocate_inspection'',''review_inspection'',''bulk_review_observations'',''decide_reinspection'') then
    v_result:=private.command_success(v_operation_id,private.quality_workflow_command(p_command_name,v_payload,v_organization_id,v_actor,v_operation_id,v_expected_version));
  elsif p_command_name in (''create_work_item'',''create_and_assign_work_item'') then');
  execute definition;
end; $patch$;

-- New columns are appended so existing clients retain their view column order.
create or replace view public.inspection_list with(security_invoker=true) as
  select i.id,i.organization_id,i.neighborhood_id,i.home_id,i.type,i.status,i.scheduled_at,h.lot_code,h.address_line1,i.current_revision,i.updated_at,i.version,
    i.company_id,i.lead_inspector_user_id,i.reviewed_at,i.escalated_at,i.escalation_reason,i.escalation_resolved_at
    from public.inspections i join public.homes h on h.organization_id=i.organization_id and h.id=i.home_id;

do $patch$
declare definition text;
begin
  definition:=pg_get_viewdef('public.work_item_list'::regclass,true);
  definition:=regexp_replace(definition,'(\s+FROM (public\.)?work_items w)',', w.reinspection_status, w.reinspection_assignee_user_id, w.reinspection_assigned_at, w.reinspection_completed_at, w.location_id\1','i');
  if strpos(definition,'w.reinspection_status')=0 then raise exception 'Work list view changed'; end if;
  execute 'create or replace view public.work_item_list with(security_invoker=true) as '||definition;
end; $patch$;

revoke all on function public.onboard_home_with_plan(uuid,jsonb,uuid) from public,anon;
grant execute on function public.onboard_home_with_plan(uuid,jsonb,uuid) to authenticated;
revoke all on function public.onboard_vendor_with_profile(uuid,text,text,public.scope_kind,uuid,uuid,jsonb) from public,anon;
grant execute on function public.onboard_vendor_with_profile(uuid,text,text,public.scope_kind,uuid,uuid,jsonb) to authenticated;
revoke all on function public.repair_technician_options(uuid,uuid,uuid),public.save_home_space(uuid,uuid,uuid,text,uuid,boolean,text) from public,anon;
grant execute on function public.repair_technician_options(uuid,uuid,uuid),public.save_home_space(uuid,uuid,uuid,text,uuid,boolean,text) to authenticated;

revoke all on function public.save_master_plan(uuid,uuid,uuid,text,jsonb,boolean,bigint),public.apply_home_plan(uuid,uuid,uuid,bigint),public.save_company_profile(uuid,uuid,text,text,text,text,text[],bigint),public.inspection_company_options(uuid,uuid),public.inspection_allocation_options(uuid,uuid) from public,anon;
grant execute on function public.save_master_plan(uuid,uuid,uuid,text,jsonb,boolean,bigint),public.apply_home_plan(uuid,uuid,uuid,bigint),public.save_company_profile(uuid,uuid,text,text,text,text,text[],bigint),public.inspection_company_options(uuid,uuid),public.inspection_allocation_options(uuid,uuid) to authenticated;
revoke all on function private.quality_workflow_command(text,jsonb,uuid,uuid,uuid,bigint),private.company_inspection_manager(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.quality_assignment_notifications() from public,anon,authenticated;
commit;
