begin;

-- Edge Functions use the service role only for trusted server-side work.
-- RLS bypass does not itself confer table privileges, so grant the internal
-- role DML access without changing anon/authenticated client permissions.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

commit;
