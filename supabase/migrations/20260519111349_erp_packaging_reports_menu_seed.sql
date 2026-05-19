-- ERP refinements for chargeable takeaway packaging, menu/recipe completion,
-- extra toppings, and opening stock ledger entries.

create table if not exists public.packaging_options (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  name text not null,
  price numeric(14, 2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_options_name_not_blank check (length(btrim(name)) > 0),
  constraint packaging_options_non_negative_price check (price >= 0)
);

drop trigger if exists packaging_options_touch_updated_at on public.packaging_options;
create trigger packaging_options_touch_updated_at
  before update on public.packaging_options
  for each row execute function app_private.touch_updated_at();

create unique index if not exists packaging_options_branch_name_unique_ci
  on public.packaging_options (
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  where active;

create index if not exists packaging_options_item_id_idx
  on public.packaging_options (item_id);

alter table public.packaging_options enable row level security;

drop policy if exists "packaging options staff read" on public.packaging_options;
create policy "packaging options staff read"
  on public.packaging_options for select to authenticated
  using (app_private.can_access_branch((select auth.uid()), branch_id));

drop policy if exists "packaging options staff insert" on public.packaging_options;
create policy "packaging options staff insert"
  on public.packaging_options for insert to authenticated
  with check (
    (app_private.has_role((select auth.uid()), 'admin') or app_private.has_role((select auth.uid()), 'cashier'))
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

drop policy if exists "packaging options staff update" on public.packaging_options;
create policy "packaging options staff update"
  on public.packaging_options for update to authenticated
  using (
    (app_private.has_role((select auth.uid()), 'admin') or app_private.has_role((select auth.uid()), 'cashier'))
    and app_private.can_access_branch((select auth.uid()), branch_id)
  )
  with check (
    (app_private.has_role((select auth.uid()), 'admin') or app_private.has_role((select auth.uid()), 'cashier'))
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

drop policy if exists "packaging options admin delete" on public.packaging_options;
create policy "packaging options admin delete"
  on public.packaging_options for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

grant select, insert, update, delete on public.packaging_options to authenticated;

create table if not exists public.order_item_packaging (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  packaging_option_id uuid references public.packaging_options(id) on delete set null,
  item_id uuid not null references public.items(id) on delete restrict,
  qty numeric(14, 3) not null,
  unit_price numeric(14, 2) not null default 0,
  stock_movement_id uuid references public.stock_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_item_packaging_positive_qty check (qty > 0),
  constraint order_item_packaging_non_negative_price check (unit_price >= 0)
);

create index if not exists order_item_packaging_order_item_id_idx
  on public.order_item_packaging (order_item_id);

create index if not exists order_item_packaging_item_id_idx
  on public.order_item_packaging (item_id);

alter table public.order_item_packaging enable row level security;

drop policy if exists "order item packaging staff read" on public.order_item_packaging;
create policy "order item packaging staff read"
  on public.order_item_packaging for select to authenticated
  using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and app_private.can_access_branch((select auth.uid()), o.branch_id)
    )
  );

drop policy if exists "order item packaging staff insert" on public.order_item_packaging;
create policy "order item packaging staff insert"
  on public.order_item_packaging for insert to authenticated
  with check (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and app_private.can_access_branch((select auth.uid()), o.branch_id)
        and (app_private.has_role((select auth.uid()), 'admin') or app_private.has_role((select auth.uid()), 'cashier'))
    )
  );

grant select, insert on public.order_item_packaging to authenticated;

insert into public.units (code, name)
select v.code, v.name
from (values
  ('bag', 'Bag'),
  ('block', 'Block'),
  ('portion', 'Portion'),
  ('tin', 'Tin'),
  ('tray', 'Tray')
) as v(code, name)
where not exists (select 1 from public.units u where lower(u.code) = lower(v.code));

insert into public.categories (kind, name, sort_order, active)
select 'menu'::public.category_kind, v.name, v.sort_order, true
from (values
  ('Burgers', 7),
  ('Chips', 8),
  ('Pregos & Bitoques', 9),
  ('Frango', 10),
  ('Seafood', 11)
) as v(name, sort_order)
where not exists (
  select 1
  from public.categories c
  where c.kind = 'menu'
    and lower(c.name) = lower(v.name)
);

update public.categories c
set sort_order = v.sort_order,
    active = true,
    updated_at = now()
from (values
  ('Starters', 1),
  ('Salads', 2),
  ('Pastas', 3),
  ('Pizza', 4),
  ('Burgers', 7),
  ('Chips', 8),
  ('Pregos & Bitoques', 9),
  ('Frango', 10),
  ('Seafood', 11),
  ('Desserts', 12),
  ('Coffee & Tea', 13),
  ('Soft Drinks', 20),
  ('Mocktails', 21),
  ('Wine', 22),
  ('Beers & Ciders', 23),
  ('Gin', 24),
  ('Brandy', 25),
  ('Rum', 26),
  ('Whiskey', 27),
  ('Tequila', 28),
  ('Liqueurs', 29),
  ('Vodka', 30)
) as v(name, sort_order)
where c.kind = 'menu'
  and lower(c.name) = lower(v.name);

with seed_items(name, stock_type, category, unit_code, bottle_ml, shot_ml, reorder_level) as (
  values
    ('SLICED 120G', 'production', 'Produced prep', 'ea', null::numeric, null::numeric, 0::numeric),
    ('BURGERS (120G)', 'production', 'Produced prep', 'ea', null, null, 0),
    ('BURGER BUNS', 'production', 'Produced prep', 'ea', null, null, 0),
    ('VEGGIE PATTY', 'production', 'Produced prep', 'ea', null, null, 0),
    ('FRIED ONIONS', 'production', 'Produced prep', 'kg', null, null, 0),
    ('JUNGLE SAUCE', 'production', 'Produced prep', 'kg', null, null, 0),
    ('MASALA SAUCE', 'production', 'Produced prep', 'kg', null, null, 0),
    ('PIMENTO SAUCE', 'production', 'Produced prep', 'kg', null, null, 0),
    ('PANCAKE BATTER', 'production', 'Produced prep', 'portion', null, null, 0),
    ('OREO ICE CREAM BASE', 'production', 'Produced prep', 'kg', null, null, 0),
    ('RED BEANS TIN (410G)', 'raw', 'Raw ingredients', 'tin', null, null, 0),
    ('PAPRIKA', 'raw', 'Raw ingredients', 'kg', null, null, 0),
    ('SYRUP', 'raw', 'Raw ingredients', 'l', null, null, 0),
    ('COFFEE BEANS', 'raw', 'Raw ingredients', 'kg', null, null, 0),
    ('CHOCOLATE POWDER', 'raw', 'Raw ingredients', 'kg', null, null, 0),
    ('CINNAMON', 'raw', 'Raw ingredients', 'kg', null, null, 0),
    ('CHOCOLATE BAR', 'raw', 'Raw ingredients', 'kg', null, null, 0),
    ('TEA BAG', 'raw', 'Raw ingredients', 'ea', null, null, 0),
    ('EARL GREY TEA BAG', 'raw', 'Raw ingredients', 'ea', null, null, 0),
    ('ROOIBOS TEA BAG', 'raw', 'Raw ingredients', 'ea', null, null, 0),
    ('HERBAL TEA BAG', 'raw', 'Raw ingredients', 'ea', null, null, 0),
    ('LEMON JUICE', 'raw', 'Raw ingredients', 'l', null, null, 0),
    ('WATER', 'raw', 'Raw ingredients', 'l', null, null, 0),
    ('FLOUR BAG', 'raw', 'Raw ingredients', 'bag', null, null, 0),
    ('CHEESE BLOCK QTY', 'raw', 'Raw ingredients', 'block', null, null, 0)
)
insert into public.items (name, stock_type, category_id, unit_id, bottle_ml, shot_ml, reorder_level, active)
select s.name,
       s.stock_type::public.stock_type,
       c.id,
       u.id,
       s.bottle_ml,
       s.shot_ml,
       s.reorder_level,
       true
from seed_items s
join public.categories c on c.kind = 'inventory' and c.name = s.category
join public.units u on lower(u.code) = lower(s.unit_code)
where not exists (
  select 1
  from public.items i
  where i.active
    and lower(i.name) = lower(s.name)
);

with unit_updates(name, unit_code, stock_type, category, bottle_ml, shot_ml) as (
  values
    ('FILLET TRAYS (500G)', 'kg', 'production', 'Produced prep', null::numeric, null::numeric),
    ('CHEESE PIZZA PKTS', 'kg', 'production', 'Produced prep', null, null),
    ('CHEESE BURGER PKTS', 'kg', 'production', 'Produced prep', null, null),
    ('MILK', 'l', 'raw', 'Raw ingredients', null, null),
    ('CONDENSED MILK', 'kg', 'raw', 'Raw ingredients', null, null),
    ('RICE COOKER', 'portion', 'production', 'Produced prep', null, null),
    ('BREAD BURGER PKTS', 'pkt', 'raw', 'Raw ingredients', null, null),
    ('BOTTLE KITCHEN (1L)', 'bottle', 'raw', 'Raw ingredients', 1000::numeric, null),
    ('PREGOS/BITOQUES (80G)', 'ea', 'production', 'Produced prep', null, null),
    ('RUMP SLICED (1KG)', 'kg', 'production', 'Produced prep', null, null)
)
update public.items i
set unit_id = u.id,
    stock_type = uu.stock_type::public.stock_type,
    category_id = c.id,
    bottle_ml = uu.bottle_ml,
    shot_ml = uu.shot_ml,
    updated_at = now()
from unit_updates uu
join public.units u on lower(u.code) = lower(uu.unit_code)
join public.categories c on c.kind = 'inventory' and c.name = uu.category
where i.active
  and lower(i.name) = lower(uu.name);

with seed_menu(name, category, price, sort_order, description) as (
  values
    ('Garlic Loaf', 'Starters', 14500::numeric, 1, 'Seasoned garlic butter'),
    ('Garlic Loaf and Cheese', 'Starters', 15500, 2, 'Garlic loaf with cheese'),
    ('Focaccia', 'Starters', 25900, 3, 'Garlic, olive oil, rock salt and rosemary'),
    ('Focaccia and Cheese', 'Starters', 32900, 4, 'Focaccia with mozzarella'),
    ('Greek Salad', 'Salads', 14000, 1, 'Greek salad'),
    ('Extra Chicken Topping', 'Salads', 6000, 2, 'Chicken topping'),
    ('Spaghetti Pomodoro', 'Pastas', 22900, 1, 'Pomodoro sauce on spaghetti'),
    ('Penne Pomodoro', 'Pastas', 22900, 2, 'Pomodoro sauce on penne'),
    ('Fettucine Pomodoro', 'Pastas', 22900, 3, 'Pomodoro sauce on fettucine'),
    ('Spaghetti Picanti', 'Pastas', 22900, 4, 'Picanti sauce on spaghetti'),
    ('Penne Picanti', 'Pastas', 22900, 5, 'Picanti sauce on penne'),
    ('Fettucine Picanti', 'Pastas', 22900, 6, 'Picanti sauce on fettucine'),
    ('Spaghetti Bolognese', 'Pastas', 27000, 7, 'Bolognese sauce on spaghetti'),
    ('Penne Bolognese', 'Pastas', 27000, 8, 'Bolognese sauce on penne'),
    ('Fettucine Bolognese', 'Pastas', 27000, 9, 'Bolognese sauce on fettucine'),
    ('Spaghetti Creamy Chicken and Mushroom', 'Pastas', 27000, 10, 'Creamy chicken and mushroom on spaghetti'),
    ('Penne Creamy Chicken and Mushroom', 'Pastas', 27000, 11, 'Creamy chicken and mushroom on penne'),
    ('Fettucine Creamy Chicken and Mushroom', 'Pastas', 27000, 12, 'Creamy chicken and mushroom on fettucine'),
    ('Spaghetti Creamy Tomato and Prawn', 'Pastas', 37000, 13, 'Creamy tomato and prawn on spaghetti'),
    ('Penne Creamy Tomato and Prawn', 'Pastas', 37000, 14, 'Creamy tomato and prawn on penne'),
    ('Fettucine Creamy Tomato and Prawn', 'Pastas', 37000, 15, 'Creamy tomato and prawn on fettucine'),
    ('Katundu Pizza', 'Pizza', 32900, 1, 'Chicken, mince, peppers, onions and mozzarella'),
    ('Mexicano Pizza', 'Pizza', 32900, 2, 'Spicy beef mince, onions, peppers and mozzarella'),
    ('Portuguese Chicken Pizza', 'Pizza', 32900, 3, 'Peri-peri chicken, onions, peppers and mozzarella'),
    ('Chicken Mushroom Pizza', 'Pizza', 32900, 4, 'Chicken, mushroom and mozzarella'),
    ('Sweet and Sour Safari Pizza', 'Pizza', 32900, 5, 'Sweet and sour chicken, pineapple and mozzarella'),
    ('Maffiosa Pizza', 'Pizza', 32900, 6, 'Chicken, olives, mozzarella and chilli'),
    ('Prawn Pizza', 'Pizza', 36000, 7, 'Portuguese-seasoned prawns and mozzarella'),
    ('Anchovy Pizza', 'Pizza', 36000, 8, 'Anchovy, capers and mozzarella'),
    ('Vegetarian Pizza', 'Pizza', 32900, 9, 'Vegetables and mozzarella'),
    ('Vegan Pizza', 'Pizza', 32900, 10, 'Vegetables and olive oil'),
    ('Margarita Pizza', 'Pizza', 32900, 11, 'Mozzarella and tomato base'),
    ('Piccanti Pizza', 'Pizza', 32900, 12, 'Garlic, chilli, peppers and mozzarella'),
    ('Jalapeno Pizza', 'Pizza', 32900, 13, 'Jalapenos, mozzarella and onions'),
    ('Hummus Pizza', 'Pizza', 32900, 14, 'Hummus, olives, onion and mozzarella'),
    ('Godfather Pizza', 'Pizza', 32900, 15, 'Feta, mozzarella, oregano, spinach and olives'),
    ('Mediterranean Pizza', 'Pizza', 32900, 16, 'Dried tomatoes, olives, mozzarella and basil'),
    ('Jungle Pepper Burger', 'Burgers', 27000, 1, 'Home-made flame-grilled burger'),
    ('Chicken Burger', 'Burgers', 27000, 2, 'Flame-grilled chicken burger'),
    ('Prawn Burger', 'Burgers', 32900, 3, 'Prawn burger'),
    ('Veggie Burger', 'Burgers', 27000, 4, 'Veggie burger'),
    ('Plain Chips Small', 'Chips', 11900, 1, 'Small plain chips'),
    ('Plain Chips Large', 'Chips', 12900, 2, 'Large plain chips'),
    ('Masala Chips Small', 'Chips', 12900, 3, 'Small masala chips'),
    ('Masala Chips Large', 'Chips', 14900, 4, 'Large masala chips'),
    ('Plain Prego', 'Pregos & Bitoques', 29000, 1, 'Portuguese steak roll with chips'),
    ('Prego Pimento', 'Pregos & Bitoques', 29000, 2, 'Prego with pimento sauce and chips'),
    ('Beef Bitoque', 'Pregos & Bitoques', 34000, 3, 'Beef bitoque with egg, rice and chips'),
    ('Chicken Bitoque', 'Pregos & Bitoques', 34000, 4, 'Chicken bitoque with egg, rice and chips'),
    ('Half Churrasco Chicken', 'Frango', 38000, 1, 'Half churrasco chicken with chips and rice'),
    ('Full Churrasco Chicken', 'Frango', 55000, 2, 'Full churrasco chicken with chips and rice'),
    ('Arroz de Marisco', 'Seafood', 66000, 1, 'Portuguese seafood rice'),
    ('Camarao 6 Prawns', 'Seafood', 46000, 2, 'Six prawns with chips and rice'),
    ('Camarao 12 Prawns', 'Seafood', 66000, 3, 'Twelve prawns with chips and rice'),
    ('Chocolate Cake', 'Desserts', 13900, 1, 'Jungle Pepper signature chocolate cake'),
    ('Pancakes', 'Desserts', 12000, 2, 'Four fluffy pancakes with syrup'),
    ('Pancakes with Ice Cream', 'Desserts', 14900, 3, 'Pancakes with ice cream and syrup'),
    ('Ice Cream', 'Desserts', 12000, 4, 'Vanilla ice cream with chocolate'),
    ('Oreo Ice Cream', 'Desserts', 13900, 5, 'Oreo ice cream'),
    ('Pastel de Belem', 'Desserts', 7500, 6, 'Portuguese custard tart'),
    ('Italian Cappuccino', 'Coffee & Tea', 7000, 1, 'Coffee with frothed milk and chocolate'),
    ('Brazilian Cappuccino', 'Coffee & Tea', 7000, 2, 'Coffee with frothed milk and cinnamon'),
    ('Kiddoccino', 'Coffee & Tea', 7500, 3, 'Hot milk with frothed milk and chocolate powder'),
    ('Bica Espresso', 'Coffee & Tea', 5500, 4, 'Small strong coffee'),
    ('Railway Espresso Bombom', 'Coffee & Tea', 7500, 5, 'Espresso on condensed milk'),
    ('Carioca', 'Coffee & Tea', 5500, 6, 'Weak espresso'),
    ('Macchiato', 'Coffee & Tea', 5500, 7, 'Espresso with frothed milk'),
    ('Pingo', 'Coffee & Tea', 5500, 8, 'Milky espresso'),
    ('Babychino', 'Coffee & Tea', 5500, 9, 'Frothy milk with chocolate powder'),
    ('Galao Caffe Latte', 'Coffee & Tea', 8500, 10, 'Milky coffee with frothed milk'),
    ('Hot Chocolate', 'Coffee & Tea', 10000, 11, 'Hot chocolate'),
    ('Submarine', 'Coffee & Tea', 9000, 12, 'Chocolate bar submerged in hot milk'),
    ('Chocachino', 'Coffee & Tea', 9500, 13, 'Hot chocolate and coffee'),
    ('Filter Coffee', 'Coffee & Tea', 6500, 14, 'Malawi blend coffee'),
    ('Malawian Tea', 'Coffee & Tea', 4000, 15, 'Malawian tea'),
    ('Earl Grey Tea', 'Coffee & Tea', 7500, 16, 'Earl Grey tea'),
    ('Rooibos Tea', 'Coffee & Tea', 6000, 17, 'Rooibos tea'),
    ('Carioca de Limao', 'Coffee & Tea', 4000, 18, 'Lemon tea'),
    ('Herbal Teas', 'Coffee & Tea', 7500, 19, 'Herbal teas')
)
insert into public.menu_items (category_id, name, description, price, sort_order, active)
select c.id, s.name, s.description, s.price, s.sort_order, true
from seed_menu s
join public.categories c on c.kind = 'menu' and c.name = s.category
where not exists (
  select 1
  from public.menu_items m
  where m.active
    and lower(m.name) = lower(s.name)
);

with seed_menu(name, category, price, sort_order, description) as (
  values
    ('Focaccia and Cheese', 'Starters', 32900::numeric, 4, 'Focaccia with mozzarella'),
    ('Extra Chicken Topping', 'Salads', 6000, 2, 'Chicken topping'),
    ('Spaghetti Pomodoro', 'Pastas', 22900, 1, 'Pomodoro sauce on spaghetti'),
    ('Penne Pomodoro', 'Pastas', 22900, 2, 'Pomodoro sauce on penne'),
    ('Fettucine Pomodoro', 'Pastas', 22900, 3, 'Pomodoro sauce on fettucine'),
    ('Spaghetti Picanti', 'Pastas', 22900, 4, 'Picanti sauce on spaghetti'),
    ('Penne Picanti', 'Pastas', 22900, 5, 'Picanti sauce on penne'),
    ('Fettucine Picanti', 'Pastas', 22900, 6, 'Picanti sauce on fettucine'),
    ('Spaghetti Bolognese', 'Pastas', 27000, 7, 'Bolognese sauce on spaghetti'),
    ('Penne Bolognese', 'Pastas', 27000, 8, 'Bolognese sauce on penne'),
    ('Fettucine Bolognese', 'Pastas', 27000, 9, 'Bolognese sauce on fettucine'),
    ('Spaghetti Creamy Chicken and Mushroom', 'Pastas', 27000, 10, 'Creamy chicken and mushroom on spaghetti'),
    ('Penne Creamy Chicken and Mushroom', 'Pastas', 27000, 11, 'Creamy chicken and mushroom on penne'),
    ('Fettucine Creamy Chicken and Mushroom', 'Pastas', 27000, 12, 'Creamy chicken and mushroom on fettucine'),
    ('Spaghetti Creamy Tomato and Prawn', 'Pastas', 37000, 13, 'Creamy tomato and prawn on spaghetti'),
    ('Penne Creamy Tomato and Prawn', 'Pastas', 37000, 14, 'Creamy tomato and prawn on penne'),
    ('Fettucine Creamy Tomato and Prawn', 'Pastas', 37000, 15, 'Creamy tomato and prawn on fettucine'),
    ('Katundu Pizza', 'Pizza', 32900, 1, 'Chicken, mince, peppers, onions and mozzarella'),
    ('Mexicano Pizza', 'Pizza', 32900, 2, 'Spicy beef mince, onions, peppers and mozzarella'),
    ('Portuguese Chicken Pizza', 'Pizza', 32900, 3, 'Peri-peri chicken, onions, peppers and mozzarella'),
    ('Chicken Mushroom Pizza', 'Pizza', 32900, 4, 'Chicken, mushroom and mozzarella'),
    ('Sweet and Sour Safari Pizza', 'Pizza', 32900, 5, 'Sweet and sour chicken, pineapple and mozzarella'),
    ('Maffiosa Pizza', 'Pizza', 32900, 6, 'Chicken, olives, mozzarella and chilli'),
    ('Prawn Pizza', 'Pizza', 36000, 7, 'Portuguese-seasoned prawns and mozzarella'),
    ('Anchovy Pizza', 'Pizza', 36000, 8, 'Anchovy, capers and mozzarella'),
    ('Vegetarian Pizza', 'Pizza', 32900, 9, 'Vegetables and mozzarella'),
    ('Vegan Pizza', 'Pizza', 32900, 10, 'Vegetables and olive oil'),
    ('Margarita Pizza', 'Pizza', 32900, 11, 'Mozzarella and tomato base'),
    ('Piccanti Pizza', 'Pizza', 32900, 12, 'Garlic, chilli, peppers and mozzarella'),
    ('Jalapeno Pizza', 'Pizza', 32900, 13, 'Jalapenos, mozzarella and onions'),
    ('Hummus Pizza', 'Pizza', 32900, 14, 'Hummus, olives, onion and mozzarella'),
    ('Godfather Pizza', 'Pizza', 32900, 15, 'Feta, mozzarella, oregano, spinach and olives'),
    ('Mediterranean Pizza', 'Pizza', 32900, 16, 'Dried tomatoes, olives, mozzarella and basil'),
    ('Jungle Pepper Burger', 'Burgers', 27000, 1, 'Home-made flame-grilled burger'),
    ('Chicken Burger', 'Burgers', 27000, 2, 'Flame-grilled chicken burger'),
    ('Prawn Burger', 'Burgers', 32900, 3, 'Prawn burger'),
    ('Veggie Burger', 'Burgers', 27000, 4, 'Veggie burger'),
    ('Plain Chips Small', 'Chips', 11900, 1, 'Small plain chips'),
    ('Plain Chips Large', 'Chips', 12900, 2, 'Large plain chips'),
    ('Masala Chips Small', 'Chips', 12900, 3, 'Small masala chips'),
    ('Masala Chips Large', 'Chips', 14900, 4, 'Large masala chips'),
    ('Plain Prego', 'Pregos & Bitoques', 29000, 1, 'Portuguese steak roll with chips'),
    ('Prego Pimento', 'Pregos & Bitoques', 29000, 2, 'Prego with pimento sauce and chips'),
    ('Beef Bitoque', 'Pregos & Bitoques', 34000, 3, 'Beef bitoque with egg, rice and chips'),
    ('Chicken Bitoque', 'Pregos & Bitoques', 34000, 4, 'Chicken bitoque with egg, rice and chips'),
    ('Half Churrasco Chicken', 'Frango', 38000, 1, 'Half churrasco chicken with chips and rice'),
    ('Full Churrasco Chicken', 'Frango', 55000, 2, 'Full churrasco chicken with chips and rice'),
    ('Arroz de Marisco', 'Seafood', 66000, 1, 'Portuguese seafood rice'),
    ('Camarao 6 Prawns', 'Seafood', 46000, 2, 'Six prawns with chips and rice'),
    ('Camarao 12 Prawns', 'Seafood', 66000, 3, 'Twelve prawns with chips and rice'),
    ('Chocolate Cake', 'Desserts', 13900, 1, 'Jungle Pepper signature chocolate cake'),
    ('Pancakes', 'Desserts', 12000, 2, 'Four fluffy pancakes with syrup'),
    ('Pancakes with Ice Cream', 'Desserts', 14900, 3, 'Pancakes with ice cream and syrup'),
    ('Ice Cream', 'Desserts', 12000, 4, 'Vanilla ice cream with chocolate'),
    ('Oreo Ice Cream', 'Desserts', 13900, 5, 'Oreo ice cream'),
    ('Pastel de Belem', 'Desserts', 7500, 6, 'Portuguese custard tart')
)
update public.menu_items m
set category_id = c.id,
    price = s.price,
    sort_order = s.sort_order,
    description = s.description,
    active = true,
    updated_at = now()
from seed_menu s
join public.categories c on c.kind = 'menu' and c.name = s.category
where lower(m.name) = lower(s.name);

update public.menu_items
set active = false,
    updated_at = now()
where lower(name) = 'salad chicken topping';

with seed_recipes(menu_name, item_name, qty, takeaway_only) as (
  values
    ('Garlic Loaf', 'LOAF PKTS', 1::numeric, false),
    ('Garlic Loaf', 'GARLIC GRATED', 0.010, false),
    ('Garlic Loaf', 'MARGARINE', 0.030, false),
    ('Garlic Loaf', 'PARSLEY', 0.002, false),
    ('Garlic Loaf and Cheese', 'LOAF PKTS', 1, false),
    ('Garlic Loaf and Cheese', 'GARLIC GRATED', 0.010, false),
    ('Garlic Loaf and Cheese', 'MARGARINE', 0.030, false),
    ('Garlic Loaf and Cheese', 'CHEESE BURGER PKTS', 0.040, false),
    ('Garlic Loaf and Cheese', 'PARSLEY', 0.002, false),
    ('Focaccia', 'DOUGH PIZZA BASES THIN', 1, false),
    ('Focaccia', 'GARLIC GRATED', 0.005, false),
    ('Focaccia', 'COOKING OIL BULK', 0.020, false),
    ('Focaccia', 'SALT', 0.003, false),
    ('Focaccia', 'ROSEMARY', 0.002, false),
    ('Focaccia and Cheese', 'DOUGH PIZZA BASES THIN', 1, false),
    ('Focaccia and Cheese', 'GARLIC GRATED', 0.005, false),
    ('Focaccia and Cheese', 'COOKING OIL BULK', 0.020, false),
    ('Focaccia and Cheese', 'SALT', 0.003, false),
    ('Focaccia and Cheese', 'ROSEMARY', 0.002, false),
    ('Focaccia and Cheese', 'CHEESE PIZZA PKTS', 0.120, false),
    ('Greek Salad', 'LETTUCE', 0.080, false),
    ('Greek Salad', 'TOMATO FRESH', 0.050, false),
    ('Greek Salad', 'CUCUMBER', 0.040, false),
    ('Greek Salad', 'FETA CHEESE', 0.030, false),
    ('Greek Salad', 'OLIVES', 0.020, false),
    ('Greek Salad', 'SALAD DRESSING', 0.030, false),
    ('Extra Chicken Topping', 'PIZZA PKTS (80G)', 1, false),
    ('Jungle Pepper Burger', 'BURGER BUNS', 1, false),
    ('Jungle Pepper Burger', 'CHIPS PEELED', 0.300, false),
    ('Jungle Pepper Burger', 'BURGERS (120G)', 1, false),
    ('Jungle Pepper Burger', 'CHEESE BURGER PKTS', 0.040, false),
    ('Jungle Pepper Burger', 'LETTUCE', 0.020, false),
    ('Jungle Pepper Burger', 'TOMATO FRESH', 0.020, false),
    ('Jungle Pepper Burger', 'ONIONS', 0.020, false),
    ('Jungle Pepper Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Chicken Burger', 'BURGER BUNS', 1, false),
    ('Chicken Burger', 'CHIPS PEELED', 0.300, false),
    ('Chicken Burger', 'BURGER (120G)', 1, false),
    ('Chicken Burger', 'LETTUCE', 0.020, false),
    ('Chicken Burger', 'TOMATO FRESH', 0.020, false),
    ('Chicken Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Prawn Burger', 'BURGER BUNS', 1, false),
    ('Prawn Burger', 'CHIPS PEELED', 0.300, false),
    ('Prawn Burger', 'CAMARAO PASTA PKTS (80G)', 2, false),
    ('Prawn Burger', 'CHEESE BURGER PKTS', 0.040, false),
    ('Prawn Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Veggie Burger', 'BURGER BUNS', 1, false),
    ('Veggie Burger', 'CHIPS PEELED', 0.300, false),
    ('Veggie Burger', 'VEGGIE PATTY', 1, false),
    ('Veggie Burger', 'LETTUCE', 0.020, false),
    ('Veggie Burger', 'TOMATO FRESH', 0.020, false),
    ('Veggie Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Plain Chips Small', 'CHIPS PEELED', 0.300, false),
    ('Plain Chips Small', 'COOKING OIL BULK', 0.100, false),
    ('Plain Chips Small', 'SALT', 0.002, false),
    ('Plain Chips Large', 'CHIPS PEELED', 0.600, false),
    ('Plain Chips Large', 'COOKING OIL BULK', 0.150, false),
    ('Plain Chips Large', 'SALT', 0.004, false),
    ('Masala Chips Small', 'CHIPS PEELED', 0.300, false),
    ('Masala Chips Small', 'MASALA SAUCE', 0.060, false),
    ('Masala Chips Small', 'PAPRIKA', 0.005, false),
    ('Masala Chips Large', 'CHIPS PEELED', 0.600, false),
    ('Masala Chips Large', 'MASALA SAUCE', 0.120, false),
    ('Masala Chips Large', 'PAPRIKA', 0.010, false),
    ('Plain Prego', 'SLICED 120G', 1, false),
    ('Plain Prego', 'LOAF PKTS', 1, false),
    ('Plain Prego', 'CHIPS PEELED', 0.300, false),
    ('Prego Pimento', 'SLICED 120G', 1, false),
    ('Prego Pimento', 'PIMENTO SAUCE', 0.060, false),
    ('Prego Pimento', 'CHIPS PEELED', 0.300, false),
    ('Beef Bitoque', 'SLICED 120G', 1, false),
    ('Beef Bitoque', 'EGGS', 1, false),
    ('Beef Bitoque', 'RICE COOKER', 1, false),
    ('Beef Bitoque', 'CHIPS PEELED', 0.250, false),
    ('Chicken Bitoque', 'BURGER (120G)', 1, false),
    ('Chicken Bitoque', 'EGGS', 1, false),
    ('Chicken Bitoque', 'RICE COOKER', 1, false),
    ('Chicken Bitoque', 'CHIPS PEELED', 0.250, false),
    ('Half Churrasco Chicken', 'FRANGO HALF (600G)', 1, false),
    ('Half Churrasco Chicken', 'CHIPS PEELED', 0.300, false),
    ('Half Churrasco Chicken', 'RICE COOKER', 1, false),
    ('Full Churrasco Chicken', 'FRANGO HALF (600G)', 2, false),
    ('Full Churrasco Chicken', 'CHIPS PEELED', 0.600, false),
    ('Full Churrasco Chicken', 'RICE COOKER', 2, false),
    ('Arroz de Marisco', 'RICE BULK', 0.400, false),
    ('Arroz de Marisco', 'CAMARAO HALF (PKT6)', 4, false),
    ('Arroz de Marisco', 'GARLIC GRATED', 0.010, false),
    ('Arroz de Marisco', 'POMODORO SAUCE', 0.150, false),
    ('Camarao 6 Prawns', 'CAMARAO HALF (PKT6)', 1, false),
    ('Camarao 6 Prawns', 'CHIPS PEELED', 0.300, false),
    ('Camarao 6 Prawns', 'RICE COOKER', 1, false),
    ('Camarao 12 Prawns', 'CAMARAO HALF (PKT6)', 2, false),
    ('Camarao 12 Prawns', 'CHIPS PEELED', 0.400, false),
    ('Camarao 12 Prawns', 'RICE COOKER', 1, false),
    ('Chocolate Cake', 'CHOCOLATE CAKE', 1, false),
    ('Pancakes', 'PANCAKE BATTER', 1, false),
    ('Pancakes', 'SYRUP', 0.030, false),
    ('Pancakes with Ice Cream', 'PANCAKE BATTER', 1, false),
    ('Pancakes with Ice Cream', 'ICE CREAM', 0.120, false),
    ('Pancakes with Ice Cream', 'SYRUP', 0.030, false),
    ('Ice Cream', 'ICE CREAM', 0.120, false),
    ('Oreo Ice Cream', 'OREO ICE CREAM BASE', 0.120, false),
    ('Pastel de Belem', 'PASTEL DE BELEM', 1, false),
    ('Italian Cappuccino', 'COFFEE BEANS', 0.010, false),
    ('Italian Cappuccino', 'MILK', 0.100, false),
    ('Italian Cappuccino', 'CHOCOLATE POWDER', 0.002, false),
    ('Brazilian Cappuccino', 'COFFEE BEANS', 0.010, false),
    ('Brazilian Cappuccino', 'MILK', 0.100, false),
    ('Brazilian Cappuccino', 'CINNAMON', 0.002, false),
    ('Kiddoccino', 'MILK', 0.250, false),
    ('Kiddoccino', 'CHOCOLATE POWDER', 0.002, false),
    ('Bica Espresso', 'COFFEE BEANS', 0.010, false),
    ('Railway Espresso Bombom', 'COFFEE BEANS', 0.010, false),
    ('Railway Espresso Bombom', 'CONDENSED MILK', 0.020, false),
    ('Carioca', 'COFFEE BEANS', 0.010, false),
    ('Macchiato', 'COFFEE BEANS', 0.010, false),
    ('Macchiato', 'MILK', 0.020, false),
    ('Pingo', 'COFFEE BEANS', 0.010, false),
    ('Pingo', 'MILK', 0.040, false),
    ('Babychino', 'MILK', 0.040, false),
    ('Babychino', 'CHOCOLATE POWDER', 0.002, false),
    ('Galao Caffe Latte', 'COFFEE BEANS', 0.010, false),
    ('Galao Caffe Latte', 'MILK', 0.120, false),
    ('Hot Chocolate', 'CHOCOLATE POWDER', 0.012, false),
    ('Hot Chocolate', 'MILK', 0.130, false),
    ('Submarine', 'MILK', 0.250, false),
    ('Submarine', 'CHOCOLATE BAR', 0.012, false),
    ('Chocachino', 'CHOCOLATE POWDER', 0.004, false),
    ('Chocachino', 'COFFEE BEANS', 0.010, false),
    ('Chocachino', 'MILK', 0.130, false),
    ('Filter Coffee', 'COFFEE BEANS', 0.020, false),
    ('Filter Coffee', 'MILK', 0.100, false),
    ('Malawian Tea', 'TEA BAG', 1, false),
    ('Malawian Tea', 'WATER', 0.250, false),
    ('Earl Grey Tea', 'EARL GREY TEA BAG', 1, false),
    ('Earl Grey Tea', 'WATER', 0.250, false),
    ('Rooibos Tea', 'ROOIBOS TEA BAG', 1, false),
    ('Rooibos Tea', 'WATER', 0.250, false),
    ('Carioca de Limao', 'TEA BAG', 1, false),
    ('Carioca de Limao', 'LEMON JUICE', 0.020, false),
    ('Herbal Teas', 'HERBAL TEA BAG', 1, false),
    ('Herbal Teas', 'WATER', 0.250, false)
),
pasta_recipes(menu_name, pasta_item, item_name, qty) as (
  values
    ('Spaghetti Pomodoro', 'SPAGHETTI', 'POMODORO SAUCE', 0.120::numeric),
    ('Spaghetti Pomodoro', 'SPAGHETTI', 'PARMESAN', 0.010),
    ('Penne Pomodoro', 'PENNE', 'POMODORO SAUCE', 0.120),
    ('Penne Pomodoro', 'PENNE', 'PARMESAN', 0.010),
    ('Fettucine Pomodoro', 'FETTUCCINE', 'POMODORO SAUCE', 0.120),
    ('Fettucine Pomodoro', 'FETTUCCINE', 'PARMESAN', 0.010),
    ('Spaghetti Picanti', 'SPAGHETTI', 'POMODORO SAUCE', 0.100),
    ('Spaghetti Picanti', 'SPAGHETTI', 'CHILLI SAUCE', 0.015),
    ('Spaghetti Picanti', 'SPAGHETTI', 'OLIVES', 0.020),
    ('Spaghetti Picanti', 'SPAGHETTI', 'GARLIC GRATED', 0.005),
    ('Penne Picanti', 'PENNE', 'POMODORO SAUCE', 0.100),
    ('Penne Picanti', 'PENNE', 'CHILLI SAUCE', 0.015),
    ('Penne Picanti', 'PENNE', 'OLIVES', 0.020),
    ('Penne Picanti', 'PENNE', 'GARLIC GRATED', 0.005),
    ('Fettucine Picanti', 'FETTUCCINE', 'POMODORO SAUCE', 0.100),
    ('Fettucine Picanti', 'FETTUCCINE', 'CHILLI SAUCE', 0.015),
    ('Fettucine Picanti', 'FETTUCCINE', 'OLIVES', 0.020),
    ('Fettucine Picanti', 'FETTUCCINE', 'GARLIC GRATED', 0.005),
    ('Spaghetti Bolognese', 'SPAGHETTI', 'MINCE COOKED', 0.120),
    ('Spaghetti Bolognese', 'SPAGHETTI', 'POMODORO SAUCE', 0.100),
    ('Spaghetti Bolognese', 'SPAGHETTI', 'PARMESAN', 0.010),
    ('Penne Bolognese', 'PENNE', 'MINCE COOKED', 0.120),
    ('Penne Bolognese', 'PENNE', 'POMODORO SAUCE', 0.100),
    ('Penne Bolognese', 'PENNE', 'PARMESAN', 0.010),
    ('Fettucine Bolognese', 'FETTUCCINE', 'MINCE COOKED', 0.120),
    ('Fettucine Bolognese', 'FETTUCCINE', 'POMODORO SAUCE', 0.100),
    ('Fettucine Bolognese', 'FETTUCCINE', 'PARMESAN', 0.010),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'FILLET TRAYS (500G)', 0.200),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'MUSHROOM', 0.040),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'WHITE SAUCE', 0.120),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'PARMESAN', 0.010),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'FILLET TRAYS (500G)', 0.200),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'MUSHROOM', 0.040),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'WHITE SAUCE', 0.120),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'PARMESAN', 0.010),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'FILLET TRAYS (500G)', 0.200),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'MUSHROOM', 0.040),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'WHITE SAUCE', 0.120),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'PARMESAN', 0.010),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'CAMARAO PASTA PKTS (80G)', 2),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'POMODORO SAUCE', 0.080),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'WHITE SAUCE', 0.080),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'GARLIC GRATED', 0.005),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'CAMARAO PASTA PKTS (80G)', 2),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'POMODORO SAUCE', 0.080),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'WHITE SAUCE', 0.080),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'GARLIC GRATED', 0.005),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'CAMARAO PASTA PKTS (80G)', 2),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'POMODORO SAUCE', 0.080),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'WHITE SAUCE', 0.080),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'GARLIC GRATED', 0.005)
),
pizza_recipes(menu_name, item_name, qty) as (
  values
    ('Katundu Pizza', 'PIZZA PKTS (80G)', 1::numeric),
    ('Katundu Pizza', 'PIZZA PKTS & BOLOG (80G)', 1),
    ('Katundu Pizza', 'G. PEPPERS', 0.040),
    ('Katundu Pizza', 'ONIONS', 0.040),
    ('Mexicano Pizza', 'PIZZA PKTS & BOLOG (80G)', 1),
    ('Mexicano Pizza', 'G. PEPPERS', 0.040),
    ('Mexicano Pizza', 'ONIONS', 0.040),
    ('Mexicano Pizza', 'CHILLI SAUCE', 0.015),
    ('Portuguese Chicken Pizza', 'PIZZA PKTS (80G)', 1),
    ('Portuguese Chicken Pizza', 'ONIONS', 0.040),
    ('Portuguese Chicken Pizza', 'G. PEPPERS', 0.040),
    ('Chicken Mushroom Pizza', 'PIZZA PKTS (80G)', 1),
    ('Chicken Mushroom Pizza', 'MUSHROOM', 0.040),
    ('Sweet and Sour Safari Pizza', 'PIZZA PKTS (80G)', 1),
    ('Sweet and Sour Safari Pizza', 'PINEAPPLE', 0.050),
    ('Sweet and Sour Safari Pizza', 'G. PEPPERS', 0.030),
    ('Maffiosa Pizza', 'PIZZA PKTS (80G)', 1),
    ('Maffiosa Pizza', 'OLIVES', 0.020),
    ('Maffiosa Pizza', 'CHILLI SAUCE', 0.010),
    ('Prawn Pizza', 'CAMARAO PASTA PKTS (80G)', 1),
    ('Prawn Pizza', 'GARLIC GRATED', 0.005),
    ('Anchovy Pizza', 'ANCHOVY', 0.040),
    ('Anchovy Pizza', 'CAPERS', 0.010),
    ('Vegetarian Pizza', 'MUSHROOM', 0.040),
    ('Vegetarian Pizza', 'G. PEPPERS', 0.040),
    ('Vegetarian Pizza', 'ONIONS', 0.040),
    ('Vegetarian Pizza', 'OLIVES', 0.020),
    ('Vegan Pizza', 'MUSHROOM', 0.040),
    ('Vegan Pizza', 'G. PEPPERS', 0.040),
    ('Vegan Pizza', 'ONIONS', 0.040),
    ('Vegan Pizza', 'TOMATO FRESH', 0.040),
    ('Margarita Pizza', 'EXTRA CHEESE', 0.040),
    ('Piccanti Pizza', 'CHILLI SAUCE', 0.015),
    ('Piccanti Pizza', 'GARLIC GRATED', 0.005),
    ('Piccanti Pizza', 'G. PEPPERS', 0.040),
    ('Jalapeno Pizza', 'JALAPENO', 0.020),
    ('Jalapeno Pizza', 'ONIONS', 0.030),
    ('Hummus Pizza', 'HUMMUS', 0.060),
    ('Hummus Pizza', 'OLIVES', 0.020),
    ('Godfather Pizza', 'FETA CHEESE', 0.030),
    ('Godfather Pizza', 'SPINACH', 0.040),
    ('Godfather Pizza', 'OLIVES', 0.020),
    ('Mediterranean Pizza', 'DRIED TOMATO', 0.030),
    ('Mediterranean Pizza', 'OLIVES', 0.020),
    ('Mediterranean Pizza', 'BASIL', 0.005)
),
all_seed_recipes as (
  select menu_name, item_name, qty, takeaway_only from seed_recipes
  union all
  select menu_name, pasta_item, 0.120, false from pasta_recipes
  union all
  select menu_name, 'COOKING OIL BULK', 0.015, false from pasta_recipes group by menu_name
  union all
  select menu_name, 'SALT', 0.002, false from pasta_recipes group by menu_name
  union all
  select menu_name, item_name, qty, false from pasta_recipes
  union all
  select menu_name, 'PIZZA TOMATO BASE', 0.100, false from pizza_recipes group by menu_name
  union all
  select menu_name, 'CHEESE PIZZA PKTS', 0.120, false from pizza_recipes where menu_name <> 'Vegan Pizza' group by menu_name
  union all
  select menu_name, item_name, qty, false from pizza_recipes
),
seed_menu_names as (
  select distinct menu_name from all_seed_recipes
)
delete from public.recipes r
using public.menu_items m, seed_menu_names sm
where r.menu_item_id = m.id
  and lower(m.name) = lower(sm.menu_name);

