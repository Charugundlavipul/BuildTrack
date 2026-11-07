begin;

-- Existing/imported homes retain their data. New interactive onboarding must
-- make an explicit plan/manual choice and persist its rooms atomically.
alter table public.homes add column layout_mode text not null default 'legacy' check(layout_mode in ('legacy','plan','manual'));
create table private.home_layout_requests (
  organization_id uuid not null, request_id uuid not null, actor_id uuid not null,
  request_hash text not null, home_id uuid not null, primary key(organization_id,request_id),
  foreign key(organization_id,home_id) references public.homes(organization_id,id)
);
do $patch$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_save_home(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,text,boolean)'::regprocedure);
  execute replace(definition,'FUNCTION public.admin_save_home(','FUNCTION private.save_home_record(');
end; $patch$;
revoke all on function private.save_home_record(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,text,boolean) from public,anon,authenticated;
create or replace function public.admin_save_home(p_organization_id uuid,p_id uuid,p_neighborhood_id uuid,p_lot_code text,p_address_line1 text default null,p_address_line2 text default null,p_city text default null,p_state_code text default null,p_postal_code text default null,p_phase text default 'planned',p_primary_supervisor_user_id uuid default null,p_external_reference text default null,p_archived boolean default false)
returns public.homes language plpgsql security definer set search_path='' as $$
begin
  if p_id is null then raise check_violation using message='Choose a standard plan or enter manual rooms before creating a home.'; end if;
  return private.save_home_record(p_organization_id,p_id,p_neighborhood_id,p_lot_code,p_address_line1,p_address_line2,p_city,p_state_code,p_postal_code,p_phase,p_primary_supervisor_user_id,p_external_reference,p_archived);
end; $$;
create function private.validate_home_layout(p_org uuid,p_neighborhood uuid,p_mode text,p_plan uuid,p_spaces jsonb) returns void language plpgsql stable security definer set search_path='' as $$
begin
  if p_mode is null or p_mode not in ('plan','manual') then raise check_violation using message='Choose a standard plan or a manual room layout.'; end if;
  if p_mode='plan' then
    if p_plan is null or not exists(select 1 from public.master_plans p join public.neighborhoods n on n.organization_id=p.organization_id and n.division_id=p.division_id where p.organization_id=p_org and p.id=p_plan and p.active and n.id=p_neighborhood) then raise check_violation using message='Choose an available floor plan from this neighborhood’s division.'; end if;
  else
    if p_plan is not null or jsonb_typeof(p_spaces) is distinct from 'array' then raise check_violation using message='Add manual rooms for this home.'; end if;
    if jsonb_array_length(p_spaces) not between 1 and 200 then raise check_violation using message='Add between 1 and 200 manual rooms or areas.'; end if;
    if exists(select 1 from jsonb_array_elements(p_spaces) r where length(trim(coalesce(r->>'name',''))) not between 1 and 120 or not exists(select 1 from public.space_types t where t.code=r->>'type' and t.active)) or jsonb_array_length(p_spaces)<>(select count(distinct lower(trim(r->>'name'))) from jsonb_array_elements(p_spaces) r) then raise check_violation using message='Give every room a unique name and an available space type.'; end if;
  end if;
