begin;

-- Remove non-existent column applied_at from client_operations update in execute_command

create or replace function public.execute_command(p_command_name text, p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_operation_id uuid;
  v_expected_version bigint;
  v_captured_at timestamptz;
  v_payload jsonb;
  v_organization_id uuid;
  v_existing private.client_operations;
  v_request_hash text;
  v_item public.work_items;
  v_item_before public.work_items;
  v_old_state public.work_state;
  v_target_state public.work_state;
  v_episode public.assignment_episodes;
  v_inspection public.inspections;
  v_id uuid;
  v_due_at timestamptz;
  v_result jsonb;
  v_rows jsonb;
  v_row jsonb;
  v_row_index integer;
  v_row_results jsonb;
  v_success_count integer;
  v_failure_count integer;
  v_lot text;
  v_plan text;
  v_address text;
  v_city text;
  v_state text;
  v_zip text;
  v_row_error text;
begin
  if v_actor is null then
    return private.command_error(gen_random_uuid(), 'UNAUTHENTICATED', 'Authentication is required.');
  end if;

  v_payload := coalesce(p_envelope -> 'payload', '{}'::jsonb);
  if p_envelope ? 'operation_id' then
    v_operation_id := (p_envelope ->> 'operation_id')::uuid;
  end if;
  if v_operation_id is null then
    return private.command_error(gen_random_uuid(), 'VALIDATION_ERROR', 'operation_id is required.');
  end if;

  begin
    if p_envelope ? 'expected_version' then
      v_expected_version := (p_envelope ->> 'expected_version')::bigint;
    end if;
    if p_envelope ? 'captured_at' then
      v_captured_at := (p_envelope ->> 'captured_at')::timestamptz;
    end if;
  exception when others then
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Invalid expected_version or captured_at.');
  end;

  if v_captured_at is not null and v_captured_at < now() - interval '90 days' then
    return private.command_error(v_operation_id, 'OPERATION_EXPIRED', 'Offline operation is older than the accepted retry window.');
  end if;

  begin
    if v_payload ? 'organization_id' then
      v_organization_id := (v_payload ->> 'organization_id')::uuid;
    elsif v_payload ? 'item_id' then
      select organization_id into v_organization_id from public.work_items where id = (v_payload ->> 'item_id')::uuid;
    elsif v_payload ? 'inspection_id' then
      select organization_id into v_organization_id from public.inspections where id = (v_payload ->> 'inspection_id')::uuid;
    elsif v_payload ? 'home_id' then
      select organization_id into v_organization_id from public.homes where id = (v_payload ->> 'home_id')::uuid;
    end if;
  exception when others then
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Invalid entity identifier.');
  end;

  if v_organization_id is null or not private.active_member(v_organization_id, v_actor) then
    return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested record was not found.');
  end if;

  v_request_hash := encode(extensions.digest((jsonb_build_object('command_name', p_command_name, 'envelope', p_envelope))::text, 'sha256'), 'hex');
  insert into private.client_operations(organization_id, user_id, operation_id, command_name, request_hash)
    values (v_organization_id, v_actor, v_operation_id, p_command_name, v_request_hash)
    on conflict (organization_id, user_id, operation_id) do nothing;

  select * into v_existing from private.client_operations
    where organization_id = v_organization_id and user_id = v_actor and operation_id = v_operation_id
    for update;
  if v_existing.request_hash <> v_request_hash or v_existing.command_name <> p_command_name then
    return private.command_error(v_operation_id, 'OPERATION_REUSE', 'This operation_id was already used with different input.');
  end if;
  if v_existing.created_at < now() - interval '90 days' then
    return private.command_error(v_operation_id, 'OPERATION_EXPIRED', 'The idempotency record has expired.');
  end if;
  if v_existing.result is not null then
    if not private.active_member(v_organization_id, v_actor) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested record was not found.');
    end if;
    return jsonb_set(v_existing.result, '{replayed}', 'true'::jsonb, true);
  end if;

  if p_command_name = 'create_work_item' then
    if not private.has_permission(v_organization_id, v_actor, 'work.create', (v_payload ->> 'neighborhood_id')::uuid, nullif(v_payload ->> 'home_id','')::uuid) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'You do not have permission to create work in this scope.');
    end if;
    v_id := coalesce(nullif(v_payload ->> 'id', '')::uuid, gen_random_uuid());
    insert into public.work_items(
      id, organization_id, neighborhood_id, home_id, location_id, common_area_location, inspection_id,
      origin, title, description, priority, safety_flag, created_by, client_captured_at
    ) values (
      v_id, v_organization_id, (v_payload ->> 'neighborhood_id')::uuid,
      nullif(v_payload ->> 'home_id','')::uuid, nullif(v_payload ->> 'location_id','')::uuid,
      nullif(trim(v_payload ->> 'common_area_location'), ''), nullif(v_payload ->> 'inspection_id','')::uuid,
      coalesce(v_payload ->> 'origin', 'internal_observation')::public.work_origin,
      trim(v_payload ->> 'title'), trim(v_payload ->> 'description'),
      coalesce(v_payload ->> 'priority','normal')::public.work_priority, coalesce((v_payload ->> 'safety_flag')::boolean, false),
      v_actor, v_captured_at
    ) returning * into v_item;
    perform private.append_work_event(v_item, 'work.created', null, 'draft', v_actor, v_operation_id, '{}'::jsonb, null, v_captured_at);
    perform private.append_audit(v_organization_id, v_actor, 'work.created', 'work_item', v_item.id, v_operation_id, null, to_jsonb(v_item));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_item.id, 'version', v_item.version, 'state', v_item.state));

  elsif p_command_name in ('update_work_draft','submit_work_item','triage_work_item','assign_work_item','delegate_company_work','acknowledge_work','start_work','block_work','unblock_work','submit_correction','verify_correction','reopen_work','cancel_work','update_due_date','issue_evidence_exception') then
    select * into v_item from public.work_items where id = (v_payload ->> 'item_id')::uuid and organization_id = v_organization_id for update;
    if not found or not private.can_read_work(v_actor, v_item.id) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested work item was not found.');
    end if;
    if v_expected_version is null then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'expected_version is required.');
    end if;
    if v_expected_version <> v_item.version then
      return private.command_error(v_operation_id, 'VERSION_CONFLICT', 'The work item changed. Refresh before retrying.', false, v_item.version);
    end if;
    v_item_before := v_item;
    v_old_state := v_item.state;

    if p_command_name = 'update_work_draft' then
      if v_item.state <> 'draft' or not (v_item.created_by = v_actor or private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Only an authorized draft editor may change this item.');
      end if;
      update public.work_items set
        title = coalesce(nullif(trim(v_payload ->> 'title'), ''), title),
        description = coalesce(nullif(trim(v_payload ->> 'description'), ''), description),
        priority = coalesce(nullif(v_payload ->> 'priority','')::public.work_priority, priority),
        safety_flag = coalesce((v_payload ->> 'safety_flag')::boolean, safety_flag)
      where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.draft_updated', 'draft', 'draft', v_actor, v_operation_id);

    elsif p_command_name = 'submit_work_item' then
      if v_item.state <> 'draft' or not (v_item.created_by = v_actor or private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only an authorized draft can be submitted.');
      end if;
      if v_item.inspection_id is not null then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Inspection findings are submitted with their inspection.');
      end if;
      update public.work_items set state = 'submitted', submitted_at = now() where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.submitted', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, null, v_captured_at);

    elsif p_command_name = 'triage_work_item' then
      if not private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Triage permission is required.');
      end if;
      if v_item.state <> 'submitted' then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only submitted work can be triaged.');
      end if;
      update public.work_items set
        priority = coalesce(nullif(v_payload ->> 'priority','')::public.work_priority, v_item.priority),
        safety_flag = coalesce((v_payload ->> 'safety_flag')::boolean, v_item.safety_flag),
        location_id = coalesce(nullif(v_payload ->> 'location_id','')::uuid, v_item.location_id)
      where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.triaged', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('notes', v_payload ->> 'notes'));

    elsif p_command_name in ('assign_work_item', 'delegate_company_work') then
      if p_command_name = 'delegate_company_work' then
        if not private.has_company_membership(v_organization_id, (v_payload ->> 'company_id')::uuid, v_actor, array['owner','admin','lead']::public.company_role[]) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'You are not authorized to delegate work for this trade partner.');
        end if;
      else
        if not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'Assignment permission is required.');
        end if;
      end if;
      if v_item.state not in ('submitted', 'assigned', 'acknowledged', 'rework_required') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This work item cannot be assigned in its current state.');
      end if;

      v_episode := private.create_assignment_episode(
        v_organization_id, v_item,
        nullif(v_payload ->> 'internal_assignee_user_id','')::uuid,
        nullif(v_payload ->> 'company_id','')::uuid,
        nullif(v_payload ->> 'technician_user_id','')::uuid,
        nullif(v_payload ->> 'specialty_id','')::uuid,
        v_actor,
        coalesce(nullif(v_payload ->> 'due_at','')::timestamptz, now() + interval '2 days'),
        v_payload ->> 'reason',
        nullif(v_payload ->> 'instructions','')
      );
      update public.work_items set
        state = 'assigned',
        current_assignment_id = v_episode.id,
        due_at = v_episode.due_at,
        assigned_at = now()
      where id = v_item.id returning * into v_item;
      perform private.item_readiness_invalidate(v_item, 'Work assigned.', v_actor, v_operation_id);
      perform private.append_work_event(v_item, 'work.assigned', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('assignment_episode_id', v_episode.id, 'reason', v_payload ->> 'reason'), v_episode.id);

    elsif p_command_name = 'acknowledge_work' then
      if not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Only the assigned party may acknowledge this work.');
      end if;
      if v_item.state <> 'assigned' then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only assigned work can be acknowledged.');
      end if;
      update public.assignment_episodes set acknowledged_at = now() where id = v_item.current_assignment_id;
      update public.work_items set state = 'acknowledged' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.acknowledged', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, v_item.current_assignment_id);

    elsif p_command_name = 'start_work' then
      if not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Only the assigned party may start this work.');
      end if;
      if v_item.state not in ('assigned','acknowledged') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only assigned or acknowledged work can be started.');
      end if;
      update public.assignment_episodes set started_at = now(), acknowledged_at = coalesce(acknowledged_at, now()) where id = v_item.current_assignment_id;
      update public.work_items set state = 'in_progress' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.started', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, v_item.current_assignment_id);

    elsif p_command_name = 'block_work' then
      if v_item.state not in ('assigned','acknowledged','in_progress','rework_required') or not (private.can_execute_work(v_actor, v_item.id) or private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This item cannot be blocked by the current user.');
      end if;
      if nullif(trim(v_payload ->> 'notes'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Blocker notes are required.');
      end if;
      insert into public.blocker_events(organization_id, work_item_id, assignment_episode_id, cause, notes, opened_by)
        values (v_organization_id, v_item.id, v_item.current_assignment_id, coalesce(v_payload ->> 'cause','other'), trim(v_payload ->> 'notes'), v_actor);
      update public.work_items set state = 'blocked', blocked_from_state = v_old_state, blocked_reason = trim(v_payload ->> 'notes') where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.blocked', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('cause', v_payload ->> 'cause', 'notes', v_payload ->> 'notes'), v_item.current_assignment_id, v_captured_at);

    elsif p_command_name = 'unblock_work' then
      if v_item.state <> 'blocked' or not (private.can_execute_work(v_actor, v_item.id) or private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This blocked item cannot be resumed by the current user.');
      end if;
      if nullif(trim(v_payload ->> 'resolution'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A blocker resolution is required.');
      end if;
      v_target_state := coalesce(v_item.blocked_from_state, 'assigned');
      update public.blocker_events set resolved_at = now(), resolved_by = v_actor, resolution = trim(v_payload ->> 'resolution')
        where organization_id = v_organization_id and work_item_id = v_item.id and resolved_at is null;
      update public.work_items set state = v_target_state, blocked_from_state = null, blocked_reason = null where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.unblocked', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('resolution', v_payload ->> 'resolution'), v_item.current_assignment_id, v_captured_at);

    elsif p_command_name = 'submit_correction' then
      if not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Only the assigned party may submit a correction.');
      end if;
      if v_item.state not in ('assigned','acknowledged','in_progress','rework_required') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Work is not in an executable state.');
      end if;
      insert into public.correction_attempts(organization_id, work_item_id, assignment_episode_id, summary, submitted_by)
        values (v_organization_id, v_item.id, v_item.current_assignment_id, trim(v_payload ->> 'summary'), v_actor)
        returning id into v_id;
      update public.work_items set state = 'ready_for_verification' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.correction_submitted', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('correction_id', v_id, 'summary', v_payload ->> 'summary'), v_item.current_assignment_id, v_captured_at);

    elsif p_command_name = 'verify_correction' then
      if not private.has_permission(v_organization_id, v_actor, 'work.verify', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Verification permission is required.');
      end if;
      if v_item.created_by = v_actor and not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'INDEPENDENCE_REQUIRED', 'Independent verification is required.');
      end if;
      if v_item.state <> 'ready_for_verification' then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only work marked ready for verification can be verified.');
      end if;
      if not exists (select 1 from public.assignment_episodes where id = v_item.current_assignment_id and technician_user_id = v_actor)
         and not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Verifier must be independent.');
      end if;
      if not exists (
        select 1 from public.attachments a
        where a.organization_id = v_organization_id and a.work_item_id = v_item.id and a.status = 'ready'
      ) and not exists (
        select 1 from public.evidence_exceptions e
        where e.organization_id = v_organization_id and e.work_item_id = v_item.id and (e.expires_at is null or e.expires_at > now())
      ) then
        return private.command_error(v_operation_id, 'EVIDENCE_NOT_READY', 'Ready photo evidence or an active exception is required before verification.');
      end if;

      insert into public.verifications(organization_id, work_item_id, verified_by, notes)
        values (v_organization_id, v_item.id, v_actor, nullif(trim(v_payload ->> 'notes'),''))
        returning id into v_id;
      update public.assignment_episodes set ended_at = now(), end_reason = 'verified' where id = v_item.current_assignment_id;
      update public.work_items set state = 'verified', verified_at = now() where id = v_item.id returning * into v_item;
      perform private.item_readiness_invalidate(v_item, 'Work verified.', v_actor, v_operation_id);
      perform private.append_work_event(v_item, 'work.verified', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('verification_id', v_id), v_item.current_assignment_id);

    elsif p_command_name = 'reopen_work' then
      if not private.has_permission(v_organization_id, v_actor, 'work.verify', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Verification permission is required to reopen work.');
      end if;
      if v_item.state not in ('ready_for_verification', 'verified') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only completed work can be reopened.');
      end if;
      if nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A reopen reason is required.');
      end if;
      select * into v_episode from public.assignment_episodes where id = v_item.current_assignment_id;
      if not found then
        return private.command_error(v_operation_id, 'NOT_FOUND', 'The prior assignment episode was not found.');
      end if;
      insert into public.assignment_episodes(organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id, assigned_by, due_at, reassignment_reason)
        values (v_organization_id, v_item.id, v_episode.internal_assignee_user_id, v_episode.company_id, v_episode.technician_user_id, v_episode.specialty_id, v_actor, coalesce(v_item.due_at, now() + interval '1 day'), 'Reopened: ' || trim(v_payload ->> 'reason'))
        returning * into v_episode;
      update public.work_items set state = 'rework_required', reopened_count = reopened_count + 1, current_assignment_id = v_episode.id where id = v_item.id returning * into v_item;
      perform private.item_readiness_invalidate(v_item, 'Verified work was reopened.', v_actor, v_operation_id);
      perform private.append_work_event(v_item, 'work.reopened', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('reason', v_payload ->> 'reason'), v_episode.id);

    elsif p_command_name = 'cancel_work' then
      if v_item.state = 'verified' or v_item.state = 'cancelled' then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Verified or cancelled work cannot be cancelled directly.');
      end if;
      if not ((v_item.state = 'draft' and v_item.created_by = v_actor) or private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id)) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Cancellation requires triage permission.');
      end if;
      if nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A cancellation reason is required.');
      end if;
      update public.assignment_episodes set ended_at = now(), end_reason = 'cancelled' where organization_id = v_organization_id and work_item_id = v_item.id and ended_at is null;
      update public.blocker_events set resolved_at = now(), resolved_by = v_actor, resolution = 'Cancelled' where organization_id = v_organization_id and work_item_id = v_item.id and resolved_at is null;
      update public.work_items set state = 'cancelled', duplicate_of_id = nullif(v_payload ->> 'duplicate_of_id','')::uuid, blocked_from_state = null, blocked_reason = null where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.cancelled', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('reason', v_payload ->> 'reason', 'duplicate_of_id', v_payload ->> 'duplicate_of_id'));

    elsif p_command_name = 'update_due_date' then
      if not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) or v_item.current_assignment_id is null then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Assignment permission and an active assignment are required.');
      end if;
      v_due_at := nullif(v_payload ->> 'new_due_at','')::timestamptz;
      if v_due_at is null or nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A new due date and reason are required.');
      end if;
      update public.assignment_episodes set due_at = v_due_at where id = v_item.current_assignment_id;
      update public.work_items set due_at = v_due_at where id = v_item.id returning * into v_item;
      update public.notification_outbox set status = 'cancelled', updated_at = now() where organization_id = v_organization_id and assignment_episode_id = v_item.current_assignment_id and status in ('pending','failed');
      perform private.append_work_event(v_item, 'work.due_date_changed', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('old_due_at', v_item_before.due_at, 'new_due_at', v_due_at, 'reason', v_payload ->> 'reason'), v_item.current_assignment_id);

    elsif p_command_name = 'issue_evidence_exception' then
      if not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Assignment permission is required to authorize an evidence exception.');
      end if;
      if nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'An exception reason is required.');
      end if;
      insert into public.evidence_exceptions(organization_id, work_item_id, authorized_by, reason, expires_at)
        values (v_organization_id, v_item.id, v_actor, trim(v_payload ->> 'reason'), nullif(v_payload ->> 'expires_at','')::timestamptz)
        returning id into v_id;
      update public.work_items set updated_at = now() where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'evidence.exception_issued', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('exception_id', v_id, 'reason', v_payload ->> 'reason'));
    end if;

    perform private.append_audit(v_organization_id, v_actor, p_command_name, 'work_item', v_item.id, v_operation_id, to_jsonb(v_item_before), to_jsonb(v_item));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_item.id, 'version', v_item.version, 'state', v_item.state));

  elsif p_command_name = 'schedule_inspection' then
    if not private.has_permission(v_organization_id, v_actor, 'inspection.schedule', (v_payload ->> 'neighborhood_id')::uuid, (v_payload ->> 'home_id')::uuid) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'Inspection schedule permission is required.');
    end if;
    v_id := coalesce(nullif(v_payload ->> 'id', '')::uuid, gen_random_uuid());
    insert into public.inspections(organization_id, neighborhood_id, home_id, type, template_version_id, scheduled_at, lead_inspector_user_id)
      values (
        v_organization_id, (v_payload ->> 'neighborhood_id')::uuid, (v_payload ->> 'home_id')::uuid,
        (v_payload ->> 'type')::public.inspection_type, (v_payload ->> 'template_version_id')::uuid,
        nullif(v_payload ->> 'scheduled_at','')::timestamptz, coalesce(nullif(v_payload ->> 'lead_inspector_user_id','')::uuid, v_actor)
      ) returning * into v_inspection;
    insert into public.inspection_participants(organization_id, inspection_id, user_id, can_edit_draft)
      values (v_organization_id, v_inspection.id, v_inspection.lead_inspector_user_id, true) on conflict do nothing;
    perform private.append_audit(v_organization_id, v_actor, 'inspection.scheduled', 'inspection', v_inspection.id, v_operation_id, null, to_jsonb(v_inspection));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status));

  elsif p_command_name in ('upsert_inspection_response','submit_inspection','begin_inspection_amendment','approve_milestone') then
    if p_command_name = 'approve_milestone' then
      select neighborhood_id into v_id from public.homes where id = (v_payload ->> 'home_id')::uuid and organization_id = v_organization_id;
      if v_id is null or not private.has_permission(v_organization_id, v_actor, 'milestone.approve', v_id, (v_payload ->> 'home_id')::uuid) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Milestone approval permission is required.');
      end if;
      perform 1 from public.homes where id = (v_payload ->> 'home_id')::uuid and organization_id = v_organization_id for update;
      if exists (select 1 from public.home_summary h where h.id = (v_payload ->> 'home_id')::uuid and h.readiness <> 'ready_for_review') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'The home is not ready for milestone review.');
      end if;
      insert into public.milestone_approvals(organization_id, home_id, milestone_code, approved_by, snapshot)
        values (v_organization_id, (v_payload ->> 'home_id')::uuid, v_payload ->> 'milestone_code', v_actor, jsonb_build_object('approved_at', now()))
        returning id into v_id;
      perform private.append_audit(v_organization_id, v_actor, 'milestone.approved', 'home', (v_payload ->> 'home_id')::uuid, v_operation_id, null, jsonb_build_object('approval_id', v_id));
      v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_id, 'status', 'approved'));
    else
      select * into v_inspection from public.inspections where id = (v_payload ->> 'inspection_id')::uuid and organization_id = v_organization_id for update;
      if not found or not private.can_read_inspection(v_actor, v_inspection.id) then
        return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested inspection was not found.');
      end if;

      -- Enforce strict version check only for lifecycle amendments and final submission, not individual question responses
      if p_command_name in ('begin_inspection_amendment', 'submit_inspection') then
        if v_expected_version is null or v_expected_version <> v_inspection.version then
          return private.command_error(v_operation_id, 'VERSION_CONFLICT', 'The inspection changed. Refresh before retrying.', false, v_inspection.version);
        end if;
      end if;

      if p_command_name = 'begin_inspection_amendment' then
        if not private.has_permission(v_organization_id, v_actor, 'inspection.manage', v_inspection.neighborhood_id, v_inspection.home_id) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'Inspection management permission is required to begin an amendment.');
        end if;
        if v_inspection.status <> 'submitted' then
          return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only a submitted inspection can be amended.');
        end if;
        update public.inspections set current_revision = current_revision + 1, status = 'amended' where id = v_inspection.id returning * into v_inspection;
        perform private.append_audit(v_organization_id, v_actor, 'inspection.amendment_started', 'inspection', v_inspection.id, v_operation_id, null, to_jsonb(v_inspection));
        v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status, 'revision', v_inspection.current_revision));
      elsif p_command_name = 'upsert_inspection_response' then
        if not (
          private.has_permission(v_organization_id, v_actor, 'inspection.perform', v_inspection.neighborhood_id, v_inspection.home_id)
          or private.has_permission(v_organization_id, v_actor, 'inspection.manage', v_inspection.neighborhood_id, v_inspection.home_id)
          or exists (select 1 from public.inspection_participants ip where ip.organization_id = v_organization_id and ip.inspection_id = v_inspection.id and ip.user_id = v_actor and ip.can_edit_draft)
        ) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'You cannot edit this inspection draft.');
        end if;
        if v_inspection.status not in ('draft','in_progress','amended') then
          return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Submitted inspection responses are immutable.');
        end if;
        insert into public.inspection_responses(organization_id, inspection_id, question_id, result, explanation, finding_work_item_id)
          values (v_organization_id, v_inspection.id, (v_payload ->> 'question_id')::uuid, (v_payload ->> 'response')::public.inspection_result,
            nullif(trim(v_payload ->> 'reason'),''), nullif(v_payload ->> 'finding_id','')::uuid)
          on conflict (organization_id, inspection_id, question_id) do update set result = excluded.result, explanation = excluded.explanation, finding_work_item_id = excluded.finding_work_item_id;

        -- Only transition from 'draft' to 'in_progress'; do not update inspections if already 'in_progress' or 'amended'
        if v_inspection.status = 'draft' then
          update public.inspections set status = 'in_progress' where id = v_inspection.id returning * into v_inspection;
        end if;
        v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status));
      else
        if not (
          private.has_permission(v_organization_id, v_actor, 'inspection.perform', v_inspection.neighborhood_id, v_inspection.home_id)
          or private.has_permission(v_organization_id, v_actor, 'inspection.manage', v_inspection.neighborhood_id, v_inspection.home_id)
          or exists (select 1 from public.inspection_participants ip where ip.organization_id = v_organization_id and ip.inspection_id = v_inspection.id and ip.user_id = v_actor and ip.can_edit_draft)
        ) then
          return private.command_error(v_operation_id, 'FORBIDDEN', 'You cannot submit this inspection.');
        end if;
        if v_inspection.status not in ('draft','in_progress','amended') then
          return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This inspection cannot be submitted.');
        end if;
        if exists (
          select 1 from public.checklist_questions q
          where q.organization_id = v_organization_id and q.version_id = v_inspection.template_version_id and q.requires_response
            and not exists (select 1 from public.inspection_responses r where r.organization_id = v_organization_id and r.inspection_id = v_inspection.id and r.question_id = q.id)
        ) then
          return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Every required checklist question must have a response.');
        end if;
        update public.work_items set state = 'submitted', submitted_at = now()
          where organization_id = v_organization_id and inspection_id = v_inspection.id and state = 'draft';
        insert into public.inspection_submissions(organization_id, inspection_id, revision_number, snapshot, submitted_by)
          select v_organization_id, v_inspection.id, v_inspection.current_revision,
            jsonb_build_object(
              'inspection', to_jsonb(v_inspection),
              'responses', coalesce((select jsonb_agg(to_jsonb(r) order by q.ordinal) from public.inspection_responses r join public.checklist_questions q on q.organization_id = r.organization_id and q.id = r.question_id where r.organization_id = v_organization_id and r.inspection_id = v_inspection.id), '[]'::jsonb),
              'finding_ids', coalesce((select jsonb_agg(w.id) from public.work_items w where w.organization_id = v_organization_id and w.inspection_id = v_inspection.id), '[]'::jsonb),
              'attachment_ids', coalesce((select jsonb_agg(a.id) from public.attachments a where a.organization_id = v_organization_id and a.inspection_id = v_inspection.id and a.status = 'ready'), '[]'::jsonb)
            ), v_actor;
        update public.inspections set status = 'submitted' where id = v_inspection.id returning * into v_inspection;
        perform private.append_audit(v_organization_id, v_actor, 'inspection.submitted', 'inspection', v_inspection.id, v_operation_id, null, to_jsonb(v_inspection));
        v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_inspection.id, 'version', v_inspection.version, 'status', v_inspection.status, 'revision', v_inspection.current_revision));
      end if;
    end if;
  elsif p_command_name = 'import_homes' then
    if not private.require_aal2() or not private.has_permission(v_organization_id, v_actor, 'structure.manage', null, null) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'Home import requires an aal2 administrator session.');
    end if;
    if not exists (select 1 from public.neighborhoods where organization_id = v_organization_id and id = (v_payload ->> 'neighborhood_id')::uuid) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The target neighborhood was not found.');
    end if;
    v_rows := coalesce(v_payload -> 'rows', '[]'::jsonb);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 or jsonb_array_length(v_rows) > 1000 then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Home import requires between 1 and 1000 rows.');
    end if;
    v_row_results := '[]'::jsonb;
    v_success_count := 0;
    for v_row, v_row_index in
      select value, (ordinality - 1)::integer from jsonb_array_elements(v_rows) with ordinality
    loop
      v_lot := trim(coalesce(v_row ->> 'lot_code', ''));
      v_plan := trim(coalesce(v_row ->> 'plan_name', ''));
      v_address := trim(coalesce(v_row ->> 'address_line1', ''));
      v_city := trim(coalesce(v_row ->> 'city', ''));
      v_state := trim(coalesce(v_row ->> 'state', ''));
      v_zip := trim(coalesce(v_row ->> 'postal_code', ''));

      v_row_error := null;
      if v_lot = '' then
        v_row_error := 'Lot code is required.';
      elsif v_plan = '' then
        v_row_error := 'Plan name is required.';
      elsif v_address = '' then
        v_row_error := 'Address line 1 is required.';
      elsif v_city = '' or v_state = '' or v_zip = '' then
        v_row_error := 'City, state, and postal code are required.';
      end if;

      if v_row_error is not null then
        v_row_results := v_row_results || jsonb_build_object('row_index', v_row_index, 'ok', false, 'error', v_row_error);
      else
        insert into public.homes(organization_id, neighborhood_id, lot_code, plan_name, address_line1, city, state, postal_code)
          values (v_organization_id, (v_payload ->> 'neighborhood_id')::uuid, v_lot, v_plan, v_address, v_city, v_state, v_zip)
          on conflict (organization_id, neighborhood_id, lot_code) do update set
            plan_name = excluded.plan_name,
            address_line1 = excluded.address_line1,
            city = excluded.city,
            state = excluded.state,
            postal_code = excluded.postal_code
          returning id into v_id;
        v_success_count := v_success_count + 1;
        v_row_results := v_row_results || jsonb_build_object('row_index', v_row_index, 'ok', true, 'id', v_id);
      end if;
    end loop;
    v_failure_count := jsonb_array_length(v_rows) - v_success_count;
    perform private.append_audit(v_organization_id, v_actor, 'homes.imported', 'neighborhood', (v_payload ->> 'neighborhood_id')::uuid, v_operation_id, null, jsonb_build_object('success_count', v_success_count, 'failure_count', v_failure_count));
    v_result := private.command_success(v_operation_id, jsonb_build_object('success_count', v_success_count, 'failure_count', v_failure_count, 'rows', v_row_results));
  else
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Unknown command.');
  end if;

  update private.client_operations
    set result = v_result
    where organization_id = v_organization_id and user_id = v_actor and operation_id = v_operation_id;

  return v_result;
end;
$$;

notify pgrst, 'reload schema';

commit;