with seed_recipes(menu_name, item_name, qty, takeaway_only) as (
  values
    ('Garlic Loaf', 'LOAF PKTS', 1::numeric, false),
    ('Garlic Loaf', 'GARLIC GRATED', 0.010, false),
    ('Garlic Loaf', 'MARGARINE', 0.030, false),
    ('Garlic Loaf', 'PARSLEY', 0.002, false),
    ('Garlic Loaf and Cheese', 'LOAF PKTS', 1, false),
    ('Garlic Loaf and Cheese', 'GARLIC GRATED', 0.010, false),
    ('Garlic Loaf and Cheese', 'MARGARINE', 0.030, false),
    ('Garlic Loaf and Cheese', 'CHEESE BURGER PKTS', 0.040, false),
    ('Garlic Loaf and Cheese', 'PARSLEY', 0.002, false),
    ('Focaccia', 'DOUGH PIZZA BASES THIN', 1, false),
    ('Focaccia', 'GARLIC GRATED', 0.005, false),
    ('Focaccia', 'COOKING OIL BULK', 0.020, false),
    ('Focaccia', 'SALT', 0.003, false),
    ('Focaccia', 'ROSEMARY', 0.002, false),
    ('Focaccia and Cheese', 'DOUGH PIZZA BASES THIN', 1, false),
    ('Focaccia and Cheese', 'GARLIC GRATED', 0.005, false),
    ('Focaccia and Cheese', 'COOKING OIL BULK', 0.020, false),
    ('Focaccia and Cheese', 'SALT', 0.003, false),
    ('Focaccia and Cheese', 'ROSEMARY', 0.002, false),
    ('Focaccia and Cheese', 'CHEESE PIZZA PKTS', 0.120, false),
    ('Greek Salad', 'LETTUCE', 0.080, false),
    ('Greek Salad', 'TOMATO FRESH', 0.050, false),
    ('Greek Salad', 'CUCUMBER', 0.040, false),
    ('Greek Salad', 'FETA CHEESE', 0.030, false),
    ('Greek Salad', 'OLIVES', 0.020, false),
    ('Greek Salad', 'SALAD DRESSING', 0.030, false),
    ('Extra Chicken Topping', 'PIZZA PKTS (80G)', 1, false),
    ('Jungle Pepper Burger', 'BURGER BUNS', 1, false),
    ('Jungle Pepper Burger', 'CHIPS PEELED', 0.300, false),
    ('Jungle Pepper Burger', 'BURGERS (120G)', 1, false),
    ('Jungle Pepper Burger', 'CHEESE BURGER PKTS', 0.040, false),
    ('Jungle Pepper Burger', 'LETTUCE', 0.020, false),
    ('Jungle Pepper Burger', 'TOMATO FRESH', 0.020, false),
    ('Jungle Pepper Burger', 'ONIONS', 0.020, false),
    ('Jungle Pepper Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Chicken Burger', 'BURGER BUNS', 1, false),
    ('Chicken Burger', 'CHIPS PEELED', 0.300, false),
    ('Chicken Burger', 'BURGER (120G)', 1, false),
    ('Chicken Burger', 'LETTUCE', 0.020, false),
    ('Chicken Burger', 'TOMATO FRESH', 0.020, false),
    ('Chicken Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Prawn Burger', 'BURGER BUNS', 1, false),
    ('Prawn Burger', 'CHIPS PEELED', 0.300, false),
    ('Prawn Burger', 'CAMARAO PASTA PKTS (80G)', 2, false),
    ('Prawn Burger', 'CHEESE BURGER PKTS', 0.040, false),
    ('Prawn Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Veggie Burger', 'BURGER BUNS', 1, false),
    ('Veggie Burger', 'CHIPS PEELED', 0.300, false),
    ('Veggie Burger', 'VEGGIE PATTY', 1, false),
    ('Veggie Burger', 'LETTUCE', 0.020, false),
    ('Veggie Burger', 'TOMATO FRESH', 0.020, false),
    ('Veggie Burger', 'JUNGLE SAUCE', 0.030, false),
    ('Plain Chips Small', 'CHIPS PEELED', 0.300, false),
    ('Plain Chips Small', 'COOKING OIL BULK', 0.100, false),
    ('Plain Chips Small', 'SALT', 0.002, false),
    ('Plain Chips Large', 'CHIPS PEELED', 0.600, false),
    ('Plain Chips Large', 'COOKING OIL BULK', 0.150, false),
    ('Plain Chips Large', 'SALT', 0.004, false),
    ('Masala Chips Small', 'CHIPS PEELED', 0.300, false),
    ('Masala Chips Small', 'MASALA SAUCE', 0.060, false),
    ('Masala Chips Small', 'PAPRIKA', 0.005, false),
    ('Masala Chips Large', 'CHIPS PEELED', 0.600, false),
    ('Masala Chips Large', 'MASALA SAUCE', 0.120, false),
    ('Masala Chips Large', 'PAPRIKA', 0.010, false),
    ('Plain Prego', 'SLICED 120G', 1, false),
    ('Plain Prego', 'LOAF PKTS', 1, false),
    ('Plain Prego', 'CHIPS PEELED', 0.300, false),
    ('Prego Pimento', 'SLICED 120G', 1, false),
    ('Prego Pimento', 'PIMENTO SAUCE', 0.060, false),
    ('Prego Pimento', 'CHIPS PEELED', 0.300, false),
    ('Beef Bitoque', 'SLICED 120G', 1, false),
    ('Beef Bitoque', 'EGGS', 1, false),
    ('Beef Bitoque', 'RICE COOKER', 1, false),
    ('Beef Bitoque', 'CHIPS PEELED', 0.250, false),
    ('Chicken Bitoque', 'BURGER (120G)', 1, false),
    ('Chicken Bitoque', 'EGGS', 1, false),
    ('Chicken Bitoque', 'RICE COOKER', 1, false),
    ('Chicken Bitoque', 'CHIPS PEELED', 0.250, false),
    ('Half Churrasco Chicken', 'FRANGO HALF (600G)', 1, false),
    ('Half Churrasco Chicken', 'CHIPS PEELED', 0.300, false),
    ('Half Churrasco Chicken', 'RICE COOKER', 1, false),
    ('Full Churrasco Chicken', 'FRANGO HALF (600G)', 2, false),
    ('Full Churrasco Chicken', 'CHIPS PEELED', 0.600, false),
    ('Full Churrasco Chicken', 'RICE COOKER', 2, false),
    ('Arroz de Marisco', 'RICE BULK', 0.400, false),
    ('Arroz de Marisco', 'CAMARAO HALF (PKT6)', 4, false),
    ('Arroz de Marisco', 'GARLIC GRATED', 0.010, false),
    ('Arroz de Marisco', 'POMODORO SAUCE', 0.150, false),
    ('Camarao 6 Prawns', 'CAMARAO HALF (PKT6)', 1, false),
    ('Camarao 6 Prawns', 'CHIPS PEELED', 0.300, false),
    ('Camarao 6 Prawns', 'RICE COOKER', 1, false),
    ('Camarao 12 Prawns', 'CAMARAO HALF (PKT6)', 2, false),
    ('Camarao 12 Prawns', 'CHIPS PEELED', 0.400, false),
    ('Camarao 12 Prawns', 'RICE COOKER', 1, false),
    ('Chocolate Cake', 'CHOCOLATE CAKE', 1, false),
    ('Pancakes', 'PANCAKE BATTER', 1, false),
    ('Pancakes', 'SYRUP', 0.030, false),
    ('Pancakes with Ice Cream', 'PANCAKE BATTER', 1, false),
    ('Pancakes with Ice Cream', 'ICE CREAM', 0.120, false),
    ('Pancakes with Ice Cream', 'SYRUP', 0.030, false),
    ('Ice Cream', 'ICE CREAM', 0.120, false),
    ('Oreo Ice Cream', 'OREO ICE CREAM BASE', 0.120, false),
    ('Pastel de Belem', 'PASTEL DE BELEM', 1, false),
    ('Italian Cappuccino', 'COFFEE BEANS', 0.010, false),
    ('Italian Cappuccino', 'MILK', 0.100, false),
    ('Italian Cappuccino', 'CHOCOLATE POWDER', 0.002, false),
    ('Brazilian Cappuccino', 'COFFEE BEANS', 0.010, false),
    ('Brazilian Cappuccino', 'MILK', 0.100, false),
    ('Brazilian Cappuccino', 'CINNAMON', 0.002, false),
    ('Kiddoccino', 'MILK', 0.250, false),
    ('Kiddoccino', 'CHOCOLATE POWDER', 0.002, false),
    ('Bica Espresso', 'COFFEE BEANS', 0.010, false),
    ('Railway Espresso Bombom', 'COFFEE BEANS', 0.010, false),
    ('Railway Espresso Bombom', 'CONDENSED MILK', 0.020, false),
    ('Carioca', 'COFFEE BEANS', 0.010, false),
    ('Macchiato', 'COFFEE BEANS', 0.010, false),
    ('Macchiato', 'MILK', 0.020, false),
    ('Pingo', 'COFFEE BEANS', 0.010, false),
    ('Pingo', 'MILK', 0.040, false),
    ('Babychino', 'MILK', 0.040, false),
    ('Babychino', 'CHOCOLATE POWDER', 0.002, false),
    ('Galao Caffe Latte', 'COFFEE BEANS', 0.010, false),
    ('Galao Caffe Latte', 'MILK', 0.120, false),
    ('Hot Chocolate', 'CHOCOLATE POWDER', 0.012, false),
    ('Hot Chocolate', 'MILK', 0.130, false),
    ('Submarine', 'MILK', 0.250, false),
    ('Submarine', 'CHOCOLATE BAR', 0.012, false),
    ('Chocachino', 'CHOCOLATE POWDER', 0.004, false),
    ('Chocachino', 'COFFEE BEANS', 0.010, false),
    ('Chocachino', 'MILK', 0.130, false),
    ('Filter Coffee', 'COFFEE BEANS', 0.020, false),
    ('Filter Coffee', 'MILK', 0.100, false),
    ('Malawian Tea', 'TEA BAG', 1, false),
    ('Malawian Tea', 'WATER', 0.250, false),
    ('Earl Grey Tea', 'EARL GREY TEA BAG', 1, false),
    ('Earl Grey Tea', 'WATER', 0.250, false),
    ('Rooibos Tea', 'ROOIBOS TEA BAG', 1, false),
    ('Rooibos Tea', 'WATER', 0.250, false),
    ('Carioca de Limao', 'TEA BAG', 1, false),
    ('Carioca de Limao', 'LEMON JUICE', 0.020, false),
    ('Herbal Teas', 'HERBAL TEA BAG', 1, false),
    ('Herbal Teas', 'WATER', 0.250, false)
),
pasta_recipes(menu_name, pasta_item, item_name, qty) as (
  values
    ('Spaghetti Pomodoro', 'SPAGHETTI', 'POMODORO SAUCE', 0.120::numeric),
    ('Spaghetti Pomodoro', 'SPAGHETTI', 'PARMESAN', 0.010),
    ('Penne Pomodoro', 'PENNE', 'POMODORO SAUCE', 0.120),
    ('Penne Pomodoro', 'PENNE', 'PARMESAN', 0.010),
    ('Fettucine Pomodoro', 'FETTUCCINE', 'POMODORO SAUCE', 0.120),
    ('Fettucine Pomodoro', 'FETTUCCINE', 'PARMESAN', 0.010),
    ('Spaghetti Picanti', 'SPAGHETTI', 'POMODORO SAUCE', 0.100),
    ('Spaghetti Picanti', 'SPAGHETTI', 'CHILLI SAUCE', 0.015),
    ('Spaghetti Picanti', 'SPAGHETTI', 'OLIVES', 0.020),
    ('Spaghetti Picanti', 'SPAGHETTI', 'GARLIC GRATED', 0.005),
    ('Penne Picanti', 'PENNE', 'POMODORO SAUCE', 0.100),
    ('Penne Picanti', 'PENNE', 'CHILLI SAUCE', 0.015),
    ('Penne Picanti', 'PENNE', 'OLIVES', 0.020),
    ('Penne Picanti', 'PENNE', 'GARLIC GRATED', 0.005),
    ('Fettucine Picanti', 'FETTUCCINE', 'POMODORO SAUCE', 0.100),
    ('Fettucine Picanti', 'FETTUCCINE', 'CHILLI SAUCE', 0.015),
    ('Fettucine Picanti', 'FETTUCCINE', 'OLIVES', 0.020),
    ('Fettucine Picanti', 'FETTUCCINE', 'GARLIC GRATED', 0.005),
    ('Spaghetti Bolognese', 'SPAGHETTI', 'MINCE COOKED', 0.120),
    ('Spaghetti Bolognese', 'SPAGHETTI', 'POMODORO SAUCE', 0.100),
    ('Spaghetti Bolognese', 'SPAGHETTI', 'PARMESAN', 0.010),
    ('Penne Bolognese', 'PENNE', 'MINCE COOKED', 0.120),
    ('Penne Bolognese', 'PENNE', 'POMODORO SAUCE', 0.100),
    ('Penne Bolognese', 'PENNE', 'PARMESAN', 0.010),
    ('Fettucine Bolognese', 'FETTUCCINE', 'MINCE COOKED', 0.120),
    ('Fettucine Bolognese', 'FETTUCCINE', 'POMODORO SAUCE', 0.100),
    ('Fettucine Bolognese', 'FETTUCCINE', 'PARMESAN', 0.010),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'FILLET TRAYS (500G)', 0.200),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'MUSHROOM', 0.040),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'WHITE SAUCE', 0.120),
    ('Spaghetti Creamy Chicken and Mushroom', 'SPAGHETTI', 'PARMESAN', 0.010),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'FILLET TRAYS (500G)', 0.200),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'MUSHROOM', 0.040),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'WHITE SAUCE', 0.120),
    ('Penne Creamy Chicken and Mushroom', 'PENNE', 'PARMESAN', 0.010),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'FILLET TRAYS (500G)', 0.200),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'MUSHROOM', 0.040),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'WHITE SAUCE', 0.120),
    ('Fettucine Creamy Chicken and Mushroom', 'FETTUCCINE', 'PARMESAN', 0.010),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'CAMARAO PASTA PKTS (80G)', 2),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'POMODORO SAUCE', 0.080),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'WHITE SAUCE', 0.080),
    ('Spaghetti Creamy Tomato and Prawn', 'SPAGHETTI', 'GARLIC GRATED', 0.005),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'CAMARAO PASTA PKTS (80G)', 2),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'POMODORO SAUCE', 0.080),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'WHITE SAUCE', 0.080),
    ('Penne Creamy Tomato and Prawn', 'PENNE', 'GARLIC GRATED', 0.005),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'CAMARAO PASTA PKTS (80G)', 2),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'POMODORO SAUCE', 0.080),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'WHITE SAUCE', 0.080),
    ('Fettucine Creamy Tomato and Prawn', 'FETTUCCINE', 'GARLIC GRATED', 0.005)
),
pizza_recipes(menu_name, item_name, qty) as (
  values
    ('Katundu Pizza', 'PIZZA PKTS (80G)', 1::numeric),
    ('Katundu Pizza', 'PIZZA PKTS & BOLOG (80G)', 1),
    ('Katundu Pizza', 'G. PEPPERS', 0.040),
    ('Katundu Pizza', 'ONIONS', 0.040),
    ('Mexicano Pizza', 'PIZZA PKTS & BOLOG (80G)', 1),
    ('Mexicano Pizza', 'G. PEPPERS', 0.040),
    ('Mexicano Pizza', 'ONIONS', 0.040),
    ('Mexicano Pizza', 'CHILLI SAUCE', 0.015),
    ('Portuguese Chicken Pizza', 'PIZZA PKTS (80G)', 1),
    ('Portuguese Chicken Pizza', 'ONIONS', 0.040),
    ('Portuguese Chicken Pizza', 'G. PEPPERS', 0.040),
    ('Chicken Mushroom Pizza', 'PIZZA PKTS (80G)', 1),
    ('Chicken Mushroom Pizza', 'MUSHROOM', 0.040),
    ('Sweet and Sour Safari Pizza', 'PIZZA PKTS (80G)', 1),
    ('Sweet and Sour Safari Pizza', 'PINEAPPLE', 0.050),
    ('Sweet and Sour Safari Pizza', 'G. PEPPERS', 0.030),
    ('Maffiosa Pizza', 'PIZZA PKTS (80G)', 1),
    ('Maffiosa Pizza', 'OLIVES', 0.020),
    ('Maffiosa Pizza', 'CHILLI SAUCE', 0.010),
    ('Prawn Pizza', 'CAMARAO PASTA PKTS (80G)', 1),
    ('Prawn Pizza', 'GARLIC GRATED', 0.005),
    ('Anchovy Pizza', 'ANCHOVY', 0.040),
    ('Anchovy Pizza', 'CAPERS', 0.010),
    ('Vegetarian Pizza', 'MUSHROOM', 0.040),
    ('Vegetarian Pizza', 'G. PEPPERS', 0.040),
    ('Vegetarian Pizza', 'ONIONS', 0.040),
    ('Vegetarian Pizza', 'OLIVES', 0.020),
    ('Vegan Pizza', 'MUSHROOM', 0.040),
    ('Vegan Pizza', 'G. PEPPERS', 0.040),
    ('Vegan Pizza', 'ONIONS', 0.040),
    ('Vegan Pizza', 'TOMATO FRESH', 0.040),
    ('Margarita Pizza', 'EXTRA CHEESE', 0.040),
    ('Piccanti Pizza', 'CHILLI SAUCE', 0.015),
    ('Piccanti Pizza', 'GARLIC GRATED', 0.005),
    ('Piccanti Pizza', 'G. PEPPERS', 0.040),
    ('Jalapeno Pizza', 'JALAPENO', 0.020),
    ('Jalapeno Pizza', 'ONIONS', 0.030),
    ('Hummus Pizza', 'HUMMUS', 0.060),
    ('Hummus Pizza', 'OLIVES', 0.020),
    ('Godfather Pizza', 'FETA CHEESE', 0.030),
    ('Godfather Pizza', 'SPINACH', 0.040),
    ('Godfather Pizza', 'OLIVES', 0.020),
    ('Mediterranean Pizza', 'DRIED TOMATO', 0.030),
    ('Mediterranean Pizza', 'OLIVES', 0.020),
    ('Mediterranean Pizza', 'BASIL', 0.005)
),
all_seed_recipes as (
  select menu_name, item_name, qty, takeaway_only from seed_recipes
  union all
  select menu_name, pasta_item, 0.120, false from pasta_recipes group by menu_name, pasta_item
  union all
  select menu_name, 'COOKING OIL BULK', 0.015, false from pasta_recipes group by menu_name
  union all
  select menu_name, 'SALT', 0.002, false from pasta_recipes group by menu_name
  union all
  select menu_name, item_name, qty, false from pasta_recipes
  union all
  select menu_name, 'PIZZA TOMATO BASE', 0.100, false from pizza_recipes group by menu_name
  union all
  select menu_name, 'CHEESE PIZZA PKTS', 0.120, false from pizza_recipes where menu_name <> 'Vegan Pizza' group by menu_name
  union all
  select menu_name, item_name, qty, false from pizza_recipes
)
insert into public.recipes (menu_item_id, item_id, qty, takeaway_only)
select m.id, i.id, r.qty, r.takeaway_only
from all_seed_recipes r
join public.menu_items m on lower(m.name) = lower(r.menu_name) and m.active
join public.items i on lower(i.name) = lower(r.item_name) and i.active
on conflict (menu_item_id, item_id) do update
set qty = excluded.qty,
    takeaway_only = excluded.takeaway_only,
    updated_at = now();

