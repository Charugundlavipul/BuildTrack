begin;

create or replace function private.require_admin_permission(p_organization_id uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), p_permission, null, null) then
    raise exception using errcode = '42501', message = 'elevated administrative permission required';
  end if;
end;
$$;

create or replace function public.admin_save_division(p_organization_id uuid, p_id uuid, p_name text, p_status public.organization_status default 'active')
returns public.divisions language plpgsql security definer set search_path = '' as $$
declare result public.divisions; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'structure.manage');
  if length(trim(coalesce(p_name,''))) not between 1 and 120 then raise exception using errcode='22023', message='division name is required'; end if;
  if p_id is null then
    insert into public.divisions(organization_id,name,status) values(p_organization_id,trim(p_name),p_status) returning * into result;
  else
    select to_jsonb(d) into before_row from public.divisions d where d.organization_id=p_organization_id and d.id=p_id for update;
    update public.divisions set name=trim(p_name),status=p_status,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='division not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'division.saved','division',result.id,null,before_row,to_jsonb(result));
  return result;
end; $$;
revoke all on function public.admin_save_division(uuid,uuid,text,public.organization_status) from public,anon;
grant execute on function public.admin_save_division(uuid,uuid,text,public.organization_status) to authenticated;

create or replace function public.admin_save_neighborhood(
  p_organization_id uuid, p_id uuid, p_division_id uuid, p_code text, p_name text,
  p_timezone text default null, p_status public.organization_status default 'active', p_supervisor_user_id uuid default null
)
returns public.neighborhoods language plpgsql security definer set search_path = '' as $$
declare result public.neighborhoods; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'structure.manage');
  if length(trim(coalesce(p_code,''))) not between 1 and 40 or length(trim(coalesce(p_name,''))) not between 1 and 160 then
    raise exception using errcode='22023', message='neighborhood code and name are required';
  end if;
  if p_division_id is not null and not exists(select 1 from public.divisions where organization_id=p_organization_id and id=p_division_id and status='active') then raise exception using errcode='22023', message='division is unavailable'; end if;
  if p_supervisor_user_id is not null and not private.active_member(p_organization_id,p_supervisor_user_id) then raise exception using errcode='22023', message='supervisor must be an active member'; end if;
  if p_timezone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception using errcode='22023', message='invalid timezone'; end if;
  if p_id is null then
    insert into public.neighborhoods(organization_id,division_id,code,name,timezone,status,supervisor_user_id)
      values(p_organization_id,p_division_id,upper(trim(p_code)),trim(p_name),nullif(trim(p_timezone),''),p_status,p_supervisor_user_id) returning * into result;
  else
    select to_jsonb(n) into before_row from public.neighborhoods n where n.organization_id=p_organization_id and n.id=p_id for update;
    update public.neighborhoods set division_id=p_division_id,code=upper(trim(p_code)),name=trim(p_name),timezone=nullif(trim(p_timezone),''),status=p_status,supervisor_user_id=p_supervisor_user_id,updated_at=now(),version=version+1
      where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='neighborhood not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'neighborhood.saved','neighborhood',result.id,null,before_row,to_jsonb(result));
  return result;
end; $$;
revoke all on function public.admin_save_neighborhood(uuid,uuid,uuid,text,text,text,public.organization_status,uuid) from public,anon;
grant execute on function public.admin_save_neighborhood(uuid,uuid,uuid,text,text,text,public.organization_status,uuid) to authenticated;

