begin;

-- Conversations are between organization members, not tied to a project or home.
drop policy if exists project_conversation_read on public.project_conversations;
drop policy if exists project_members_read on public.project_conversation_members;
drop policy if exists project_messages_read on public.project_messages;

drop function if exists public.project_chat_scopes(uuid);
drop function if exists public.project_chat_people(uuid,uuid,uuid,text);
drop function if exists public.project_chat_create(uuid,uuid,uuid,uuid,text,uuid[],text);
drop function if exists public.project_chat_inbox(uuid,integer,text);
drop function if exists public.project_chat_read(uuid,uuid,bigint);
drop function if exists public.project_chat_mark_read(uuid,uuid,bigint);
drop function if exists public.project_chat_set_member(uuid,uuid,uuid,boolean);
drop function if exists private.send_project_message(uuid,uuid,uuid,jsonb);
drop function if exists private.can_read_project_chat(uuid,uuid,uuid);
drop function if exists private.can_use_project_chat(uuid,uuid,uuid,uuid);

alter table public.project_conversations drop constraint if exists project_conversations_audience_check;
update public.project_conversations set audience='partners' where audience='project';
alter table public.project_conversations add constraint project_conversations_audience_check check(audience in ('internal','partners'));
alter table public.project_conversations drop column home_id, drop column neighborhood_id;

create function private.can_read_project_chat(p_org uuid,p_conversation uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.active_member(p_org,p_user) and exists(
    select 1 from public.project_conversations c
    join public.project_conversation_members m on m.organization_id=c.organization_id and m.conversation_id=c.id
    where c.organization_id=p_org and c.id=p_conversation and m.user_id=p_user and m.removed_at is null
      and (c.audience<>'internal' or private.is_internal_member(p_org,p_user))
  );
$$;

create policy project_conversation_read on public.project_conversations for select to authenticated using(private.can_read_project_chat(organization_id,id,auth.uid()));
create policy project_members_read on public.project_conversation_members for select to authenticated using(private.can_read_project_chat(organization_id,conversation_id,auth.uid()));
create policy project_messages_read on public.project_messages for select to authenticated using(private.can_read_project_chat(organization_id,conversation_id,auth.uid()));

create function public.project_chat_people(p_org uuid,p_audience text default 'partners') returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_org,auth.uid()) then raise insufficient_privilege using message='Active organization membership is required.'; end if;
  if p_audience is null or p_audience not in ('partners','internal') or p_audience='internal' and not private.is_internal_member(p_org,auth.uid()) then raise insufficient_privilege using message='Internal conversations are limited to the internal team.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'display_name',p.display_name,'affiliation',m.affiliation) order by p.display_name,p.id),'[]')
    from public.organization_memberships m join public.profiles p on p.id=m.user_id
    where m.organization_id=p_org and m.user_id<>auth.uid() and private.active_member(p_org,m.user_id)
      and (p_audience<>'internal' or private.is_internal_member(p_org,m.user_id)));
end; $$;

create function public.project_chat_create(p_org uuid,p_request uuid,p_title text,p_users uuid[],p_audience text default 'partners') returns uuid language plpgsql security definer set search_path='' as $$
declare conversation public.project_conversations; person uuid; participants uuid[]; fingerprint text;
begin
  if not private.active_member(p_org,auth.uid()) then raise insufficient_privilege using message='Active organization membership is required.'; end if;
  if p_request is null or length(trim(coalesce(p_title,''))) not between 1 and 160 or cardinality(coalesce(p_users,'{}')) not between 1 and 49 then raise check_violation using message='Enter a title and choose 1–49 participants.'; end if;
  if p_audience is null or p_audience not in ('partners','internal') or p_audience='internal' and not private.is_internal_member(p_org,auth.uid()) then raise insufficient_privilege using message='Internal conversations are limited to the internal team.'; end if;
  select array_agg(distinct u order by u) into participants from unnest(coalesce(p_users,'{}'::uuid[])||auth.uid()) u;
  if cardinality(participants)<2 then raise check_violation using message='Choose at least one other participant.'; end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('title',trim(p_title),'audience',p_audience,'participants',participants)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||auth.uid()::text||p_request::text,0));
  select * into conversation from public.project_conversations where organization_id=p_org and created_by=auth.uid() and request_id=p_request;
  if found then
    if conversation.request_hash<>fingerprint then raise check_violation using message='This conversation request was already used. Refresh Messages before retrying.'; end if;
    if not private.can_read_project_chat(p_org,conversation.id,auth.uid()) then raise insufficient_privilege using message='Conversation membership is required to recover this conversation.'; end if;
    return conversation.id;
  end if;
  foreach person in array participants loop
    if not private.active_member(p_org,person) or p_audience='internal' and not private.is_internal_member(p_org,person) then raise check_violation using message='A selected participant is not available for this audience.'; end if;
  end loop;
  insert into public.project_conversations(organization_id,audience,title,created_by,request_id,request_hash) values(p_org,p_audience,trim(p_title),auth.uid(),p_request,fingerprint) returning * into conversation;
  insert into public.project_conversation_members(organization_id,conversation_id,user_id) select p_org,conversation.id,u from unnest(participants) u;
  insert into public.project_messages(organization_id,conversation_id,author_id,author_name,body,kind,operation_id) values(p_org,conversation.id,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'Team member'),'Conversation started. Participants can see its complete shared history.','system',gen_random_uuid());
  perform private.append_audit(p_org,auth.uid(),'conversation.created','project_conversation',conversation.id,null,null,jsonb_build_object('participants',participants,'audience',p_audience));
  return conversation.id;
