begin;

create or replace function public.run_scheduled_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  return private.cleanup_operational_artifacts();
end;
$$;
revoke all on function public.run_scheduled_cleanup() from public, anon, authenticated;
grant execute on function public.run_scheduled_cleanup() to service_role;

create or replace function public.run_notification_scheduler()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  return private.schedule_due_notifications();
end;
$$;
revoke all on function public.run_notification_scheduler() from public, anon, authenticated;
grant execute on function public.run_notification_scheduler() to service_role;

commit;