create or replace function public.admin_save_home(
  p_organization_id uuid, p_id uuid, p_neighborhood_id uuid, p_lot_code text, p_address_line1 text default null,
  p_address_line2 text default null, p_city text default null, p_state_code text default null, p_postal_code text default null,
  p_phase text default 'planned', p_primary_supervisor_user_id uuid default null, p_external_reference text default null, p_archived boolean default false
)
returns public.homes language plpgsql security definer set search_path = '' as $$
declare result public.homes; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'structure.manage');
  if length(trim(coalesce(p_lot_code,''))) not between 1 and 80 then raise exception using errcode='22023', message='lot code is required'; end if;
  if not exists(select 1 from public.neighborhoods where organization_id=p_organization_id and id=p_neighborhood_id and status='active') then raise exception using errcode='22023', message='neighborhood is unavailable'; end if;
  if p_primary_supervisor_user_id is not null and not private.active_member(p_organization_id,p_primary_supervisor_user_id) then raise exception using errcode='22023', message='supervisor must be an active member'; end if;
  if p_id is null then
    insert into public.homes(organization_id,neighborhood_id,lot_code,address_line1,address_line2,city,state_code,postal_code,phase,primary_supervisor_user_id,external_reference,archived_at)
      values(p_organization_id,p_neighborhood_id,trim(p_lot_code),nullif(trim(p_address_line1),''),nullif(trim(p_address_line2),''),nullif(trim(p_city),''),upper(nullif(trim(p_state_code),'')),nullif(trim(p_postal_code),''),trim(p_phase),p_primary_supervisor_user_id,nullif(trim(p_external_reference),''),case when p_archived then now() end) returning * into result;
  else
    select to_jsonb(h) into before_row from public.homes h where h.organization_id=p_organization_id and h.id=p_id for update;
    update public.homes set neighborhood_id=p_neighborhood_id,lot_code=trim(p_lot_code),address_line1=nullif(trim(p_address_line1),''),address_line2=nullif(trim(p_address_line2),''),city=nullif(trim(p_city),''),state_code=upper(nullif(trim(p_state_code),'')),postal_code=nullif(trim(p_postal_code),''),phase=trim(p_phase),primary_supervisor_user_id=p_primary_supervisor_user_id,external_reference=nullif(trim(p_external_reference),''),archived_at=case when p_archived then coalesce(archived_at,now()) else null end,updated_at=now(),version=version+1
      where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='home not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'home.saved','home',result.id,null,before_row,to_jsonb(result));
  return result;
end; $$;
revoke all on function public.admin_save_home(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,text,boolean) from public,anon;
grant execute on function public.admin_save_home(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,text,boolean) to authenticated;

create or replace function public.admin_save_home_location(p_organization_id uuid,p_id uuid,p_home_id uuid,p_name text,p_parent_location_id uuid default null,p_active boolean default true)
returns public.home_locations language plpgsql security definer set search_path = '' as $$
declare result public.home_locations; home_row public.homes; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'structure.manage');
  select * into home_row from public.homes where organization_id=p_organization_id and id=p_home_id and archived_at is null;
  if not found then raise exception using errcode='22023', message='home is unavailable'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 then raise exception using errcode='22023', message='location name is required'; end if;
  if p_parent_location_id is not null and not exists(select 1 from public.home_locations where organization_id=p_organization_id and home_id=p_home_id and id=p_parent_location_id and active) then raise exception using errcode='22023', message='parent location is unavailable'; end if;
  if p_id is null then
    insert into public.home_locations(organization_id,neighborhood_id,home_id,name,parent_location_id,active) values(p_organization_id,home_row.neighborhood_id,p_home_id,trim(p_name),p_parent_location_id,p_active) returning * into result;
  else
    select to_jsonb(l) into before_row from public.home_locations l where l.organization_id=p_organization_id and l.id=p_id for update;
    update public.home_locations set name=trim(p_name),parent_location_id=p_parent_location_id,active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id and home_id=p_home_id returning * into result;
    if not found then raise exception using errcode='02000', message='home location not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'home_location.saved','home_location',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_home_location(uuid,uuid,uuid,text,uuid,boolean) from public,anon;
grant execute on function public.admin_save_home_location(uuid,uuid,uuid,text,uuid,boolean) to authenticated;

