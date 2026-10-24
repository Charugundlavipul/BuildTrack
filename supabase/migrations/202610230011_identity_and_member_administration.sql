begin;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name, preferred_locale)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'BuildTrack user'),
    coalesce(nullif(new.raw_user_meta_data ->> 'preferred_locale', ''), 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

insert into public.profiles(id, display_name, preferred_locale)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1), 'BuildTrack user'),
  coalesce(nullif(u.raw_user_meta_data ->> 'preferred_locale', ''), 'en')
from auth.users u
on conflict (id) do nothing;

create or replace function public.update_my_profile(
  p_display_name text,
  p_preferred_locale text default 'en',
  p_timezone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.profiles;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authenticated identity required';
  end if;
  if length(trim(coalesce(p_display_name, ''))) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'display name must be between 2 and 120 characters';
  end if;
  if p_preferred_locale not in ('en') then
    raise exception using errcode = '22023', message = 'unsupported locale';
  end if;
  insert into public.profiles(id, display_name, preferred_locale, timezone)
  values (auth.uid(), trim(p_display_name), p_preferred_locale, nullif(trim(p_timezone), ''))
  on conflict (id) do update
    set display_name = excluded.display_name,
        preferred_locale = excluded.preferred_locale,
        timezone = excluded.timezone,
        updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.update_my_profile(text,text,text) from public, anon;
grant execute on function public.update_my_profile(text,text,text) to authenticated;

create or replace function public.current_access(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.active_member(p_organization_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'active membership required';
  end if;
  select jsonb_build_object(
    'organization_id', p_organization_id,
    'user_id', auth.uid(),
    'membership', jsonb_build_object('affiliation', m.affiliation, 'status', m.status),
    'profile', jsonb_build_object('display_name', p.display_name, 'preferred_locale', p.preferred_locale, 'timezone', p.timezone),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ra.id,
        'role_code', ra.role_code,
        'scope_kind', ra.scope_kind,
        'neighborhood_id', ra.neighborhood_id,
        'home_id', ra.home_id,
        'starts_at', ra.starts_at,
        'ends_at', ra.ends_at
      ) order by ra.role_code, ra.scope_kind, ra.neighborhood_id, ra.home_id)
      from public.role_assignments ra
      where ra.organization_id = p_organization_id and ra.user_id = auth.uid()
        and ra.revoked_at is null and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now())
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(permission_code order by permission_code)
      from (
        select distinct rp.permission_code
        from public.role_assignments ra
        join public.role_permissions rp on rp.role_code = ra.role_code
        where ra.organization_id = p_organization_id and ra.user_id = auth.uid()
          and ra.revoked_at is null and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now())
      ) permissions
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object('company_id', cm.company_id, 'kind', cm.kind) order by cm.company_id)
      from public.company_memberships cm
      where cm.organization_id = p_organization_id and cm.user_id = auth.uid()
        and cm.revoked_at is null and cm.active_from <= now() and (cm.active_to is null or cm.active_to > now())
    ), '[]'::jsonb)
  ) into result
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active';
  return result;
end;
$$;
revoke all on function public.current_access(uuid) from public, anon;
grant execute on function public.current_access(uuid) to authenticated;

create or replace function public.admin_list_members(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'access management permission required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'email', u.email,
    'display_name', p.display_name,
    'affiliation', m.affiliation,
    'status', m.status,
    'joined_at', m.joined_at,
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ra.id,
        'role_code', ra.role_code,
        'scope_kind', ra.scope_kind,
        'neighborhood_id', ra.neighborhood_id,
        'home_id', ra.home_id,
        'starts_at', ra.starts_at,
        'ends_at', ra.ends_at
      ) order by ra.role_code, ra.scope_kind)
      from public.role_assignments ra
      where ra.organization_id = m.organization_id and ra.user_id = m.user_id and ra.revoked_at is null
        and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now())
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object('company_id', cm.company_id, 'company_name', c.name, 'kind', cm.kind))
      from public.company_memberships cm
      join public.companies c on c.organization_id = cm.organization_id and c.id = cm.company_id
      where cm.organization_id = m.organization_id and cm.user_id = m.user_id and cm.revoked_at is null
        and cm.active_from <= now() and (cm.active_to is null or cm.active_to > now())
    ), '[]'::jsonb)
  ) order by p.display_name, u.email), '[]'::jsonb) into result
  from public.organization_memberships m
  join auth.users u on u.id = m.user_id
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id;
  return result;
