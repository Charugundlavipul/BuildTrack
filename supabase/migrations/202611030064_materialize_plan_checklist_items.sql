begin;

-- A checklist category is an import source, not a permanent relationship.
-- Materialize every legacy category question into the space's editable item
-- list, preserve custom items, remove duplicates, and discard the reference.
with migrated as (
  select p.id,
    jsonb_agg(
      (space.value - 'checklist_version_id') || jsonb_build_object(
        'checklist_items',
        coalesce((
          select jsonb_agg(to_jsonb(item.label) order by item.source_rank,item.item_order)
          from (
            select deduplicated.label,deduplicated.source_rank,deduplicated.item_order
            from (
              select combined.label,combined.source_rank,combined.item_order,
                row_number() over(partition by lower(combined.label) order by combined.source_rank,combined.item_order) duplicate_rank
              from (
                select trim(q.label) label,0 source_rank,q.ordinal::bigint item_order
                from public.checklist_questions q
                where q.organization_id=p.organization_id
                  and q.version_id=nullif(space.value->>'checklist_version_id','')::uuid
                union all
                select trim(existing.value #>> '{}') label,1 source_rank,existing.ordinality::bigint item_order
                from jsonb_array_elements(coalesce(space.value->'checklist_items','[]'::jsonb)) with ordinality existing(value,ordinality)
                where jsonb_typeof(existing.value)='string'
              ) combined
              where length(combined.label) between 2 and 1000
            ) deduplicated
            where deduplicated.duplicate_rank=1
            order by deduplicated.source_rank,deduplicated.item_order
            limit 100
          ) item
        ),'[]'::jsonb)
      )
      order by space.ordinality
    ) spaces
  from public.master_plans p
  cross join lateral jsonb_array_elements(p.spaces) with ordinality space(value,ordinality)
  group by p.id
)
update public.master_plans plan
set spaces=migrated.spaces,updated_at=now()
from migrated
where migrated.id=plan.id
  and exists(select 1 from jsonb_array_elements(plan.spaces) space where space ? 'checklist_version_id');

create or replace function private.validate_plan_checklists() returns trigger
language plpgsql security definer set search_path='' as $$
declare space jsonb; item jsonb;
begin
  for space in select value from jsonb_array_elements(new.spaces) loop
    if space ? 'checklist_version_id' then
      raise check_violation using message='Import checklist category items instead of assigning a category to a space.';
    end if;
    if space ? 'checklist_items' then
      if jsonb_typeof(space->'checklist_items')<>'array' or jsonb_array_length(space->'checklist_items')>100 then
        raise check_violation using message='Each space supports up to 100 checklist items.';
      end if;
      for item in select value from jsonb_array_elements(space->'checklist_items') loop
        if jsonb_typeof(item)<>'string' or length(trim(item #>> '{}')) not between 2 and 1000 then
          raise check_violation using message='Checklist items must be between 2 and 1000 characters.';
        end if;
      end loop;
    end if;
  end loop;
  return new;
end; $$;

notify pgrst, 'reload schema';

commit;
