begin;
do $$
begin
 if exists(select 1 from public.space_types s where s.active and not exists(
  select 1 from public.checklist_templates t join public.checklist_versions v on v.template_id=t.id and v.organization_id=t.organization_id
  where t.organization_id='e46a5e61-db90-4053-b92d-defd077839eb' and t.active and t.snapshot_home_id is null and t.name=s.label
   and v.published_at is not null and exists(select 1 from public.checklist_questions q where q.organization_id=v.organization_id and q.version_id=v.id))) then
  raise exception 'An active space type is missing a published, nonempty checklist category';
 end if;
 if exists(select 1 from public.checklist_questions q join public.checklist_versions v on v.id=q.version_id join public.checklist_templates t on t.id=v.template_id
  where t.organization_id='e46a5e61-db90-4053-b92d-defd077839eb' and t.snapshot_home_id is null
  group by q.version_id having min(q.ordinal)<>1 or max(q.ordinal)<>count(*)) then
  raise exception 'Checklist item ordering is incomplete';
 end if;
 if exists(select 1 from public.checklist_templates where organization_id='e46a5e61-db90-4053-b92d-defd077839eb' and active and snapshot_home_id is null group by lower(trim(name)) having count(*)>1) then
  raise exception 'Duplicate active checklist category names';
 end if;
end; $$;
-- Verify that published categories are visible to the owning administrator
-- through the same RLS-protected tables the plan editor reads.
select set_config('request.jwt.claims',jsonb_build_object('sub',(
 select v.created_by from public.checklist_versions v join public.checklist_templates t on t.id=v.template_id
 where t.organization_id='e46a5e61-db90-4053-b92d-defd077839eb' and t.snapshot_home_id is null and v.published_at is not null limit 1
),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
select (select count(*) from public.space_types where active) as active_space_types,
 (select count(*) from public.checklist_templates where organization_id='e46a5e61-db90-4053-b92d-defd077839eb' and active and snapshot_home_id is null) as checklist_categories,
 (select count(*) from public.checklist_versions v join public.checklist_templates t on t.id=v.template_id where t.organization_id='e46a5e61-db90-4053-b92d-defd077839eb' and t.active and t.snapshot_home_id is null and v.published_at is not null) as published_versions,
 (select count(*) from public.checklist_questions q join public.checklist_versions v on v.id=q.version_id join public.checklist_templates t on t.id=v.template_id where t.organization_id='e46a5e61-db90-4053-b92d-defd077839eb' and t.active and t.snapshot_home_id is null) as checklist_items;
rollback;
