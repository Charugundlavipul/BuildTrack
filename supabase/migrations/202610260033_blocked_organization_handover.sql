begin;
create or replace function public.platform_set_member_status(p_organization_id uuid,p_user_id uuid,p_status public.membership_status,p_reason text,p_expected_status public.membership_status)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.organization_memberships; assigned integer;
begin
  perform private.require_platform_admin();
  if p_status not in ('active','suspended','removed') or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'a reason of 5 to 1000 characters and a valid status are required'; end if;
  perform 1 from public.organizations where id=p_organization_id for update;
  select * into previous from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id for update;
  if not found then raise exception 'organization membership not found'; end if;
  if previous.status is distinct from p_expected_status then raise exception using errcode='40001',message='membership changed; reload before continuing'; end if;
  if previous.status=p_status or (p_status='active' and previous.status<>'suspended') then raise exception 'removed users must be invited again with new role grants'; end if;
  update public.organization_memberships set status=p_status,ended_at=case when p_status='active' then null else now() end where organization_id=p_organization_id and user_id=p_user_id;
  if p_status='removed' then
    update public.role_assignments set revoked_at=now() where organization_id=p_organization_id and user_id=p_user_id and revoked_at is null;
    update public.company_memberships set revoked_at=now() where organization_id=p_organization_id and user_id=p_user_id and revoked_at is null;
  end if;
  if p_status<>'active' then
    update public.invites set status='revoked' where organization_id=p_organization_id and status='pending' and normalized_email=(select lower(email) from auth.users where id=p_user_id);
  end if;
  select count(*) into assigned from public.assignment_episodes where organization_id=p_organization_id and internal_assignee_user_id=p_user_id and ended_at is null;
  perform private.ensure_access_administrator(p_organization_id);
  -- Keep blocked organizations recoverable without a privileged manual repair.
  if exists(select 1 from public.organizations where id=p_organization_id and onboarding_status='ready') and not exists(
    select 1 from public.role_assignments ra join public.organization_memberships m on m.organization_id=ra.organization_id and m.user_id=ra.user_id
    join public.role_permissions rp on rp.role_code=ra.role_code and rp.permission_code='access.manage'
    where ra.organization_id=p_organization_id and ra.scope_kind='organization' and ra.revoked_at is null and ra.starts_at<=now() and ra.ends_at is null
      and m.status='active' and m.ended_at is null and private.role_grant_enabled(ra)) then
    raise exception using errcode='23514',message='retain an active organization-wide access administrator, including while the organization is blocked';
  end if;

  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details)
    values(auth.uid(),p_organization_id,'organization.member_'||p_status::text,p_user_id::text,jsonb_build_object('reason',trim(p_reason),'previous_status',previous.status,'assigned_work',assigned));
  perform private.append_audit(p_organization_id,auth.uid(),'platform.membership_'||p_status::text,'user',p_user_id,null,null,jsonb_build_object('reason',trim(p_reason),'assigned_work',assigned));
  return jsonb_build_object('user_id',p_user_id,'status',p_status,'assigned_work',assigned);
end; $$;


commit;
