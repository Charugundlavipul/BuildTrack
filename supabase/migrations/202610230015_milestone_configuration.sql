begin;

create or replace function public.admin_save_home_milestone(p_organization_id uuid,p_id uuid,p_home_id uuid,p_milestone_code text,p_planned_at timestamptz default null)
returns public.home_milestones language plpgsql security definer set search_path = '' as $$
declare result public.home_milestones; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id,'structure.manage');
  if not exists(select 1 from public.homes h where h.organization_id=p_organization_id and h.id=p_home_id and h.archived_at is null) then raise exception using errcode='22023',message='home is unavailable'; end if;
  if length(trim(coalesce(p_milestone_code,''))) not between 1 and 80 then raise exception using errcode='22023',message='milestone code is required'; end if;
  if p_id is null then insert into public.home_milestones(organization_id,home_id,milestone_code,planned_at) values(p_organization_id,p_home_id,lower(trim(p_milestone_code)),p_planned_at) returning * into result;
  else select to_jsonb(m) into before_row from public.home_milestones m where m.organization_id=p_organization_id and m.id=p_id for update;
    update public.home_milestones set milestone_code=lower(trim(p_milestone_code)),planned_at=p_planned_at,updated_at=now() where organization_id=p_organization_id and id=p_id and home_id=p_home_id returning * into result;
    if not found then raise exception using errcode='02000',message='home milestone not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'home_milestone.saved','home_milestone',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_home_milestone(uuid,uuid,uuid,text,timestamptz) from public,anon;
grant execute on function public.admin_save_home_milestone(uuid,uuid,uuid,text,timestamptz) to authenticated;

create or replace function public.admin_save_milestone_requirement(p_organization_id uuid,p_id uuid,p_home_id uuid,p_milestone_code text,p_required_inspection_type public.inspection_type,p_required boolean default true)
returns public.milestone_requirements language plpgsql security definer set search_path = '' as $$
declare result public.milestone_requirements; before_row jsonb;
begin
  perform private.require_admin_permission(p_organization_id,'config.manage');
  if not exists(select 1 from public.homes h where h.organization_id=p_organization_id and h.id=p_home_id and h.archived_at is null) then raise exception using errcode='22023',message='home is unavailable'; end if;
  if length(trim(coalesce(p_milestone_code,''))) not between 1 and 80 then raise exception using errcode='22023',message='milestone code is required'; end if;
  if p_id is null then insert into public.milestone_requirements(organization_id,home_id,milestone_code,required_inspection_type,required) values(p_organization_id,p_home_id,lower(trim(p_milestone_code)),p_required_inspection_type,p_required) returning * into result;
  else select to_jsonb(r) into before_row from public.milestone_requirements r where r.organization_id=p_organization_id and r.id=p_id for update;
    update public.milestone_requirements set milestone_code=lower(trim(p_milestone_code)),required_inspection_type=p_required_inspection_type,required=p_required where organization_id=p_organization_id and id=p_id and home_id=p_home_id returning * into result;
    if not found then raise exception using errcode='02000',message='milestone requirement not found'; end if;
  end if;
  perform private.append_audit(p_organization_id,auth.uid(),'milestone_requirement.saved','milestone_requirement',result.id,null,before_row,to_jsonb(result)); return result;
end; $$;
revoke all on function public.admin_save_milestone_requirement(uuid,uuid,uuid,text,public.inspection_type,boolean) from public,anon;
grant execute on function public.admin_save_milestone_requirement(uuid,uuid,uuid,text,public.inspection_type,boolean) to authenticated;

commit;