delete from public.recipes r
using public.items i
where r.item_id = i.id
  and r.takeaway_only
  and i.stock_type = 'consumable';

insert into public.packaging_options (item_id, name, price, sort_order, active)
select i.id, v.name, v.price, v.sort_order, true
from (values
  ('PIZZA BOX', 'Pizza Box', 0::numeric, 1),
  ('WHITE SMALL BOX', 'White Small Box', 0, 2),
  ('WHITE LARGE BOX', 'White Large Box', 0, 3),
  ('FOIL CUPS', 'Foil Cup', 0, 4),
  ('BLACK JUMBOS PKTS', 'Black Jumbo Packet', 0, 5),
  ('PIZZA PACKAGING PKTS', 'Pizza Packet', 0, 6)
) as v(item_name, name, price, sort_order)
join public.items i on lower(i.name) = lower(v.item_name)
where not exists (
  select 1
  from public.packaging_options p
  where p.active
    and lower(p.name) = lower(v.name)
);

update public.packaging_options p
set item_id = i.id,
    sort_order = v.sort_order,
    active = true,
    updated_at = now()
from (values
  ('PIZZA BOX', 'Pizza Box', 1),
  ('WHITE SMALL BOX', 'White Small Box', 2),
  ('WHITE LARGE BOX', 'White Large Box', 3),
  ('FOIL CUPS', 'Foil Cup', 4),
  ('BLACK JUMBOS PKTS', 'Black Jumbo Packet', 5),
  ('PIZZA PACKAGING PKTS', 'Pizza Packet', 6)
) as v(item_name, name, sort_order)
join public.items i on lower(i.name) = lower(v.item_name)
where lower(p.name) = lower(v.name);

insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select m.id, v.modifier_name, v.price_delta, v.sort_order, true
from public.menu_items m
join public.categories c on c.id = m.category_id
cross join (values
  ('Extra Cheese', 6000::numeric, 10),
  ('Extra Chicken', 6000, 11),
  ('Extra Mushroom', 6000, 12),
  ('Extra Egg', 6000, 13)
) as v(modifier_name, price_delta, sort_order)
where m.active
  and c.kind = 'menu'
  and c.name in ('Pizza', 'Burgers', 'Pregos & Bitoques')
  and not exists (
    select 1
    from public.modifiers mod
    where mod.menu_item_id = m.id
      and mod.active
      and lower(mod.name) = lower(v.modifier_name)
  );

insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select m.id, 'Extra Fried Onions', 6000, 14, true
from public.menu_items m
join public.categories c on c.id = m.category_id
where m.active
  and c.kind = 'menu'
  and c.name in ('Burgers', 'Pregos & Bitoques')
  and not exists (
    select 1
    from public.modifiers mod
    where mod.menu_item_id = m.id
      and mod.active
      and lower(mod.name) = 'extra fried onions'
  );

update public.modifiers mod
set price_delta = 6000,
    updated_at = now()
where lower(mod.name) in ('extra cheese', 'extra chicken', 'extra mushroom', 'extra egg', 'extra fried onions');