create or replace function public.admin_save_company(p_organization_id uuid,p_id uuid,p_name text,p_external_vendor_reference text default null,p_status public.organization_status default 'active')
returns public.companies language plpgsql security definer set search_path = '' as $$
declare result public.companies; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'roster.manage');
  if length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception using errcode='22023', message='company name is required'; end if;
  if p_id is null then insert into public.companies(organization_id,name,external_vendor_reference,status) values(p_organization_id,trim(p_name),nullif(trim(p_external_vendor_reference),''),p_status) returning * into result;
  else select to_jsonb(c) into before_row from public.companies c where c.organization_id=p_organization_id and c.id=p_id for update;
    update public.companies set name=trim(p_name),external_vendor_reference=nullif(trim(p_external_vendor_reference),''),status=p_status,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='company not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'company.saved','company',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_company(uuid,uuid,text,text,public.organization_status) from public,anon;
grant execute on function public.admin_save_company(uuid,uuid,text,text,public.organization_status) to authenticated;

create or replace function public.admin_save_specialty(p_organization_id uuid,p_id uuid,p_code text,p_name text,p_active boolean default true)
returns public.trade_specialties language plpgsql security definer set search_path = '' as $$
declare result public.trade_specialties; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'roster.manage');
  if length(trim(coalesce(p_code,''))) not between 1 and 40 or length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception using errcode='22023', message='specialty code and name are required'; end if;
  if p_id is null then insert into public.trade_specialties(organization_id,code,name,active) values(p_organization_id,upper(trim(p_code)),trim(p_name),p_active) returning * into result;
  else select to_jsonb(s) into before_row from public.trade_specialties s where s.organization_id=p_organization_id and s.id=p_id for update;
    update public.trade_specialties set code=upper(trim(p_code)),name=trim(p_name),active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='specialty not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'specialty.saved','trade_specialty',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_specialty(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.admin_save_specialty(uuid,uuid,text,text,boolean) to authenticated;

create or replace function public.admin_save_roster(p_organization_id uuid,p_id uuid,p_neighborhood_id uuid,p_company_id uuid,p_specialty_id uuid,p_status public.organization_status default 'active',p_active_from timestamptz default now(),p_active_to timestamptz default null)
returns public.neighborhood_trade_rosters language plpgsql security definer set search_path = '' as $$
declare result public.neighborhood_trade_rosters; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'roster.manage');
  if p_active_to is not null and p_active_to <= p_active_from then raise exception using errcode='22023', message='roster end must follow its start'; end if;
  if not exists(select 1 from public.neighborhoods where organization_id=p_organization_id and id=p_neighborhood_id and status='active') then raise exception using errcode='22023', message='neighborhood is unavailable'; end if;
  if not exists(select 1 from public.companies where organization_id=p_organization_id and id=p_company_id and status='active') then raise exception using errcode='22023', message='company is unavailable'; end if;
  if not exists(select 1 from public.trade_specialties where organization_id=p_organization_id and id=p_specialty_id and active) then raise exception using errcode='22023', message='specialty is unavailable'; end if;
  if p_id is null then insert into public.neighborhood_trade_rosters(organization_id,neighborhood_id,company_id,specialty_id,status,active_from,active_to) values(p_organization_id,p_neighborhood_id,p_company_id,p_specialty_id,p_status,p_active_from,p_active_to) returning * into result;
  else select to_jsonb(r) into before_row from public.neighborhood_trade_rosters r where r.organization_id=p_organization_id and r.id=p_id for update;
    update public.neighborhood_trade_rosters set neighborhood_id=p_neighborhood_id,company_id=p_company_id,specialty_id=p_specialty_id,status=p_status,active_from=p_active_from,active_to=p_active_to where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='roster entry not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'roster.saved','neighborhood_trade_roster',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_roster(uuid,uuid,uuid,uuid,uuid,public.organization_status,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_save_roster(uuid,uuid,uuid,uuid,uuid,public.organization_status,timestamptz,timestamptz) to authenticated;