end; $$;
create function public.onboard_home_layout(p_org uuid,p_request uuid,p_mode text,p_plan uuid,p_spaces jsonb,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.homes; request private.home_layout_requests; fingerprint text; room jsonb;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_org,auth.uid(),'structure.manage',(p_details->>'neighborhood_id')::uuid,null) then raise insufficient_privilege using message='Home management and administrator verification are required.'; end if;
  if p_request is null or p_mode is null or p_mode not in ('plan','manual') then raise check_violation using message='Choose a standard plan or a manual room layout.'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('mode',p_mode,'plan',p_plan,'spaces',p_spaces,'details',p_details)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_request::text,0));
  select * into request from private.home_layout_requests where organization_id=p_org and request_id=p_request;
  if found then
    if request.actor_id<>auth.uid() or request.request_hash<>fingerprint then raise check_violation using message='This onboarding request was already used. Refresh the home directory before retrying.'; end if;
    select * into h from public.homes where organization_id=p_org and id=request.home_id;
    return to_jsonb(h);
  end if;
  perform private.validate_home_layout(p_org,(p_details->>'neighborhood_id')::uuid,p_mode,p_plan,p_spaces);
  if p_mode='plan' and (p_plan is null or coalesce(jsonb_array_length(p_spaces),0)<>0) then raise check_violation using message='Choose a standard floor plan.'; end if;
  if p_mode='manual' then
    if p_plan is not null or jsonb_typeof(p_spaces) is distinct from 'array' or jsonb_array_length(p_spaces) not between 1 and 200 then raise check_violation using message='Add at least one manual room or area.'; end if;
    if exists(select 1 from jsonb_array_elements(p_spaces) r where length(trim(coalesce(r->>'name',''))) not between 1 and 120 or not exists(select 1 from public.space_types t where t.code=r->>'type' and t.active))
      or jsonb_array_length(p_spaces)<>(select count(distinct lower(trim(r->>'name'))) from jsonb_array_elements(p_spaces) r) then raise check_violation using message='Give every room a unique name and an available space type.'; end if;
  end if;
  h:=private.save_home_record(p_org,null,(p_details->>'neighborhood_id')::uuid,p_details->>'lot_code',p_details->>'address_line1',p_details->>'address_line2',p_details->>'city',p_details->>'state_code',p_details->>'postal_code','planned',null,p_details->>'external_reference',false);
  if p_mode='plan' then perform public.apply_home_plan(p_org,h.id,p_plan,h.version);
  else
    for room in select value from jsonb_array_elements(p_spaces) loop
      perform public.save_home_space(p_org,null,h.id,room->>'name',null,true,room->>'type');
    end loop;
  end if;
  update public.homes set layout_mode=p_mode where organization_id=p_org and id=h.id returning * into h;
  insert into private.home_layout_requests values(p_org,p_request,auth.uid(),fingerprint,h.id);
  perform private.append_audit(p_org,auth.uid(),'home.layout_onboarded','home',h.id,null,null,to_jsonb(h));
  return to_jsonb(h);
