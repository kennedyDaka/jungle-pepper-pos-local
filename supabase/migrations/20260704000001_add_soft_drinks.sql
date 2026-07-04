-- Move CHAPMAN and ROCKSHANDY from Mocktails to Soft Drinks category
update public.menu_items
set category_id = (select id from public.categories where kind = 'menu' and name = 'Soft Drinks'),
    sort_order = case name when 'CHAPMAN' then 15 when 'ROCKSHANDY' then 16 else sort_order end,
    updated_at = now()
where active and name in ('CHAPMAN', 'ROCKSHANDY');

-- Insert inventory items for new drinks
insert into public.items (name, stock_type, category_id, unit_id, active)
select s.name, s.stock_type, c.id, u.id, true
from (values
  ('SWISS LEMONADE BOTTLE/CAN', 'beverage'::public.stock_type, 'Beverages', 'ea'),
  ('LEMONADE BOTTLE/CAN', 'beverage'::public.stock_type, 'Beverages', 'ea'),
  ('JUICE FRESH BOTTLE/CAN', 'beverage'::public.stock_type, 'Beverages', 'ea')
) s(name, stock_type, cat_name, unit_code)
join public.categories c on c.kind = 'inventory' and c.name = s.cat_name
join public.units u on u.code = s.unit_code
where not exists (
  select 1 from public.items i where i.active and lower(i.name) = lower(s.name)
);

-- Insert new menu items
insert into public.menu_items (category_id, name, description, price, active, sort_order)
select c.id, s.name, s.description, s.price, true, s.sort_order
from (values
  ('SWISS LEMONADE', 'Soft Drinks', 'Swiss lemonade drink', 5000, 17),
  ('LEMONADE', 'Soft Drinks', 'Lemonade drink', 5000, 18),
  ('JUICE FRESH', 'Soft Drinks', 'Fresh juice', 8000, 19)
) s(name, cat_name, description, price, sort_order)
join public.categories c on c.kind = 'menu' and c.name = s.cat_name
where not exists (
  select 1 from public.menu_items m where m.active and lower(m.name) = lower(s.name)
);

-- Insert recipes for new menu items
insert into public.recipes (menu_item_id, item_id, qty, takeaway_only)
select m.id, i.id, 1, false
from (values
  ('SWISS LEMONADE', 'SWISS LEMONADE BOTTLE/CAN'),
  ('LEMONADE', 'LEMONADE BOTTLE/CAN'),
  ('JUICE FRESH', 'JUICE FRESH BOTTLE/CAN')
) r(menu_name, item_name)
join public.menu_items m on m.active and lower(m.name) = lower(r.menu_name)
join public.items i on i.active and lower(i.name) = lower(r.item_name)
where not exists (
  select 1 from public.recipes r2
  join public.menu_items m2 on m2.id = r2.menu_item_id
  join public.items i2 on i2.id = r2.item_id
  where m2.active and lower(m2.name) = lower(r.menu_name)
    and i2.active and lower(i2.name) = lower(r.item_name)
);
