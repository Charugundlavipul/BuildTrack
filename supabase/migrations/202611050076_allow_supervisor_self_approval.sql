begin;

-- Supervisors may accept repairs they performed or submitted themselves.
-- Authority still comes from work.verify in the repair's scope. Optional
-- Inspector reinspections retain their separate assignment/independence rules.
create or replace function private.can_verify(p_user_id uuid,p_attempt_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.correction_attempts ca
  join public.work_items w on w.organization_id=ca.organization_id and w.id=ca.work_item_id
  where ca.id=p_attempt_id and (
   (w.reinspection_status is distinct from 'pending'
    and private.has_permission(w.organization_id,p_user_id,'work.verify',w.neighborhood_id,w.home_id))
   or (w.state='ready_for_verification' and w.reinspection_status='pending'
    and w.reinspection_assignee_user_id=p_user_id
    and private.has_permission(w.organization_id,p_user_id,'inspection.perform',w.neighborhood_id,w.home_id)
    and ca.submitted_by<>p_user_id
    and ca.accountable_internal_user_id is distinct from p_user_id
    and ca.technician_user_id is distinct from p_user_id
    and not (ca.accountable_company_id is not null
     and private.active_company_membership(w.organization_id,ca.accountable_company_id,p_user_id,null)))
  )
 );
$$;
revoke all on function private.can_verify(uuid,uuid) from public,anon,authenticated;

do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('public.work_completion_context(uuid,uuid)'::regprocedure);
 needle:='Another authorized reviewer must review this completion. You cannot approve work you performed or submitted, or work completed by your company.';
 if strpos(definition,needle)=0 then raise exception 'Review completion context before updating self approval'; end if;
 definition:=replace(definition,needle,'A submitted completion is required before this work can be reviewed.');
 definition:=replace(definition,'independent','eligible');
 execute definition;

 definition:=pg_get_functiondef('public.execute_command_before_plan_checklists(text,jsonb)'::regprocedure);
 needle:='''INDEPENDENCE_REQUIRED'', ''Verification requires an eligible independent verifier.''';
 if strpos(definition,needle)=0 then raise exception 'Review completion error before updating self approval'; end if;
 definition:=replace(definition,needle,'''FORBIDDEN'', ''An authorized supervisor and a pending completion are required for review.''');
 execute definition;
end; $$;

notify pgrst,'reload schema';
commit;