end; $$;

create function public.project_chat_inbox(p_org uuid,p_page integer default 0,p_search text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.active_member(p_org,auth.uid()) then raise insufficient_privilege using message='Active organization membership is required.'; end if;
  return (with visible as (select c.*,m.last_read_seq,
      (select count(*) from public.project_messages msg where msg.organization_id=p_org and msg.conversation_id=c.id and msg.seq>m.last_read_seq and msg.author_id<>auth.uid()) unread,
      (select max(msg.seq) from public.project_messages msg where msg.organization_id=p_org and msg.conversation_id=c.id) latest_seq
    from public.project_conversations c join public.project_conversation_members m on m.organization_id=c.organization_id and m.conversation_id=c.id
    where c.organization_id=p_org and c.title ilike '%'||coalesce(p_search,'')||'%' and m.user_id=auth.uid() and private.can_read_project_chat(p_org,c.id,auth.uid())), page as (select * from visible order by latest_seq desc,id limit 25 offset greatest(coalesce(p_page,0),0)*25)
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by latest_seq desc,id) from page),'[]'),'total',(select count(*) from visible),'unread',(select coalesce(sum(unread),0) from visible)));
end; $$;

create function public.project_chat_read(p_org uuid,p_conversation uuid,p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_read_project_chat(p_org,p_conversation,auth.uid()) then raise insufficient_privilege using message='Current conversation membership is required.'; end if;
  return (with selected as (select m.* from public.project_messages m where m.organization_id=p_org and m.conversation_id=p_conversation and (p_before is null or m.seq<p_before) order by m.seq desc limit 51),page as (select * from selected order by seq desc limit 50)
    select jsonb_build_object('conversation',(select to_jsonb(c)||jsonb_build_object('can_manage',c.created_by=auth.uid() or private.has_permission(p_org,auth.uid(),'access.manage',null,null)) from public.project_conversations c where c.organization_id=p_org and c.id=p_conversation),
      'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',p.display_name,'last_read_seq',m.last_read_seq,'has_access',private.active_member(p_org,m.user_id) and (c.audience<>'internal' or private.is_internal_member(p_org,m.user_id))) order by p.display_name),'[]') from public.project_conversation_members m join public.profiles p on p.id=m.user_id join public.project_conversations c on c.organization_id=m.organization_id and c.id=m.conversation_id where m.organization_id=p_org and m.conversation_id=p_conversation and m.removed_at is null),
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
  if p_active is null or (p_user<>auth.uid() or p_active) and not(c.created_by=auth.uid() or private.has_permission(p_org,auth.uid(),'access.manage',null,null)) then raise insufficient_privilege using message='Only the conversation owner or an organization administrator can manage participants.'; end if;
  if p_active and (not private.active_member(p_org,p_user) or c.audience='internal' and not private.is_internal_member(p_org,p_user)) then raise check_violation using message='This person is not available for this conversation audience.'; end if;
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
  if not private.can_read_project_chat(p_org,c,p_actor) then raise insufficient_privilege using message='Current conversation membership is required.'; end if;
  if length(trim(coalesce(p_payload->>'body',''))) not between 1 and 4000 then raise check_violation using message='Enter a message of 1–4000 characters.'; end if;
  if reply is not null and not exists(select 1 from public.project_messages where organization_id=p_org and conversation_id=c and id=reply) then raise check_violation using message='Reply to a message in this conversation.'; end if;
  insert into public.project_messages(organization_id,conversation_id,author_id,author_name,body,operation_id,reply_to)
    values(p_org,c,p_actor,coalesce((select display_name from public.profiles where id=p_actor),'Team member'),trim(p_payload->>'body'),p_operation,reply) returning * into result;
  return to_jsonb(result);
end; $$;

revoke all on function public.project_chat_people(uuid,text),public.project_chat_create(uuid,uuid,text,uuid[],text),public.project_chat_inbox(uuid,integer,text),public.project_chat_read(uuid,uuid,bigint),public.project_chat_mark_read(uuid,uuid,bigint),public.project_chat_set_member(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.project_chat_people(uuid,text),public.project_chat_create(uuid,uuid,text,uuid[],text),public.project_chat_inbox(uuid,integer,text),public.project_chat_read(uuid,uuid,bigint),public.project_chat_mark_read(uuid,uuid,bigint),public.project_chat_set_member(uuid,uuid,uuid,boolean) to authenticated;

commit;