end; $$;
create or replace function public.onboard_home_with_plan(p_org uuid,p_details jsonb,p_plan uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.onboard_home_layout(p_org,gen_random_uuid(),'plan',p_plan,'[]',p_details); end; $$;

-- CSV batches use the same required layout path, including preview validation.
do $import$
declare definition text; old_block text; block text; block_start integer; block_end integer; start_at integer; end_at integer; needle text;
begin
  definition:=replace(pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
  block_start:=strpos(definition,'elsif p_command_name = ''import_homes'' then');
  if block_start=0 then raise exception 'Review home import command'; end if;
  block_end:=strpos(substring(definition from block_start),'elsif p_command_name = ''bulk_assign_work_items'' then');
  if block_end=0 then raise exception 'Review home import command boundary'; end if;
  old_block:=substring(definition from block_start for block_end-1);
  block:=old_block;
  needle:='v_rows := coalesce(v_payload -> ''rows'', ''[]''::jsonb);';
  if strpos(block,needle)=0 then raise exception 'Review home import validation'; end if;
  block:=replace(block,needle,'perform private.validate_home_layout(v_organization_id,(v_payload->>''neighborhood_id'')::uuid,v_payload->>''layout_mode'',nullif(v_payload->>''master_plan_id'','''')::uuid,coalesce(v_payload->''spaces'',''[]''::jsonb)); '||needle);
  start_at:=strpos(block,'insert into public.homes(');
  if start_at=0 then raise exception 'Review home import insertion'; end if;
  end_at:=strpos(substring(block from start_at),') returning id into v_row_id;');
  if end_at=0 then raise exception 'Review home import result'; end if;
  needle:=substring(block from start_at for end_at-1+length(') returning id into v_row_id;'));
  block:=replace(block,needle,'v_row_id:=(public.onboard_home_layout(v_organization_id,gen_random_uuid(),v_payload->>''layout_mode'',nullif(v_payload->>''master_plan_id'','''')::uuid,coalesce(v_payload->''spaces'',''[]''::jsonb),v_row||jsonb_build_object(''neighborhood_id'',v_payload->>''neighborhood_id''))->>''id'')::uuid;');
  execute replace(definition,old_block,block);
end; $import$;

-- A shared order preserves causality when several actions share a transaction timestamp.
create sequence private.observation_activity_order;
alter table public.work_events add column activity_order bigint not null default nextval('private.observation_activity_order');
alter table public.comments add column activity_order bigint not null default nextval('private.observation_activity_order');
alter table public.attachments add column activity_order bigint not null default nextval('private.observation_activity_order');

grant usage,select on sequence private.observation_activity_order to service_role;

-- Snapshot human-readable accountability when an event is created. Historical
-- events remain immutable; the feed labels any legacy name lookup explicitly.
create or replace function private.append_work_event(p_item public.work_items,p_event_type text,p_from_state public.work_state,p_to_state public.work_state,p_actor_id uuid,p_operation_id uuid,p_details jsonb default '{}'::jsonb,p_assignment_episode_id uuid default null,p_client_captured_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; previous public.assignment_episodes;
begin
  snapshot:=coalesce(p_details,'{}')||jsonb_build_object('actor_name',(select display_name from public.profiles where id=p_actor_id));
  snapshot:=snapshot||jsonb_build_object(
    'assignee_name',(select display_name from public.profiles where id=coalesce(nullif(p_details->>'internal_assignee_user_id','')::uuid,nullif(p_details->>'technician_id','')::uuid,nullif(p_details->>'inspector_user_id','')::uuid)),
    'company_name',(select name from public.companies where organization_id=p_item.organization_id and id=nullif(p_details->>'company_id','')::uuid),
    'previous_assignee_name',(select display_name from public.profiles where id=nullif(p_details->>'previous_technician_id','')::uuid));
  if p_event_type='work.assigned' then
    select * into previous from public.assignment_episodes where organization_id=p_item.organization_id and work_item_id=p_item.id and id is distinct from p_assignment_episode_id and ended_at is not null order by ended_at desc,id desc limit 1;
    snapshot:=snapshot||jsonb_build_object('previous_assignee_name',(select display_name from public.profiles where id=coalesce(previous.technician_user_id,previous.internal_assignee_user_id)),
      'previous_company_name',(select name from public.companies where organization_id=p_item.organization_id and id=previous.company_id));
  end if;
  insert into public.work_events(organization_id,work_item_id,assignment_episode_id,event_type,from_state,to_state,actor_id,operation_id,details,client_captured_at)
    values(p_item.organization_id,p_item.id,p_assignment_episode_id,p_event_type,p_from_state,p_to_state,p_actor_id,p_operation_id,jsonb_strip_nulls(snapshot),p_client_captured_at);
end; $$;
do $patch$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='update public.assignment_episodes set technician_user_id = v_technician_id where id = v_episode.id returning * into v_episode;';
  if strpos(definition,needle)=0 then raise exception 'Review company delegation history before applying this migration'; end if;
  definition:=replace(definition,needle,'v_payload:=v_payload||jsonb_build_object(''previous_technician_id'',v_episode.technician_user_id); '||needle);
  definition:=replace(definition,'jsonb_build_object(''technician_id'', v_technician_id), v_episode.id);','jsonb_build_object(''technician_id'', v_technician_id,''previous_technician_id'',v_payload->>''previous_technician_id''), v_episode.id);');
  execute definition;
end; $patch$;

create function public.observation_activity(p_org uuid,p_item uuid,p_before_at timestamptz default null,p_before_key text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.can_read_work(auth.uid(),p_item) or not exists(select 1 from public.work_items where organization_id=p_org and id=p_item) then raise insufficient_privilege using message='Observation access is required.'; end if;
  with feed as (
    select lpad(e.activity_order::text,20,'0')||':event:'||e.id key,e.server_at at,'event' kind,e.actor_id,coalesce(e.details->>'actor_name',p.display_name,'System') actor_name,e.event_type,e.from_state::text from_state,e.to_state::text to_state,e.details||jsonb_strip_nulls(jsonb_build_object('completion_note',(select completion_note from public.correction_attempts ca where ca.organization_id=p_org and ca.work_item_id=p_item and ca.id=nullif(e.details->>'attempt_id','')::uuid),'assignee_name',coalesce(e.details->>'assignee_name',(select display_name from public.profiles where id=coalesce(nullif(e.details->>'internal_assignee_user_id','')::uuid,nullif(e.details->>'technician_id','')::uuid,nullif(e.details->>'inspector_user_id','')::uuid))),'company_name',coalesce(e.details->>'company_name',(select name from public.companies where organization_id=p_org and id=nullif(e.details->>'company_id','')::uuid)))) details,
      null::text body,'shared'::text visibility,null::uuid attachment_id,null::text file_status,null::text file_name,(not(e.details ? 'actor_name')) legacy_name
    from public.work_events e left join public.profiles p on p.id=e.actor_id where e.organization_id=p_org and e.work_item_id=p_item and e.event_type<>'comment.added'
    union all
    select lpad(c.activity_order::text,20,'0')||':comment:'||c.id,c.created_at,'comment',c.author_id,coalesce((select e.details->>'actor_name' from public.work_events e where e.organization_id=p_org and e.work_item_id=p_item and e.details->>'comment_id'=c.id::text limit 1),p.display_name,'Former team member'),'comment.added',null,null,'{}'::jsonb,
      case when c.redacted_at is not null then '[Message removed]' else c.body end,c.visibility::text,null,null,null,false
    from public.comments c left join public.profiles p on p.id=c.author_id where c.organization_id=p_org and c.work_item_id=p_item and (c.visibility='shared' or private.is_internal_member(p_org,auth.uid()))
    union all
    select lpad(a.activity_order::text,20,'0')||':attachment:'||a.id,a.created_at,'attachment',a.uploader_id,coalesce(p.display_name,'Former team member'),'evidence.added',null,null,'{}'::jsonb,null,a.visibility::text,a.id,a.status::text,a.original_name,false
    from public.attachments a left join public.profiles p on p.id=a.uploader_id where a.organization_id=p_org and a.work_item_id=p_item and private.can_read_attachment(auth.uid(),a.id)
  ), selected as (select * from feed where p_before_at is null or (at,key)<(p_before_at,coalesce(p_before_key,'')) order by at desc,key desc limit 51), page as (select * from selected order by at desc,key desc limit 50)
  select jsonb_build_object('entries',coalesce((select jsonb_agg(to_jsonb(page) order by at desc,key desc) from page),'[]'),'has_more',(select count(*)>50 from selected)) into result;
  return result;
end; $$;

-- Conversations have an explicit project/home scope and explicit participants.
-- Neither organization membership nor a platform role alone permits reading.
create table public.project_conversations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  neighborhood_id uuid not null, home_id uuid, audience text not null default 'project' check(audience in ('project','internal')), title text not null check(length(trim(title)) between 1 and 160),
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  request_id uuid not null, request_hash text not null, unique(organization_id,id),unique(organization_id,created_by,request_id),
  foreign key(organization_id,neighborhood_id) references public.neighborhoods(organization_id,id),
  foreign key(organization_id,home_id) references public.homes(organization_id,id)
);
create table public.project_conversation_members (
  organization_id uuid not null,conversation_id uuid not null,user_id uuid not null references auth.users(id),
  joined_at timestamptz not null default now(),removed_at timestamptz,last_read_seq bigint not null default 0,
  primary key(organization_id,conversation_id,user_id),foreign key(organization_id,conversation_id) references public.project_conversations(organization_id,id)
);
create table public.project_messages (
  id uuid primary key default gen_random_uuid(),seq bigint generated always as identity unique,
  organization_id uuid not null,conversation_id uuid not null,author_id uuid not null references auth.users(id),
  author_name text not null,body text not null check(length(trim(body)) between 1 and 4000),kind text not null default 'message' check(kind in ('message','system')),
  reply_to uuid,created_at timestamptz not null default now(),operation_id uuid not null,
  unique(organization_id,conversation_id,id),unique(organization_id,author_id,operation_id),
  foreign key(organization_id,conversation_id) references public.project_conversations(organization_id,id),
  foreign key(organization_id,conversation_id,reply_to) references public.project_messages(organization_id,conversation_id,id)
);
create index observation_activity_cursor on public.work_events(organization_id,work_item_id,server_at desc,id);
create index project_messages_cursor on public.project_messages(organization_id,conversation_id,seq desc);
create index project_conversation_member_inbox on public.project_conversation_members(organization_id,user_id) where removed_at is null;
create trigger project_messages_immutable before update or delete on public.project_messages for each row execute function private.prevent_mutation();

create function private.can_use_project_chat(p_org uuid,p_user uuid,p_neighborhood uuid,p_home uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_user) and exists(select 1 from public.neighborhoods n where n.organization_id=p_org and n.id=p_neighborhood and n.status='active')
    and (p_home is null or exists(select 1 from public.homes h where h.organization_id=p_org and h.id=p_home and h.neighborhood_id=p_neighborhood and h.archived_at is null))
    and private.has_any_scope(p_org,p_user,p_neighborhood,p_home);
$$;
create function private.can_read_project_chat(p_org uuid,p_conversation uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.project_conversations c join public.project_conversation_members m on m.organization_id=c.organization_id and m.conversation_id=c.id
    where c.organization_id=p_org and c.id=p_conversation and m.user_id=p_user and m.removed_at is null and (c.audience<>'internal' or private.is_internal_member(p_org,p_user)) and private.can_use_project_chat(p_org,p_user,c.neighborhood_id,c.home_id));
$$;
alter table public.project_conversations enable row level security;
alter table public.project_conversation_members enable row level security;
alter table public.project_messages enable row level security;
create policy project_conversation_read on public.project_conversations for select to authenticated using(private.can_read_project_chat(organization_id,id,auth.uid()));
create policy project_members_read on public.project_conversation_members for select to authenticated using(private.can_read_project_chat(organization_id,conversation_id,auth.uid()));
create policy project_messages_read on public.project_messages for select to authenticated using(private.can_read_project_chat(organization_id,conversation_id,auth.uid()));
revoke all on public.project_conversations,public.project_conversation_members,public.project_messages from public,anon,authenticated;
grant select on public.project_conversations,public.project_conversation_members,public.project_messages to authenticated;

create function public.project_chat_scopes(p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_org,auth.uid()) then raise insufficient_privilege using message='Active organization membership is required.'; end if;
  return jsonb_build_object('neighborhoods',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'name',n.name,'can_project_chat',private.can_use_project_chat(p_org,auth.uid(),n.id,null)) order by n.name,n.id),'[]') from public.neighborhoods n where n.organization_id=p_org and (private.can_use_project_chat(p_org,auth.uid(),n.id,null) or exists(select 1 from public.homes h where h.organization_id=p_org and h.neighborhood_id=n.id and private.can_use_project_chat(p_org,auth.uid(),n.id,h.id)))),
    'homes',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'lot_code',h.lot_code,'neighborhood_id',h.neighborhood_id) order by h.lot_code,h.id),'[]') from public.homes h where h.organization_id=p_org and private.can_use_project_chat(p_org,auth.uid(),h.neighborhood_id,h.id)));
