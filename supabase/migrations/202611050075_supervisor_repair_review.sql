begin;

-- A completed repair normally goes to its supervisor. Inspector authority is
-- limited to the optional, explicitly assigned reinspection branch.
create or replace function private.can_verify(p_user_id uuid,p_attempt_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.correction_attempts ca
  join public.work_items w on w.organization_id=ca.organization_id and w.id=ca.work_item_id
  where ca.id=p_attempt_id and ca.submitted_by<>p_user_id
   and ca.accountable_internal_user_id is distinct from p_user_id
   and ca.technician_user_id is distinct from p_user_id
   and (private.has_permission(w.organization_id,p_user_id,'work.verify',w.neighborhood_id,w.home_id)
    or (w.state='ready_for_verification' and w.reinspection_status='pending'
     and w.reinspection_assignee_user_id=p_user_id
     and private.has_permission(w.organization_id,p_user_id,'inspection.perform',w.neighborhood_id,w.home_id)))
   and not (ca.accountable_company_id is not null
    and private.active_company_membership(w.organization_id,ca.accountable_company_id,p_user_id,null))
 );
$$;
revoke all on function private.can_verify(uuid,uuid) from public,anon,authenticated;

-- Keep the audited completion attempts, assignment history, evidence, immutable
-- submissions and receipts. Never send these commands to the batch-only fork.
do $patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef('public.execute_command_before_plan_checklists(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:='elsif p_command_name = ''verify_correction'' then';
 if strpos(definition,needle)=0 then raise exception 'Review supervisor decision dispatch before applying migration'; end if;
 definition:=replace(definition,needle,needle||'
      if not private.has_permission(v_organization_id,v_actor,''work.verify'',v_item.neighborhood_id,v_item.home_id) then
        return private.command_error(v_operation_id,''FORBIDDEN'',''An authorized supervisor must review completed work.'');
      end if;
      if v_item.reinspection_status = ''pending'' then
        return private.command_error(v_operation_id,''INVALID_TRANSITION'',''An Inspector has been assigned. Wait for the requested reinspection decision.'');
      end if;');
 execute definition;

 definition:=replace(pg_get_functiondef('private.quality_workflow_command(text,jsonb,uuid,uuid,uuid,bigint)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:='or attempt.submitted_by=target or';
 if strpos(definition,needle)=0 then raise exception 'Review reinspection independence check before applying migration'; end if;
 definition:=replace(definition,needle,'or attempt.submitted_by=target or attempt.accountable_internal_user_id=target or attempt.technician_user_id=target or');
 needle:='if action=''reinspect'' then';
 definition:=replace(definition,needle,needle||'
        if w.reinspection_status=''pending'' then raise check_violation using message=''This repair already has a pending reinspection.''; end if;');
 execute definition;

 definition:=replace(pg_get_functiondef('public.execute_command_before_work_completion(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:='elsif p_command_name = ''save_inspection_responses'' then';
 if strpos(definition,needle)=0 then raise exception 'Review inspection batch draft handler before applying migration'; end if;
 definition:=replace(definition,needle,needle||'
        if not (private.has_permission(v_organization_id,v_actor,''inspection.manage'',v_inspection.neighborhood_id,v_inspection.home_id)
          or private.has_permission(v_organization_id,v_actor,''inspection.perform'',v_inspection.neighborhood_id,v_inspection.home_id)
           and (v_inspection.lead_inspector_user_id=v_actor or exists(select 1 from public.inspection_participants ip where ip.inspection_id=v_inspection.id and ip.user_id=v_actor and ip.can_edit_draft))) then
          return private.command_error(v_operation_id,''FORBIDDEN'',''Only an assigned Inspector or supervisor can edit this draft.'');
        end if;');
 execute definition;
end; $patch$;

-- The observation upsert rewrite removed its error boundary. Restore structured
-- errors and rollback of every nested task if any assignment in the batch fails.
do $$ declare definition text; needle text; begin
 definition:=replace(pg_get_functiondef('private.inspection_observation_command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
 needle:='return result;'||chr(10)||'end;';
 if strpos(definition,needle)=0 then raise exception 'Review observation command error boundary before applying migration'; end if;
 definition:=replace(definition,needle,'return result;
exception when insufficient_privilege then return private.command_error(op,''FORBIDDEN'',sqlerrm);
 when serialization_failure then return private.command_error(op,''VERSION_CONFLICT'',sqlerrm);
 when check_violation or foreign_key_violation or not_null_violation or invalid_text_representation or unique_violation then return private.command_error(op,''VALIDATION_ERROR'',sqlerrm);
end;');
 execute definition;
end; $$;

create or replace function public.execute_command(p_command_name text,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb:=p_envelope->'payload'; h public.homes; ver uuid; result jsonb; error_detail text;
begin
 if p_command_name='save_inspection_responses' then
  return public.execute_command_before_work_completion(p_command_name,p_envelope);
 end if;
 if p_command_name in ('record_inspection_observation','create_observation_work','disregard_inspection_observation') then
  return private.inspection_observation_command(p_command_name,p_envelope);
 end if;
 if p_command_name in ('schedule_inspection','schedule_company_inspection') and coalesce((payload->>'plan_checklist')::boolean,false) then
  select * into h from public.homes where id=(payload->>'home_id')::uuid;
  ver:=private.snapshot_plan_checklist(h.organization_id,h.id,(p_envelope->>'operation_id')::uuid,(payload->>'plan_version')::bigint,coalesce(payload->'additional_items','[]'::jsonb));
  p_envelope:=jsonb_set(p_envelope,'{payload,template_version_id}',to_jsonb(ver));
  result:=public.execute_command_before_plan_checklists(p_command_name,p_envelope);
  -- A rejected schedule must not leave an orphan property snapshot.
  if not coalesce((result->>'ok')::boolean,false) then
   raise exception using errcode='BT002',message='Scheduling failed',detail=result::text;
  end if;
  return result;
 end if;
 return public.execute_command_before_plan_checklists(p_command_name,p_envelope);
exception when sqlstate 'BT002' then
 get stacked diagnostics error_detail=pg_exception_detail;
 return error_detail::jsonb;
end; $$;
revoke all on function public.execute_command(text,jsonb) from public,anon;
grant execute on function public.execute_command(text,jsonb) to authenticated;

create or replace function public.work_completion_context(p_org uuid,p_item uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.work_items; executable boolean; supervisor boolean; independent boolean; attempt uuid;
begin
 select * into w from public.work_items where organization_id=p_org and id=p_item;
 if not found or not private.can_read_work(auth.uid(),p_item) then raise insufficient_privilege using message='Work item is outside your access.'; end if;
 executable:=private.can_execute_work(auth.uid(),p_item) and w.state in ('assigned','acknowledged','in_progress','rework_required');
 supervisor:=private.has_permission(p_org,auth.uid(),'work.verify',w.neighborhood_id,w.home_id);
 select ca.id into attempt from public.correction_attempts ca where ca.organization_id=p_org and ca.work_item_id=p_item
  and not exists(select 1 from public.verifications v where v.organization_id=p_org and v.correction_attempt_id=ca.id)
  order by ca.attempt_number desc limit 1;
 independent:=coalesce(private.can_verify(auth.uid(),attempt),false);
 return jsonb_build_object(
  'can_complete',executable,
  'can_review',supervisor and independent and w.state='ready_for_verification' and w.reinspection_status is distinct from 'pending',
  'can_request_reinspection',supervisor and w.home_id is not null and w.state='ready_for_verification' and w.reinspection_status is distinct from 'pending',
  'review_block_reason',case when w.state<>'ready_for_verification' then null
   when w.reinspection_status='pending' then 'Waiting for the assigned Inspector’s reinspection decision.'
   when supervisor and not independent then 'Another authorized reviewer must review this completion. You cannot approve work you performed or submitted, or work completed by your company.'
   when not supervisor then 'An authorized supervisor will review this completion.' end,
  'evidence_exception_id',case when executable then (select id from public.evidence_exceptions where organization_id=p_org and work_item_id=p_item
   and consumed_by_attempt_id is null and (expires_at is null or expires_at>now()) order by created_at desc limit 1) end);
end; $$;
revoke all on function public.work_completion_context(uuid,uuid) from public,anon;
grant execute on function public.work_completion_context(uuid,uuid) to authenticated;

-- Notify supervisors of a review queue, without implying every repair needs an
-- Inspector visit. Existing API field names remain compatible with saved clients.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.notify_property_repairs_ready()'::regprocedure);
 definition:=replace(definition,'Property ready for reinspection','Property repairs ready for review');
 definition:=replace(definition,': all repair tasks are complete and the inspection report has been reviewed.',': repairs have been marked complete. Review and close the work, or request an optional reinspection.');
 execute definition;
end; $$;
notify pgrst,'reload schema';
commit;
