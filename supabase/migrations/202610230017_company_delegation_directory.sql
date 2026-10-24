begin;

create or replace function public.company_delegation_options(p_organization_id uuid,p_work_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare episode public.assignment_episodes; result jsonb;
begin
  if auth.uid() is null or not private.active_member(p_organization_id,auth.uid()) then return null; end if;
  select ae.* into episode
  from public.work_items w
  join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id and ae.ended_at is null
  where w.organization_id=p_organization_id and w.id=p_work_item_id;
  if not found or episode.company_id is null or not private.active_company_membership(p_organization_id,episode.company_id,auth.uid(),'manager') then return null; end if;
  select jsonb_build_object(
    'company_id',episode.company_id,
    'current_technician_id',episode.technician_user_id,
    'technicians',coalesce(jsonb_agg(jsonb_build_object('user_id',cm.user_id,'display_name',p.display_name) order by p.display_name) filter(where cm.user_id is not null),'[]'::jsonb)
  ) into result
  from public.company_memberships cm
  join public.organization_memberships om on om.organization_id=cm.organization_id and om.user_id=cm.user_id and om.status='active'
  join public.profiles p on p.id=cm.user_id
  where cm.organization_id=p_organization_id and cm.company_id=episode.company_id and cm.kind='technician'
    and cm.revoked_at is null and cm.active_from<=now() and (cm.active_to is null or cm.active_to>now());
  return result;
end; $$;
revoke all on function public.company_delegation_options(uuid,uuid) from public,anon;
grant execute on function public.company_delegation_options(uuid,uuid) to authenticated;

commit;
