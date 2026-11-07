begin;

create table public.organization_pricing (
  organization_id uuid primary key references public.organizations(id),
  plan_name text not null check(length(trim(plan_name)) between 1 and 120),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  billing_interval text not null check(billing_interval in ('monthly','annual')),
  subscription_status text not null check(subscription_status in ('draft','trial','active','past_due','cancelled')),
  base_rate numeric(12,2) not null default 0 check(base_rate>=0),
  user_rate numeric(12,2) not null default 0 check(user_rate>=0),
  home_rate numeric(12,2) not null default 0 check(home_rate>=0),
  included_users integer not null default 0 check(included_users>=0),
  included_homes integer not null default 0 check(included_homes>=0),
  billing_email text not null default '', starts_on date not null,
  ends_on date check(ends_on>=starts_on), notes text not null default '' check(length(notes)<=4000),
  version bigint not null default 1, updated_at timestamptz not null default now()
);
alter table public.organization_pricing enable row level security;
revoke all on public.organization_pricing from anon,authenticated;
grant all on public.organization_pricing to service_role;

create function public.platform_get_operations(p_organization_id uuid,p_search text default '',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'organization not found'; end if;
  select jsonb_build_object(
    'pricing',(select to_jsonb(p) from public.organization_pricing p where organization_id=p_organization_id),
    'usage',jsonb_build_object('users',(select count(*) from public.organization_memberships where organization_id=p_organization_id and status='active' and (ended_at is null or ended_at>now())),
      'homes',(select count(*) from public.homes where organization_id=p_organization_id and archived_at is null)),
    'total',(select count(*) from public.organization_memberships m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id
      where m.organization_id=p_organization_id and (coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%')),
    'members',(select coalesce(jsonb_agg(to_jsonb(q) order by q.email,q.user_id),'[]') from (
      select m.user_id,u.email,p.display_name,m.status,m.affiliation,
        (select coalesce(jsonb_agg(jsonb_build_object('label',r.label,'scope',ra.scope_kind,'effective',private.role_grant_enabled(ra)) order by r.label),'[]')
          from public.role_assignments ra join public.roles r on r.code=ra.role_code where ra.organization_id=m.organization_id and ra.user_id=m.user_id and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())) as roles,
        (select count(*) from public.assignment_episodes a where a.organization_id=m.organization_id and a.internal_assignee_user_id=m.user_id and a.ended_at is null) as assigned_work
      from public.organization_memberships m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id
      where m.organization_id=p_organization_id and (coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%')
      order by u.email,m.user_id limit 25 offset greatest(0,least(p_page,100000))*25) q),
    'invitations',(select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') from (
      select id,normalized_email,status,expires_at,created_at,delivery_error,proposed_grants from public.invites where organization_id=p_organization_id order by created_at desc limit 50) q)
  ) into result;
  return result;
end; $$;

create function public.platform_save_pricing(p_organization_id uuid,p_config jsonb,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.organization_pricing; saved public.organization_pricing; billing_email text;
begin
  perform private.require_platform_admin();
  perform 1 from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;
  select * into previous from public.organization_pricing where organization_id=p_organization_id;
  if previous.version is distinct from p_expected_version then raise exception using errcode='40001',message='pricing changed; reload before saving'; end if;
  billing_email:=lower(trim(coalesce(p_config->>'billing_email','')));
  if billing_email<>'' and billing_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'valid billing email required'; end if;
  insert into public.organization_pricing(organization_id,plan_name,currency,billing_interval,subscription_status,base_rate,user_rate,home_rate,included_users,included_homes,billing_email,starts_on,ends_on,notes)
  values(p_organization_id,trim(p_config->>'plan_name'),upper(p_config->>'currency'),p_config->>'billing_interval',p_config->>'subscription_status',
    (p_config->>'base_rate')::numeric,(p_config->>'user_rate')::numeric,(p_config->>'home_rate')::numeric,(p_config->>'included_users')::integer,(p_config->>'included_homes')::integer,
    billing_email,(p_config->>'starts_on')::date,nullif(p_config->>'ends_on','')::date,coalesce(p_config->>'notes',''))
  on conflict(organization_id) do update set plan_name=excluded.plan_name,currency=excluded.currency,billing_interval=excluded.billing_interval,subscription_status=excluded.subscription_status,
    base_rate=excluded.base_rate,user_rate=excluded.user_rate,home_rate=excluded.home_rate,included_users=excluded.included_users,included_homes=excluded.included_homes,
    billing_email=excluded.billing_email,starts_on=excluded.starts_on,ends_on=excluded.ends_on,notes=excluded.notes,version=public.organization_pricing.version+1,updated_at=now()
  returning * into saved;
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details)
    values(auth.uid(),p_organization_id,'organization.pricing_updated',p_organization_id::text,jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return to_jsonb(saved);
end; $$;

create function public.platform_set_member_status(p_organization_id uuid,p_user_id uuid,p_status public.membership_status,p_reason text,p_expected_status public.membership_status)
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
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details)
    values(auth.uid(),p_organization_id,'organization.member_'||p_status::text,p_user_id::text,jsonb_build_object('reason',trim(p_reason),'previous_status',previous.status,'assigned_work',assigned));
  perform private.append_audit(p_organization_id,auth.uid(),'platform.membership_'||p_status::text,'user',p_user_id,null,null,jsonb_build_object('reason',trim(p_reason),'assigned_work',assigned));
  return jsonb_build_object('user_id',p_user_id,'status',p_status,'assigned_work',assigned);
end; $$;

create function public.platform_set_organization_status(p_organization_id uuid,p_status public.organization_status,p_reason text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.organizations; saved public.organizations;
begin
  perform private.require_platform_admin();
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'a reason of 5 to 1000 characters is required'; end if;
  select * into previous from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;
  if previous.version is distinct from p_expected_version then raise exception using errcode='40001',message='organization changed; reload before continuing'; end if;
  if previous.status=p_status then raise exception 'organization already has this status'; end if;
  update public.organizations set status=p_status,version=version+1,updated_at=now() where id=p_organization_id returning * into saved;
  if p_status<>'active' then update public.invites set status='revoked' where organization_id=p_organization_id and status='pending'; end if;
  perform private.ensure_access_administrator(p_organization_id);
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details)
    values(auth.uid(),p_organization_id,'organization.status_changed',p_organization_id::text,jsonb_build_object('reason',trim(p_reason),'before',previous.status,'after',p_status));
  return to_jsonb(saved);
end; $$;

create function public.platform_prepare_member_invitation(p_organization_id uuid,p_email text,p_role_code text,p_token_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.invites; normalized text:=lower(trim(p_email));
begin
  perform private.require_platform_admin();
  perform 1 from public.organizations where id=p_organization_id and status='active' for update;
  if not found then raise exception 'invitations require an active organization'; end if;
  if normalized is null or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days 5 minutes' then raise exception 'valid email, token and expiry required'; end if;
  if not exists(select 1 from public.roles r where r.code=p_role_code and private.role_enabled(p_organization_id,r.code) and 'organization'=any(r.allowed_scope_kinds) and not r.requires_company) then raise exception 'choose an enabled organization-wide role without a company requirement'; end if;
  if exists(select 1 from public.organizations where id=p_organization_id and onboarding_status='pending_admin') and not exists(select 1 from public.role_permissions where role_code=p_role_code and permission_code='access.manage') then raise exception 'invite an access administrator before adding other members'; end if;
  if exists(select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id and lower(u.email)=normalized and m.status='active') then raise exception 'this person is already an active member'; end if;
  update public.invites set status='revoked' where organization_id=p_organization_id and normalized_email=normalized and status='pending';
  insert into public.invites(organization_id,normalized_email,proposed_membership,proposed_grants,token_hash,expires_at,invited_by)
    values(p_organization_id,normalized,jsonb_build_object('affiliation','internal','platform_managed',true),jsonb_build_array(jsonb_build_object('role_code',p_role_code,'scope_kind','organization')),p_token_hash,p_expires_at,auth.uid()) returning * into invitation;
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details) values(auth.uid(),p_organization_id,'organization.member_invited',invitation.id::text,jsonb_build_object('email',normalized,'role_code',p_role_code));
  return jsonb_build_object('id',invitation.id,'email',normalized,'expires_at',invitation.expires_at);
end; $$;

create function public.platform_revoke_invitation(p_organization_id uuid,p_invitation_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_platform_admin();
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'a reason of 5 to 1000 characters is required'; end if;
  perform 1 from public.organizations where id=p_organization_id for update;
  update public.invites set status='revoked' where organization_id=p_organization_id and id=p_invitation_id and status='pending';
  if not found then raise exception 'pending invitation not found in this organization'; end if;
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details) values(auth.uid(),p_organization_id,'organization.invitation_revoked',p_invitation_id::text,jsonb_build_object('reason',trim(p_reason)));
end; $$;

revoke all on function public.platform_get_operations(uuid,text,integer),public.platform_save_pricing(uuid,jsonb,bigint),public.platform_set_member_status(uuid,uuid,public.membership_status,text,public.membership_status),public.platform_set_organization_status(uuid,public.organization_status,text,bigint),public.platform_prepare_member_invitation(uuid,text,text,text,timestamptz),public.platform_revoke_invitation(uuid,uuid,text) from public,anon;
grant execute on function public.platform_get_operations(uuid,text,integer),public.platform_save_pricing(uuid,jsonb,bigint),public.platform_set_member_status(uuid,uuid,public.membership_status,text,public.membership_status),public.platform_set_organization_status(uuid,public.organization_status,text,bigint),public.platform_prepare_member_invitation(uuid,text,text,text,timestamptz),public.platform_revoke_invitation(uuid,uuid,text) to authenticated;

create or replace function public.platform_save_organization(p_id uuid,p_name text,p_timezone text,p_status public.organization_status,
  p_administrator_email text,p_administrator_role_code text,p_request_id uuid,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.organizations; before_row public.organizations; calendar uuid; existing uuid;
begin
  perform private.require_platform_admin();
  if p_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
    select organization_id into existing from public.organization_onboarding where request_id=p_request_id;
    if existing is not null then return public.platform_get_organization(existing); end if;
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 160 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception using errcode='22023',message='organization name and a valid timezone are required';
  end if;
  if p_id is null then
    if p_status<>'active' or p_request_id is null or p_administrator_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_administrator_email is null then
      raise exception using errcode='22023',message='a new organization requires an administrator email and an onboarding request ID';
    end if;
    if not exists(select 1 from public.roles r join public.role_permissions rp on rp.role_code=r.code and rp.permission_code='access.manage'
      where r.code=p_administrator_role_code and r.organization_id is null and r.active and 'organization'=any(r.allowed_scope_kinds)) then
      raise exception using errcode='22023',message='choose an active shared role with organization-wide access management for the initial administrator';
    end if;
    insert into public.organizations(name,timezone) values(trim(p_name),p_timezone) returning * into result;
    insert into public.organization_roles(organization_id,role_code,enabled) values(result.id,p_administrator_role_code,true)
      on conflict(organization_id,role_code) do update set enabled=true;
    insert into public.business_calendars(organization_id,name,timezone) values(result.id,'Default business calendar',p_timezone) returning id into calendar;
    update public.organizations set default_calendar_id=calendar where id=result.id returning * into result;
    insert into public.organization_onboarding(organization_id,request_id,administrator_email,administrator_role_code,created_by)
      values(result.id,p_request_id,lower(trim(p_administrator_email)),p_administrator_role_code,auth.uid());
  else
    select * into before_row from public.organizations where id=p_id for update;
    if not found then raise exception using errcode='02000',message='organization not found'; end if;
    if before_row.version is distinct from p_expected_version then raise exception using errcode='40001',message='organization changed; reload before saving'; end if;
    if p_status is distinct from before_row.status then raise exception 'use Access & lifecycle to change organization status with a reason'; end if;
    update public.organizations set name=trim(p_name),timezone=p_timezone,status=p_status,version=version+1,updated_at=now()
      where id=p_id returning * into result;
    if before_row.onboarding_status='pending_admin' then
      if p_administrator_email is null or p_administrator_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or not exists(
        select 1 from public.roles r join public.role_permissions rp on rp.role_code=r.code and rp.permission_code='access.manage'
        where r.code=p_administrator_role_code and r.active and (r.organization_id is null or r.organization_id=p_id) and 'organization'=any(r.allowed_scope_kinds)) then
        raise exception using errcode='22023',message='a valid initial administrator email and organization-wide access role are required';
      end if;
      if exists(select 1 from public.organization_onboarding where organization_id=p_id and
        (administrator_email<>lower(trim(p_administrator_email)) or administrator_role_code<>p_administrator_role_code)) then
        update public.invites set status='revoked' where organization_id=p_id and status='pending' and proposed_membership->>'platform_onboarding'='true';
      end if;
      update public.organization_onboarding set administrator_email=lower(trim(p_administrator_email)),administrator_role_code=p_administrator_role_code where organization_id=p_id;
      insert into public.organization_roles(organization_id,role_code,enabled) values(p_id,p_administrator_role_code,true)
        on conflict(organization_id,role_code) do update set enabled=true,updated_at=now();
    end if;
  end if;
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id,details)
    values(auth.uid(),result.id,case when p_id is null then 'organization.created' else 'organization.updated' end,result.id::text,jsonb_build_object('before',to_jsonb(before_row),'after',to_jsonb(result),'initial_administrator_email',case when result.onboarding_status='pending_admin' then lower(trim(p_administrator_email)) else null end,'initial_administrator_role',case when result.onboarding_status='pending_admin' then p_administrator_role_code else null end));
  return public.platform_get_organization(result.id);
end; $$;

commit;
