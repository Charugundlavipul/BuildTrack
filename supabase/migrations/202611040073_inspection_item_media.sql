begin;
alter table public.attachments add column question_id uuid;
alter table public.attachments add constraint attachment_question_fk foreign key(organization_id,question_id) references public.checklist_questions(organization_id,id);
alter table public.attachments add constraint attachment_question_parent check(question_id is null or inspection_id is not null);
create index attachment_inspection_question on public.attachments(organization_id,inspection_id,question_id);

create function public.request_inspection_item_media(p_inspection uuid,p_question uuid,p_name text,p_mime text,p_bytes bigint)
returns public.attachments language plpgsql security definer set search_path='' as $$
declare i public.inspections; result public.attachments; media_id uuid:=gen_random_uuid();
begin
  select * into i from public.inspections where id=p_inspection for update;
  if not found or not private.active_member(i.organization_id,auth.uid()) or i.status not in ('draft','in_progress','amended')
    or not private.has_permission(i.organization_id,auth.uid(),'inspection.perform',i.neighborhood_id,i.home_id)
    or not (i.lead_inspector_user_id=auth.uid() or private.has_permission(i.organization_id,auth.uid(),'inspection.manage',i.neighborhood_id,i.home_id)) then
    raise insufficient_privilege using message='Only the assigned Inspector or inspection manager can attach evidence to an open inspection.';
  end if;
  if not exists(select 1 from public.checklist_questions q where q.organization_id=i.organization_id and q.version_id=i.template_version_id and q.id=p_question) then raise check_violation using message='Checklist item does not belong to this inspection.'; end if;
  if p_bytes is null or p_bytes not between 1 and 20971520 or p_mime is null or p_mime not in ('image/jpeg','image/png','image/heic','image/heif','application/pdf') or nullif(trim(p_name),'') is null then raise check_violation using message='Use a photo or PDF up to 20 MB.'; end if;
  if (select count(*) from public.attachments where inspection_id=i.id and question_id=p_question and status<>'deleted')>=20 then raise check_violation using message='Each checklist item supports up to 20 evidence files.'; end if;
  insert into public.attachments(id,organization_id,neighborhood_id,home_id,inspection_id,question_id,visibility,uploader_id,bucket,object_key,original_name,mime_type,byte_size,purpose)
  values(media_id,i.organization_id,i.neighborhood_id,i.home_id,i.id,p_question,'shared',auth.uid(),'evidence',i.organization_id||'/'||media_id||'/original',regexp_replace(p_name,'[\\/\x00-\x1f]','_','g'),p_mime,p_bytes,'observation') returning * into result;
  return result;
end; $$;
revoke all on function public.request_inspection_item_media(uuid,uuid,text,text,bigint) from public,anon;
grant execute on function public.request_inspection_item_media(uuid,uuid,text,text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
