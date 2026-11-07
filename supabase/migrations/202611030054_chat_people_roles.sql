begin;

create or replace function public.project_chat_people(p_org uuid, p_audience text default 'partners')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.active_member(p_org, auth.uid()) then
    raise insufficient_privilege using message = 'Active organization membership is required.';
  end if;
  if p_audience is null or p_audience not in ('partners', 'internal')
    or (p_audience = 'internal' and not private.is_internal_member(p_org, auth.uid())) then
    raise insufficient_privilege using message = 'Internal conversations are limited to the internal team.';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', p.id,
          'display_name', p.display_name,
          'affiliation', m.affiliation,
          'role_label', coalesce(
            (
              select string_agg(distinct r.label, ', ' order by r.label)
              from public.role_assignments ra
              join public.roles r on r.code = ra.role_code
              where ra.organization_id = p_org
                and ra.user_id = m.user_id
                and ra.revoked_at is null
                and ra.starts_at <= now()
                and (ra.ends_at is null or ra.ends_at > now())
                and private.role_grant_enabled(ra)
            ),
            case when m.affiliation = 'external' then 'External partner' else 'Team member' end
          )
        )
        order by p.display_name, p.id
      ),
      '[]'::jsonb
    )
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org
      and m.user_id <> auth.uid()
      and private.active_member(p_org, m.user_id)
      and (p_audience <> 'internal' or private.is_internal_member(p_org, m.user_id))
  );
end; $$;

revoke all on function public.project_chat_people(uuid, text) from public, anon;
grant execute on function public.project_chat_people(uuid, text) to authenticated;

commit;