end; $$;
create function public.project_chat_people(p_org uuid,p_neighborhood uuid,p_home uuid default null,p_audience text default 'project') returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_use_project_chat(p_org,auth.uid(),p_neighborhood,p_home) then raise insufficient_privilege using message='Current project access is required.'; end if;
  if p_audience is null or p_audience not in ('project','internal') or p_audience='internal' and not private.is_internal_member(p_org,auth.uid()) then raise insufficient_privilege using message='Internal conversations are limited to the internal project team.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'display_name',p.display_name,'affiliation',m.affiliation) order by p.display_name,p.id),'[]')
    from public.organization_memberships m join public.profiles p on p.id=m.user_id where m.organization_id=p_org and (p_audience<>'internal' or private.is_internal_member(p_org,m.user_id)) and m.user_id<>auth.uid() and private.can_use_project_chat(p_org,m.user_id,p_neighborhood,p_home));
end; $$;
create function public.project_chat_create(p_org uuid,p_request uuid,p_neighborhood uuid,p_home uuid,p_title text,p_users uuid[],p_audience text default 'project') returns uuid language plpgsql security definer set search_path='' as $$
declare conversation public.project_conversations; person uuid; participants uuid[]; fingerprint text;
begin
  if not private.can_use_project_chat(p_org,auth.uid(),p_neighborhood,p_home) then raise insufficient_privilege using message='Current project access is required.'; end if;
  if p_request is null or length(trim(coalesce(p_title,''))) not between 1 and 160 or cardinality(coalesce(p_users,'{}')) not between 1 and 49 then raise check_violation using message='Enter a title and choose 1–49 project participants.'; end if;
  if p_audience is null or p_audience not in ('project','internal') or p_audience='internal' and not private.is_internal_member(p_org,auth.uid()) then raise insufficient_privilege using message='Internal conversations are limited to the internal project team.'; end if;
  select array_agg(distinct u order by u) into participants from unnest(p_users||auth.uid()) u;
  if cardinality(participants)<2 then raise check_violation using message='Choose at least one other project participant.'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('project',p_neighborhood,'home',p_home,'title',trim(p_title),'audience',p_audience,'participants',participants)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||auth.uid()::text||p_request::text,0));
  select * into conversation from public.project_conversations where organization_id=p_org and created_by=auth.uid() and request_id=p_request;
  if found then
    if conversation.request_hash<>fingerprint then raise check_violation using message='This conversation request was already used. Refresh Messages before retrying.'; end if;
    if not private.can_read_project_chat(p_org,conversation.id,auth.uid()) then raise insufficient_privilege using message='Conversation membership is required to recover this conversation.'; end if;
    return conversation.id;
  end if;
  foreach person in array participants loop
    if not private.can_use_project_chat(p_org,person,p_neighborhood,p_home) or p_audience='internal' and not private.is_internal_member(p_org,person) then raise check_violation using message='A participant no longer has access to this project or home.'; end if;
  end loop;
  insert into public.project_conversations(organization_id,neighborhood_id,home_id,audience,title,created_by,request_id,request_hash) values(p_org,p_neighborhood,p_home,p_audience,trim(p_title),auth.uid(),p_request,fingerprint) returning * into conversation;
  insert into public.project_conversation_members(organization_id,conversation_id,user_id) select p_org,conversation.id,u from unnest(participants) u;
  insert into public.project_messages(organization_id,conversation_id,author_id,author_name,body,kind,operation_id) values(p_org,conversation.id,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'Team member'),'Conversation started. Participants can see its complete shared history.','system',gen_random_uuid());
  perform private.append_audit(p_org,auth.uid(),'conversation.created','project_conversation',conversation.id,null,null,jsonb_build_object('participants',participants,'neighborhood_id',p_neighborhood,'home_id',p_home));
  return conversation.id;