create or replace function public.admin_save_work_category(p_organization_id uuid,p_id uuid,p_code text,p_name text,p_active boolean default true)
returns public.work_categories language plpgsql security definer set search_path = '' as $$
declare result public.work_categories; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'config.manage');
  if length(trim(coalesce(p_code,''))) not between 1 and 40 or length(trim(coalesce(p_name,''))) not between 1 and 160 then raise exception using errcode='22023', message='category code and name are required'; end if;
  if p_id is null then insert into public.work_categories(organization_id,code,name,active) values(p_organization_id,upper(trim(p_code)),trim(p_name),p_active) returning * into result;
  else select to_jsonb(c) into before_row from public.work_categories c where c.organization_id=p_organization_id and c.id=p_id for update;
    update public.work_categories set code=upper(trim(p_code)),name=trim(p_name),active=p_active,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='work category not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'work_category.saved','work_category',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_work_category(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.admin_save_work_category(uuid,uuid,text,text,boolean) to authenticated;

create or replace function public.admin_save_business_calendar(p_organization_id uuid,p_id uuid,p_name text,p_timezone text,p_working_weekdays smallint[],p_local_start_time time,p_local_end_time time,p_holiday_dates date[] default '{}')
returns public.business_calendars language plpgsql security definer set search_path = '' as $$
declare result public.business_calendars; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'config.manage');
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception using errcode='22023', message='invalid timezone'; end if;
  if cardinality(p_working_weekdays)<1 or exists(select 1 from unnest(p_working_weekdays) d where d<0 or d>6) then raise exception using errcode='22023', message='working weekdays must contain values from 0 through 6'; end if;
  if p_local_end_time<=p_local_start_time then raise exception using errcode='22023', message='business day must end after it starts'; end if;
  if p_id is null then insert into public.business_calendars(organization_id,name,timezone,working_weekdays,local_start_time,local_end_time,holiday_dates) values(p_organization_id,trim(p_name),p_timezone,p_working_weekdays,p_local_start_time,p_local_end_time,p_holiday_dates) returning * into result;
  else select to_jsonb(c) into before_row from public.business_calendars c where c.organization_id=p_organization_id and c.id=p_id for update;
    update public.business_calendars set name=trim(p_name),timezone=p_timezone,working_weekdays=p_working_weekdays,local_start_time=p_local_start_time,local_end_time=p_local_end_time,holiday_dates=p_holiday_dates,updated_at=now(),version=version+1 where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='calendar not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'calendar.saved','business_calendar',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_business_calendar(uuid,uuid,text,text,smallint[],time,time,date[]) from public,anon;
grant execute on function public.admin_save_business_calendar(uuid,uuid,text,text,smallint[],time,time,date[]) to authenticated;

create or replace function public.admin_create_checklist_version(p_organization_id uuid,p_template_id uuid,p_template_name text,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare template_row public.checklist_templates; version_row public.checklist_versions; question jsonb; position integer:=0;
begin
  perform private.require_admin_permission(p_organization_id, 'config.manage');
  if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions)<1 or jsonb_array_length(p_questions)>250 then raise exception using errcode='22023', message='one to 250 checklist questions are required'; end if;
  if p_template_id is null then
    if length(trim(coalesce(p_template_name,''))) not between 1 and 160 then raise exception using errcode='22023', message='template name is required'; end if;
    insert into public.checklist_templates(organization_id,name) values(p_organization_id,trim(p_template_name)) returning * into template_row;
  else
    select * into template_row from public.checklist_templates where organization_id=p_organization_id and id=p_template_id and active for update;
    if not found then raise exception using errcode='02000', message='active checklist template not found'; end if;
  end if;
  insert into public.checklist_versions(organization_id,template_id,number,created_by)
    select p_organization_id,template_row.id,coalesce(max(number),0)+1,auth.uid() from public.checklist_versions where organization_id=p_organization_id and template_id=template_row.id returning * into version_row;
  for question in select value from jsonb_array_elements(p_questions) loop
    position:=position+1;
    if length(trim(coalesce(question->>'label','')))<2 then raise exception using errcode='22023', message='every checklist question requires a label'; end if;
    if nullif(question->>'category_id','') is not null and not exists(select 1 from public.work_categories where organization_id=p_organization_id and id=(question->>'category_id')::uuid and active) then raise exception using errcode='22023', message='checklist category is unavailable'; end if;
    insert into public.checklist_questions(organization_id,version_id,ordinal,section,label,category_id,requires_response)
      values(p_organization_id,version_row.id,position,coalesce(nullif(trim(question->>'section'),''),'General'),trim(question->>'label'),nullif(question->>'category_id','')::uuid,coalesce((question->>'requires_response')::boolean,true));
  end loop;
  perform private.append_audit(p_organization_id,auth.uid(),'checklist.version_created','checklist_version',version_row.id,null,null,to_jsonb(version_row),jsonb_build_object('question_count',position));
  return jsonb_build_object('template_id',template_row.id,'version_id',version_row.id,'number',version_row.number,'question_count',position);