delete from public.modifier_recipes mr
using public.modifiers mod
where mr.modifier_id = mod.id
  and lower(mod.name) in ('extra cheese', 'extra chicken', 'extra mushroom', 'extra egg', 'extra fried onions');

insert into public.modifier_recipes (modifier_id, item_id, qty)
select mod.id, i.id, v.qty
from public.modifiers mod
join public.menu_items m on m.id = mod.menu_item_id
join public.categories c on c.id = m.category_id
join lateral (
  select case
      when lower(mod.name) = 'extra cheese' and c.name = 'Pizza' then 'EXTRA CHEESE'
      when lower(mod.name) = 'extra cheese' then 'CHEESE BURGER PKTS'
      when lower(mod.name) = 'extra chicken' then 'PIZZA PKTS (80G)'
      when lower(mod.name) = 'extra mushroom' then 'MUSHROOM'
      when lower(mod.name) = 'extra egg' then 'EGGS'
      when lower(mod.name) = 'extra fried onions' then 'FRIED ONIONS'
    end as item_name,
    case
      when lower(mod.name) = 'extra chicken' then 1::numeric
      when lower(mod.name) = 'extra egg' then 1::numeric
      else 0.040::numeric
    end as qty
) v on v.item_name is not null
join public.items i on lower(i.name) = lower(v.item_name)
where mod.active
  and lower(mod.name) in ('extra cheese', 'extra chicken', 'extra mushroom', 'extra egg', 'extra fried onions')
