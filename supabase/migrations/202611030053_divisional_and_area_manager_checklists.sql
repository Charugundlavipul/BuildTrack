begin;

-- Grant config.manage to division_admin (Divisional Admin) and neighborhood_admin (Area Construction Manager)
insert into public.role_permissions(role_code, permission_code) values
  ('division_admin', 'config.manage'),
  ('neighborhood_admin', 'config.manage')
on conflict do nothing;

-- Update role descriptions to reflect checklist & standards configuration capabilities
update public.roles
set description = 'Manage users, neighborhoods, vendors, checklists, and operations inside assigned divisions.'
where code = 'division_admin';

update public.roles
set description = 'Neighborhood administrator: onboard lots and customize copied plans, configure checklists, assign inspectors, manage local users and vendors, and review escalations.'
where code = 'neighborhood_admin';

-- Update private.require_admin_permission so that any active member holding an enabled role assignment
-- with the required administrative permission (including scoped to division or neighborhood) can execute the admin RPCs.
create or replace function private.require_admin_permission(p_organization_id uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.require_aal2() or not (
    private.has_permission(p_organization_id, auth.uid(), p_permission, null, null)
    or exists (
      select 1 from public.role_assignments a
      join public.role_permissions rp on rp.role_code = a.role_code and rp.permission_code = p_permission
      where a.organization_id = p_organization_id
        and a.user_id = auth.uid()
        and private.role_grant_enabled(a)
        and a.revoked_at is null
        and a.starts_at <= now()
        and (a.ends_at is null or a.ends_at > now())
    )
  ) then
    raise exception using errcode = '42501', message = 'elevated administrative permission required';
  end if;
end;
$$;

-- Update save_role_definition so config.manage is allowed for organization, division, or neighborhood scopes
create or replace function public.save_role_definition(
  p_organization_id uuid,
  p_code text,
  p_label text,
  p_description text,
  p_scopes public.scope_kind[],
  p_permissions text[],
  p_active boolean,
  p_default boolean,
  p_requires_company boolean,
  p_expected_version bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; previous public.roles; result public.roles;
begin
  if p_organization_id is null then
    raise exception using errcode = '42501', message = 'organization access management permission required';
  end if;
  perform private.require_admin_permission(p_organization_id, 'access.manage');
  perform 1 from public.organizations where id = p_organization_id for update;
  if length(trim(coalesce(p_label, ''))) not between 2 and 120 or length(coalesce(p_description, '')) > 2000 or coalesce(cardinality(p_scopes), 0) < 1
    or coalesce(cardinality(p_permissions), 0) < 1 or cardinality(p_permissions) > 30
    or exists(select 1 from unnest(p_permissions) v where not exists(select 1 from public.permissions where code = v)) then
    raise exception using errcode = '22023', message = 'a role needs a name, valid scopes, and at least one catalog permission';
  end if;
  if 'config.manage' = any(p_permissions) and (not (p_scopes <@ array['organization', 'division', 'neighborhood']::public.scope_kind[]) or p_requires_company) then
    raise exception using errcode = '22023', message = 'configuration management requires organization, division, or neighborhood scope';
  end if;
  if p_permissions && array['structure.manage', 'access.manage', 'roster.manage'] and
    (not (p_scopes <@ array['organization', 'division', 'neighborhood']::public.scope_kind[]) or p_requires_company) then
    raise exception using errcode = '22023', message = 'builder administration requires organization, division, or neighborhood scope';
  end if;
  if 'company' = any(p_scopes) and not (p_permissions <@ array['company.users.manage', 'work.execute_assigned', 'comment.create_shared', 'evidence.upload', 'inspection.perform', 'inspection.findings.create']) then
    raise exception using errcode = '22023', message = 'company scope supports only company users and assigned-work permissions';
  end if;
  if 'company.users.manage' = any(p_permissions) and not ('access.manage' = any(p_permissions)) and (not p_requires_company or p_scopes <> array['company']::public.scope_kind[]) then
    raise exception using errcode = '22023', message = 'vendor user administration requires company-only scope';
  end if;
  if p_code is not null then
    select * into previous from public.roles where roles.code = p_code for update;
    if not found or previous.organization_id is distinct from p_organization_id then
      raise exception using errcode = '42501', message = 'this role belongs to a different catalog';
    end if;
    if previous.version is distinct from p_expected_version then
      raise exception using errcode = '40001', message = 'role changed; reload before saving';
    end if;
    if exists(select 1 from public.role_assignments where role_code = p_code and revoked_at is null and (ends_at is null or ends_at > now()) and not (scope_kind = any(p_scopes))) then
      raise exception using errcode = '23514', message = 'reassign existing grants before removing their allowed scope';
    end if;
    v_code := p_code;
    update public.roles r set label = trim(p_label), description = trim(p_description), allowed_scope_kinds = p_scopes,
      active = p_active, default_for_new_organizations = false, requires_company = p_requires_company,
      version = r.version + 1, updated_at = now() where r.code = p_code returning * into result;
    delete from public.role_permissions where role_code = p_code;
  else
    v_code := 'custom_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.roles(code, label, description, allowed_scope_kinds, organization_id, active, default_for_new_organizations, requires_company, immutable_seed)
      values(v_code, trim(p_label), trim(p_description), p_scopes, p_organization_id, p_active, false, p_requires_company, false) returning * into result;
    insert into public.organization_roles(organization_id, role_code) values(p_organization_id, v_code);
  end if;
  insert into public.role_permissions(role_code, permission_code) select v_code, v from (select distinct unnest(p_permissions) v) p;
  perform private.append_audit(p_organization_id, auth.uid(), 'role.saved', 'role', null, null, to_jsonb(previous), to_jsonb(result), jsonb_build_object('code', v_code, 'permissions', p_permissions));
  return to_jsonb(result);
end; $$;

commit;

