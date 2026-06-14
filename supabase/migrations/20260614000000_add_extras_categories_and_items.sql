-- Add new menu categories for EXTRAS content
create temp table seed_cats (
  kind public.category_kind not null,
  name text not null,
  sort_order integer not null,
  primary key (kind, name)
) on commit drop;

insert into seed_cats (kind, name, sort_order)
values
  ('menu', 'Dairy', 18),
  ('menu', 'Meats', 19),
  ('menu', 'Veggie', 20),
  ('menu', 'Sauces', 21);

insert into public.categories (kind, name, sort_order, active)
select kind, name, sort_order, true from seed_cats
on conflict (kind, lower(name)) do nothing;

update public.categories c
set sort_order = s.sort_order, active = true, updated_at = now()
from seed_cats s
where c.kind = s.kind and lower(c.name) = lower(s.name);

-- Add menu items under each new category
create temp table seed_extras_items (
  category_name text not null,
  item_name text not null,
  item_price integer not null,
  item_order integer not null
) on commit drop;

insert into seed_extras_items (category_name, item_name, item_price, item_order)
values
  -- Dairy
  ('Dairy', 'Cheese 40g', 8000, 1),
  ('Dairy', 'Cheese 120g', 8000, 2),
  ('Dairy', 'Feta', 8000, 3),
  ('Dairy', 'Milk', 8000, 4),
  -- Meats (all 8000)
  ('Meats', 'Chicken (80g)', 8000, 1),
  ('Meats', 'Mince (80g)', 8000, 2),
  ('Meats', 'Prawn (80g)', 8000, 3),
  ('Meats', 'Anchovy', 8000, 4),
  ('Meats', 'Beef Burger', 8000, 5),
  ('Meats', 'Chick Burger', 8000, 6),
  ('Meats', 'Beef Prego', 8000, 7),
  -- Veggie
  ('Veggie', 'Pineapple', 2000, 1),
  ('Veggie', 'Tomato', 2000, 2),
  ('Veggie', 'Onion', 2000, 3),
  ('Veggie', 'Green Pepper', 2000, 4),
  ('Veggie', 'Chilli', 3000, 5),
  ('Veggie', 'Garlic', 2000, 6),
  ('Veggie', 'Mushroom', 2000, 7),
  ('Veggie', 'Olives', 2000, 8),
  ('Veggie', 'Capers', 2000, 9),
  ('Veggie', 'Rice', 2000, 10),
  ('Veggie', 'Bread', 2000, 11),
  ('Veggie', 'Egg', 2000, 12),
  -- Sauces
  ('Sauces', 'Frango Sauce', 2000, 1),
  ('Sauces', 'Camarao Sauce', 2000, 2),
  ('Sauces', 'Bitoque Sauce', 2000, 3);

insert into public.menu_items (category_id, name, price, sort_order)
select c.id, e.item_name, e.item_price, e.item_order
from seed_extras_items e
join public.categories c on c.kind = 'menu' and c.name = e.category_name
where not exists (
  select 1 from public.menu_items mi
  where mi.name = e.item_name and mi.category_id = c.id
);