on conflict (modifier_id, item_id) do update
set qty = excluded.qty,
    updated_at = now();

create or replace function public.finalize_order(
  _payload jsonb,
  _branch_id uuid default null,
  _customer_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  user_id uuid := auth.uid();
  order_id uuid;
  order_item_id uuid;
  packaging_row_id uuid;
  line jsonb;
  modifier_payload jsonb;
  packaging_payload jsonb;
  menu public.menu_items%rowtype;
  modifier public.modifiers%rowtype;
  packaging public.packaging_options%rowtype;
  recipe public.recipes%rowtype;
  modifier_recipe public.modifier_recipes%rowtype;
  payment jsonb;
  qty numeric(14, 6);
  modifier_total numeric(14, 2);
  unit_price numeric(14, 2);
  package_unit_price numeric(14, 2);
  subtotal numeric(14, 2) := 0;
  discount numeric(14, 2) := coalesce((_payload ->> 'discount')::numeric, 0);
  total numeric(14, 2);
  payment_total numeric(14, 2) := 0;
  movement public.stock_movements%rowtype;
  line_takeaway boolean;
  crust_option_count integer;
  selected_crust_count integer;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'cashier')) then
    raise exception 'Only admins and cashiers can finalize orders';
  end if;

  if not app_private.can_access_branch(user_id, _branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  if jsonb_typeof(_payload -> 'items') <> 'array' or jsonb_array_length(_payload -> 'items') = 0 then
    raise exception 'Order requires at least one line item';
  end if;

  for line in select * from jsonb_array_elements(_payload -> 'items') loop
    qty := coalesce((line ->> 'qty')::numeric, 0);
    if qty <= 0 then
      raise exception 'Order line quantity must be positive';
    end if;

    select *
    into menu
    from public.menu_items
    where id = (line ->> 'menu_item_id')::uuid
      and active;

    if not found then
      raise exception 'Menu item not found or inactive';
    end if;

    if not app_private.can_access_branch(user_id, coalesce(_branch_id, menu.branch_id)) then
      raise exception 'You do not have access to this menu item';
    end if;

    modifier_total := 0;
    selected_crust_count := 0;
    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select *
        into modifier
        from public.modifiers
        where id = (modifier_payload ->> 'modifier_id')::uuid
          and menu_item_id = menu.id
          and active;

        if not found then
          raise exception 'Modifier not found or inactive';
        end if;

        if lower(modifier.name) in ('thin crust', 'thick crust') then
          selected_crust_count := selected_crust_count + 1;
        end if;

        modifier_total := modifier_total + modifier.price_delta;
      end loop;
    end if;

    select count(*)
    into crust_option_count
    from public.modifiers
    where menu_item_id = menu.id
      and active
      and lower(name) in ('thin crust', 'thick crust');

    if crust_option_count > 0 and selected_crust_count <> 1 then
      raise exception 'Choose exactly one pizza crust';
    end if;

    subtotal := subtotal + ((menu.price + modifier_total) * qty);

    line_takeaway := coalesce((line ->> 'takeaway')::boolean, false);
    if line_takeaway then
      if jsonb_typeof(line -> 'packaging') <> 'object' then
        raise exception 'Choose packaging for takeaway items';
      end if;

      packaging_payload := line -> 'packaging';
      select *
      into packaging
      from public.packaging_options
      where id = (packaging_payload ->> 'option_id')::uuid
        and active;

      if not found then
        raise exception 'Packaging option not found or inactive';
      end if;

      if not app_private.can_access_branch(user_id, coalesce(_branch_id, packaging.branch_id)) then
        raise exception 'You do not have access to this packaging option';
      end if;

      package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);
      if package_unit_price < 0 then
        raise exception 'Packaging price cannot be negative';
      end if;

      subtotal := subtotal + (package_unit_price * qty);
    end if;
  end loop;

  total := greatest(subtotal - discount, 0);

  if jsonb_typeof(_payload -> 'payments') <> 'array' then
    raise exception 'Order requires payments';
  end if;

  for payment in select * from jsonb_array_elements(_payload -> 'payments') loop
    if coalesce((payment ->> 'amount')::numeric, 0) <= 0 then
      raise exception 'Payment amount must be positive';
    end if;

    payment_total := payment_total + coalesce((payment ->> 'amount')::numeric, 0);
  end loop;

  if payment_total < total then
    raise exception 'Payment total is less than order total';
  end if;

  insert into public.orders (
    branch_id,
    customer_id,
    cashier_id,
    subtotal,
    discount,
    total,
    status,
    note
  )
  values (
    _branch_id,
    _customer_id,
    user_id,
    subtotal,
    discount,
    total,
    'paid',
    nullif(_payload ->> 'note', '')
  )
  returning id into order_id;

  for line in select * from jsonb_array_elements(_payload -> 'items') loop
    qty := (line ->> 'qty')::numeric;
    line_takeaway := coalesce((line ->> 'takeaway')::boolean, false);
    select * into menu from public.menu_items where id = (line ->> 'menu_item_id')::uuid;

    modifier_total := 0;
    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;
        modifier_total := modifier_total + modifier.price_delta;
      end loop;
    end if;

    unit_price := menu.price + modifier_total;

    insert into public.order_items (order_id, menu_item_id, qty, unit_price, note, takeaway)
    values (order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''), line_takeaway)
    returning id into order_item_id;

    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta)
        values (order_item_id, modifier.id, modifier.price_delta);

        for modifier_recipe in
          select *
          from public.modifier_recipes
          where modifier_id = modifier.id
        loop
          movement := public.apply_stock_movement(
            modifier_recipe.item_id,
            'sale',
            -abs(modifier_recipe.qty * qty),
            0,
            'POS order ' || order_id::text || ' modifier ' || modifier.name,
            _branch_id,
            'order',
            order_id
          );
        end loop;
      end loop;
    end if;

    if line_takeaway and jsonb_typeof(line -> 'packaging') = 'object' then
      packaging_payload := line -> 'packaging';
      select *
      into packaging
      from public.packaging_options
      where id = (packaging_payload ->> 'option_id')::uuid
        and active;

      package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);

      movement := public.apply_stock_movement(
        packaging.item_id,
        'sale',
        -abs(qty),
        0,
        'POS order ' || order_id::text || ' packaging ' || packaging.name,
        _branch_id,
        'order',
        order_id
      );

      insert into public.order_item_packaging (
        order_item_id,
        packaging_option_id,
        item_id,
        qty,
        unit_price,
        stock_movement_id
      )
      values (
        order_item_id,
        packaging.id,
        packaging.item_id,
        qty,
        package_unit_price,
        movement.id
      )
      returning id into packaging_row_id;
    end if;

    for recipe in
      select *
      from public.recipes
      where menu_item_id = menu.id
        and (not takeaway_only or line_takeaway)
    loop
      movement := public.apply_stock_movement(
        recipe.item_id,
        'sale',
        -abs(recipe.qty * qty),
        0,
        'POS order ' || order_id::text,
        _branch_id,
        'order',
        order_id
      );
    end loop;
  end loop;

  for payment in select * from jsonb_array_elements(_payload -> 'payments') loop
    insert into public.payments (order_id, method, amount)
    values (order_id, (payment ->> 'method')::public.payment_method, (payment ->> 'amount')::numeric);
  end loop;

  insert into public.receipts (order_id, receipt_no, channel, issued_by)
  values (
    order_id,
    'RCPT-' || to_char(now(), 'YYYYMMDD') || '-' || left(order_id::text, 8),
    'screen',
    user_id
  );

  return order_id;
