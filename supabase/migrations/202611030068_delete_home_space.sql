begin;

create or replace function public.delete_home_space(p_org uuid, p_id uuid, p_home uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result public.home_locations;
  h public.homes;
begin
  if not private.require_aal2() then
    raise insufficient_privilege using message='MFA verification is required.';
  end if;

  select * into h from public.homes
  where organization_id=p_org and id=p_home;

  if not found or not private.has_permission(p_org,auth.uid(),'structure.manage',h.neighborhood_id,h.id) then
    raise insufficient_privilege using message='Home management permission is required for this property.';
  end if;

  select * into result from public.home_locations
  where organization_id=p_org and home_id=p_home and id=p_id for update;

  if not found then
    raise check_violation using message='Location was not found.';
  end if;

  if exists(select 1 from public.home_locations where organization_id=p_org and home_id=p_home and parent_location_id=p_id) then
    raise check_violation using message='Remove or reassign sub-areas before deleting this location.';
  end if;

  if exists(select 1 from public.work_items where organization_id=p_org and home_id=p_home and location_id=p_id)
     or exists(select 1 from public.inspection_observations where organization_id=p_org and home_id=p_home and location_id=p_id) then
    raise check_violation using message='This location has recorded work items or inspection findings. Mark it inactive instead of deleting.';
  end if;

  delete from public.home_locations where organization_id=p_org and home_id=p_home and id=p_id;

  perform private.append_audit(p_org,auth.uid(),'home_location.deleted','home_location',p_id,null,to_jsonb(result),null);

  return to_jsonb(result);
end; $$;

revoke all on function public.delete_home_space(uuid,uuid,uuid) from public,anon;
grant execute on function public.delete_home_space(uuid,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
