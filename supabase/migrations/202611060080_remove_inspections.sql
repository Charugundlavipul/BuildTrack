begin;

alter table public.inspections
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users(id),
  add column status_before_removal public.inspection_status;

create or replace view public.inspection_list with (security_invoker = true) as
  select i.id,i.organization_id,i.neighborhood_id,i.home_id,i.type,i.status,i.scheduled_at,h.lot_code,h.address_line1,i.current_revision,i.updated_at,i.version,
    i.company_id,i.lead_inspector_user_id,i.reviewed_at,i.escalated_at,i.escalation_reason,i.escalation_resolved_at
  from public.inspections i join public.homes h on h.organization_id=i.organization_id and h.id=i.home_id
  where i.removed_at is null;

create function public.remove_inspection(p_organization_id uuid, p_inspection_id uuid, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.inspections; actor uuid := auth.uid();
begin
  if actor is null or not private.active_member(p_organization_id, actor) then
    raise insufficient_privilege using message = 'An active organization membership is required.';
  end if;
  select * into i from public.inspections where organization_id=p_organization_id and id=p_inspection_id for update;
  if not found or i.removed_at is not null then raise no_data_found using message = 'Inspection not found.'; end if;
  if not private.has_permission(p_organization_id, actor, 'inspection.manage', i.neighborhood_id, i.home_id)
    or not exists (
      select 1 from public.role_assignments a
      where a.organization_id=p_organization_id and a.user_id=actor
        and a.role_code in ('org_admin','division_admin','neighborhood_admin','superintendent','assistant_superintendent')
        and a.revoked_at is null and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
        and private.role_grant_enabled(a) and a.scope_kind <> 'company'
        and private.scope_contains(p_organization_id,a.scope_kind,a.division_id,a.neighborhood_id,a.home_id,'home'::public.scope_kind,null,i.neighborhood_id,i.home_id)
    ) then raise insufficient_privilege using message = 'An administrator or supervisor with access to this home is required.'; end if;
  if p_expected_version is null or i.version<>p_expected_version then raise serialization_failure using message = 'Inspection changed. Refresh and try again.'; end if;
  update public.inspections set removed_at=now(), removed_by=actor, status_before_removal=i.status,
    status='cancelled', cancellation_reason='Removed from active inspections', updated_at=now(), version=version+1
    where id=i.id and organization_id=p_organization_id;
  update public.milestone_approvals set invalidated_at=now(), invalidation_reason='An inspection was removed.'
    where organization_id=p_organization_id and home_id=i.home_id and invalidated_at is null;
  perform private.append_audit(p_organization_id,actor,'inspection.removed','inspection',i.id,null,
    jsonb_build_object('status',i.status,'version',i.version),jsonb_build_object('status','cancelled'),jsonb_build_object('history_retained',true));
  return jsonb_build_object('id',i.id,'removed',true);
end; $$;
revoke all on function public.remove_inspection(uuid,uuid,bigint) from public,anon;
grant execute on function public.remove_inspection(uuid,uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
