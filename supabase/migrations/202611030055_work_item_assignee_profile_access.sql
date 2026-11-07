begin;

-- Allow users to view profiles of other members in the organizations they share
create or replace function private.can_view_profile(p_viewer_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer_id = p_profile_id
  or exists (
    select 1
    from public.organization_memberships m1
    join public.organization_memberships m2 on m2.organization_id = m1.organization_id
    where m1.user_id = p_viewer_id
      and m2.user_id = p_profile_id
  );
$$;

revoke all on function private.can_view_profile(uuid, uuid) from public, anon, authenticated;

drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_org_members_select on public.profiles;

create policy profiles_org_members_select on public.profiles
for select to authenticated using (
  private.can_view_profile(auth.uid(), id)
);

commit;

