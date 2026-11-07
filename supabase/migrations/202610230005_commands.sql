begin;

create or replace function private.command_error(
  p_operation_id uuid,
  p_code text,
  p_message text,
  p_retryable boolean default false,
  p_current_version bigint default null,
  p_field_errors jsonb default null
)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'ok', false,
    'operation_id', p_operation_id,
    'error', jsonb_build_object(
      'code', p_code,
      'message', p_message,
      'retryable', p_retryable,
      'current_version', p_current_version,
      'field_errors', p_field_errors
    )
  ));
$$;

create or replace function private.command_success(p_operation_id uuid, p_data jsonb, p_replayed boolean default false)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'server_time', now(),
    'replayed', p_replayed,
    'data', p_data
  );
$$;

create or replace function private.append_work_event(
  p_item public.work_items,
  p_event_type text,
  p_from_state public.work_state,
  p_to_state public.work_state,
  p_actor_id uuid,
  p_operation_id uuid,
  p_details jsonb default '{}'::jsonb,
  p_assignment_episode_id uuid default null,
  p_client_captured_at timestamptz default null
)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.work_events(
    organization_id, work_item_id, assignment_episode_id, event_type, from_state, to_state,
    actor_id, operation_id, details, client_captured_at
  ) values (
    p_item.organization_id, p_item.id, p_assignment_episode_id, p_event_type, p_from_state, p_to_state,
    p_actor_id, p_operation_id, p_details, p_client_captured_at
  );
$$;

