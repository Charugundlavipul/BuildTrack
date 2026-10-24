begin;

drop policy if exists engagements_self_or_manager_select on public.inspection_engagements;
create policy engagements_self_or_manager_select on public.inspection_engagements
for select to authenticated using (
  private.active_member(organization_id, auth.uid())
  and (
    inspector_user_id = auth.uid()
    or private.has_permission(organization_id, auth.uid(), 'inspection.manage', neighborhood_id, home_id)
    or private.has_permission(organization_id, auth.uid(), 'config.manage', null, null)
  )
);

commit;
