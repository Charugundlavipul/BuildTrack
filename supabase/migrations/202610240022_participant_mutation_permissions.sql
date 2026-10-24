begin;

insert into public.permissions(code,description) values
  ('comment.create_shared','Create shared work conversation comments'),
  ('evidence.upload','Reserve and upload field evidence')
on conflict(code) do update set description=excluded.description;

insert into public.role_permissions(role_code,permission_code)
select role_code,permission_code from (values
  ('area_manager','comment.create_shared'),('superintendent','comment.create_shared'),('assistant_superintendent','comment.create_shared'),
  ('internal_quality','comment.create_shared'),('external_inspector','comment.create_shared'),('verifier','comment.create_shared'),
  ('trade_manager','comment.create_shared'),('trade_technician','comment.create_shared'),('operations_coordinator','comment.create_shared'),('internal_contributor','comment.create_shared'),
  ('area_manager','evidence.upload'),('superintendent','evidence.upload'),('assistant_superintendent','evidence.upload'),
  ('internal_quality','evidence.upload'),('external_inspector','evidence.upload'),('trade_manager','evidence.upload'),
  ('trade_technician','evidence.upload'),('operations_coordinator','evidence.upload'),('internal_contributor','evidence.upload')
) grants(role_code,permission_code)
on conflict do nothing;

create or replace function private.enforce_comment_create_permission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare item public.work_items;
begin
  if auth.role()='service_role' then return new; end if;
  select * into item from public.work_items where organization_id=new.organization_id and id=new.work_item_id;
  if auth.uid() is null or item.id is null or not private.has_permission(new.organization_id,auth.uid(),'comment.create_shared',item.neighborhood_id,item.home_id) then
    raise exception using errcode='42501',message='comment permission required';
  end if;
  if new.visibility='internal' and not private.has_permission(new.organization_id,auth.uid(),'comment.internal',item.neighborhood_id,item.home_id) then
    raise exception using errcode='42501',message='internal comment permission required';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_comment_create_permission on public.comments;
create trigger enforce_comment_create_permission before insert on public.comments
for each row execute function private.enforce_comment_create_permission();

create or replace function private.enforce_attachment_create_permission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role()='service_role' then return new; end if;
  if auth.uid() is null or not private.has_permission(new.organization_id,auth.uid(),'evidence.upload',new.neighborhood_id,new.home_id) then
    raise exception using errcode='42501',message='evidence upload permission required';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_attachment_create_permission on public.attachments;
create trigger enforce_attachment_create_permission before insert on public.attachments
for each row execute function private.enforce_attachment_create_permission();

commit;
