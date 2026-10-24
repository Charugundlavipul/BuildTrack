begin;

alter table public.notifications add column outbox_id uuid;
alter table public.notifications add constraint notifications_outbox_fk
  foreign key(organization_id,outbox_id) references public.notification_outbox(organization_id,id) on delete restrict;
create unique index notifications_one_per_outbox on public.notifications(organization_id,outbox_id) where outbox_id is not null;

commit;
