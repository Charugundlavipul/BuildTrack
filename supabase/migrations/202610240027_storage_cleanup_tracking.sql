begin;

alter table public.attachments add column storage_deleted_at timestamptz;
alter table public.export_jobs add column storage_deleted_at timestamptz;

commit;
