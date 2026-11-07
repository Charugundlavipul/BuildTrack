begin;

-- Preserve the existing command validations, idempotency, audit, and notification behavior.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.execute_command(text,jsonb)'::regprocedure);
  definition:=replace(definition,E'\r\n',E'\n');
  if strpos(definition,'if p_command_name = ''create_work_item'' then')=0 or
    strpos(definition,'if v_item.state not in (''submitted'',''assigned'',''acknowledged'',''in_progress'',''blocked'',''rework_required'') then')=0 then
    raise exception 'execute_command changed; direct-assignment migration requires review';
  end if;
  definition:=replace(definition,'if p_command_name = ''create_work_item'' then',
    'if p_command_name in (''create_work_item'',''create_and_assign_work_item'') then');
  definition:=replace(definition,
    'v_result := private.command_success(v_operation_id, jsonb_build_object(''id'', v_item.id, ''version'', v_item.version, ''state'', v_item.state));',
    $patch$
    if p_command_name='create_and_assign_work_item' then
      v_row_result:=public.execute_command('assign_work_item',jsonb_build_object(
        'operation_id',gen_random_uuid(),'expected_version',v_item.version,'captured_at',v_captured_at,
        'payload',coalesce(v_payload->'assignment','{}'::jsonb)||jsonb_build_object('organization_id',v_organization_id,'item_id',v_item.id)));
      if not coalesce((v_row_result->>'ok')::boolean,false) then
        raise exception using errcode='BT001',message='Assignment failed',detail=v_row_result::text;
      end if;
      select * into v_item from public.work_items where id=v_item.id;
    end if;
    v_result := private.command_success(v_operation_id, jsonb_build_object('id', v_item.id, 'version', v_item.version, 'state', v_item.state));
    $patch$);
  definition:=replace(definition,
    'if v_item.state not in (''submitted'',''assigned'',''acknowledged'',''in_progress'',''blocked'',''rework_required'') then',
    'if v_item.state not in (''draft'',''submitted'',''assigned'',''acknowledged'',''in_progress'',''blocked'',''rework_required'') then');
  definition:=replace(definition,
    'v_internal_user := nullif(v_payload ->> ''accountable_internal_user_id'','''')::uuid;',
    $patch$
      if v_item.state='draft' and v_item.inspection_id is not null then
        return private.command_error(v_operation_id,'INVALID_TRANSITION','Submit the inspection before assigning its findings.');
      end if;
      v_internal_user := nullif(v_payload ->> 'accountable_internal_user_id','')::uuid;
    $patch$);
  definition:=replace(definition,
    'update public.work_items set current_assignment_id = v_episode.id, due_at = v_due_at, state = ''assigned'',',
    'update public.work_items set submitted_at=coalesce(submitted_at,now()), current_assignment_id = v_episode.id, due_at = v_due_at, state = ''assigned'',');
  definition:=replace(definition,
    'perform private.append_work_event(v_item, ''work.assigned'',',
    $patch$
      if v_old_state='draft' then
        perform private.item_readiness_invalidate(v_item,'A new work item was assigned.',v_actor,v_operation_id);
      end if;
      perform private.append_work_event(v_item, 'work.assigned',
    $patch$);
  definition:=replace(definition,E'exception\n  when unique_violation then',
    $patch$exception
  when sqlstate 'BT001' then
    get stacked diagnostics v_row_result = PG_EXCEPTION_DETAIL;
    return jsonb_set(v_row_result,'{operation_id}',to_jsonb(v_operation_id));
  when unique_violation then$patch$);
  -- Diagnostic detail is text; collect it separately before parsing JSON.
  definition:=replace(definition,'get stacked diagnostics v_row_result = PG_EXCEPTION_DETAIL;',
    'get stacked diagnostics v_request_hash = PG_EXCEPTION_DETAIL; v_row_result:=v_request_hash::jsonb;');
  if strpos(definition,'when sqlstate ''BT001'' then')=0 or strpos(definition,'submitted_at=coalesce(submitted_at,now())')=0 then
    raise exception 'execute_command changed; atomic assignment patch did not apply';
  end if;
  execute definition;
end;
$migration$;

create or replace view public.work_item_list with (security_invoker = true) as
select
  w.id, w.organization_id, w.neighborhood_id, w.home_id, h.lot_code,
  nullif(concat_ws(', ', h.address_line1, h.city, h.state_code), '') as address,
  w.title, w.description, w.priority, w.state, w.safety_flag, w.due_at,
  coalesce(c.name, p.display_name) as assigned_party_name,
  w.updated_at, w.version, w.created_at, w.inspection_id
from public.work_items w
left join public.homes h on h.organization_id = w.organization_id and h.id = w.home_id
left join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id
left join public.companies c on c.organization_id = ae.organization_id and c.id = ae.company_id
left join public.profiles p on p.id = ae.internal_assignee_user_id;

commit;
