begin;

alter table public.attachments add column client_operation_id uuid;
create unique index attachments_uploader_operation_unique on public.attachments (uploader_id, client_operation_id) where client_operation_id is not null;

create function public.request_offline_work_attachment_slot(
  p_operation_id uuid, p_organization_id uuid, p_neighborhood_id uuid, p_home_id uuid,
  p_work_item_id uuid, p_visibility public.comment_visibility, p_original_name text,
  p_mime_type text, p_byte_size bigint, p_purpose text
) returns public.attachments language plpgsql security definer set search_path = '' as $$
declare result public.attachments;
begin
  if auth.uid() is null or p_operation_id is null or p_work_item_id is null
    or not private.active_member(p_organization_id, auth.uid())
    or not private.can_read_work(auth.uid(), p_work_item_id)
    or not private.has_permission(p_organization_id, auth.uid(), 'evidence.upload', p_neighborhood_id, p_home_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_operation_id::text, 0));
  select * into result from public.attachments where uploader_id = auth.uid() and client_operation_id = p_operation_id;
  if found then
    if result.organization_id is distinct from p_organization_id or result.neighborhood_id is distinct from p_neighborhood_id
      or result.home_id is distinct from p_home_id or result.work_item_id is distinct from p_work_item_id
      or result.visibility is distinct from p_visibility or result.original_name is distinct from pg_catalog.regexp_replace(p_original_name, '[\\/\x00-\x1f]', '_', 'g')
      or result.mime_type is distinct from p_mime_type or result.byte_size is distinct from p_byte_size or result.purpose is distinct from p_purpose then
      raise exception using errcode = '22023', message = 'upload operation does not match its original reservation';
    end if;
    return result;
  end if;
  result := public.request_attachment_slot(p_organization_id, p_neighborhood_id, p_home_id, p_work_item_id, null, null, p_visibility, p_original_name, p_mime_type, p_byte_size, p_purpose);
  update public.attachments set client_operation_id = p_operation_id where id = result.id returning * into result;
  return result;
end;
$$;
revoke all on function public.request_offline_work_attachment_slot(uuid,uuid,uuid,uuid,uuid,public.comment_visibility,text,text,bigint,text) from public, anon;
grant execute on function public.request_offline_work_attachment_slot(uuid,uuid,uuid,uuid,uuid,public.comment_visibility,text,text,bigint,text) to authenticated;
commit;
