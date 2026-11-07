begin;

-- This internal helper has only received batch response saves since migration
-- 075. Preserve that exact path and its receipts; remove unreachable copies of
-- work commands referencing retired fields and states.
do $$
declare definition text; dispatch_start integer; select_start integer; select_end integer; batch_start integer; batch_end integer; tail_start integer; marker text;
begin
 definition:=replace(pg_get_functiondef('public.execute_command_before_work_completion(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
 dispatch_start:=strpos(definition,'  if p_command_name = ''create_work_item'' then');
 select_start:=strpos(definition,'      select * into v_inspection from public.inspections where id = (v_payload ->> ''inspection_id'')::uuid and organization_id = v_organization_id for update;');
 select_end:=strpos(definition,'      -- Enforce strict version check');
 marker:='      elsif p_command_name = ''save_inspection_responses'' then';
 batch_start:=strpos(definition,marker)+length(marker);
 batch_end:=strpos(definition,'      elsif p_command_name = ''upsert_inspection_response'' then');
 tail_start:=strpos(definition,'  update private.client_operations');
 if dispatch_start=0 or select_start<=dispatch_start or select_end<=select_start or batch_start<=select_end or batch_end<=batch_start or tail_start<=batch_end then
  raise exception 'Review batch command layout before removing legacy branches';
 end if;
 definition:=left(definition,dispatch_start-1)||'
  if p_command_name<>''save_inspection_responses'' then
    return private.command_error(v_operation_id,''UNKNOWN_COMMAND'',''This internal handler only saves inspection response batches.'');
  end if;
  '||substring(definition,select_start,select_end-select_start)
   ||substring(definition,batch_start,batch_end-batch_start)
   ||substring(definition,tail_start);
 execute definition;
end; $$;
revoke all on function public.execute_command_before_work_completion(text,jsonb) from public,anon,authenticated;

do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('public.admin_set_catalog_status(uuid,text,uuid,boolean)'::regprocedure);
 needle:='update public.inspection_engagements set revoked_at=case when p_active then null else now() end,updated_at=now(),version=version+1';
 if strpos(definition,needle)=0 then raise exception 'Review inspection engagement lifecycle before correcting obsolete columns'; end if;
 execute replace(definition,needle,'update public.inspection_engagements set revoked_at=case when p_active then null else now() end');
end; $$;
notify pgrst,'reload schema';
commit;
