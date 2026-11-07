begin;

-- Inspection managers need to read the assigned plan even when their role
-- does not include property editing.
create policy plans_inspection_read on public.master_plans for select to authenticated using(
  private.active_member(organization_id,auth.uid()) and exists(
    select 1 from public.homes h where h.organization_id=master_plans.organization_id and h.master_plan_id=master_plans.id
      and private.has_permission(h.organization_id,auth.uid(),'inspection.manage',h.neighborhood_id,h.id)));

-- Reusable checklist templates now serve as room categories. Inspection snapshots
-- stay in the existing version/question tables so responses and offline bundles
-- continue to refer to immutable question IDs.
alter table public.checklist_templates add column snapshot_home_id uuid;
alter table public.checklist_templates add foreign key (organization_id, snapshot_home_id) references public.homes(organization_id,id);

create function private.validate_plan_checklists() returns trigger
language plpgsql security definer set search_path='' as $$
declare space jsonb; item jsonb;
begin
  for space in select value from jsonb_array_elements(new.spaces) loop
    if nullif(space->>'checklist_version_id','') is not null and not exists (
      select 1 from public.checklist_versions v join public.checklist_templates t on t.organization_id=v.organization_id and t.id=v.template_id
      where v.organization_id=new.organization_id and v.id=(space->>'checklist_version_id')::uuid and v.published_at is not null and t.active and t.snapshot_home_id is null
    ) then raise check_violation using message='Choose a published room checklist category from this organization.'; end if;
    if space ? 'checklist_items' then
      if jsonb_typeof(space->'checklist_items')<>'array' or jsonb_array_length(space->'checklist_items')>100 then
        raise check_violation using message='Each space supports up to 100 additional checklist items.';
      end if;
      for item in select value from jsonb_array_elements(space->'checklist_items') loop
        if jsonb_typeof(item)<>'string' or length(trim(item #>> '{}'))>1000 or length(trim(item #>> '{}'))=1 then
          raise check_violation using message='Checklist items must be between 2 and 1000 characters.';
        end if;
      end loop;
    end if;
  end loop;
  return new;
end; $$;
create trigger validate_plan_checklists before insert or update of spaces on public.master_plans for each row execute function private.validate_plan_checklists();

create function private.snapshot_plan_checklist(p_org uuid,p_home uuid,p_operation uuid,p_version bigint,p_extras jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare h public.homes; plan public.master_plans; space jsonb; item jsonb; q record; template uuid; ver uuid; position integer:=0; section_name text;
begin
  select * into h from public.homes where organization_id=p_org and id=p_home;
  if not found or not private.require_aal2() or not private.has_permission(p_org,auth.uid(),'inspection.manage',h.neighborhood_id,h.id) then
    raise insufficient_privilege using message='Inspection management permission is required for this property.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
  -- Same operation always resolves to the same immutable snapshot on retries.
  select v.id into ver from public.checklist_versions v join public.checklist_templates t on t.id=v.template_id
    where t.id=p_operation and t.organization_id=p_org and t.snapshot_home_id=p_home;
  if found then return ver; end if;
  select * into plan from public.master_plans where organization_id=p_org and id=h.master_plan_id for share;
  if not found then raise check_violation using message='Apply a floor plan before scheduling an inspection.'; end if;
  if p_version is null or plan.version<>p_version then raise serialization_failure using message='The plan checklist changed. Reload before scheduling.'; end if;
  if p_extras is null or jsonb_typeof(p_extras)<>'array' or jsonb_array_length(p_extras)>100 then
    raise check_violation using message='Provide up to 100 property-only checklist items.';
  end if;
  insert into public.checklist_templates(id,organization_id,name,snapshot_home_id)
    values(p_operation,p_org,left(plan.name || ' · Lot ' || h.lot_code || ' inspection',160),p_home) returning id into template;
  insert into public.checklist_versions(organization_id,template_id,number,created_by)
    values(p_org,template,1,auth.uid()) returning id into ver;
  for space in select value from jsonb_array_elements(plan.spaces) loop
    section_name:=space->>'name';
    if nullif(space->>'checklist_version_id','') is not null then
      if not exists(select 1 from public.checklist_versions v join public.checklist_templates t on t.id=v.template_id
        where v.organization_id=p_org and v.id=(space->>'checklist_version_id')::uuid and v.published_at is not null and t.active and t.snapshot_home_id is null) then
        raise check_violation using message='A plan space has an unavailable checklist category. Update the floor plan.';
      end if;
      for q in select * from public.checklist_questions where organization_id=p_org and version_id=(space->>'checklist_version_id')::uuid order by ordinal loop
        position:=position+1;
        insert into public.checklist_questions(organization_id,version_id,ordinal,section,label,requires_response)
          values(p_org,ver,position,section_name,q.label,q.requires_response);
      end loop;
    end if;
    for item in select value from jsonb_array_elements(coalesce(space->'checklist_items','[]'::jsonb)) loop
      if nullif(trim(item #>> '{}'),'') is not null then
        position:=position+1;
        insert into public.checklist_questions(organization_id,version_id,ordinal,section,label)
          values(p_org,ver,position,section_name,trim(item #>> '{}'));
      end if;
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(p_extras) loop
    if jsonb_typeof(item)<>'object' or length(trim(coalesce(item->>'label',''))) not between 2 and 1000
      or not exists(select 1 from jsonb_array_elements(plan.spaces) s where s->>'name'=item->>'section') then
      raise check_violation using message='Every property-only item needs a plan space and 2–1000 characters.';
    end if;
    position:=position+1;
    insert into public.checklist_questions(organization_id,version_id,ordinal,section,label)
      values(p_org,ver,position,item->>'section',trim(item->>'label'));
  end loop;
  if position=0 or position>5000 then raise check_violation using message='Configure between 1 and 5000 checklist items for this inspection.'; end if;
  update public.checklist_versions set published_at=now() where id=ver;
  perform private.append_audit(p_org,auth.uid(),'inspection.checklist_snapshot','checklist_version',ver,p_operation,null,null,jsonb_build_object('home_id',p_home,'plan_id',plan.id,'plan_version',plan.version,'property_items',jsonb_array_length(p_extras)));
  return ver;
end; $$;

-- Preserve the command pipeline, including its permission checks, assignment
-- rules, idempotency receipts, and individual/company scheduling support.
alter function public.execute_command(text,jsonb) rename to execute_command_before_plan_checklists;
revoke all on function public.execute_command_before_plan_checklists(text,jsonb) from public,anon,authenticated;
create function public.execute_command(p_command_name text,p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=p_envelope->'payload'; h public.homes; ver uuid;
begin
  if p_command_name in ('schedule_inspection','schedule_company_inspection') and coalesce((payload->>'plan_checklist')::boolean,false) then
    select * into h from public.homes where id=(payload->>'home_id')::uuid;
    ver:=private.snapshot_plan_checklist(h.organization_id,h.id,(p_envelope->>'operation_id')::uuid,(payload->>'plan_version')::bigint,coalesce(payload->'additional_items','[]'::jsonb));
    p_envelope:=jsonb_set(p_envelope,'{payload,template_version_id}',to_jsonb(ver));
  end if;
  return public.execute_command_before_plan_checklists(p_command_name,p_envelope);
end; $$;
revoke all on function public.execute_command(text,jsonb) from public,anon;
grant execute on function public.execute_command(text,jsonb) to authenticated;

-- A property snapshot cannot be used to inspect another home, even through the
-- legacy scheduling payload supported for previously published checklists.
create function private.check_inspection_snapshot_home() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.checklist_versions v join public.checklist_templates t on t.id=v.template_id
    where v.id=new.template_version_id and t.snapshot_home_id is not null and t.snapshot_home_id<>new.home_id) then
    raise check_violation using message='This inspection checklist belongs to another property.';
  end if;
  return new;
end; $$;
create trigger check_inspection_snapshot_home before insert or update of home_id,template_version_id on public.inspections
  for each row execute function private.check_inspection_snapshot_home();
revoke all on function private.snapshot_plan_checklist(uuid,uuid,uuid,bigint,jsonb), private.validate_plan_checklists(), private.check_inspection_snapshot_home() from public,anon,authenticated;
commit;
