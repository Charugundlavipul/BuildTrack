begin;

alter table public.roles add column release_state text not null default 'available' check(release_state in ('available','planned'));
insert into public.permissions(code,description) values('inspection.findings.create','Record findings inside assigned inspections');
insert into public.role_permissions(role_code,permission_code) values
  ('org_admin','inspection.findings.create'),('division_admin','inspection.findings.create'),('neighborhood_admin','inspection.findings.create');
update public.roles set label=case code
  when 'org_admin' then 'Org Admin' when 'division_admin' then 'Divisional Admin'
  when 'neighborhood_admin' then 'Area Construction Manager' when 'superintendent' then 'Construction Supervisor'
  when 'vendor_admin' then 'Vendor Manager' when 'trade_technician' then 'Vendor Tradesman'
  when 'internal_contributor' then 'Internal contributor' else label end,
  version=version+1,updated_at=now()
where code in ('org_admin','division_admin','neighborhood_admin','superintendent','vendor_admin','trade_technician','internal_contributor');
update public.roles set description='Manage users, neighborhoods, vendors, and operations inside assigned divisions.' where code='division_admin';
update public.roles set description='Neighborhood admin: onboard lots and homes, assign inspectors, manage local users and vendors, and review escalations.' where code='neighborhood_admin';
update public.roles set description='Assign inspections, review observations, assign repairs, and verify completed work within scope.' where code='superintendent';
update public.roles set description='Primary company contact: manage company users, grant Inspector access, and dispatch the company''s repair assignments.' where code='vendor_admin';
update public.roles set description='Secondary company contact: perform assigned repairs, report progress, and submit completion evidence.' where code='trade_technician';
update public.roles set allowed_scope_kinds='{company}' where code='vendor_admin'
  and not exists(select 1 from public.role_assignments where role_code='vendor_admin' and revoked_at is null and scope_kind<>'company')
  and not exists(select 1 from public.invites where status='pending' and expires_at>now() and exists(
    select 1 from jsonb_array_elements(proposed_grants) grant_row where grant_row->>'role_code'='vendor_admin' and grant_row->>'scope_kind'<>'company'));
update public.roles set description='Report issues and perform assigned internal work. Add the Inspector role when this person also conducts inspections.',default_for_new_organizations=true where code='internal_contributor';

insert into public.roles(code,label,allowed_scope_kinds,description,default_for_new_organizations,requires_company)
  values('inspector','Inspector','{neighborhood,home,division,company}',
    'Additional inspection role for an Internal contributor or a company member. Company scope requires active membership and approved coverage; inspections must be assigned to this person.',true,false);
insert into public.role_permissions(role_code,permission_code) values
  ('inspector','inspection.perform'),('inspector','inspection.findings.create'),('inspector','evidence.upload'),('inspector','comment.create_shared');
insert into public.organization_roles(organization_id,role_code,enabled)
  select o.id,r,true from public.organizations o cross join unnest(array['inspector','internal_contributor']) r
  on conflict(organization_id,role_code) do nothing;
insert into public.roles(code,label,allowed_scope_kinds,description,active,default_for_new_organizations,release_state)
  values('sales_rep','Sales Rep','{organization,division,neighborhood,home}','Planned future role for read-only lot phase and inspection status visibility.',false,false,'planned');
insert into public.role_permissions(role_code,permission_code) values('sales_rep','work.read_scope'),('sales_rep','report.read_scope');

-- Retire unused templates. Any live grants or invitations receive an exact-permission,
-- organization-private compatibility role; no one is silently promoted to supervisor/admin.
do $migration$
declare old_role public.roles; organization record; compatibility text; invitation public.invites; grants jsonb;
begin
  for old_role in select * from public.roles where organization_id is null and active and code in
    ('operations_coordinator','verifier','auditor','leadership_viewer','internal_quality','external_inspector') loop
    for organization in select a.organization_id from public.organization_roles a where a.role_code=old_role.code and a.enabled and
      (exists(select 1 from public.role_assignments g where g.organization_id=a.organization_id and g.role_code=a.role_code and g.revoked_at is null)
        or exists(select 1 from public.invites i where i.organization_id=a.organization_id and i.status='pending' and i.expires_at>now()
          and exists(select 1 from jsonb_array_elements(i.proposed_grants) item where item->>'role_code'=a.role_code))) loop
      compatibility:='compat_'||old_role.code||'_'||replace(organization.organization_id::text,'-','');
      insert into public.roles(code,label,allowed_scope_kinds,description,active,default_for_new_organizations,requires_company,organization_id,immutable_seed)
        values(compatibility,'Existing '||old_role.label||' access',old_role.allowed_scope_kinds,
          'Preserves permissions issued before catalog cleanup. Review and replace with current roles when appropriate.',true,false,old_role.requires_company,organization.organization_id,false);
      insert into public.role_permissions(role_code,permission_code) select compatibility,permission_code from public.role_permissions where role_code=old_role.code;
      insert into public.organization_roles(organization_id,role_code,enabled) values(organization.organization_id,compatibility,true);
      update public.role_assignments set role_code=compatibility where organization_id=organization.organization_id and role_code=old_role.code and revoked_at is null;
      for invitation in select * from public.invites i where i.organization_id=organization.organization_id and i.status='pending' and i.expires_at>now() loop
        select jsonb_agg(case when item->>'role_code'=old_role.code then item||jsonb_build_object('role_code',compatibility) else item end) into grants
          from jsonb_array_elements(invitation.proposed_grants) item;
        update public.invites set proposed_grants=grants where id=invitation.id;
      end loop;
      perform private.append_audit(organization.organization_id,null,'role.catalog_migrated','role',null,null,null,null,
        jsonb_build_object('old_role',old_role.code,'compatibility_role',compatibility));
    end loop;
  end loop;
