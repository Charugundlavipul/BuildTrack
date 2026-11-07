begin;

-- Revocation must remain possible after a home is archived or a member is suspended.
-- Restoring access still goes through admin_save_inspector_engagement validation.
create or replace function public.admin_revoke_inspector_engagement(p_organization_id uuid, p_id uuid)
returns public.inspection_engagements
language plpgsql security definer set search_path = '' as $$
declare result public.inspection_engagements; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id, 'config.manage');
  select to_jsonb(e) into before_row from public.inspection_engagements e
    where e.organization_id = p_organization_id and e.id = p_id for update;
  if not found then raise exception using errcode = '02000', message = 'inspector engagement not found'; end if;
  update public.inspection_engagements set revoked_at = coalesce(revoked_at, now())
    where organization_id = p_organization_id and id = p_id returning * into result;
  perform private.append_audit(p_organization_id, auth.uid(), 'inspector_engagement.revoked', 'inspection_engagement', result.id, null, before_row, to_jsonb(result));
  return result;
end; $$;
revoke all on function public.admin_revoke_inspector_engagement(uuid, uuid) from public, anon;
grant execute on function public.admin_revoke_inspector_engagement(uuid, uuid) to authenticated;

create or replace function public.inspection_lead_options(p_organization_id uuid, p_home_id uuid)
returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
declare neighborhood uuid;
begin
  select h.neighborhood_id into neighborhood from public.homes h
    where h.organization_id = p_organization_id and h.id = p_home_id and h.archived_at is null;
  if not found or not private.has_permission(p_organization_id, auth.uid(), 'inspection.manage', neighborhood, p_home_id) then
    raise exception using errcode = '42501', message = 'inspection management permission is required for this home';
  end if;
  return query select m.user_id, p.display_name from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_organization_id and m.status = 'active' and (
      private.has_permission(p_organization_id, m.user_id, 'inspection.perform', neighborhood, p_home_id)
      or private.has_permission(p_organization_id, m.user_id, 'inspection.manage', neighborhood, p_home_id)
      or exists (select 1 from public.inspection_engagements e where e.organization_id = p_organization_id
        and e.home_id = p_home_id and e.inspector_user_id = m.user_id and e.revoked_at is null
        and e.starts_at <= now() and e.ends_at > now())
    ) order by p.display_name, m.user_id;
end; $$;
revoke all on function public.inspection_lead_options(uuid, uuid) from public, anon;
grant execute on function public.inspection_lead_options(uuid, uuid) to authenticated;

commit;
