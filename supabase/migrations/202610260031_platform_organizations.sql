begin;

create function private.validate_invitation_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
declare item jsonb; role_row public.roles; scope public.scope_kind; neighborhood uuid; home uuid;
begin
  if new.status<>'pending' then return new; end if;
  if jsonb_typeof(new.proposed_grants)<>'array' or jsonb_array_length(new.proposed_grants) not between 1 and 20 then
    raise exception using errcode='22023',message='one to twenty role grants are required';
  end if;
  for item in select value from jsonb_array_elements(new.proposed_grants) loop
    select * into role_row from public.roles where code=item->>'role_code';
    scope:=nullif(item->>'scope_kind','')::public.scope_kind;
    neighborhood:=nullif(item->>'neighborhood_id','')::uuid;
    home:=nullif(item->>'home_id','')::uuid;
    if not found or not private.role_enabled(new.organization_id,role_row.code) or scope is null or not(scope=any(role_row.allowed_scope_kinds)) then
      raise exception using errcode='22023',message='invitation role is unavailable or has an incompatible scope';
    end if;
    if role_row.requires_company and new.proposed_company_id is null then raise exception using errcode='22023',message='this role requires a trade company'; end if;
    if (scope='organization' and (neighborhood is not null or home is not null)) or
      (scope='neighborhood' and (neighborhood is null or home is not null)) or (scope='home' and (neighborhood is null or home is null)) then
      raise exception using errcode='22023',message='invitation scope identifiers are invalid';
    end if;
    if neighborhood is not null and not exists(select 1 from public.neighborhoods where organization_id=new.organization_id and id=neighborhood and status='active') then
      raise exception using errcode='22023',message='invitation neighborhood is unavailable';
    end if;
    if home is not null and not exists(select 1 from public.homes where organization_id=new.organization_id and neighborhood_id=neighborhood and id=home and archived_at is null) then
      raise exception using errcode='22023',message='invitation home is unavailable';
    end if;
  end loop;
  return new;
end; $$;
create trigger invitation_role_catalog_guard before insert or update on public.invites
  for each row execute function private.validate_invitation_roles();

create function public.platform_list_organizations(p_search text default '',p_status text default '',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  select jsonb_build_object('total',(select count(*) from public.organizations o where
    (p_status='' or o.status::text=p_status) and (o.name ilike '%'||p_search||'%' or o.id::text=p_search)),
    'rows',coalesce(jsonb_agg(to_jsonb(rows) order by rows.name,rows.id),'[]')) into result from (
      select o.*,(select count(*) from public.organization_memberships m where m.organization_id=o.id and m.status='active') as member_count,
        b.administrator_email
      from public.organizations o left join public.organization_onboarding b on b.organization_id=o.id
      where (p_status='' or o.status::text=p_status) and (o.name ilike '%'||p_search||'%' or o.id::text=p_search)
      order by o.name,o.id limit 25 offset greatest(0,least(p_page,100000))*25
    ) rows;
  return result;
end; $$;

create function public.platform_get_organization(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_platform_admin();
  select jsonb_build_object('organization',to_jsonb(o),'onboarding',(select to_jsonb(b) from public.organization_onboarding b where b.organization_id=o.id),
    'roles',public.manage_role_catalog(o.id),
    'invitations',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from (select id,normalized_email,status,expires_at,created_at,delivery_error from public.invites where organization_id=o.id and proposed_membership->>'platform_onboarding'='true' order by created_at desc limit 20) i),
    'activity',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select action,created_at from public.platform_audit_events where organization_id=o.id order by created_at desc limit 20) a))
  into result from public.organizations o where o.id=p_id;
  if result is null then raise exception using errcode='02000',message='organization not found'; end if;
  return result;
end; $$;

create function public.platform_save_organization(p_id uuid,p_name text,p_timezone text,p_status public.organization_status,
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

create function public.platform_prepare_administrator_invitation(p_organization_id uuid,p_token_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare onboarding public.organization_onboarding; invitation public.invites;
begin
  perform private.require_platform_admin();
  perform 1 from public.organizations where id=p_organization_id and status='active' and onboarding_status='pending_admin' for update;
  if not found then raise exception using errcode='22023',message='only an active organization awaiting its first administrator can use onboarding invitations'; end if;
  select * into onboarding from public.organization_onboarding where organization_id=p_organization_id;
  if not found then raise exception using errcode='22023',message='administrator onboarding details are unavailable'; end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_expires_at<=now() or p_expires_at>now()+interval '7 days 5 minutes' then
    raise exception using errcode='22023',message='invalid invitation token or expiry';
  end if;
  if not private.role_enabled(p_organization_id,onboarding.administrator_role_code) or not exists(
    select 1 from public.role_permissions where role_code=onboarding.administrator_role_code and permission_code='access.manage') then
    raise exception using errcode='22023',message='enable the initial administrator role before sending this invitation';
  end if;
  update public.invites set status='revoked' where organization_id=p_organization_id and normalized_email=onboarding.administrator_email and status='pending';
  insert into public.invites(organization_id,normalized_email,proposed_membership,proposed_grants,token_hash,expires_at,invited_by)
    values(p_organization_id,onboarding.administrator_email,jsonb_build_object('affiliation','internal','platform_onboarding',true),
      jsonb_build_array(jsonb_build_object('role_code',onboarding.administrator_role_code,'scope_kind','organization','neighborhood_id',null,'home_id',null)),
      p_token_hash,p_expires_at,auth.uid()) returning * into invitation;
  insert into public.platform_audit_events(actor_id,organization_id,action,entity_id)
    values(auth.uid(),p_organization_id,'organization.administrator_invited',invitation.id::text);
  return jsonb_build_object('id',invitation.id,'email',invitation.normalized_email,'expires_at',invitation.expires_at);
end; $$;

revoke all on function public.platform_list_organizations(text,text,integer),public.platform_get_organization(uuid),
  public.platform_save_organization(uuid,text,text,public.organization_status,text,text,uuid,bigint),
  public.platform_prepare_administrator_invitation(uuid,text,timestamptz) from public,anon;
grant execute on function public.platform_list_organizations(text,text,integer),public.platform_get_organization(uuid),
  public.platform_save_organization(uuid,text,text,public.organization_status,text,text,uuid,bigint),
  public.platform_prepare_administrator_invitation(uuid,text,timestamptz) to authenticated;

create function public.invitation_identity_exists(p_email text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='service role required'; end if;
  return exists(select 1 from auth.users where lower(email)=lower(trim(p_email)));
end; $$;
revoke all on function public.invitation_identity_exists(text) from public,anon,authenticated;
grant execute on function public.invitation_identity_exists(text) to service_role;

commit;
