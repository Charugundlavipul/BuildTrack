begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('evidence', 'evidence', false, 20971520, array['image/jpeg','image/png','image/heic','image/heif','application/pdf']),
  ('exports', 'exports', false, 52428800, array['text/csv','application/pdf','application/zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.request_attachment_slot(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_home_id uuid,
  p_work_item_id uuid,
  p_inspection_id uuid,
  p_comment_id uuid,
  p_visibility public.comment_visibility,
  p_original_name text,
  p_mime_type text,
  p_byte_size bigint,
  p_purpose text
)
returns public.attachments
language plpgsql security definer set search_path = '' as $$
declare
  v_result public.attachments;
  v_attachment_id uuid := gen_random_uuid();
  v_parent_count integer;
begin
  if auth.uid() is null or not private.active_member(p_organization_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_byte_size < 1 or p_byte_size > 20971520 then
    raise exception using errcode = '22023', message = 'file must be 20 MB or smaller';
  end if;
  if p_mime_type not in ('image/jpeg','image/png','image/heic','image/heif','application/pdf') then
    raise exception using errcode = '22023', message = 'unsupported file type';
  end if;
  if p_work_item_id is not null and not private.can_read_work(auth.uid(), p_work_item_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_inspection_id is not null and not private.can_read_inspection(auth.uid(), p_inspection_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_comment_id is not null and not exists (
    select 1 from public.comments c where c.organization_id = p_organization_id and c.id = p_comment_id and private.can_read_work(auth.uid(), c.work_item_id)
  ) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_visibility = 'internal' and not private.is_internal_member(p_organization_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'external participants cannot upload internal evidence';
  end if;
  select count(*) into v_parent_count from public.attachments a
    where a.organization_id = p_organization_id and a.status <> 'deleted'
      and (
        (p_work_item_id is not null and a.work_item_id = p_work_item_id)
        or (p_inspection_id is not null and a.inspection_id = p_inspection_id)
        or (p_comment_id is not null and a.comment_id = p_comment_id)
      );
  if v_parent_count >= 20 then
    raise exception using errcode = '23514', message = 'attachment quota reached';
  end if;
  insert into public.attachments(
    id, organization_id, neighborhood_id, home_id, work_item_id, inspection_id, comment_id,
    visibility, uploader_id, bucket, object_key, original_name, mime_type, byte_size, purpose
  ) values (
    v_attachment_id, p_organization_id, p_neighborhood_id, p_home_id, p_work_item_id, p_inspection_id, p_comment_id,
    p_visibility, auth.uid(), 'evidence', p_organization_id || '/' || v_attachment_id || '/original',
    regexp_replace(p_original_name, '[\\/\x00-\x1f]', '_', 'g'), p_mime_type, p_byte_size, p_purpose
  ) returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.request_attachment_slot(uuid,uuid,uuid,uuid,uuid,uuid,public.comment_visibility,text,text,bigint,text) from public, anon;
grant execute on function public.request_attachment_slot(uuid,uuid,uuid,uuid,uuid,uuid,public.comment_visibility,text,text,bigint,text) to authenticated;

create or replace function public.mark_attachment_quarantined(p_attachment_id uuid)
returns public.attachments language plpgsql security definer set search_path = '' as $$
declare result public.attachments;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.attachments set status = 'quarantined' where id = p_attachment_id and status = 'pending_upload' returning * into result;
  return result;
end;
$$;
revoke all on function public.mark_attachment_quarantined(uuid) from public, anon, authenticated;
grant execute on function public.mark_attachment_quarantined(uuid) to service_role;

create or replace function public.finalize_attachment_record(
  p_attachment_id uuid,
  p_sha256 text,
  p_actual_size bigint,
  p_actual_mime text,
  p_clean boolean,
  p_provider_reference text,
  p_derivative_object_key text default null,
  p_rejection_reason text default null
)
returns public.attachments language plpgsql security definer set search_path = '' as $$
declare result public.attachments;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.attachments set
    sha256 = p_sha256,
    byte_size = p_actual_size,
    mime_type = p_actual_mime,
    scan_provider = 'cloudmersive',
    scan_reference = p_provider_reference,
    derivative_object_key = p_derivative_object_key,
    status = case when p_clean then 'ready'::public.attachment_status else 'rejected'::public.attachment_status end,
    rejection_reason = case when p_clean then null else coalesce(p_rejection_reason, 'Content validation failed') end,
    ready_at = case when p_clean then now() else null end
  where id = p_attachment_id and status in ('pending_upload','quarantined')
  returning * into result;
  return result;
end;
$$;
revoke all on function public.finalize_attachment_record(uuid,text,bigint,text,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_attachment_record(uuid,text,bigint,text,boolean,text,text,text) to service_role;

create or replace function private.schedule_due_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer := 0;
begin
  insert into public.notification_outbox(
    organization_id, recipient_user_id, work_item_id, assignment_episode_id, channel,
    dedupe_key, template_key, payload, available_at
  )
  select ae.organization_id, recipient.user_id, ae.work_item_id, ae.id, channel.name,
    'due:' || ae.id || ':' || channel.name || ':' || recipient.user_id || ':' || to_char(ae.due_at, 'YYYYMMDDHH24MI'),
    'work_due', jsonb_build_object('work_item_id', ae.work_item_id, 'due_at', ae.due_at), now()
  from public.assignment_episodes ae
  join public.work_items w on w.organization_id = ae.organization_id and w.id = ae.work_item_id
  cross join lateral (
    select ae.internal_assignee_user_id as user_id where ae.internal_assignee_user_id is not null
    union
    select cm.user_id from public.company_memberships cm where cm.organization_id = ae.organization_id and cm.company_id = ae.company_id
      and cm.kind = 'manager' and cm.revoked_at is null and cm.active_from <= now() and (cm.active_to is null or cm.active_to > now())
  ) recipient
  cross join (values ('in_app'),('email')) as channel(name)
  where ae.ended_at is null and ae.due_at <= now() + interval '1 day'
    and w.state not in ('draft','verified','cancelled')
    and private.active_member(ae.organization_id, recipient.user_id)
  on conflict (organization_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.claim_notification_batch(p_limit integer, p_lease_token uuid)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  return query
  with claimable as (
    select id from public.notification_outbox
    where status in ('pending','failed','leased') and available_at <= now()
      and (leased_until is null or leased_until < now()) and attempts < max_attempts
    order by available_at, created_at
    for update skip locked limit greatest(1, least(p_limit, 100))
  )
  update public.notification_outbox o set status = 'leased', lease_token = p_lease_token,
    leased_until = now() + interval '2 minutes', attempts = attempts + 1, updated_at = now()
  from claimable c where o.id = c.id returning o.*;
end;
$$;
revoke all on function public.claim_notification_batch(integer,uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_batch(integer,uuid) to service_role;

create or replace function public.complete_notification(p_id uuid, p_lease_token uuid, p_provider_message_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.notification_outbox set status = 'sent', provider_message_id = p_provider_message_id,
    sent_at = now(), leased_until = null, lease_token = null, updated_at = now()
  where id = p_id and lease_token = p_lease_token and status = 'leased';
end;
$$;
revoke all on function public.complete_notification(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.complete_notification(uuid,uuid,text) to service_role;

create or replace function public.fail_notification(p_id uuid, p_lease_token uuid, p_error text, p_retryable boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.notification_outbox set
    status = case when not p_retryable or attempts >= max_attempts then 'dead'::public.notification_status else 'failed'::public.notification_status end,
    last_error = left(p_error, 1000),
    available_at = case when p_retryable then now() + (interval '1 minute' * power(2, least(attempts, 8))) else available_at end,
    leased_until = null, lease_token = null, updated_at = now()
  where id = p_id and lease_token = p_lease_token and status = 'leased';
end;
$$;
revoke all on function public.fail_notification(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.fail_notification(uuid,uuid,text,boolean) to service_role;

create or replace function private.cleanup_operational_artifacts()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op_count integer; attachment_count integer; export_count integer;
begin
  delete from private.client_operations where created_at < now() - interval '90 days';
  get diagnostics op_count = row_count;
  update public.attachments set status = 'deleted', rejection_reason = coalesce(rejection_reason, 'Orphaned upload expired')
    where status in ('pending_upload','quarantined') and created_at < now() - interval '24 hours'
      and correction_attempt_id is null;
  get diagnostics attachment_count = row_count;
  update public.export_jobs set status = 'expired', updated_at = now()
    where status = 'ready' and expires_at < now();
  get diagnostics export_count = row_count;
  return jsonb_build_object('operations_deleted', op_count, 'attachments_expired', attachment_count, 'exports_expired', export_count);
end;
$$;

do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.unschedule('buildtrack-notification-scheduler');
  exception when others then null;
  end;
  begin
    perform cron.schedule('buildtrack-notification-scheduler', '*/5 * * * *', 'select private.schedule_due_notifications()');
    perform cron.schedule('buildtrack-artifact-cleanup', '15 * * * *', 'select private.cleanup_operational_artifacts()');
  exception when others then null;
  end;
end $$;

commit;