end; $migration$;
update public.roles set active=false,default_for_new_organizations=false,version=version+1,updated_at=now()
  where organization_id is null and code in ('operations_coordinator','verifier','auditor','leadership_viewer','internal_quality','external_inspector');
update public.organization_roles set enabled=false where role_code in ('operations_coordinator','verifier','auditor','leadership_viewer','internal_quality','external_inspector');

create function private.guard_planned_role() returns trigger language plpgsql set search_path='' as $$
begin
  if new.release_state='planned' and (new.active or new.default_for_new_organizations) then raise exception using errcode='23514',message='planned roles cannot be published or enabled by default'; end if;
  return new;
end; $$;
create trigger guard_planned_role before insert or update on public.roles for each row execute function private.guard_planned_role();

-- Company scope itself requires company membership, including roles that may also
-- be assigned personally at neighborhood/home scope (such as Inspector).
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('private.role_grant_enabled(public.role_assignments)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='not r.requires_company or exists';
  if strpos(definition,needle)=0 then raise exception 'role membership guard changed; review assignable Inspector integration'; end if;
  execute replace(definition,needle,'not (r.requires_company or p_assignment.scope_kind=''company'') or exists');

  definition:=replace(pg_get_functiondef('private.has_permission(uuid,uuid,text,uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='''work.execute_assigned'',''comment.create_shared'',''evidence.upload'',''company.users.manage''';
  if strpos(definition,needle)=0 then raise exception 'company permission allowlist changed'; end if;
  execute replace(definition,needle,'''work.execute_assigned'',''comment.create_shared'',''evidence.upload'',''company.users.manage'',''inspection.perform'',''inspection.findings.create''');

  definition:=replace(pg_get_functiondef('private.delegation_level(uuid,uuid,text,public.scope_kind,uuid,uuid,uuid,uuid,timestamptz,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'if requested.requires_company and (p_company is null','if (requested.requires_company or p_scope=''company'') and (p_company is null');
  definition:=replace(definition,'if not requested.requires_company or p_company is null','if p_company is null');
  definition:=replace(definition,'p_role in (''vendor_admin'',''trade_technician'')','p_role in (''vendor_admin'',''trade_technician'',''inspector'')');
  definition:=replace(definition,'a.role_code=''vendor_admin'' and a.company_id=p_company',
    'exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code=''company.users.manage'') and a.company_id=p_company');
  execute definition;

  definition:=replace(pg_get_functiondef('public.admin_set_member_access(uuid,uuid,public.affiliation_kind,jsonb,uuid,text)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'when item.requires_company then','when item.requires_company or assignment->>''scope_kind''=''company'' then');
  definition:=replace(definition,'if item.requires_company and not exists','if (item.requires_company or assignment->>''scope_kind''=''company'') and not exists');
  execute definition;

  definition:=replace(pg_get_functiondef('public.admin_create_invitation(uuid,text,public.affiliation_kind,jsonb,uuid,text,text,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'when exists(select 1 from public.roles where code=grant_row->>''role_code'' and requires_company) then',
    'when grant_row->>''scope_kind''=''company'' or exists(select 1 from public.roles where code=grant_row->>''role_code'' and requires_company) then');
  execute definition;

  definition:=replace(pg_get_functiondef('public.accept_invitation(text)'::regprocedure),chr(13)||chr(10),chr(10));
  definition:=replace(definition,'when exists(select 1 from public.roles where code=grant_row->>''role_code'' and requires_company) then',
    'when grant_row->>''scope_kind''=''company'' or exists(select 1 from public.roles where code=grant_row->>''role_code'' and requires_company) then');
  execute definition;

  definition:=replace(pg_get_functiondef('public.save_role_definition(uuid,text,text,text,public.scope_kind[],text[],boolean,boolean,boolean,bigint)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if ''company''=any(p_scopes) and (not p_requires_company or not(p_permissions<@array[''company.users.manage'',''work.execute_assigned'',''comment.create_shared'',''evidence.upload''])) then';
  if strpos(definition,needle)=0 then raise exception 'role definition guard changed; review Inspector company scope'; end if;
  execute replace(definition,needle,'if ''company''=any(p_scopes) and not(p_permissions<@array[''company.users.manage'',''work.execute_assigned'',''comment.create_shared'',''evidence.upload'',''inspection.perform'',''inspection.findings.create'']) then');
end; $migration$;

create or replace function private.can_read_inspection(p_user_id uuid,p_inspection_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.inspections i where i.id=p_inspection_id and private.active_member(i.organization_id,p_user_id) and (
    private.has_permission(i.organization_id,p_user_id,'inspection.manage',i.neighborhood_id,i.home_id) or
    (private.has_permission(i.organization_id,p_user_id,'inspection.perform',i.neighborhood_id,i.home_id) and (
      i.lead_inspector_user_id=p_user_id or exists(select 1 from public.inspection_participants ip where ip.organization_id=i.organization_id and ip.inspection_id=i.id and ip.user_id=p_user_id) or
      exists(select 1 from public.inspection_engagements ie where ie.organization_id=i.organization_id and ie.home_id=i.home_id and ie.inspector_user_id=p_user_id and ie.starts_at<=now() and ie.ends_at>now() and ie.revoked_at is null)))));
$$;

-- Company inspectors may open the homes of their assigned inspections without
-- receiving unrelated homes or builder-wide read permissions.
create or replace function private.has_any_scope(p_organization_id uuid,p_user_id uuid,p_neighborhood_id uuid default null,p_home_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select private.active_member(p_organization_id,p_user_id) and exists(
    select 1 from public.role_assignments a where a.organization_id=p_organization_id and a.user_id=p_user_id
      and private.role_grant_enabled(a) and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now()) and (
        (a.scope_kind<>'company' and private.scope_contains(p_organization_id,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,
          case when p_home_id is not null then 'home'::public.scope_kind when p_neighborhood_id is not null then 'neighborhood'::public.scope_kind else 'organization'::public.scope_kind end,null,p_neighborhood_id,p_home_id))
        or (a.scope_kind='company' and private.company_covers(p_organization_id,a.company_id,p_neighborhood_id) and (
          (exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code='inspection.perform') and exists(
            select 1 from public.inspections i where i.organization_id=p_organization_id and i.neighborhood_id=p_neighborhood_id
              and (p_home_id is null or i.home_id=p_home_id) and private.can_read_inspection(p_user_id,i.id)))
          or (exists(select 1 from public.role_permissions rp where rp.role_code=a.role_code and rp.permission_code='work.execute_assigned') and exists(
            select 1 from public.work_items w join public.assignment_episodes ae on ae.organization_id=w.organization_id and ae.id=w.current_assignment_id
            where w.organization_id=p_organization_id and w.neighborhood_id=p_neighborhood_id and (p_home_id is null or w.home_id=p_home_id)
              and ae.company_id=a.company_id and ae.ended_at is null
              and (ae.technician_user_id=p_user_id or private.active_company_membership(p_organization_id,a.company_id,p_user_id,'manager'))))
        ))
      )
  );
$$;

create function private.can_capture_work(p_org uuid,p_actor uuid,p_neighborhood uuid,p_home uuid,p_inspection uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when p_inspection is not null then
    (private.has_permission(p_org,p_actor,'work.create',p_neighborhood,p_home) or private.has_permission(p_org,p_actor,'inspection.findings.create',p_neighborhood,p_home)) and exists(
    select 1 from public.inspections i where i.organization_id=p_org and i.id=p_inspection and i.neighborhood_id=p_neighborhood and i.home_id=p_home
      and i.status in ('draft','in_progress','amended') and private.can_read_inspection(p_actor,i.id)
      and (private.has_permission(p_org,p_actor,'inspection.perform',p_neighborhood,p_home) or private.has_permission(p_org,p_actor,'inspection.manage',p_neighborhood,p_home)))
  else private.has_permission(p_org,p_actor,'work.create',p_neighborhood,p_home) and exists(select 1 from public.role_assignments a join public.role_permissions rp on rp.role_code=a.role_code and rp.permission_code='work.create'
    where a.organization_id=p_org and a.user_id=p_actor and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
      and private.role_grant_enabled(a) and a.scope_kind<>'company' and private.scope_contains(p_org,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,
        case when p_home is null then 'neighborhood'::public.scope_kind else 'home'::public.scope_kind end,null,p_neighborhood,p_home)) end;
$$;
do $migration$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='private.has_permission(v_organization_id, v_actor, ''work.create'', (v_payload ->> ''neighborhood_id'')::uuid, nullif(v_payload ->> ''home_id'','''')::uuid)';
  if strpos(definition,needle)=0 then raise exception 'work creation permission guard changed'; end if;
  execute replace(definition,needle,'private.can_capture_work(v_organization_id,v_actor,(v_payload->>''neighborhood_id'')::uuid,nullif(v_payload->>''home_id'','''')::uuid,nullif(v_payload->>''inspection_id'','''')::uuid)');
end; $migration$;

commit;
