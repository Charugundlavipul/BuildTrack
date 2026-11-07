begin;

-- Preserve the inspection batch implementation while restoring the audited
-- work command pipeline (attempts, evidence, independent verification, receipts).
do $patch$
declare definition text; needle text;
begin
  definition:=replace(pg_get_functiondef('public.execute_command_before_plan_checklists(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
  needle:='if v_item.state <> ''in_progress'' or not private.can_execute_work(v_actor, v_item.id) then';
  if strpos(definition,needle)=0 then raise exception 'Review completion state guard before applying migration'; end if;
  definition:=replace(definition,needle,'if v_item.state not in (''assigned'',''acknowledged'',''in_progress'',''rework_required'') or not private.can_execute_work(v_actor, v_item.id) then');
  definition:=replace(definition,'Only the current accountable party may submit an in-progress correction.','Only the assigned party may mark this work as completed.');
  execute definition;
end; $patch$;

alter function public.execute_command(text,jsonb) rename to execute_command_before_work_completion;
revoke all on function public.execute_command_before_work_completion(text,jsonb) from public,anon,authenticated;
create function public.execute_command(p_command_name text,p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_command_name in ('create_work_item','update_work_draft','submit_work_item','triage_work_item','assign_work_item','delegate_company_work','acknowledge_work','start_work','block_work','unblock_work','submit_correction','verify_correction','reopen_work','cancel_work','update_due_date','issue_evidence_exception','add_comment') then
    return public.execute_command_before_plan_checklists(p_command_name,p_envelope);
  end if;
  return public.execute_command_before_work_completion(p_command_name,p_envelope);
end; $$;
revoke all on function public.execute_command(text,jsonb) from public,anon;
grant execute on function public.execute_command(text,jsonb) to authenticated;

create function public.work_completion_context(p_org uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare w public.work_items; executable boolean;
begin
  select * into w from public.work_items where organization_id=p_org and id=p_item;
  if not found or not private.can_read_work(auth.uid(),p_item) then raise insufficient_privilege using message='Work item is outside your access.'; end if;
  executable:=private.can_execute_work(auth.uid(),p_item) and w.state in ('assigned','acknowledged','in_progress','rework_required');
  return jsonb_build_object('can_complete',executable,'evidence_exception_id',case when executable then (
    select id from public.evidence_exceptions where organization_id=p_org and work_item_id=p_item and consumed_by_attempt_id is null and (expires_at is null or expires_at>now()) order by created_at desc limit 1) end);
end; $$;
revoke all on function public.work_completion_context(uuid,uuid) from public,anon;
grant execute on function public.work_completion_context(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
