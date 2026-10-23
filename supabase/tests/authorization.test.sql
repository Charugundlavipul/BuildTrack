begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select extensions.ok((select relrowsecurity from pg_class where oid = 'public.work_items'::regclass), 'SEC01 work_items has RLS');
select extensions.ok((select relrowsecurity from pg_class where oid = 'public.attachments'::regclass), 'SEC08 attachments has RLS');
select extensions.ok((select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass), 'SEC09 audit_events has RLS');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}', true);
select extensions.is((select count(*)::bigint from public.organizations), 1::bigint, 'SEC01 superintendent sees only tenant A');
select extensions.is((select count(*)::bigint from public.neighborhoods), 2::bigint, 'SEC02 neighborhood grants include only assigned neighborhoods');
select extensions.is((select count(*)::bigint from public.work_items), 4::bigint, 'SEC02 scoped superintendent sees tenant A work');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}', true);
select extensions.is((select count(*)::bigint from public.homes), 1::bigint, 'SEC02 home-only contributor cannot read sibling homes');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal1"}', true);
select extensions.is((select count(*)::bigint from public.comments where visibility = 'internal'), 0::bigint, 'SEC03 external inspector cannot read internal comments');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal1"}', true);
select extensions.is((select count(*)::bigint from public.work_items), 2::bigint, 'SEC04 trade manager reads own company current items only');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal1"}', true);
select extensions.is((select count(*)::bigint from public.work_items), 2::bigint, 'SEC04 technician reads individually assigned items only');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000010","role":"authenticated","aal":"aal1"}', true);
select extensions.is((select count(*)::bigint from public.work_items), 0::bigint, 'SEC05 suspended member has no work access');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000009","role":"authenticated","aal":"aal1"}', true);
reset role;
select extensions.ok(not private.can_verify('10000000-0000-0000-0000-000000000009','72000000-0000-0000-0000-000000000001'), 'SEC07 same-company verifier is denied');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}', true);
reset role;
select extensions.ok(private.can_verify('10000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001'), 'SEC07 independent verifier is allowed');

set local role authenticated;
select extensions.throws_ok(
  $$update public.work_items set state = 'verified' where id = '70000000-0000-0000-0000-000000000001'$$,
  '42501',
  'SEC09 direct lifecycle update is denied'
);

select * from extensions.finish();
rollback;