end; $$;
create function public.project_chat_inbox(p_org uuid,p_page integer default 0,p_search text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_org,auth.uid()) then raise insufficient_privilege using message='Active organization membership is required.'; end if;
  return (with visible as (select c.*,n.name project_name,h.lot_code,m.last_read_seq,
      (select count(*) from public.project_messages msg where msg.organization_id=p_org and msg.conversation_id=c.id and msg.seq>m.last_read_seq and msg.author_id<>auth.uid()) unread,
      (select max(msg.seq) from public.project_messages msg where msg.organization_id=p_org and msg.conversation_id=c.id) latest_seq
    from public.project_conversations c join public.project_conversation_members m on m.organization_id=c.organization_id and m.conversation_id=c.id join public.neighborhoods n on n.organization_id=c.organization_id and n.id=c.neighborhood_id left join public.homes h on h.organization_id=c.organization_id and h.id=c.home_id
    where c.organization_id=p_org and concat_ws(' ',c.title,n.name,h.lot_code) ilike '%'||coalesce(p_search,'')||'%' and m.user_id=auth.uid() and private.can_read_project_chat(p_org,c.id,auth.uid())), page as (select * from visible order by latest_seq desc,id limit 25 offset greatest(coalesce(p_page,0),0)*25)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by latest_seq desc,id) from page),'[]'),'total',(select count(*) from visible),'unread',(select coalesce(sum(unread),0) from visible)));
