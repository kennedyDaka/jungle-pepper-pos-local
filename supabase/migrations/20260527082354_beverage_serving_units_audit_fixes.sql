-- Keep wine and spirits readable for bar control:
-- wine is served as glasses, spirits/liqueurs as shots, and soft drinks stay whole units.

update public.items
set bottle_ml = null,
    shot_ml = null,
    updated_at = now()
where active
  and stock_type = 'beverage'
  and name in ('GINGER ALE BOTTLE/CAN', 'GINGER SOBO BOTTLE/CAN')
  and (bottle_ml is not null or shot_ml is not null);

update public.recipes r
set qty = 1,
    updated_at = now()
from public.items i
where r.item_id = i.id
  and i.active
  and i.name in ('GINGER ALE BOTTLE/CAN', 'GINGER SOBO BOTTLE/CAN')
  and r.qty is distinct from 1;

update public.items
set unit_id = u.id,
    bottle_ml = null,
    shot_ml = null,
    updated_at = now()
from public.units u
where public.items.active
  and public.items.stock_type = 'beverage'
  and public.items.name = 'ANGOSTURA BITTERS'
  and u.code = 'l'
  and (
    public.items.unit_id is distinct from u.id
    or public.items.bottle_ml is not null
    or public.items.shot_ml is not null
  );

update public.recipes r
set qty = 0.005,
    updated_at = now()
from public.items i
where r.item_id = i.id
  and i.active
  and i.name = 'ANGOSTURA BITTERS'
  and r.qty is distinct from 0.005;

update public.items
set bottle_ml = coalesce(bottle_ml, 750),
    shot_ml = 175,
    updated_at = now()
where active
  and stock_type = 'beverage'
  and name ilike '%wine%'
  and (bottle_ml is null or shot_ml is distinct from 175);

with measured_beverages as (
  select
    i.id,
    case
      when u.code = 'ml' then i.shot_ml
      when u.code = 'l' then i.shot_ml / 1000
      when i.bottle_ml > 0 then i.shot_ml / i.bottle_ml
      else null
    end as recipe_qty
  from public.items i
  left join public.units u on u.id = i.unit_id
  where i.active
    and i.stock_type = 'beverage'
    and i.shot_ml > 0
)
update public.recipes r
set qty = round(m.recipe_qty, 6),
    updated_at = now()
from measured_beverages m
where r.item_id = m.id
  and m.recipe_qty is not null
  and r.qty is distinct from round(m.recipe_qty, 6);

create or replace function public.sync_beverage_recipe_qty()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item_unit text;
  recipe_qty numeric;
begin
  select u.code into item_unit
  from public.units u
  where u.id = new.unit_id;

  if new.stock_type = 'beverage' and new.shot_ml > 0 then
    recipe_qty := case
      when item_unit = 'ml' then new.shot_ml
      when item_unit = 'l' then new.shot_ml / 1000
      when new.bottle_ml > 0 then new.shot_ml / new.bottle_ml
      else null
    end;

    if recipe_qty is not null then
      update public.recipes
      set qty = round(recipe_qty, 6),
          updated_at = now()
      where item_id = new.id
        and qty is distinct from round(recipe_qty, 6);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_beverage_recipe_qty_after_update on public.items;
create trigger sync_beverage_recipe_qty_after_update
after update of unit_id, bottle_ml, shot_ml on public.items
for each row
execute function public.sync_beverage_recipe_qty();
