begin;

create or replace function public.bootstrap_organization(p_name text, p_timezone text, p_admin_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare org_id uuid; calendar_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  insert into public.organizations(name, timezone) values (trim(p_name), p_timezone) returning id into org_id;
  insert into public.business_calendars(organization_id, name, timezone) values (org_id, 'Default business calendar', p_timezone) returning id into calendar_id;
  update public.organizations set default_calendar_id = calendar_id where id = org_id;
  insert into public.organization_memberships(organization_id, user_id, affiliation, status, joined_at)
    values (org_id, p_admin_user_id, 'internal', 'active', now());
  insert into public.role_assignments(organization_id, user_id, role_code, scope_kind, granted_by)
    values (org_id, p_admin_user_id, 'org_admin', 'organization', p_admin_user_id);
  insert into public.audit_events(organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (org_id, p_admin_user_id, 'organization.bootstrapped', 'organization', org_id, jsonb_build_object('controlled_operator', true));
  return org_id;
end;
$$;
revoke all on function public.bootstrap_organization(text,text,uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_organization(text,text,uuid) to service_role;

create or replace function public.admin_create_invitation(
  p_organization_id uuid,
  p_email text,
  p_affiliation public.affiliation_kind,
  p_grants jsonb,
  p_company_id uuid,
  p_company_kind text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.invites language plpgsql security definer set search_path = '' as $$
declare result public.invites;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '7 days 5 minutes' then
    raise exception using errcode = '22023', message = 'invitation expiry must be within seven days';
  end if;
  if jsonb_typeof(p_grants) <> 'array' then raise exception using errcode = '22023', message = 'grants must be an array'; end if;
  if p_company_id is not null and not exists (select 1 from public.companies c where c.organization_id = p_organization_id and c.id = p_company_id and c.status = 'active') then
    raise exception using errcode = '22023', message = 'company is unavailable';
  end if;
  insert into public.invites(
    organization_id, normalized_email, proposed_membership, proposed_grants, proposed_company_id,
    token_hash, expires_at, invited_by
  ) values (
    p_organization_id, lower(trim(p_email)), jsonb_build_object('affiliation', p_affiliation, 'company_kind', p_company_kind),
    p_grants, p_company_id, p_token_hash, p_expires_at, auth.uid()
  ) returning * into result;
  perform private.append_audit(p_organization_id, auth.uid(), 'invitation.created', 'invite', result.id, null, null, to_jsonb(result) - 'token_hash');
  return result;
end;
$$;
revoke all on function public.admin_create_invitation(uuid,text,public.affiliation_kind,jsonb,uuid,text,text,timestamptz) from public, anon;
grant execute on function public.admin_create_invitation(uuid,text,public.affiliation_kind,jsonb,uuid,text,text,timestamptz) to authenticated;

create or replace function public.accept_invitation(p_plaintext_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invitation public.invites%rowtype;
  user_email text;
  grant_row jsonb;
  membership_id uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'authenticated identity required'; end if;
  select lower(email) into user_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if user_email is null then raise exception using errcode = '42501', message = 'verified email required'; end if;
  select * into invitation from public.invites
    where token_hash = encode(extensions.digest(p_plaintext_token, 'sha256'), 'hex')
    for update;
  if not found or invitation.status <> 'pending' or invitation.expires_at <= now() then
    raise exception using errcode = '22023', message = 'invitation is invalid or expired';
  end if;
  if invitation.normalized_email <> user_email then
    raise exception using errcode = '42501', message = 'signed-in email does not match invitation';
  end if;
  insert into public.organization_memberships(organization_id, user_id, affiliation, status, joined_at)
    values (invitation.organization_id, auth.uid(), (invitation.proposed_membership ->> 'affiliation')::public.affiliation_kind, 'active', now())
    on conflict (organization_id, user_id) do update set status = 'active', affiliation = excluded.affiliation, joined_at = coalesce(public.organization_memberships.joined_at, now()), ended_at = null
    returning id into membership_id;
  for grant_row in select value from jsonb_array_elements(invitation.proposed_grants) loop
    if not exists (select 1 from public.roles r where r.code = grant_row ->> 'role_code' and (grant_row ->> 'scope_kind')::public.scope_kind = any(r.allowed_scope_kinds)) then
      raise exception using errcode = '22023', message = 'invitation contains an invalid role scope';
    end if;
    insert into public.role_assignments(
      organization_id, user_id, role_code, scope_kind, neighborhood_id, home_id, starts_at, ends_at, granted_by
    ) values (
      invitation.organization_id, auth.uid(), grant_row ->> 'role_code', (grant_row ->> 'scope_kind')::public.scope_kind,
      nullif(grant_row ->> 'neighborhood_id','')::uuid, nullif(grant_row ->> 'home_id','')::uuid,
      coalesce(nullif(grant_row ->> 'starts_at','')::timestamptz, now()), nullif(grant_row ->> 'ends_at','')::timestamptz,
      invitation.invited_by
    );
  end loop;
  if invitation.proposed_company_id is not null then
    insert into public.company_memberships(organization_id, company_id, user_id, kind)
      values (invitation.organization_id, invitation.proposed_company_id, auth.uid(), coalesce(invitation.proposed_membership ->> 'company_kind', 'technician'));
  end if;
  update public.invites set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = invitation.id;
  perform private.append_audit(invitation.organization_id, auth.uid(), 'invitation.accepted', 'invite', invitation.id, null, null, jsonb_build_object('membership_id', membership_id));
  return jsonb_build_object('organization_id', invitation.organization_id, 'membership_id', membership_id);
end;
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.admin_suspend_member(p_organization_id uuid, p_user_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare orphaned jsonb;
begin
  if auth.uid() is null or not private.require_aal2() or not private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null) then
    raise exception using errcode = '42501', message = 'aal2 access management permission required';
  end if;
  if exists (
    select 1 from public.role_assignments ra where ra.organization_id = p_organization_id and ra.user_id = p_user_id and ra.role_code = 'org_admin'
      and ra.revoked_at is null and not exists (
        select 1 from public.role_assignments other
        join public.organization_memberships om on om.organization_id = other.organization_id and om.user_id = other.user_id and om.status = 'active'
        where other.organization_id = p_organization_id and other.user_id <> p_user_id and other.role_code = 'org_admin'
          and other.revoked_at is null and other.starts_at <= now() and (other.ends_at is null or other.ends_at > now())
      )
  ) then
    raise exception using errcode = '23514', message = 'cannot suspend the last active organization administrator';
  end if;
  update public.organization_memberships set status = 'suspended', ended_at = now() where organization_id = p_organization_id and user_id = p_user_id and status = 'active';
  if not found then raise exception using errcode = '02000', message = 'active membership not found'; end if;
  update public.role_assignments set revoked_at = now() where organization_id = p_organization_id and user_id = p_user_id and revoked_at is null;
  update public.company_memberships set revoked_at = now() where organization_id = p_organization_id and user_id = p_user_id and revoked_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('work_item_id', w.id, 'title', w.title)), '[]'::jsonb) into orphaned
  from public.work_items w join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id
  where w.organization_id = p_organization_id and ae.internal_assignee_user_id = p_user_id and ae.ended_at is null;
  perform private.append_audit(p_organization_id, auth.uid(), 'membership.suspended', 'user', p_user_id, null, null, jsonb_build_object('reason', p_reason, 'orphaned_work', orphaned));
  return jsonb_build_object('user_id', p_user_id, 'orphaned_work', orphaned);
end;
$$;
revoke all on function public.admin_suspend_member(uuid,uuid,text) from public, anon;
grant execute on function public.admin_suspend_member(uuid,uuid,text) to authenticated;

create or replace function public.create_export_job(p_organization_id uuid, p_export_kind text, p_filters jsonb)
returns public.export_jobs language plpgsql security definer set search_path = '' as $$
declare result public.export_jobs;
begin
  if not private.has_permission(p_organization_id, auth.uid(), 'report.read_scope', null, null) then
    raise exception using errcode = '42501', message = 'report permission required';
  end if;
  insert into public.export_jobs(organization_id, requested_by, export_kind, filters)
    values (p_organization_id, auth.uid(), p_export_kind, coalesce(p_filters, '{}'::jsonb)) returning * into result;
  return result;
end;
$$;
revoke all on function public.create_export_job(uuid,text,jsonb) from public, anon;
grant execute on function public.create_export_job(uuid,text,jsonb) to authenticated;

create or replace function public.complete_export_job(p_job_id uuid, p_status text, p_object_key text, p_row_count integer, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'service role required'; end if;
  update public.export_jobs set status = p_status, object_key = p_object_key, row_count = p_row_count,
    error_message = p_error, expires_at = case when p_status = 'ready' then now() + interval '24 hours' else null end, updated_at = now()
  where id = p_job_id;
end;
$$;
revoke all on function public.complete_export_job(uuid,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.complete_export_job(uuid,text,text,integer,text) to service_role;

create or replace function public.participant_directory(p_organization_id uuid, p_neighborhood_id uuid default null)
returns table(user_id uuid, display_name text, affiliation public.affiliation_kind)
language sql stable security definer set search_path = '' as $$
  select distinct m.user_id, p.display_name, m.affiliation
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id and m.status = 'active'
    and private.active_member(p_organization_id, auth.uid())
    and (
      private.has_permission(p_organization_id, auth.uid(), 'access.manage', null, null)
      or exists (
        select 1 from public.role_assignments mine
        join public.role_assignments theirs on theirs.organization_id = mine.organization_id
        where mine.organization_id = p_organization_id and mine.user_id = auth.uid() and theirs.user_id = m.user_id
          and mine.revoked_at is null and theirs.revoked_at is null
          and (p_neighborhood_id is null or mine.scope_kind = 'organization' or mine.neighborhood_id = p_neighborhood_id)
          and (p_neighborhood_id is null or theirs.scope_kind = 'organization' or theirs.neighborhood_id = p_neighborhood_id)
      )
    );
$$;
revoke all on function public.participant_directory(uuid,uuid) from public, anon;
grant execute on function public.participant_directory(uuid,uuid) to authenticated;

commit;