end; $$;
create function public.project_chat_read(p_org uuid,p_conversation uuid,p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_read_project_chat(p_org,p_conversation,auth.uid()) then raise insufficient_privilege using message='Current conversation and project membership are required.'; end if;
  return (with selected as (select m.* from public.project_messages m where m.organization_id=p_org and m.conversation_id=p_conversation and (p_before is null or m.seq<p_before) order by m.seq desc limit 51),page as (select * from selected order by seq desc limit 50)
    select jsonb_build_object('conversation',(select to_jsonb(c)||jsonb_build_object('can_manage',c.created_by=auth.uid() or coalesce(private.admin_level(p_org,auth.uid(),'neighborhood',(select division_id from public.neighborhoods where organization_id=p_org and id=c.neighborhood_id),c.neighborhood_id,null)<=3,false)) from public.project_conversations c where c.organization_id=p_org and c.id=p_conversation),
      'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',p.display_name,'last_read_seq',m.last_read_seq,'has_access',private.can_use_project_chat(p_org,m.user_id,c.neighborhood_id,c.home_id)) order by p.display_name),'[]') from public.project_conversation_members m join public.profiles p on p.id=m.user_id join public.project_conversations c on c.organization_id=m.organization_id and c.id=m.conversation_id where m.organization_id=p_org and m.conversation_id=p_conversation and m.removed_at is null),
      'messages',coalesce((select jsonb_agg(to_jsonb(page)||jsonb_build_object('reply_name',(select r.author_name from public.project_messages r where r.organization_id=p_org and r.conversation_id=p_conversation and r.id=page.reply_to),'reply_body',(select left(r.body,240) from public.project_messages r where r.organization_id=p_org and r.conversation_id=p_conversation and r.id=page.reply_to)) order by seq desc) from page),'[]'),'has_more',(select count(*)>50 from selected)));
