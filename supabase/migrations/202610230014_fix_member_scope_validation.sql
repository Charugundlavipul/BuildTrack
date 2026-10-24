begin;

create or replace function public.admin_set_member_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_affiliation public.affiliation_kind,
  p_assignments jsonb,
  p_company_id uuid default null,
  p_company_kind text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  assignment jsonb;
  role_row public.roles%rowtype;
  v_role_code text;
  v_requested_scope public.scope_kind;
  v_neighborhood_id uuid;
  v_home_id uuid;
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
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception using errcode = '22023', message = 'identity does not exist'; end if;
  if p_company_id is not null then
    if p_company_kind not in ('manager','technician') then raise exception using errcode = '22023', message = 'company kind must be manager or technician'; end if;
    if not exists (select 1 from public.companies c where c.organization_id = p_organization_id and c.id = p_company_id and c.status = 'active') then raise exception using errcode = '22023', message = 'company is unavailable'; end if;
  elsif p_company_kind is not null then raise exception using errcode = '22023', message = 'company is required for company kind';
  end if;

  select jsonb_build_object(
    'membership', to_jsonb(m),
    'roles', coalesce((select jsonb_agg(to_jsonb(ra)) from public.role_assignments ra where ra.organization_id=p_organization_id and ra.user_id=p_user_id and ra.revoked_at is null),'[]'::jsonb),
    'companies', coalesce((select jsonb_agg(to_jsonb(cm)) from public.company_memberships cm where cm.organization_id=p_organization_id and cm.user_id=p_user_id and cm.revoked_at is null),'[]'::jsonb)
  ) into previous_access from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id;

  insert into public.organization_memberships(organization_id,user_id,affiliation,status,joined_at)
    values(p_organization_id,p_user_id,p_affiliation,'active',now())
    on conflict(organization_id,user_id) do update set affiliation=excluded.affiliation,status='active',joined_at=coalesce(public.organization_memberships.joined_at,now()),ended_at=null;

  for assignment in select value from jsonb_array_elements(p_assignments) loop
    v_role_code:=nullif(assignment->>'role_code','');
    v_requested_scope:=nullif(assignment->>'scope_kind','')::public.scope_kind;
    v_neighborhood_id:=nullif(assignment->>'neighborhood_id','')::uuid;
    v_home_id:=nullif(assignment->>'home_id','')::uuid;
    select * into role_row from public.roles r where r.code=v_role_code;
    if not found or v_requested_scope is null or not(v_requested_scope=any(role_row.allowed_scope_kinds)) then raise exception using errcode='22023',message='role and scope are incompatible'; end if;
    if (v_requested_scope='organization' and (v_neighborhood_id is not null or v_home_id is not null))
      or (v_requested_scope='neighborhood' and (v_neighborhood_id is null or v_home_id is not null))
      or (v_requested_scope='home' and (v_neighborhood_id is null or v_home_id is null)) then raise exception using errcode='22023',message='invalid role scope identifiers'; end if;
    if v_neighborhood_id is not null and not exists(select 1 from public.neighborhoods n where n.organization_id=p_organization_id and n.id=v_neighborhood_id and n.status='active') then raise exception using errcode='22023',message='neighborhood is unavailable'; end if;
    if v_home_id is not null and not exists(select 1 from public.homes h where h.organization_id=p_organization_id and h.neighborhood_id=v_neighborhood_id and h.id=v_home_id and h.archived_at is null) then raise exception using errcode='22023',message='home is unavailable'; end if;
    if v_role_code in ('trade_manager','trade_technician') and p_company_id is null then raise exception using errcode='22023',message='trade roles require a company association'; end if;
    if v_role_code='org_admin' and v_requested_scope='organization' then retains_org_admin:=true; end if;
  end loop;

  if not retains_org_admin and exists(
    select 1 from public.role_assignments ra where ra.organization_id=p_organization_id and ra.user_id=p_user_id and ra.role_code='org_admin' and ra.revoked_at is null and ra.starts_at<=now() and (ra.ends_at is null or ra.ends_at>now())
  ) and not exists(
    select 1 from public.role_assignments other join public.organization_memberships om on om.organization_id=other.organization_id and om.user_id=other.user_id and om.status='active'
    where other.organization_id=p_organization_id and other.user_id<>p_user_id and other.role_code='org_admin' and other.revoked_at is null and other.starts_at<=now() and (other.ends_at is null or other.ends_at>now())
  ) then raise exception using errcode='23514',message='cannot remove the last active organization administrator'; end if;

  update public.role_assignments set revoked_at=now() where organization_id=p_organization_id and user_id=p_user_id and revoked_at is null;
  update public.company_memberships set revoked_at=now() where organization_id=p_organization_id and user_id=p_user_id and revoked_at is null;
  for assignment in select value from jsonb_array_elements(p_assignments) loop
    insert into public.role_assignments(organization_id,user_id,role_code,scope_kind,neighborhood_id,home_id,starts_at,ends_at,granted_by)
    values(p_organization_id,p_user_id,assignment->>'role_code',(assignment->>'scope_kind')::public.scope_kind,nullif(assignment->>'neighborhood_id','')::uuid,nullif(assignment->>'home_id','')::uuid,coalesce(nullif(assignment->>'starts_at','')::timestamptz,now()),nullif(assignment->>'ends_at','')::timestamptz,auth.uid());
  end loop;
  if p_company_id is not null then insert into public.company_memberships(organization_id,company_id,user_id,kind) values(p_organization_id,p_company_id,p_user_id,p_company_kind); end if;

  select jsonb_build_object(
    'membership',to_jsonb(m),
    'roles',coalesce((select jsonb_agg(to_jsonb(ra)) from public.role_assignments ra where ra.organization_id=p_organization_id and ra.user_id=p_user_id and ra.revoked_at is null),'[]'::jsonb),
    'companies',coalesce((select jsonb_agg(to_jsonb(cm)) from public.company_memberships cm where cm.organization_id=p_organization_id and cm.user_id=p_user_id and cm.revoked_at is null),'[]'::jsonb)
  ) into new_access from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id;
  perform private.append_audit(p_organization_id,auth.uid(),'membership.access_changed','user',p_user_id,null,previous_access,new_access);
  return new_access;
end; $$;

revoke all on function public.admin_set_member_access(uuid,uuid,public.affiliation_kind,jsonb,uuid,text) from public,anon;
grant execute on function public.admin_set_member_access(uuid,uuid,public.affiliation_kind,jsonb,uuid,text) to authenticated;

commit;
