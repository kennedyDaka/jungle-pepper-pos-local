-- Focaccia must choose one dough base like pizza
delete from public.recipes r
using public.menu_items m, public.items i
where r.menu_item_id = m.id
  and r.item_id = i.id
  and m.name like 'Focaccia%'
  and i.name = 'DOUGH PIZZA BASES THIN';

insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select m.id, 'Thin Crust', 0, 1, true
from public.menu_items m
join public.categories c on c.id = m.category_id
where m.active
  and m.name like 'Focaccia%'
  and c.kind = 'menu'
  and not exists (
    select 1 from public.modifiers mod
    where mod.menu_item_id = m.id
      and mod.active
      and lower(mod.name) = 'thin crust'
  );

insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select m.id, 'Thick Crust', 0, 2, true
from public.menu_items m
join public.categories c on c.id = m.category_id
where m.active
  and m.name like 'Focaccia%'
  and c.kind = 'menu'
  and not exists (
    select 1 from public.modifiers mod
    where mod.menu_item_id = m.id
      and mod.active
      and lower(mod.name) = 'thick crust'
  );

update public.modifiers mod
set price_delta = 0,
    sort_order = case lower(mod.name) when 'thin crust' then 1 else 2 end,
    active = true,
    updated_at = now()
from public.menu_items m
join public.categories c on c.id = m.category_id
where mod.menu_item_id = m.id
  and m.name like 'Focaccia%'
  and c.kind = 'menu'
  and lower(mod.name) in ('thin crust', 'thick crust');

delete from public.modifier_recipes mr
using public.modifiers mod, public.menu_items m, public.categories c
where mr.modifier_id = mod.id
  and mod.menu_item_id = m.id
  and m.category_id = c.id
  and m.name like 'Focaccia%'
  and c.kind = 'menu'
  and lower(mod.name) in ('thin crust', 'thick crust');

insert into public.modifier_recipes (modifier_id, item_id, qty)
select mod.id, i.id, 1
from public.modifiers mod
join public.menu_items m on m.id = mod.menu_item_id
join public.categories c on c.id = m.category_id
join public.items i on i.name = case lower(mod.name)
  when 'thin crust' then 'DOUGH PIZZA BASES THIN'
  else 'DOUGH PIZZA BASES THICK'
end
where mod.active
  and m.name like 'Focaccia%'
  and c.kind = 'menu'
  and lower(mod.name) in ('thin crust', 'thick crust')
on conflict (modifier_id, item_id) do update
set qty = excluded.qty,
    updated_at = now();
