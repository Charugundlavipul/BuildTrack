begin;

-- Grant execute privilege on private.can_view_profile so authenticated users can evaluate the RLS policy on public.profiles
grant execute on function private.can_view_profile(uuid, uuid) to authenticated;

commit;

