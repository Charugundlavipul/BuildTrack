begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select extensions.is((select count(*)::bigint from public.work_items w where w.organization_id is null), 0::bigint, 'I01 tenant rows require organization');
select extensions.is((select count(*)::bigint from public.assignment_episodes ae where (ae.internal_assignee_user_id is not null)::int + (ae.company_id is not null)::int <> 1), 0::bigint, 'I04 exactly one accountable party');
select extensions.ok(not exists(select 1 from public.assignment_episodes ae where ae.ended_at is null group by ae.work_item_id having count(*) > 1), 'I04 one open assignment episode');
select extensions.ok(not exists(select 1 from public.verifications v left join public.correction_attempts ca on ca.id = v.correction_attempt_id and ca.organization_id = v.organization_id where ca.id is null), 'I06 every verification belongs to an attempt in the same organization');
select extensions.has_index('public','assignment_episodes','assignment_episodes_one_open','CON01 open assignment has a partial unique index');
select extensions.has_index('public','milestone_approvals','milestone_approvals_one_active','CON05 milestone approval has a partial unique index');
select extensions.ok(not exists(select 1 from public.notification_outbox group by organization_id,dedupe_key having count(*) > 1), 'NOT01 outbox dedupe keys are unique');
select extensions.ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='role'), 'FR02 profiles have no global role');

select * from extensions.finish();
rollback;