end;
$$;

revoke execute on function public.finalize_order(jsonb, uuid, uuid) from public, anon;
grant execute on function public.finalize_order(jsonb, uuid, uuid) to authenticated;

do $$
declare
  actor_id uuid;
  main_branch_id uuid;
  item_record public.items%rowtype;
  stock record;
  before_qty numeric(14, 3);
begin
  select ur.user_id
  into actor_id
  from public.user_roles ur
  where ur.role = 'admin'
  order by ur.created_at
  limit 1;

  select b.id
  into main_branch_id
  from public.branches b
  where lower(b.code) = 'main'
  order by b.created_at
  limit 1;

  for stock in
    select *
    from (values
      ('FRANGO HALF (600G)', 21::numeric),
      ('FILLET TRAYS (500G)', 3),
      ('PIZZA PKTS (80G)', 9),
      ('BURGER (120G)', 4),
      ('SLICED 120G', 12),
      ('MINCE BULK (1KG)', 1),
      ('BURGERS (120G)', 9),
      ('PIZZA PKTS & BOLOG (80G)', 3),
      ('CAMARAO BOX PKTS', 1),
      ('CAMARAO HALF (PKT6)', 16),
      ('CAMARAO PASTA PKTS (80G)', 11),
      ('CHEESE BLOCK QTY', 1),
      ('CHEESE PIZZA PKTS', 0.120),
      ('CHEESE BURGER PKTS', 0.440),
      ('MILK', 3),
      ('CONDENSED MILK', 1.170),
      ('EGGS', 33),
      ('FLOUR BAG', 2),
      ('DOUGH PIZZA BASES THIN', 35),
      ('DOUGH PIZZA BASES THICK', 29),
      ('BURGER BUNS', 18),
      ('RICE BULK', 5),
      ('MARISCO PKTS', 10),
      ('SALT', 1),
      ('SUGAR', 4),
      ('COOKING OIL BULK', 1),
      ('POTATOES BULK', 19.550),
      ('CHIPS PEELED', 0.540),
      ('ONIONS', 3),
      ('GARLIC FULL', 2),
      ('RED BEANS TIN (410G)', 4),
      ('TOMATO FRESH', 20)
    ) as s(item_name, qty)
    where s.qty > 0
  loop
    select *
    into item_record
    from public.items i
    where i.active
      and lower(i.name) = lower(stock.item_name)
    for update;

    if found and not exists (
      select 1
      from public.stock_movements sm
      where sm.item_id = item_record.id
        and sm.ref_type = 'opening_stock'
    ) then
      if actor_id is not null then
        perform app_private.apply_stock_movement_internal(
          actor_id,
          item_record.id,
          'adjustment',
          stock.qty,
          0,
          'Opening inventory loaded from opening stock sheet',
          main_branch_id,
          'opening_stock',
          null
        );
      else
        before_qty := item_record.qty_on_hand;

        update public.items
        set qty_on_hand = before_qty + stock.qty,
            branch_id = coalesce(branch_id, main_branch_id),
            updated_at = now()
        where id = item_record.id;

        insert into public.stock_movements (
          branch_id,
          item_id,
          type,
          qty,
          unit_cost,
          qty_before,
          qty_after,
          note,
          ref_type,
          ref_id,
          created_by
        )
        values (
          main_branch_id,
          item_record.id,
          'adjustment',
          stock.qty,
          item_record.avg_cost,
          before_qty,
          before_qty + stock.qty,
          'Opening inventory loaded from opening stock sheet',
          'opening_stock',
          null,
          null
        );
      end if;
    end if;
  end loop;
end;
$$;