create or replace function private.append_audit(
  p_organization_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_operation_id uuid,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.audit_events(
    organization_id, actor_id, event_type, entity_type, entity_id, operation_id, before_data, after_data, metadata
  ) values (
    p_organization_id, p_actor_id, p_event_type, p_entity_type, p_entity_id, p_operation_id,
    p_before, p_after, p_metadata
  );
$$;

create or replace function private.item_readiness_invalidate(p_item public.work_items, p_reason text, p_actor_id uuid, p_operation_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_item.home_id is null then return; end if;
  update public.milestone_approvals
    set invalidated_at = now(), invalidation_reason = p_reason
    where organization_id = p_item.organization_id and home_id = p_item.home_id and invalidated_at is null;
  if found then
    perform private.append_audit(p_item.organization_id, p_actor_id, 'milestone.invalidated', 'home', p_item.home_id, p_operation_id, null, null, jsonb_build_object('reason', p_reason));
  end if;
end;
$$;

create or replace function public.execute_command(p_command_name text, p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_operation_id uuid;
  v_expected_version bigint;
  v_captured_at timestamptz;
  v_payload jsonb := coalesce(p_envelope -> 'payload', '{}'::jsonb);
  v_request_hash text;
  v_organization_id uuid;
  v_item public.work_items%rowtype;
  v_item_before public.work_items%rowtype;
  v_episode public.assignment_episodes%rowtype;
  v_attempt public.correction_attempts%rowtype;
  v_inspection public.inspections%rowtype;
  v_old_state public.work_state;
  v_target_state public.work_state;
  v_result jsonb;
  v_existing private.client_operations%rowtype;
  v_id uuid;
  v_count integer;
  v_attempt_number integer;
  v_internal_user uuid;
  v_company_id uuid;
  v_technician_id uuid;
  v_specialty_id uuid;
  v_due_at timestamptz;
  v_decision text;
  v_method text;
  v_rows jsonb;
  v_row jsonb;
  v_row_result jsonb;
  v_row_results jsonb;
  v_row_index integer;
  v_success_count integer;
  v_row_id uuid;
begin
  if v_actor is null then
    return private.command_error(null, 'UNAUTHENTICATED', 'A valid authenticated session is required.');
  end if;

  begin
    v_operation_id := (p_envelope ->> 'operation_id')::uuid;
  exception when others then
    return private.command_error(null, 'VALIDATION_ERROR', 'operation_id must be a UUID.');
  end;
  if v_operation_id is null then
    return private.command_error(null, 'VALIDATION_ERROR', 'operation_id is required.');
  end if;
  begin
    v_expected_version := nullif(p_envelope ->> 'expected_version', '')::bigint;
    v_captured_at := nullif(p_envelope ->> 'captured_at', '')::timestamptz;
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
      perform private.item_readiness_invalidate(v_item, 'A new work item was submitted.', v_actor, v_operation_id);

    elsif p_command_name = 'triage_work_item' then
      if not private.has_permission(v_organization_id, v_actor, 'work.triage', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Triage permission is required.');
      end if;
      update public.work_items set
        priority = coalesce(nullif(v_payload ->> 'priority','')::public.work_priority, priority)
      where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.triaged', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('notes', v_payload ->> 'notes'));

    elsif p_command_name = 'assign_work_item' then
      if not private.has_permission(v_organization_id, v_actor, 'work.assign', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Assignment permission is required.');
      end if;
      if v_item.state not in ('submitted','assigned','acknowledged','in_progress','blocked','rework_required') then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This item cannot be assigned in its current state.');
      end if;
      v_internal_user := nullif(v_payload ->> 'accountable_internal_user_id','')::uuid;
      v_company_id := nullif(v_payload ->> 'company_id','')::uuid;
      v_technician_id := nullif(v_payload ->> 'technician_id','')::uuid;
      v_specialty_id := nullif(v_payload ->> 'specialty_id','')::uuid;
      v_due_at := nullif(v_payload ->> 'due_at','')::timestamptz;
      if (v_internal_user is not null)::int + (v_company_id is not null)::int <> 1 or v_due_at is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Exactly one accountable party and a due date are required.');
      end if;
      if v_internal_user is not null and not private.active_member(v_organization_id, v_internal_user) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The internal assignee is not an active organization member.');
      end if;
      if v_company_id is not null and not exists (
        select 1 from public.neighborhood_trade_rosters r where r.organization_id = v_organization_id
          and r.neighborhood_id = v_item.neighborhood_id and r.company_id = v_company_id
          and (v_specialty_id is null or r.specialty_id = v_specialty_id) and r.status = 'active'
          and r.active_from <= now() and (r.active_to is null or r.active_to > now())
      ) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The company is not actively rostered for this neighborhood and specialty.');
      end if;
      if v_technician_id is not null and not private.active_company_membership(v_organization_id, v_company_id, v_technician_id, 'technician') then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The technician is not an active member of the accountable company.');
      end if;
      update public.assignment_episodes set ended_at = now(), end_reason = 'reassigned', reassignment_reason = nullif(v_payload ->> 'reason','')
        where organization_id = v_organization_id and work_item_id = v_item.id and ended_at is null;
      update public.blocker_events set resolved_at = now(), resolved_by = v_actor, resolution = coalesce(v_payload ->> 'reason','Reassigned')
        where organization_id = v_organization_id and work_item_id = v_item.id and resolved_at is null;
      insert into public.assignment_episodes(
        organization_id, work_item_id, internal_assignee_user_id, company_id, technician_user_id, specialty_id,
        assigned_by, due_at, reassignment_reason
      ) values (
        v_organization_id, v_item.id, v_internal_user, v_company_id, v_technician_id, v_specialty_id,
        v_actor, v_due_at, nullif(v_payload ->> 'reason','')
      ) returning * into v_episode;
      update public.work_items set current_assignment_id = v_episode.id, due_at = v_due_at, state = 'assigned', blocked_from_state = null, blocked_reason = null where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.assigned', v_old_state, v_item.state, v_actor, v_operation_id,
        jsonb_build_object('internal_assignee_user_id', v_internal_user, 'company_id', v_company_id, 'technician_id', v_technician_id, 'due_at', v_due_at, 'reason', v_payload ->> 'reason'), v_episode.id);
      if v_internal_user is not null then
        insert into public.notification_outbox(organization_id, recipient_user_id, work_item_id, assignment_episode_id, channel, dedupe_key, template_key, payload)
          values (v_organization_id, v_internal_user, v_item.id, v_episode.id, 'in_app', 'assignment:' || v_episode.id || ':in_app:' || v_internal_user, 'work_assigned', jsonb_build_object('work_item_id', v_item.id));
      end if;

    elsif p_command_name = 'delegate_company_work' then
      select * into v_episode from public.assignment_episodes where organization_id = v_organization_id and id = v_item.current_assignment_id and ended_at is null for update;
      if v_episode.company_id is null or not private.active_company_membership(v_organization_id, v_episode.company_id, v_actor, 'manager') then
        return private.command_error(v_operation_id, 'FORBIDDEN', 'Only an active manager of the accountable company may delegate.');
      end if;
      v_technician_id := nullif(v_payload ->> 'technician_id','')::uuid;
      if v_technician_id is not null and not private.active_company_membership(v_organization_id, v_episode.company_id, v_technician_id, 'technician') then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The technician does not belong to this company.');
      end if;
      update public.assignment_episodes set technician_user_id = v_technician_id where id = v_episode.id returning * into v_episode;
      update public.work_items set updated_at = now() where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.delegated', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('technician_id', v_technician_id), v_episode.id);

    elsif p_command_name = 'acknowledge_work' then
      if v_item.state <> 'assigned' or not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only the current accountable party may acknowledge assigned work.');
      end if;
      update public.assignment_episodes set acknowledged_at = coalesce(acknowledged_at, now()) where id = v_item.current_assignment_id returning * into v_episode;
      update public.work_items set state = 'acknowledged' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.acknowledged', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, v_episode.id, v_captured_at);

    elsif p_command_name = 'start_work' then
      if v_item.state not in ('acknowledged','rework_required') or not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only the current accountable party may start this work.');
      end if;
      update public.assignment_episodes set started_at = coalesce(started_at, now()) where id = v_item.current_assignment_id returning * into v_episode;
      update public.work_items set state = 'in_progress' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'work.started', v_old_state, v_item.state, v_actor, v_operation_id, '{}'::jsonb, v_episode.id, v_captured_at);

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
      perform private.append_work_event(v_item, 'work.unblocked', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('resolution', v_payload ->> 'resolution'), v_item.current_assignment_id);

    elsif p_command_name = 'submit_correction' then
      if v_item.state <> 'in_progress' or not private.can_execute_work(v_actor, v_item.id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only the current accountable party may submit an in-progress correction.');
      end if;
      if nullif(trim(v_payload ->> 'note'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A completion note is required.');
      end if;
      select count(*) into v_count from public.attachments a
        where a.organization_id = v_organization_id and a.work_item_id = v_item.id and a.status = 'ready' and a.visibility = 'shared'
          and a.id in (select value::uuid from jsonb_array_elements_text(coalesce(v_payload -> 'attachment_ids','[]'::jsonb)));
      if v_count = 0 and nullif(v_payload ->> 'evidence_exception_id','') is null then
        return private.command_error(v_operation_id, 'EVIDENCE_NOT_READY', 'At least one ready shared evidence file or an approved exception is required.');
      end if;
      if nullif(v_payload ->> 'evidence_exception_id','') is not null and not exists (
        select 1 from public.evidence_exceptions ee where ee.id = (v_payload ->> 'evidence_exception_id')::uuid
          and ee.organization_id = v_organization_id and ee.work_item_id = v_item.id and ee.consumed_by_attempt_id is null
          and (ee.expires_at is null or ee.expires_at > now())
      ) then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'The evidence exception is unavailable or expired.');
      end if;
      select * into v_episode from public.assignment_episodes where id = v_item.current_assignment_id and organization_id = v_organization_id and ended_at is null for update;
      select coalesce(max(attempt_number),0) + 1 into v_attempt_number from public.correction_attempts where organization_id = v_organization_id and work_item_id = v_item.id;
      insert into public.correction_attempts(
        organization_id, work_item_id, assignment_episode_id, attempt_number, submitted_by, completion_note,
        evidence_exception_id, accountable_company_id, accountable_internal_user_id, technician_user_id
      ) values (
        v_organization_id, v_item.id, v_episode.id, v_attempt_number, v_actor, trim(v_payload ->> 'note'),
        nullif(v_payload ->> 'evidence_exception_id','')::uuid, v_episode.company_id, v_episode.internal_assignee_user_id, v_episode.technician_user_id
      ) returning * into v_attempt;
      update public.attachments set correction_attempt_id = v_attempt.id
        where organization_id = v_organization_id and work_item_id = v_item.id and status = 'ready'
          and id in (select value::uuid from jsonb_array_elements_text(coalesce(v_payload -> 'attachment_ids','[]'::jsonb)));
      update public.evidence_exceptions set consumed_by_attempt_id = v_attempt.id where id = v_attempt.evidence_exception_id;
      update public.work_items set state = 'ready_for_verification' where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'correction.submitted', v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('attempt_id', v_attempt.id, 'attempt_number', v_attempt.attempt_number), v_episode.id, v_captured_at);

    elsif p_command_name = 'verify_correction' then
      if v_item.state <> 'ready_for_verification' then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'This item is not ready for verification.');
      end if;
      select ca.* into v_attempt from public.correction_attempts ca
        left join public.verifications v on v.organization_id = ca.organization_id and v.correction_attempt_id = ca.id
        where ca.organization_id = v_organization_id and ca.work_item_id = v_item.id and v.id is null
        order by ca.attempt_number desc limit 1 for update of ca;
      if not found or not private.can_verify(v_actor, v_attempt.id) then
        return private.command_error(v_operation_id, 'INDEPENDENCE_REQUIRED', 'Verification requires an eligible independent verifier.');
      end if;
      v_decision := v_payload ->> 'decision';
      v_method := v_payload ->> 'method';
      if v_decision not in ('accepted','rejected') or v_method not in ('on_site','remote') then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A valid decision and verification method are required.');
      end if;
      if v_item.safety_flag and v_method <> 'on_site' then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Safety-flagged work requires on-site verification.');
      end if;
      if v_decision = 'rejected' and nullif(trim(v_payload ->> 'notes'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A rejection reason is required.');
      end if;
      insert into public.verifications(organization_id, correction_attempt_id, decision, method, verified_by, notes)
        values (v_organization_id, v_attempt.id, v_decision, v_method, v_actor, nullif(trim(v_payload ->> 'notes'),''));
      if v_decision = 'accepted' then
        update public.assignment_episodes set ended_at = now(), end_reason = 'verified' where id = v_item.current_assignment_id;
        v_target_state := 'verified';
      else
        v_target_state := 'rework_required';
      end if;
      update public.work_items set state = v_target_state where id = v_item.id returning * into v_item;
      perform private.append_work_event(v_item, 'correction.' || v_decision, v_old_state, v_item.state, v_actor, v_operation_id, jsonb_build_object('attempt_id', v_attempt.id, 'method', v_method, 'notes', v_payload ->> 'notes'), v_item.current_assignment_id);

    elsif p_command_name = 'reopen_work' then
      if v_item.state <> 'verified' or not private.has_permission(v_organization_id, v_actor, 'work.verify', v_item.neighborhood_id, v_item.home_id) then
        return private.command_error(v_operation_id, 'INVALID_TRANSITION', 'Only an authorized verifier may reopen verified work.');
      end if;
      if nullif(trim(v_payload ->> 'reason'),'') is null then
        return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A reopening reason is required.');
      end if;
      select * into v_episode from public.assignment_episodes where organization_id = v_organization_id and work_item_id = v_item.id order by assigned_at desc limit 1;
      if v_episode.company_id is not null and not exists (
        select 1 from public.neighborhood_trade_rosters r where r.organization_id = v_organization_id and r.neighborhood_id = v_item.neighborhood_id and r.company_id = v_episode.company_id and r.status = 'active'
      ) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The prior accountable company is no longer eligible; specify a replacement through assignment.');
      end if;
      if v_episode.internal_assignee_user_id is not null and not private.active_member(v_organization_id, v_episode.internal_assignee_user_id) then
        return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The prior internal assignee is no longer active.');
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
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_item.id, 'version', v_item.version, 'state', v_item.state, 'attempt_id', v_attempt.id));

  elsif p_command_name = 'add_comment' then
    select * into v_item from public.work_items where id = (v_payload ->> 'item_id')::uuid and organization_id = v_organization_id;
    if not found or not private.can_read_work(v_actor, v_item.id) then
      return private.command_error(v_operation_id, 'NOT_FOUND', 'The requested work item was not found.');
    end if;
    if (v_payload ->> 'visibility') = 'internal' and not private.is_internal_member(v_organization_id, v_actor) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'External participants cannot create internal comments.');
    end if;
    insert into public.comments(organization_id, work_item_id, author_id, visibility, body)
      values (v_organization_id, v_item.id, v_actor, coalesce(v_payload ->> 'visibility','shared')::public.comment_visibility, trim(v_payload ->> 'body'))
      returning id into v_id;
    perform private.append_work_event(v_item, 'comment.added', v_item.state, v_item.state, v_actor, v_operation_id, jsonb_build_object('comment_id', v_id, 'visibility', v_payload ->> 'visibility'));
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_id, 'work_item_id', v_item.id));

  elsif p_command_name = 'schedule_inspection' then
    select * into v_item from public.work_items where false;
    if not exists (
      select 1 from public.homes h where h.id = (v_payload ->> 'home_id')::uuid and h.organization_id = v_organization_id
        and private.has_permission(v_organization_id, v_actor, 'inspection.manage', h.neighborhood_id, h.id)
    ) then
      return private.command_error(v_operation_id, 'FORBIDDEN', 'Inspection management permission is required.');
    end if;
    select neighborhood_id into v_id from public.homes where organization_id = v_organization_id and id = (v_payload ->> 'home_id')::uuid;
    if not exists (
      select 1 from public.checklist_versions cv
      where cv.organization_id = v_organization_id and cv.id = (v_payload ->> 'template_version_id')::uuid and cv.published_at is not null
    ) then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'A published checklist version is required.');
    end if;
    if not private.active_member(v_organization_id, (v_payload ->> 'lead_inspector_user_id')::uuid) or not (
      private.has_permission(v_organization_id, (v_payload ->> 'lead_inspector_user_id')::uuid, 'inspection.perform', v_id, (v_payload ->> 'home_id')::uuid)
      or private.has_permission(v_organization_id, (v_payload ->> 'lead_inspector_user_id')::uuid, 'inspection.manage', v_id, (v_payload ->> 'home_id')::uuid)
      or exists (
        select 1 from public.inspection_engagements ie
        where ie.organization_id = v_organization_id and ie.home_id = (v_payload ->> 'home_id')::uuid
          and ie.inspector_user_id = (v_payload ->> 'lead_inspector_user_id')::uuid
          and ie.starts_at <= now() and ie.ends_at > now() and ie.revoked_at is null
      )
    ) then
      return private.command_error(v_operation_id, 'ASSIGNEE_INELIGIBLE', 'The lead inspector is not eligible for this home.');
    end if;
    insert into public.inspections(organization_id, neighborhood_id, home_id, type, template_version_id, scheduled_at, lead_inspector_user_id)
      values (v_organization_id, v_id, (v_payload ->> 'home_id')::uuid, (v_payload ->> 'type')::public.inspection_type,
        (v_payload ->> 'template_version_id')::uuid, nullif(v_payload ->> 'scheduled_at','')::timestamptz, (v_payload ->> 'lead_inspector_user_id')::uuid)
      returning * into v_inspection;
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
      if v_expected_version is null or v_expected_version <> v_inspection.version then
        return private.command_error(v_operation_id, 'VERSION_CONFLICT', 'The inspection changed. Refresh before retrying.', false, v_inspection.version);
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
        update public.inspections set status = case when status = 'amended' then 'amended'::public.inspection_status else 'in_progress'::public.inspection_status end where id = v_inspection.id returning * into v_inspection;
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
      v_row_id := null;
      if nullif(trim(v_row ->> 'lot_code'), '') is null then
        v_row_result := jsonb_build_object('row', v_row_index, 'status', 'invalid', 'error', 'lot_code is required');
      elsif exists (
        select 1 from public.homes h where h.organization_id = v_organization_id
          and h.neighborhood_id = (v_payload ->> 'neighborhood_id')::uuid
          and lower(h.lot_code) = lower(trim(v_row ->> 'lot_code'))
      ) or (
        select count(*) from jsonb_array_elements(v_rows) candidate
        where lower(trim(candidate ->> 'lot_code')) = lower(trim(v_row ->> 'lot_code'))
      ) > 1 then
        v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'duplicate');
      elsif coalesce((v_payload ->> 'preview')::boolean, true) then
        v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'ready');
      else
        begin
          insert into public.homes(
            organization_id, neighborhood_id, lot_code, address_line1, address_line2, city, state_code,
            postal_code, phase, external_reference
          ) values (
            v_organization_id, (v_payload ->> 'neighborhood_id')::uuid, trim(v_row ->> 'lot_code'),
            nullif(trim(v_row ->> 'address_line1'), ''), nullif(trim(v_row ->> 'address_line2'), ''),
            nullif(trim(v_row ->> 'city'), ''), nullif(upper(trim(v_row ->> 'state_code')), ''),
            nullif(trim(v_row ->> 'postal_code'), ''), coalesce(nullif(trim(v_row ->> 'phase'), ''), 'planned'),
            nullif(trim(v_row ->> 'external_reference'), '')
          ) returning id into v_row_id;
          v_success_count := v_success_count + 1;
          v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'inserted', 'id', v_row_id);
          perform private.append_audit(v_organization_id, v_actor, 'home.imported', 'home', v_row_id, v_operation_id, null, v_row);
        exception when unique_violation or check_violation or foreign_key_violation then
          v_row_result := jsonb_build_object('row', v_row_index, 'lot_code', trim(v_row ->> 'lot_code'), 'status', 'invalid', 'error', 'The row failed validation.');
        end;
      end if;
      v_row_results := v_row_results || jsonb_build_array(v_row_result);
    end loop;
    v_result := private.command_success(v_operation_id, jsonb_build_object(
      'preview', coalesce((v_payload ->> 'preview')::boolean, true),
      'inserted_count', v_success_count,
      'rows', v_row_results
    ));

  elsif p_command_name = 'bulk_assign_work_items' then
    v_rows := coalesce(v_payload -> 'rows', '[]'::jsonb);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 or jsonb_array_length(v_rows) > 500 then
      return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Bulk assignment requires between 1 and 500 rows.');
    end if;
    v_row_results := '[]'::jsonb;
    v_success_count := 0;
    for v_row, v_row_index in
      select value, (ordinality - 1)::integer from jsonb_array_elements(v_rows) with ordinality
    loop
      v_row_result := public.execute_command('assign_work_item', jsonb_build_object(
        'operation_id', gen_random_uuid(),
        'expected_version', v_row -> 'expected_version',
        'captured_at', coalesce(p_envelope -> 'captured_at', to_jsonb(now())),
        'payload', (v_row - 'expected_version') || jsonb_build_object('item_id', v_row ->> 'item_id')
      ));
      if coalesce((v_row_result ->> 'ok')::boolean, false) then v_success_count := v_success_count + 1; end if;
      v_row_results := v_row_results || jsonb_build_array(jsonb_build_object('row', v_row_index, 'item_id', v_row ->> 'item_id', 'result', v_row_result));
    end loop;
    v_result := private.command_success(v_operation_id, jsonb_build_object(
      'success_count', v_success_count,
      'failure_count', jsonb_array_length(v_rows) - v_success_count,
      'rows', v_row_results
    ));

  else
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'Unknown command name.');
  end if;

  update private.client_operations set result = v_result where organization_id = v_organization_id and user_id = v_actor and operation_id = v_operation_id;
  return v_result;
exception
  when unique_violation then
    return private.command_error(v_operation_id, 'VERSION_CONFLICT', 'A concurrent operation changed this record. Refresh before retrying.', true);
  when check_violation or foreign_key_violation or not_null_violation or invalid_text_representation then
    return private.command_error(v_operation_id, 'VALIDATION_ERROR', 'The command payload failed validation.');
end;
$$;

revoke all on function public.execute_command(text, jsonb) from public, anon;
grant execute on function public.execute_command(text, jsonb) to authenticated;

create or replace function public.update_my_profile(p_display_name text, p_preferred_locale text default 'en', p_timezone text default null)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'unauthenticated'; end if;
  insert into public.profiles(id, display_name, preferred_locale, timezone)
    values (auth.uid(), trim(p_display_name), p_preferred_locale, p_timezone)
    on conflict (id) do update set display_name = excluded.display_name, preferred_locale = excluded.preferred_locale, timezone = excluded.timezone, updated_at = now()
    returning * into result;
  return result;
end;
$$;
revoke all on function public.update_my_profile(text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text) to authenticated;

commit;
