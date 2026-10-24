begin;

create or replace view public.work_item_list with (security_invoker = true) as
select
  w.id, w.organization_id, w.neighborhood_id, w.home_id, h.lot_code,
  nullif(concat_ws(', ', h.address_line1, h.city, h.state_code), '') as address,
  w.title, w.description, w.priority, w.state, w.safety_flag, w.due_at,
  coalesce(c.name, p.display_name) as assigned_party_name,
  w.updated_at, w.version, w.created_at, w.category_id
from public.work_items w
left join public.homes h on h.organization_id = w.organization_id and h.id = w.home_id
left join public.assignment_episodes ae on ae.organization_id = w.organization_id and ae.id = w.current_assignment_id
left join public.companies c on c.organization_id = ae.organization_id and c.id = ae.company_id
left join public.profiles p on p.id = ae.internal_assignee_user_id;
grant select on public.work_item_list to authenticated;

alter table public.role_assignments
  add constraint role_assignments_valid_window check (ends_at is null or ends_at > starts_at) not valid;
alter table public.company_memberships
  add constraint company_memberships_valid_window check (active_to is null or active_to > active_from) not valid;

create or replace function private.validate_notification_rule()
returns trigger language plpgsql set search_path = '' as $$
declare quiet_start text := new.quiet_hours->>'start'; quiet_end text := new.quiet_hours->>'end';
begin
  if jsonb_typeof(new.quiet_hours) <> 'object' then
    raise exception using errcode='22023',message='quiet hours must be an object';
  end if;
  if (quiet_start is null) <> (quiet_end is null) then
    raise exception using errcode='22023',message='quiet hours require both start and end';
  end if;
  if quiet_start is not null and (quiet_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or quiet_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or quiet_start=quiet_end) then
    raise exception using errcode='22023',message='quiet hours are invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists notification_rule_validation on public.notification_rules;
create trigger notification_rule_validation before insert or update on public.notification_rules
for each row execute function private.validate_notification_rule();

commit;
