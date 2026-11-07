-- Extend the global catalog without reactivating retired types or overwriting administrator labels.
begin;
insert into public.space_types(code,label) values
('kitchen','Kitchen'),
('living','Living area'),
('dining','Dining area'),
('great_room','Great room'),
('family_room','Family room'),
('breakfast_nook','Breakfast nook'),
('formal_dining_room','Formal dining room'),
('sitting_room','Sitting room'),
('sunroom','Sunroom'),
('conservatory','Conservatory'),
('den','Den'),
('library','Library'),
('home_office','Home office'),
('study','Study'),
('playroom','Playroom'),
('game_room','Game room'),
('media_room','Media room'),
('home_theater','Home theater'),
('music_room','Music room'),
('craft_room','Craft room'),
('hobby_room','Hobby room'),
('home_gym','Home gym'),
('yoga_room','Yoga room'),
('prayer_room','Prayer room'),
('guest_lounge','Guest lounge'),
('bedroom','Bedroom'),
('primary_bedroom','Primary bedroom'),
('guest_bedroom','Guest bedroom'),
('childrens_bedroom','Children’s bedroom'),
('nursery','Nursery'),
('bunk_room','Bunk room'),
('bathroom','Bathroom'),
('primary_bathroom','Primary bathroom'),
('guest_bathroom','Guest bathroom'),
('powder_room','Powder room'),
('shower_room','Shower room'),
('wet_room','Wet room'),
('toilet_room','Toilet room'),
('dressing_room','Dressing room'),
('walk_in_closet','Walk-in closet'),
('linen_closet','Linen closet'),
('sauna','Sauna'),
('steam_room','Steam room'),
('entry_foyer','Entry foyer'),
('vestibule','Vestibule'),
('hallway','Hallway'),
('corridor','Corridor'),
('landing','Landing'),
('staircase','Staircase'),
('stairwell','Stairwell'),
('elevator_lobby','Elevator lobby'),
('elevator_shaft','Elevator shaft'),
('mudroom','Mudroom'),
('breezeway','Breezeway'),
('accessibility_ramp','Accessibility ramp'),
('laundry','Laundry'),
('utility_room','Utility room'),
('pantry','Pantry'),
('walk_in_pantry','Walk-in pantry'),
('butlers_pantry','Butler’s pantry'),
('scullery','Scullery'),
('storage_room','Storage room'),
('closet','Closet'),
('coat_closet','Coat closet'),
('under_stair_storage','Under-stair storage'),
('attic','Attic'),
('basement','Basement'),
('crawl_space','Crawl space'),
('wine_cellar','Wine cellar'),
('cold_storage','Cold storage'),
('safe_room','Safe room'),
('storm_shelter','Storm shelter'),
('workshop','Workshop'),
('garage','Garage'),
('carport','Carport'),
('bicycle_storage','Bicycle storage'),
('refuse_room','Refuse room'),
('janitor_closet','Janitor closet'),
('package_room','Package room'),
('mechanical_room','Mechanical room'),
('electrical_room','Electrical room'),
('hvac_closet','HVAC closet'),
('air_handler_room','Air handler room'),
('boiler_room','Boiler room'),
('water_heater_closet','Water heater closet'),
('pump_room','Pump room'),
('fire_sprinkler_room','Fire sprinkler room'),
('communications_room','Communications room'),
('server_room','Server room'),
('solar_equipment_area','Solar equipment area'),
('battery_storage_room','Battery storage room'),
('generator_room','Generator room'),
('meter_room','Meter room'),
('service_shaft','Service shaft'),
('exterior','Exterior'),
('patio','Patio'),
('porch','Porch'),
('front_porch','Front porch'),
('rear_porch','Rear porch'),
('screened_porch','Screened porch'),
('deck','Deck'),
('balcony','Balcony'),
('terrace','Terrace'),
('roof_terrace','Roof terrace'),
('courtyard','Courtyard'),
('front_yard','Front yard'),
('back_yard','Back yard'),
('side_yard','Side yard'),
('garden','Garden'),
('landscape_area','Landscape area'),
('driveway','Driveway'),
('walkway','Walkway'),
('sidewalk','Sidewalk'),
('parking_area','Parking area'),
('loading_area','Loading area'),
('pool','Pool'),
('pool_deck','Pool deck'),
('spa','Spa'),
('outdoor_kitchen','Outdoor kitchen'),
('barbecue_area','Barbecue area'),
('pergola','Pergola'),
('gazebo','Gazebo'),
('shed','Shed'),
('greenhouse','Greenhouse'),
('playground','Playground'),
('pet_area','Pet area'),
('retaining_wall_area','Retaining wall area'),
('fence_and_gate_area','Fence and gate area'),
('drainage_area','Drainage area'),
('septic_area','Septic area'),
('well_house','Well house'),
('dock','Dock'),
('roof','Roof'),
('foundation_perimeter','Foundation perimeter'),
('reception','Reception'),
('lobby','Lobby'),
('mail_room','Mail room'),
('community_room','Community room'),
('meeting_room','Meeting room'),
('coworking_room','Coworking room'),
('fitness_center','Fitness center'),
('locker_room','Locker room'),
('shared_restroom','Shared restroom'),
('shared_kitchen','Shared kitchen'),
('security_room','Security room'),
('management_office','Management office'),
('maintenance_room','Maintenance room'),
('leasing_office','Leasing office'),
('retail_unit','Retail unit'),
('guest_suite','Guest suite'),
('other','Other')
on conflict do nothing;
create or replace function public.get_report_metrics(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  result jsonb;
  state_filter text := nullif(trim(p_filters->>'state'), '');
  priority_filter text := nullif(trim(p_filters->>'priority'), '');
  neighborhood_filter uuid := nullif(p_filters->>'neighborhood_id', '')::uuid;
  home_filter uuid := nullif(p_filters->>'home_id', '')::uuid;
  date_from_filter date := nullif(p_filters->>'date_from', '')::date;
  date_to_filter date := nullif(p_filters->>'date_to', '')::date;
begin
  if not exists (select 1 from public.my_organizations where id = p_organization_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if state_filter is not null and state_filter not in ('draft','submitted','assigned','acknowledged','in_progress','blocked','ready_for_verification','rework_required','verified','cancelled') then
    raise exception using errcode = '22023', message = 'invalid state filter';
  end if;
  if priority_filter is not null and priority_filter not in ('low','normal','high','critical') then
    raise exception using errcode = '22023', message = 'invalid priority filter';
  end if;
  if date_from_filter is not null and date_to_filter is not null and date_from_filter > date_to_filter then
    raise exception using errcode = '22023', message = 'invalid report date range';
  end if;

  with filtered_work as materialized (
    select w.*
    from public.work_items w
    where w.organization_id = p_organization_id
      and (neighborhood_filter is null or w.neighborhood_id = neighborhood_filter)
      and (home_filter is null or w.home_id = home_filter)
      and (state_filter is null or w.state::text = state_filter)
      and (priority_filter is null or w.priority::text = priority_filter)
      and (date_from_filter is null or w.created_at >= date_from_filter::timestamptz)
      and (date_to_filter is null or w.created_at < (date_to_filter + 1)::timestamptz)
  ),
  acknowledgment as (
    select
      round((percentile_cont(.5) within group (order by extract(epoch from (ae.acknowledged_at - ae.assigned_at))) / 3600)::numeric, 1) median_hours,
      count(*) sample
    from public.assignment_episodes ae
    join filtered_work w on w.organization_id = ae.organization_id and w.id = ae.work_item_id
    where ae.acknowledged_at is not null
  ),
  first_pass as (
    select
      round(100.0 * count(*) filter (where v.decision = 'accepted') / nullif(count(*), 0), 1) acceptance_pct,
      count(*) sample
    from public.correction_attempts ca
    join filtered_work w on w.organization_id = ca.organization_id and w.id = ca.work_item_id
    join public.verifications v on v.organization_id = ca.organization_id and v.correction_attempt_id = ca.id
    where ca.attempt_number = 1
  ),
  states as (
    select fw.state, count(*) total from filtered_work fw group by fw.state
  )
  select jsonb_build_object(
    'open_count', (select count(*) from filtered_work where state not in ('draft','verified','cancelled')),
    'overdue_count', (select count(*) from filtered_work where due_at < now() and state not in ('draft','verified','cancelled')),
    'acknowledgment_median_hours', case when acknowledgment.sample >= 10 then coalesce(acknowledgment.median_hours, 0) else null end,
    'acknowledgment_sample', acknowledgment.sample,
    'first_pass_acceptance_pct', case when first_pass.sample >= 10 then coalesce(first_pass.acceptance_pct, 0) else null end,
    'first_pass_sample', first_pass.sample,
    'small_sample_threshold', 10,
    'by_state', coalesce((select jsonb_agg(jsonb_build_object('label', replace(states.state::text, '_', ' '), 'value', states.total) order by states.state::text) from states), '[]'::jsonb),
    'filters', p_filters,
    'timezone', (select timezone from public.organizations where id = p_organization_id)
  ) into result
  from acknowledgment cross join first_pass;
  return result;
end;
$$;

revoke all on function public.get_report_metrics(uuid, jsonb) from public, anon;
grant execute on function public.get_report_metrics(uuid, jsonb) to authenticated;

commit;