end; $$;
revoke all on function public.admin_create_checklist_version(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.admin_create_checklist_version(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.admin_publish_checklist_version(p_organization_id uuid,p_version_id uuid)
returns public.checklist_versions language plpgsql security definer set search_path = '' as $$
declare result public.checklist_versions;
begin
  perform private.require_admin_permission(p_organization_id, 'config.manage');
  update public.checklist_versions set published_at=now() where organization_id=p_organization_id and id=p_version_id and published_at is null returning * into result;
  if not found then raise exception using errcode='02000', message='unpublished checklist version not found'; end if;
  if not exists(select 1 from public.checklist_questions where organization_id=p_organization_id and version_id=p_version_id) then raise exception using errcode='23514', message='cannot publish an empty checklist'; end if;
  perform private.append_audit(p_organization_id,auth.uid(),'checklist.version_published','checklist_version',result.id,null,null,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_publish_checklist_version(uuid,uuid) from public,anon;
grant execute on function public.admin_publish_checklist_version(uuid,uuid) to authenticated;

create or replace function public.admin_save_inspector_engagement(p_organization_id uuid,p_id uuid,p_neighborhood_id uuid,p_home_id uuid,p_inspector_user_id uuid,p_purpose text,p_starts_at timestamptz,p_ends_at timestamptz,p_revoke boolean default false)
returns public.inspection_engagements language plpgsql security definer set search_path = '' as $$
declare result public.inspection_engagements; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'config.manage');
  if p_ends_at<=p_starts_at then raise exception using errcode='22023', message='engagement end must follow its start'; end if;
  if not exists(select 1 from public.homes where organization_id=p_organization_id and neighborhood_id=p_neighborhood_id and id=p_home_id and archived_at is null) then raise exception using errcode='22023', message='home is unavailable'; end if;
  if not private.active_member(p_organization_id,p_inspector_user_id) or not exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_inspector_user_id and affiliation='external' and status='active') then raise exception using errcode='22023', message='inspector must be an active external member'; end if;
  if p_id is null then insert into public.inspection_engagements(organization_id,neighborhood_id,home_id,inspector_user_id,purpose,starts_at,ends_at,revoked_at) values(p_organization_id,p_neighborhood_id,p_home_id,p_inspector_user_id,trim(p_purpose),p_starts_at,p_ends_at,case when p_revoke then now() end) returning * into result;
  else select to_jsonb(e) into before_row from public.inspection_engagements e where e.organization_id=p_organization_id and e.id=p_id for update;
    update public.inspection_engagements set neighborhood_id=p_neighborhood_id,home_id=p_home_id,inspector_user_id=p_inspector_user_id,purpose=trim(p_purpose),starts_at=p_starts_at,ends_at=p_ends_at,revoked_at=case when p_revoke then coalesce(revoked_at,now()) else null end where organization_id=p_organization_id and id=p_id returning * into result;
    if not found then raise exception using errcode='02000', message='inspector engagement not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'inspector_engagement.saved','inspection_engagement',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_inspector_engagement(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.admin_save_inspector_engagement(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,boolean) to authenticated;

commit;
