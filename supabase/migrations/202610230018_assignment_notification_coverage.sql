begin;

create or replace function private.enqueue_assignment_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid; channel_name text;
begin
  if tg_op='UPDATE' and new.technician_user_id is not distinct from old.technician_user_id then return new; end if;
  if tg_op='UPDATE' and old.technician_user_id is not null then
    update public.notification_outbox set status='cancelled',updated_at=now()
      where organization_id=new.organization_id and assignment_episode_id=new.id and recipient_user_id=old.technician_user_id and status in ('pending','failed','leased');
    update public.notifications set invalidated_at=now()
      where organization_id=new.organization_id and work_item_id=new.work_item_id and recipient_user_id=old.technician_user_id and invalidated_at is null;
  end if;

  for recipient,channel_name in
    select recipient_id,channel from (
      select new.internal_assignee_user_id recipient_id,'email'::text channel where tg_op='INSERT' and new.internal_assignee_user_id is not null
      union
      select cm.user_id,v.channel from public.company_memberships cm cross join(values('in_app'::text),('email'::text)) v(channel)
        where tg_op='INSERT' and new.company_id is not null and cm.organization_id=new.organization_id and cm.company_id=new.company_id and cm.kind='manager'
          and cm.revoked_at is null and cm.active_from<=now() and (cm.active_to is null or cm.active_to>now())
      union
      select new.technician_user_id,v.channel from (values('in_app'::text),('email'::text)) v(channel) where new.technician_user_id is not null
    ) recipients where recipient_id is not null
  loop
    insert into public.notification_outbox(organization_id,recipient_user_id,work_item_id,assignment_episode_id,channel,dedupe_key,template_key,payload)
      values(new.organization_id,recipient,new.work_item_id,new.id,channel_name,'assignment:'||new.id||':'||channel_name||':'||recipient,'work_assigned',jsonb_build_object('work_item_id',new.work_item_id))
      on conflict(organization_id,dedupe_key) do nothing;
  end loop;
  return new;
end; $$;

drop trigger if exists assignment_episode_notifications on public.assignment_episodes;
create trigger assignment_episode_notifications
after insert or update of technician_user_id on public.assignment_episodes
for each row execute function private.enqueue_assignment_notifications();

commit;