end; $$;
create function public.project_chat_mark_read(p_org uuid,p_conversation uuid,p_seq bigint) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.can_read_project_chat(p_org,p_conversation,auth.uid()) then raise insufficient_privilege using message='Current conversation membership is required.'; end if;
  update public.project_conversation_members set last_read_seq=greatest(last_read_seq,least(coalesce(p_seq,0),coalesce((select max(seq) from public.project_messages where organization_id=p_org and conversation_id=p_conversation),0))) where organization_id=p_org and conversation_id=p_conversation and user_id=auth.uid();
end; $$;
create function public.project_chat_set_member(p_org uuid,p_conversation uuid,p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare c public.project_conversations; actor text; target text;
begin
  if not private.can_read_project_chat(p_org,p_conversation,auth.uid()) then raise insufficient_privilege using message='Current conversation membership is required.'; end if;
  select * into c from public.project_conversations where organization_id=p_org and id=p_conversation for update;
  if p_active is null or (p_user<>auth.uid() or p_active) and not(c.created_by=auth.uid() or coalesce(private.admin_level(p_org,auth.uid(),'neighborhood',(select division_id from public.neighborhoods where organization_id=p_org and id=c.neighborhood_id),c.neighborhood_id,null)<=3,false)) then raise insufficient_privilege using message='Only the conversation owner or a participating project administrator can manage participants.'; end if;
  if p_active and (not private.can_use_project_chat(p_org,p_user,c.neighborhood_id,c.home_id) or c.audience='internal' and not private.is_internal_member(p_org,p_user)) then raise check_violation using message='This person does not have current access to the project or home.'; end if;
  if p_active then
    insert into public.project_conversation_members(organization_id,conversation_id,user_id) values(p_org,p_conversation,p_user) on conflict(organization_id,conversation_id,user_id) do update set removed_at=null where project_conversation_members.removed_at is not null;
  else update public.project_conversation_members set removed_at=now() where organization_id=p_org and conversation_id=p_conversation and user_id=p_user and removed_at is null; end if;
  if not found then return; end if;
  select display_name into actor from public.profiles where id=auth.uid(); select display_name into target from public.profiles where id=p_user;
  insert into public.project_messages(organization_id,conversation_id,author_id,author_name,body,kind,operation_id) values(p_org,p_conversation,auth.uid(),coalesce(actor,'Team member'),coalesce(actor,'Team member')||case when p_active then ' added ' else ' removed ' end||coalesce(target,'a participant')||'.','system',gen_random_uuid());
  perform private.append_audit(p_org,auth.uid(),'conversation.membership_changed','project_conversation',p_conversation,null,null,jsonb_build_object('user_id',p_user,'active',p_active));
end; $$;
create function private.send_project_message(p_org uuid,p_actor uuid,p_operation uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=(p_payload->>'conversation_id')::uuid; result public.project_messages; reply uuid:=nullif(p_payload->>'reply_to','')::uuid;
begin
  perform 1 from public.project_conversation_members where organization_id=p_org and conversation_id=c and user_id=p_actor for share;
  if not private.can_read_project_chat(p_org,c,p_actor) then raise insufficient_privilege using message='Current conversation and project membership are required.'; end if;
  if length(trim(coalesce(p_payload->>'body',''))) not between 1 and 4000 then raise check_violation using message='Enter a message of 1–4000 characters.'; end if;
  if reply is not null and not exists(select 1 from public.project_messages where organization_id=p_org and conversation_id=c and id=reply) then raise check_violation using message='Reply to a message in this conversation.'; end if;
  insert into public.project_messages(organization_id,conversation_id,author_id,author_name,body,operation_id,reply_to)
    values(p_org,c,p_actor,coalesce((select display_name from public.profiles where id=p_actor),'Team member'),trim(p_payload->>'body'),p_operation,reply) returning * into result;
  return to_jsonb(result);
end; $$;
do $patch$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if p_command_name in (''schedule_company_inspection'',''allocate_inspection'',''review_inspection'',''bulk_review_observations'',''decide_reinspection'') then';
  if strpos(definition,needle)=0 then raise exception 'Review the command gateway before adding project messages'; end if;
  execute replace(definition,needle,'if p_command_name=''send_project_message'' then
    v_result:=private.command_success(v_operation_id,private.send_project_message(v_organization_id,v_actor,v_operation_id,v_payload));
  elsif p_command_name in (''schedule_company_inspection'',''allocate_inspection'',''review_inspection'',''bulk_review_observations'',''decide_reinspection'') then');
end; $patch$;

revoke all on function public.onboard_home_layout(uuid,uuid,text,uuid,jsonb,jsonb),public.observation_activity(uuid,uuid,timestamptz,text),public.project_chat_scopes(uuid),public.project_chat_people(uuid,uuid,uuid,text),public.project_chat_create(uuid,uuid,uuid,uuid,text,uuid[],text),public.project_chat_inbox(uuid,integer,text),public.project_chat_read(uuid,uuid,bigint),public.project_chat_mark_read(uuid,uuid,bigint),public.project_chat_set_member(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.onboard_home_layout(uuid,uuid,text,uuid,jsonb,jsonb),public.observation_activity(uuid,uuid,timestamptz,text),public.project_chat_scopes(uuid),public.project_chat_people(uuid,uuid,uuid,text),public.project_chat_create(uuid,uuid,uuid,uuid,text,uuid[],text),public.project_chat_inbox(uuid,integer,text),public.project_chat_read(uuid,uuid,bigint),public.project_chat_mark_read(uuid,uuid,bigint),public.project_chat_set_member(uuid,uuid,uuid,boolean) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_messages') then alter publication supabase_realtime add table public.project_messages; end if;
end; $$;
commit;