end;
$$;
revoke all on function public.admin_list_members(uuid) from public, anon;
grant execute on function public.admin_list_members(uuid) to authenticated;

create or replace function public.admin_set_member_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_affiliation public.affiliation_kind,
  p_assignments jsonb,
  p_company_id uuid default null,
  p_company_kind text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment jsonb;
  role_row public.roles%rowtype;
  role_code text;
  requested_scope public.scope_kind;
  neighborhood_id uuid;
  home_id uuid;
  previous_access jsonb;
  new_access jsonb;
  retains_org_admin boolean := false;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) < 1 or jsonb_array_length(p_assignments) > 20 then
    raise exception using errcode = '22023', message = 'one to twenty role assignments are required';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '22023', message = 'identity does not exist';
  end if;
  if p_company_id is not null then
    if p_company_kind not in ('manager','technician') then
      raise exception using errcode = '22023', message = 'company kind must be manager or technician';
    end if;
    if not exists (select 1 from public.companies where organization_id = p_organization_id and id = p_company_id and status = 'active') then
      raise exception using errcode = '22023', message = 'company is unavailable';
    end if;
  elsif p_company_kind is not null then
    raise exception using errcode = '22023', message = 'company is required for company kind';
  end if;

  select jsonb_build_object(
    'membership', to_jsonb(m),
    'roles', coalesce((select jsonb_agg(to_jsonb(ra)) from public.role_assignments ra where ra.organization_id = p_organization_id and ra.user_id = p_user_id and ra.revoked_at is null), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(to_jsonb(cm)) from public.company_memberships cm where cm.organization_id = p_organization_id and cm.user_id = p_user_id and cm.revoked_at is null), '[]'::jsonb)
  ) into previous_access
  from public.organization_memberships m
  where m.organization_id = p_organization_id and m.user_id = p_user_id;

  insert into public.organization_memberships(organization_id, user_id, affiliation, status, joined_at)
  values (p_organization_id, p_user_id, p_affiliation, 'active', now())
  on conflict (organization_id, user_id) do update
    set affiliation = excluded.affiliation, status = 'active', joined_at = coalesce(public.organization_memberships.joined_at, now()), ended_at = null;

  for assignment in select value from jsonb_array_elements(p_assignments) loop
    role_code := nullif(assignment ->> 'role_code', '');
    requested_scope := nullif(assignment ->> 'scope_kind', '')::public.scope_kind;
    neighborhood_id := nullif(assignment ->> 'neighborhood_id', '')::uuid;
    home_id := nullif(assignment ->> 'home_id', '')::uuid;
    select * into role_row from public.roles where code = role_code;
    if not found or requested_scope is null or not (requested_scope = any(role_row.allowed_scope_kinds)) then
      raise exception using errcode = '22023', message = 'role and scope are incompatible';
    end if;
    if (requested_scope = 'organization' and (neighborhood_id is not null or home_id is not null))
      or (requested_scope = 'neighborhood' and (neighborhood_id is null or home_id is not null))
      or (requested_scope = 'home' and (neighborhood_id is null or home_id is null)) then
      raise exception using errcode = '22023', message = 'invalid role scope identifiers';
    end if;
    if neighborhood_id is not null and not exists (
      select 1 from public.neighborhoods where organization_id = p_organization_id and id = neighborhood_id and status = 'active'
    ) then raise exception using errcode = '22023', message = 'neighborhood is unavailable'; end if;
    if home_id is not null and not exists (
      select 1 from public.homes where organization_id = p_organization_id and neighborhood_id = neighborhood_id and id = home_id and archived_at is null
    ) then raise exception using errcode = '22023', message = 'home is unavailable'; end if;
    if role_code in ('trade_manager','trade_technician') and p_company_id is null then
      raise exception using errcode = '22023', message = 'trade roles require a company association';
    end if;
    if role_code = 'org_admin' and requested_scope = 'organization' then retains_org_admin := true; end if;
  end loop;

  if not retains_org_admin and exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = p_organization_id and ra.user_id = p_user_id and ra.role_code = 'org_admin'
      and ra.revoked_at is null and ra.starts_at <= now() and (ra.ends_at is null or ra.ends_at > now())
  ) and not exists (
    select 1 from public.role_assignments other
    join public.organization_memberships om on om.organization_id = other.organization_id and om.user_id = other.user_id and om.status = 'active'
    where other.organization_id = p_organization_id and other.user_id <> p_user_id and other.role_code = 'org_admin'
      and other.revoked_at is null and other.starts_at <= now() and (other.ends_at is null or other.ends_at > now())
  ) then
    raise exception using errcode = '23514', message = 'cannot remove the last active organization administrator';
  end if;

  update public.role_assignments set revoked_at = now()
  where organization_id = p_organization_id and user_id = p_user_id and revoked_at is null;
  update public.company_memberships set revoked_at = now()
  where organization_id = p_organization_id and user_id = p_user_id and revoked_at is null;

  for assignment in select value from jsonb_array_elements(p_assignments) loop
    insert into public.role_assignments(
      organization_id, user_id, role_code, scope_kind, neighborhood_id, home_id, starts_at, ends_at, granted_by
    ) values (
      p_organization_id,
      p_user_id,
      assignment ->> 'role_code',
      (assignment ->> 'scope_kind')::public.scope_kind,
      nullif(assignment ->> 'neighborhood_id', '')::uuid,
      nullif(assignment ->> 'home_id', '')::uuid,
      coalesce(nullif(assignment ->> 'starts_at', '')::timestamptz, now()),
      nullif(assignment ->> 'ends_at', '')::timestamptz,
      auth.uid()
    );
  end loop;
  if p_company_id is not null then
    insert into public.company_memberships(organization_id, company_id, user_id, kind)
    values (p_organization_id, p_company_id, p_user_id, p_company_kind);
  end if;

  select jsonb_build_object(
    'membership', to_jsonb(m),
    'roles', coalesce((select jsonb_agg(to_jsonb(ra)) from public.role_assignments ra where ra.organization_id = p_organization_id and ra.user_id = p_user_id and ra.revoked_at is null), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(to_jsonb(cm)) from public.company_memberships cm where cm.organization_id = p_organization_id and cm.user_id = p_user_id and cm.revoked_at is null), '[]'::jsonb)
  ) into new_access
  from public.organization_memberships m
  where m.organization_id = p_organization_id and m.user_id = p_user_id;
  perform private.append_audit(p_organization_id, auth.uid(), 'membership.access_changed', 'user', p_user_id, null, previous_access, new_access);
  return new_access;
