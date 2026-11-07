begin;

drop function if exists public.inspection_lead_options(uuid, uuid);
create function public.inspection_lead_options(p_organization_id uuid, p_home_id uuid)
returns table(user_id uuid, display_name text, role_label text)
language plpgsql stable security definer set search_path = '' as $$
declare
  neighborhood uuid;
begin
  select h.neighborhood_id into neighborhood
  from public.homes h
  where h.organization_id = p_organization_id and h.id = p_home_id and h.archived_at is null;

  if not found or not private.has_permission(p_organization_id, auth.uid(), 'inspection.manage', neighborhood, p_home_id) then
    raise exception using errcode = '42501', message = 'inspection management permission is required for this home';
  end if;

  return query
  select m.user_id, p.display_name, coalesce(relevant_role.label, 'Inspector')
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  left join lateral (
    select r.label
    from public.role_assignments a
    join public.roles r on r.code = a.role_code
    where a.organization_id = p_organization_id
      and a.user_id = m.user_id
      and private.role_grant_enabled(a)
      and a.revoked_at is null
      and a.starts_at <= now()
      and (a.ends_at is null or a.ends_at > now())
      and exists (
        select 1 from public.role_permissions rp
        where rp.role_code = a.role_code
          and rp.permission_code in ('inspection.perform', 'inspection.manage')
      )
      and (
        (a.scope_kind <> 'company' and private.scope_contains(
          p_organization_id, a.scope_kind, a.division_id, a.neighborhood_id, a.home_id,
          'home'::public.scope_kind, null, neighborhood, p_home_id
        ))
        or (a.scope_kind = 'company' and private.company_covers(p_organization_id, a.company_id, neighborhood))
      )
    order by
      (a.role_code = 'inspector') desc,
      case a.scope_kind when 'home' then 4 when 'neighborhood' then 3 when 'division' then 2 when 'organization' then 1 else 0 end desc,
      a.authority_level,
      r.label
    limit 1
  ) relevant_role on true
  where m.organization_id = p_organization_id and m.status = 'active' and (
    private.has_permission(p_organization_id, m.user_id, 'inspection.perform', neighborhood, p_home_id)
    or private.has_permission(p_organization_id, m.user_id, 'inspection.manage', neighborhood, p_home_id)
    or exists (
      select 1 from public.inspection_engagements e
      where e.organization_id = p_organization_id
        and e.home_id = p_home_id
        and e.inspector_user_id = m.user_id
        and e.revoked_at is null
        and e.starts_at <= now()
        and e.ends_at > now()
    )
  )
  order by p.display_name, m.user_id;
end; $$;

revoke all on function public.inspection_lead_options(uuid, uuid) from public, anon;
grant execute on function public.inspection_lead_options(uuid, uuid) to authenticated;

commit;
