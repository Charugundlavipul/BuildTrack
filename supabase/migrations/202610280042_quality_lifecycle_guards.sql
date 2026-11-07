begin;

drop policy company_private_read on public.company_private_details;
create policy company_private_read on public.company_private_details for select to authenticated using(
  private.controls_company(organization_id,auth.uid(),company_id) or private.vendor_admin(organization_id,auth.uid(),company_id));
create function public.company_profile_context(p_org uuid,p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare editable boolean;
begin
  if not private.can_read_company(p_org,auth.uid(),p_company) then raise insufficient_privilege using message='Company is unavailable.'; end if;
  editable:=private.controls_company(p_org,auth.uid(),p_company) or private.vendor_admin(p_org,auth.uid(),p_company);
  return jsonb_build_object('can_edit',editable,'ein',case when editable then (select ein from public.company_private_details where organization_id=p_org and company_id=p_company) end);
end; $$;
revoke all on function public.company_profile_context(uuid,uuid) from public,anon;
grant execute on function public.company_profile_context(uuid,uuid) to authenticated;

create function private.guard_quality_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='inspections' then
    if new.status in ('draft','in_progress','amended') then new.reviewed_at:=null; new.reviewed_by:=null; end if;
    if new.status='amended' and old.status='submitted' then new.escalated_at:=null;new.escalation_reason:=null;new.escalation_resolved_at:=null; end if;
    if new.escalated_at is distinct from old.escalated_at and new.escalated_at is not null then new.reviewed_at:=null; new.reviewed_by:=null; end if;
  elsif tg_table_name='companies' then
    if new.status<>'active' and old.status='active' and exists(select 1 from public.inspections where organization_id=new.organization_id and company_id=new.id and status in ('draft','in_progress','amended')) then raise check_violation using message='Assign or cancel open company inspections before deactivating this company.'; end if;
  elsif old.reinspection_status='pending' and new.reinspection_status='pending' and new.state<>'ready_for_verification' then
    new.reinspection_status:=null; new.reinspection_assignee_user_id:=null;new.reinspection_assigned_by:=null;new.reinspection_assigned_at:=null;
  end if;
  return new;
end; $$;
create trigger guard_inspection_review before update on public.inspections for each row execute function private.guard_quality_lifecycle();
create trigger guard_company_open_inspections before update on public.companies for each row execute function private.guard_quality_lifecycle();
create trigger guard_observation_reinspection before update on public.work_items for each row execute function private.guard_quality_lifecycle();
revoke all on function private.guard_quality_lifecycle() from public,anon,authenticated;

-- Reinspection rejection is a normal repair return, so notify the accountable
-- company rather than silently leaving the item in its manager's queue.
create function private.reinspection_return_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.event_type='observation.reinspection_rejected' then
    insert into public.notifications(organization_id,recipient_user_id,work_item_id,title,body,deep_link)
      select distinct new.organization_id,cm.user_id,new.work_item_id,'Repair returned for rework',coalesce(new.details->>'notes','Review the on-site findings.'),'/org/'||new.organization_id||'/work/'||new.work_item_id
      from public.assignment_episodes a join public.company_memberships cm on cm.organization_id=a.organization_id and cm.company_id=a.company_id
      where a.id=new.assignment_episode_id and private.vendor_admin(new.organization_id,cm.user_id,a.company_id)
      union select new.organization_id,a.internal_assignee_user_id,new.work_item_id,'Repair returned for rework',coalesce(new.details->>'notes','Review the on-site findings.'),'/org/'||new.organization_id||'/work/'||new.work_item_id
        from public.assignment_episodes a where a.id=new.assignment_episode_id and a.internal_assignee_user_id is not null and private.active_member(new.organization_id,a.internal_assignee_user_id);
  end if;
  return new;
end; $$;
create trigger notify_reinspection_return after insert on public.work_events for each row execute function private.reinspection_return_notification();
revoke all on function private.reinspection_return_notification() from public,anon,authenticated;
commit;