end;
$$;
revoke all on function public.admin_set_member_access(uuid,uuid,public.affiliation_kind,jsonb,uuid,text) from public, anon;
grant execute on function public.admin_set_member_access(uuid,uuid,public.affiliation_kind,jsonb,uuid,text) to authenticated;

create or replace function public.admin_list_invitations(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'access management permission required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'email', i.normalized_email, 'status', i.status, 'expires_at', i.expires_at,
    'created_at', i.created_at, 'delivery_error', i.delivery_error,
    'membership', i.proposed_membership, 'grants', i.proposed_grants, 'company_id', i.proposed_company_id
  ) order by i.created_at desc), '[]'::jsonb) into result
  from public.invites i where i.organization_id = p_organization_id;
  return result;
end;
$$;
revoke all on function public.admin_list_invitations(uuid) from public, anon;
grant execute on function public.admin_list_invitations(uuid) to authenticated;

create or replace function public.admin_revoke_invitation(p_organization_id uuid, p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result public.invites;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
  end if;
  update public.invites set status = 'revoked'
  where organization_id = p_organization_id and id = p_invitation_id and status = 'pending'
  returning * into result;
  if not found then raise exception using errcode = '02000', message = 'pending invitation not found'; end if;
  perform private.append_audit(p_organization_id, auth.uid(), 'invitation.revoked', 'invite', p_invitation_id, null, null, null);
  return jsonb_build_object('id', result.id, 'status', result.status);
end;
$$;
revoke all on function public.admin_revoke_invitation(uuid,uuid) from public, anon;
grant execute on function public.admin_revoke_invitation(uuid,uuid) to authenticated;

commit;
