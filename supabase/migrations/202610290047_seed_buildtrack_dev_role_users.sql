-- Seed test users for remaining roles in BuildTrack Development when present.

begin;

do $$
declare
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  v_org_id uuid := 'e46a5e61-db90-4053-b92d-defd077839eb';
  v_grantor_id uuid := '3c1cd17d-4431-46e5-b63d-4e478cbc3bf6';
  v_division_id uuid := '4a3f4495-d014-4bbb-bf0e-e28e351c35c5';
  v_neighborhood_id uuid := '23fbb143-254c-472f-9c1c-37f50f6ac8c8';
  v_home_id uuid := '753b91ef-781f-41a9-ac06-bd6c8b9ea91b';
  v_company_id uuid := '50000000-0000-4000-8000-000000000101';
  v_specialty_id uuid := '51000000-0000-4000-8000-000000000101';
  v_work_item_id uuid := '70000000-0000-4000-8000-000000000101';
  v_episode_id uuid := '71000000-0000-4000-8000-000000000101';
  v_user record;
  v_dev_password text := nullif(current_setting('buildtrack.dev_seed_password', true), '');
begin
  -- Development fixtures require an explicit per-session password. Existing
  -- installations are unaffected; this prevents future automatic shared logins.
  if v_dev_password is null then return; end if;
  if length(v_dev_password)<12 then raise check_violation using message='Choose a development seed password of at least 12 characters.'; end if;
  if not exists (select 1 from public.organizations where id = v_org_id) then
    return;
  end if;

  -- Ensure all available shared roles are enabled for BuildTrack Development
  insert into public.organization_roles (organization_id, role_code, enabled)
  select v_org_id, r.code, true
  from public.roles r
  where r.organization_id is null
    and r.active
    and r.release_state = 'available'
  on conflict (organization_id, role_code) do update
    set enabled = true;

  -- Create auth users, identities, and completed profiles
  for v_user in
    select * from (values
      ('10000000-0000-4000-8000-000000000101'::uuid, 'division.admin@buildtrack.test', 'Devon Division Admin', 'Devon', 'Division Admin', 'internal'::public.affiliation_kind),
      ('10000000-0000-4000-8000-000000000102'::uuid, 'area.manager@buildtrack.test', 'Morgan Area Manager', 'Morgan', 'Area Manager', 'internal'::public.affiliation_kind),
      ('10000000-0000-4000-8000-000000000103'::uuid, 'contributor@buildtrack.test', 'Casey Contributor', 'Casey', 'Contributor', 'internal'::public.affiliation_kind),
      ('10000000-0000-4000-8000-000000000104'::uuid, 'inspector@buildtrack.test', 'Elliot Inspector', 'Elliot', 'Inspector', 'internal'::public.affiliation_kind),
      ('10000000-0000-4000-8000-000000000105'::uuid, 'vendor.admin@buildtrack.test', 'Victor Vendor Admin', 'Victor', 'Vendor Admin', 'external'::public.affiliation_kind),
      ('10000000-0000-4000-8000-000000000106'::uuid, 'vendor.tech@buildtrack.test', 'Taylor Vendor Tech', 'Taylor', 'Vendor Tech', 'external'::public.affiliation_kind)
    ) as t(id, email, display_name, first_name, last_name, affiliation)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, email_change, email_change_token_new, recovery_token
    )
    values (
      v_instance,
      v_user.id,
      'authenticated',
      'authenticated',
      v_user.email,
      extensions.crypt(v_dev_password, extensions.gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', v_user.display_name),
      false,
      '', '', '', ''
    )
    on conflict (id) do update
      set email = excluded.email,
          email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
          raw_user_meta_data = excluded.raw_user_meta_data,
          updated_at = now();

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    values (
      v_user.id,
      v_user.id,
      v_user.id::text,
      jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true, 'phone_verified', false),
      'email',
      now(),
      now(),
      now()
    )
    on conflict (id) do update
      set identity_data = excluded.identity_data,
          updated_at = now();

    insert into public.profiles (
      id, display_name, first_name, last_name, completed_at, preferred_locale, timezone
    )
    values (
      v_user.id,
      v_user.display_name,
      v_user.first_name,
      v_user.last_name,
      now(),
      'en',
      'America/New_York'
    )
    on conflict (id) do update
      set display_name = excluded.display_name,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          completed_at = coalesce(public.profiles.completed_at, excluded.completed_at),
          updated_at = now();

    insert into public.organization_memberships (
      organization_id, user_id, affiliation, status, joined_at
    )
    values (
      v_org_id,
      v_user.id,
      v_user.affiliation,
      'active',
      now()
    )
    on conflict (organization_id, user_id) do update
      set affiliation = excluded.affiliation,
          status = 'active',
          ended_at = null;
  end loop;

  -- Create active vendor company and coverage for BuildTrack Development
  insert into public.companies (
    id, organization_id, name, external_vendor_reference, status, owner_scope_kind, owner_authority_level, created_by
  )
  values (
    v_company_id, v_org_id, 'Apex Trade Partners', 'VND-APEX-01', 'active', 'organization', 1, v_grantor_id
  )
  on conflict (organization_id, name) do update
    set status = 'active',
        updated_at = now()
  returning id into v_company_id;

  insert into public.company_access_grants (
    organization_id, company_id, scope_kind, authority_level, granted_by
  )
  select v_org_id, v_company_id, 'organization', 1, v_grantor_id
  where not exists (
    select 1 from public.company_access_grants g
    where g.organization_id = v_org_id
      and g.company_id = v_company_id
      and g.scope_kind = 'organization'
      and g.revoked_at is null
  );

  -- Company memberships for Vendor Manager (vendor_admin) and Vendor Tradesman (trade_technician)
  insert into public.company_memberships (
    organization_id, company_id, user_id, kind, granted_by, authority_level
  )
  select v_org_id, v_company_id, '10000000-0000-4000-8000-000000000105'::uuid, 'manager', v_grantor_id, 1
  where not exists (
    select 1 from public.company_memberships cm
    where cm.organization_id = v_org_id
      and cm.company_id = v_company_id
      and cm.user_id = '10000000-0000-4000-8000-000000000105'::uuid
      and cm.revoked_at is null
      and cm.active_to is null
  );

  insert into public.company_memberships (
    organization_id, company_id, user_id, kind, granted_by, authority_level
  )
  select v_org_id, v_company_id, '10000000-0000-4000-8000-000000000106'::uuid, 'technician', v_grantor_id, 1
  where not exists (
    select 1 from public.company_memberships cm
    where cm.organization_id = v_org_id
      and cm.company_id = v_company_id
      and cm.user_id = '10000000-0000-4000-8000-000000000106'::uuid
      and cm.revoked_at is null
      and cm.active_to is null
  );

  -- Role assignments for all 6 remaining roles
  -- 1. Divisional Admin (division_admin)
  insert into public.role_assignments (
    organization_id, user_id, role_code, scope_kind, division_id, authority_level, granted_by
  )
  select v_org_id, '10000000-0000-4000-8000-000000000101'::uuid, 'division_admin', 'division', v_division_id, 1, v_grantor_id
  where not exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = v_org_id
      and ra.user_id = '10000000-0000-4000-8000-000000000101'::uuid
      and ra.role_code = 'division_admin'
      and ra.revoked_at is null
  );

  -- 2. Area Construction Manager (neighborhood_admin)
  insert into public.role_assignments (
    organization_id, user_id, role_code, scope_kind, neighborhood_id, authority_level, granted_by
  )
  select v_org_id, '10000000-0000-4000-8000-000000000102'::uuid, 'neighborhood_admin', 'neighborhood', v_neighborhood_id, 1, v_grantor_id
  where not exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = v_org_id
      and ra.user_id = '10000000-0000-4000-8000-000000000102'::uuid
      and ra.role_code = 'neighborhood_admin'
      and ra.revoked_at is null
  );

  -- 3. Internal contributor (internal_contributor)
  insert into public.role_assignments (
    organization_id, user_id, role_code, scope_kind, neighborhood_id, authority_level, granted_by
  )
  select v_org_id, '10000000-0000-4000-8000-000000000103'::uuid, 'internal_contributor', 'neighborhood', v_neighborhood_id, 1, v_grantor_id
  where not exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = v_org_id
      and ra.user_id = '10000000-0000-4000-8000-000000000103'::uuid
      and ra.role_code = 'internal_contributor'
      and ra.revoked_at is null
  );

  -- 4. Inspector (inspector)
  insert into public.role_assignments (
    organization_id, user_id, role_code, scope_kind, neighborhood_id, authority_level, granted_by
  )
  select v_org_id, '10000000-0000-4000-8000-000000000104'::uuid, 'inspector', 'neighborhood', v_neighborhood_id, 1, v_grantor_id
  where not exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = v_org_id
      and ra.user_id = '10000000-0000-4000-8000-000000000104'::uuid
      and ra.role_code = 'inspector'
      and ra.revoked_at is null
  );

  -- 5. Vendor Manager / Company Admin (vendor_admin)
  insert into public.role_assignments (
    organization_id, user_id, role_code, scope_kind, company_id, authority_level, granted_by
  )
  select v_org_id, '10000000-0000-4000-8000-000000000105'::uuid, 'vendor_admin', 'company', v_company_id, 1, v_grantor_id
  where not exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = v_org_id
      and ra.user_id = '10000000-0000-4000-8000-000000000105'::uuid
      and ra.role_code = 'vendor_admin'
      and ra.revoked_at is null
  );

  -- 6. Vendor Tradesman / Vendor (trade_technician)
  insert into public.role_assignments (
    organization_id, user_id, role_code, scope_kind, company_id, authority_level, granted_by
  )
  select v_org_id, '10000000-0000-4000-8000-000000000106'::uuid, 'trade_technician', 'company', v_company_id, 1, v_grantor_id
  where not exists (
    select 1 from public.role_assignments ra
    where ra.organization_id = v_org_id
      and ra.user_id = '10000000-0000-4000-8000-000000000106'::uuid
      and ra.role_code = 'trade_technician'
      and ra.revoked_at is null
  );

  -- Trade specialty and neighborhood roster for Apex Trade Partners
  insert into public.trade_specialties (id, organization_id, code, name, active)
  values (v_specialty_id, v_org_id, 'GENERAL', 'General Contracting & Finish', true)
  on conflict (organization_id, code) do update
    set active = true
  returning id into v_specialty_id;

  insert into public.neighborhood_trade_rosters (
    organization_id, neighborhood_id, company_id, specialty_id, status, granted_by, authority_level
  )
  select v_org_id, v_neighborhood_id, v_company_id, v_specialty_id, 'active', v_grantor_id, 1
  where not exists (
    select 1 from public.neighborhood_trade_rosters r
    where r.organization_id = v_org_id
      and r.neighborhood_id = v_neighborhood_id
      and r.company_id = v_company_id
      and r.specialty_id = v_specialty_id
      and r.status = 'active'
      and r.active_to is null
  );

  -- Active inspection engagement for Elliot Inspector on Lot 1
  insert into public.inspection_engagements (
    organization_id, neighborhood_id, home_id, inspector_user_id, purpose, starts_at, ends_at
  )
  select v_org_id, v_neighborhood_id, v_home_id, '10000000-0000-4000-8000-000000000104'::uuid,
    'Pre-walkthrough quality inspection', now() - interval '1 day', now() + interval '30 days'
  where not exists (
    select 1 from public.inspection_engagements ie
    where ie.organization_id = v_org_id
      and ie.home_id = v_home_id
      and ie.inspector_user_id = '10000000-0000-4000-8000-000000000104'::uuid
      and ie.revoked_at is null
  );

  -- Sample assigned work item for vendor accounts.
  insert into public.work_items (
    id, organization_id, neighborhood_id, home_id, origin, title, description,
    priority, safety_flag, state, created_by, submitted_at, due_at
  )
  values (
    v_work_item_id,
    v_org_id,
    v_neighborhood_id,
    v_home_id,
    'internal_observation',
    'Cabinet door alignment & trim touch-up',
    'Align upper kitchen cabinet doors and complete base trim touch-up prior to walkthrough.',
    'high',
    false,
    'assigned',
    v_grantor_id,
    now() - interval '1 day',
    now() + interval '5 days'
  )
  on conflict (id) do nothing;

  insert into public.assignment_episodes (
    id, organization_id, work_item_id, company_id, technician_user_id, specialty_id, assigned_by, assigned_at, due_at
  )
  values (
    v_episode_id,
    v_org_id,
    v_work_item_id,
    v_company_id,
    '10000000-0000-4000-8000-000000000106'::uuid,
    v_specialty_id,
    v_grantor_id,
    now() - interval '1 day',
    now() + interval '5 days'
  )
  on conflict (id) do nothing;

  update public.work_items
  set current_assignment_id = v_episode_id
  where id = v_work_item_id
    and current_assignment_id is null;
end $$;

commit;

