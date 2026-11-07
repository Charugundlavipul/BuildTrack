begin;

-- Use the parent record's scope, not caller-supplied location metadata. Lock the
-- parent so quota checks and inspection submission serialize with uploads.
create function private.require_attachment_write(a public.attachments,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare w public.work_items; i public.inspections; c public.comments;
begin
 if p_actor is null or not private.active_member(a.organization_id,p_actor) then raise insufficient_privilege using message='forbidden'; end if;
 if (a.work_item_id is not null)::int+(a.inspection_id is not null)::int+(a.comment_id is not null)::int<>1 then
  raise check_violation using message='Choose exactly one attachment parent.';
 end if;
 if a.inspection_id is not null then
  select * into i from public.inspections where organization_id=a.organization_id and id=a.inspection_id for update;
  if not found or a.neighborhood_id is distinct from i.neighborhood_id or a.home_id is distinct from i.home_id
   or i.status not in ('draft','in_progress','amended')
   or not (private.has_permission(i.organization_id,p_actor,'inspection.manage',i.neighborhood_id,i.home_id)
    or private.has_permission(i.organization_id,p_actor,'inspection.perform',i.neighborhood_id,i.home_id)
     and (i.lead_inspector_user_id=p_actor or exists(select 1 from public.inspection_participants ip where ip.inspection_id=i.id and ip.user_id=p_actor and ip.can_edit_draft))) then
   raise insufficient_privilege using message='Only an assigned Inspector or supervisor can attach evidence to an open inspection.';
  end if;
 else
  if a.comment_id is not null then
   select * into c from public.comments where organization_id=a.organization_id and id=a.comment_id for update;
   if not found or c.visibility='internal' and not private.is_internal_member(a.organization_id,p_actor) then raise insufficient_privilege using message='Comment is outside your access.'; end if;
   select * into w from public.work_items where organization_id=a.organization_id and id=c.work_item_id for update;
  else
   select * into w from public.work_items where organization_id=a.organization_id and id=a.work_item_id for update;
  end if;
  if w.id is null or a.neighborhood_id is distinct from w.neighborhood_id or a.home_id is distinct from w.home_id
   or not private.can_read_work(p_actor,w.id) then raise insufficient_privilege using message='Work item is outside your upload access.'; end if;
 end if;
 if not private.has_permission(a.organization_id,p_actor,'evidence.upload',a.neighborhood_id,a.home_id)
  or a.visibility='internal' and not private.is_internal_member(a.organization_id,p_actor) then
  raise insufficient_privilege using message='Evidence upload permission is required in this scope.';
 end if;
end; $$;
revoke all on function private.require_attachment_write(public.attachments,uuid) from public,anon,authenticated;

-- Upload ownership alone must never bypass loss of access to the parent.
create or replace function private.can_read_attachment(p_user_id uuid,p_attachment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a where a.id=p_attachment_id
  and private.active_member(a.organization_id,p_user_id)
  and (a.visibility='shared' or private.is_internal_member(a.organization_id,p_user_id))
  and (a.status='ready' or a.uploader_id=p_user_id and a.status in ('pending_upload','quarantined'))
  and ((a.work_item_id is not null and private.can_read_work(p_user_id,a.work_item_id))
   or (a.inspection_id is not null and private.can_read_inspection(p_user_id,a.inspection_id))
   or (a.comment_id is not null and exists(select 1 from public.comments c where c.organization_id=a.organization_id and c.id=a.comment_id
    and private.can_read_work(p_user_id,c.work_item_id) and (c.visibility='shared' or private.is_internal_member(a.organization_id,p_user_id)))))
 );
$$;
-- This helper is used by an RLS policy and needs execution permission.
revoke all on function private.can_read_attachment(uuid,uuid) from public,anon;
grant execute on function private.can_read_attachment(uuid,uuid) to authenticated;

do $$ declare definition text; needle text; begin
 definition:=replace(pg_get_functiondef('public.request_attachment_slot(uuid,uuid,uuid,uuid,uuid,uuid,public.comment_visibility,text,text,bigint,text)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:='if auth.uid() is null or not private.active_member(p_organization_id, auth.uid()) then';
 if strpos(definition,needle)=0 then raise exception 'Review attachment reservation before applying security fix'; end if;
 definition:=replace(definition,needle,'v_result.organization_id:=p_organization_id; v_result.neighborhood_id:=p_neighborhood_id; v_result.home_id:=p_home_id;
  v_result.work_item_id:=p_work_item_id; v_result.inspection_id:=p_inspection_id; v_result.comment_id:=p_comment_id; v_result.visibility:=p_visibility;
  perform private.require_attachment_write(v_result,auth.uid());
  if nullif(trim(p_original_name),'''') is null or length(p_original_name)>255 then raise check_violation using message=''A filename of up to 255 characters is required.''; end if;
  '||needle);
 execute definition;

 definition:=replace(pg_get_functiondef('public.finalize_attachment_record(uuid,text,bigint,text,boolean,text,text,text)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:='update public.attachments set';
 if strpos(definition,needle)=0 then raise exception 'Review evidence finalization before applying security fix'; end if;
 definition:=replace(definition,needle,'select * into result from public.attachments where id=p_attachment_id;
  if not found or result.status not in (''pending_upload'',''quarantined'') then return null; end if;
  perform private.require_attachment_write(result,result.uploader_id);
  select * into result from public.attachments where id=p_attachment_id for update;
  if result.status not in (''pending_upload'',''quarantined'') then return null; end if;
  '||needle);
 execute definition;
end; $$;

-- Recheck access and draft state before issuing a replacement signed upload URL.
create function public.authorize_attachment_upload(p_attachment_id uuid)
returns public.attachments language plpgsql security definer set search_path='' as $$
declare a public.attachments;
begin
 select * into a from public.attachments where id=p_attachment_id;
 if not found or a.uploader_id is distinct from auth.uid() or not private.can_read_attachment(auth.uid(),a.id) then
  raise insufficient_privilege using message='Attachment is outside your upload access.';
 end if;
 if a.status in ('pending_upload','quarantined') then perform private.require_attachment_write(a,auth.uid());
 elsif a.status<>'ready' then raise check_violation using message='Attachment is not available for upload.'; end if;
 return a;
end; $$;
revoke all on function public.authorize_attachment_upload(uuid) from public,anon;
grant execute on function public.authorize_attachment_upload(uuid) to authenticated;

-- Use the same parent authorization for per-question inspection media.
create or replace function public.request_inspection_item_media(p_inspection uuid,p_question uuid,p_name text,p_mime text,p_bytes bigint)
returns public.attachments language plpgsql security definer set search_path='' as $$
declare i public.inspections; result public.attachments; media_id uuid:=gen_random_uuid();
begin
 select * into i from public.inspections where id=p_inspection for update;
 if not found then raise insufficient_privilege using message='Inspection is outside your upload access.'; end if;
 result.organization_id:=i.organization_id; result.neighborhood_id:=i.neighborhood_id; result.home_id:=i.home_id;
 result.inspection_id:=i.id; result.visibility:='shared';
 perform private.require_attachment_write(result,auth.uid());
 if not exists(select 1 from public.checklist_questions q where q.organization_id=i.organization_id and q.version_id=i.template_version_id and q.id=p_question) then raise check_violation using message='Checklist item does not belong to this inspection.'; end if;
 if p_bytes is null or p_bytes not between 1 and 20971520 or p_mime is null or p_mime not in ('image/jpeg','image/png','image/heic','image/heif','application/pdf')
  or nullif(trim(p_name),'') is null or length(p_name)>255 then raise check_violation using message='Use a photo or PDF up to 20 MB and a filename of up to 255 characters.'; end if;
 if (select count(*) from public.attachments where inspection_id=i.id and question_id=p_question and status<>'deleted')>=20 then raise check_violation using message='Each checklist item supports up to 20 evidence files.'; end if;
 insert into public.attachments(id,organization_id,neighborhood_id,home_id,inspection_id,question_id,visibility,uploader_id,bucket,object_key,original_name,mime_type,byte_size,purpose)
 values(media_id,i.organization_id,i.neighborhood_id,i.home_id,i.id,p_question,'shared',auth.uid(),'evidence',i.organization_id||'/'||media_id||'/original',regexp_replace(p_name,'[\\/\x00-\x1f]','_','g'),p_mime,p_bytes,'observation') returning * into result;
 return result;
end; $$;

-- Each completion attempt owns its evidence permanently. A resubmission must
-- use new correction evidence or an explicitly authorized evidence exception.
do $$ declare definition text; needle text; begin
 definition:=replace(pg_get_functiondef('public.execute_command_before_plan_checklists(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:='elsif p_command_name = ''submit_correction'' then';
 if strpos(definition,needle)=0 then raise exception 'Review completion evidence dispatch before applying security fix'; end if;
 definition:=replace(definition,needle,needle||'
      if exists(select 1 from jsonb_array_elements_text(coalesce(v_payload->''attachment_ids'',''[]''::jsonb)) selected(id)
       where not exists(select 1 from public.attachments a where a.id=selected.id::uuid and a.organization_id=v_organization_id
        and a.work_item_id=v_item.id and a.status=''ready'' and a.visibility=''shared'' and a.purpose=''correction'' and a.correction_attempt_id is null)) then
       return private.command_error(v_operation_id,''EVIDENCE_NOT_READY'',''Choose new, ready completion evidence. Evidence already submitted with an earlier attempt cannot be reused.'');
      end if;');
 execute definition;
end; $$;
notify pgrst,'reload schema';
commit;
