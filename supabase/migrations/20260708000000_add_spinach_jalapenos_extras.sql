-- Add Spinach and Jalapenos as new Veggie extras menu items
-- (Veggie category sort_order=20, last existing item "Egg" has sort_order 12)

insert into public.menu_items (category_id, name, price, sort_order)
select c.id, e.item_name, e.item_price, e.item_order
from (
  values
    ('Veggie', 'Spinach', 2000, 13),
    ('Veggie', 'Jalapenos', 2000, 14)
) as e (category_name, item_name, item_price, item_order)
join public.categories c on c.kind = 'menu' and c.name = e.category_name
where not exists (
  select 1 from public.menu_items mi
  where mi.name = e.item_name and mi.category_id = c.id
);
