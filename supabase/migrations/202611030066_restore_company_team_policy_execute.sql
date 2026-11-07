begin;

-- company_memberships_scoped_select evaluates this predicate as the querying
-- authenticated user. The function is security definer and returns only a
-- boolean, so expose EXECUTE without exposing its underlying tables.
grant execute on function private.company_team_visible(uuid,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
