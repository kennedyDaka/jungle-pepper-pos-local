-- Refine operational stock units and make pizza base choice a required POS modifier.

create table if not exists public.modifier_recipes (
  id uuid primary key default gen_random_uuid(),
  modifier_id uuid not null references public.modifiers(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  qty numeric(14, 6) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modifier_recipes_positive_qty check (qty > 0),
  unique (modifier_id, item_id)
);

drop trigger if exists modifier_recipes_touch_updated_at on public.modifier_recipes;
create trigger modifier_recipes_touch_updated_at
  before update on public.modifier_recipes
  for each row execute function app_private.touch_updated_at();

alter table public.modifier_recipes enable row level security;

drop policy if exists "modifier recipes staff read" on public.modifier_recipes;
create policy "modifier recipes staff read"
  on public.modifier_recipes for select to authenticated
  using (
    exists (
      select 1
      from public.modifiers mod
      join public.menu_items m on m.id = mod.menu_item_id
      where mod.id = modifier_id
        and app_private.can_access_branch((select auth.uid()), m.branch_id)
    )
  );

drop policy if exists "modifier recipes admin insert" on public.modifier_recipes;
create policy "modifier recipes admin insert"
  on public.modifier_recipes for insert to authenticated
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    and exists (
      select 1
      from public.modifiers mod
      join public.menu_items m on m.id = mod.menu_item_id
      where mod.id = modifier_id
        and app_private.can_access_branch((select auth.uid()), m.branch_id)
    )
  );

drop policy if exists "modifier recipes admin update" on public.modifier_recipes;
create policy "modifier recipes admin update"
  on public.modifier_recipes for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

drop policy if exists "modifier recipes admin delete" on public.modifier_recipes;
create policy "modifier recipes admin delete"
  on public.modifier_recipes for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

grant select, insert, update, delete on public.modifier_recipes to authenticated;

create index if not exists modifier_recipes_modifier_id_idx
  on public.modifier_recipes (modifier_id);

create index if not exists modifier_recipes_item_id_idx
  on public.modifier_recipes (item_id);

-- Unit cleanup: bulk weighed/prepped ingredients stay kg/l; counted packs/bottles/pieces stay count units.
update public.items i
set unit_id = u.id,
    updated_at = now()
from public.units u
where u.code = 'pkt'
  and i.active
  and i.name in ('MARISCO PKTS');

update public.items i
set unit_id = u.id,
    updated_at = now()
from public.units u
where u.code = 'l'
  and i.active
  and i.name in ('MILK');

update public.items i
set bottle_ml = 1000,
    updated_at = now()
where i.active
  and i.name = 'BOTTLE KITCHEN (1L)';

-- Pizzas must choose one dough base. The base recipe no longer hardcodes thin base.
delete from public.recipes r
using public.menu_items m, public.categories c, public.items i
where r.menu_item_id = m.id
  and m.category_id = c.id
  and r.item_id = i.id
  and c.kind = 'menu'
  and c.name = 'Pizza'
  and i.name in ('DOUGH PIZZA BASES THIN', 'DOUGH PIZZA BASES THICK');

insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select m.id, 'Thin Crust', 0, 1, true
from public.menu_items m
join public.categories c on c.id = m.category_id
where m.active
  and c.kind = 'menu'
  and c.name = 'Pizza'
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
  and c.kind = 'menu'
  and c.name = 'Pizza'
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
  and c.kind = 'menu'
  and c.name = 'Pizza'
  and lower(mod.name) in ('thin crust', 'thick crust');

delete from public.modifier_recipes mr
using public.modifiers mod, public.menu_items m, public.categories c
where mr.modifier_id = mod.id
  and mod.menu_item_id = m.id
  and m.category_id = c.id
  and c.kind = 'menu'
  and c.name = 'Pizza'
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
  and c.kind = 'menu'
  and c.name = 'Pizza'
  and lower(mod.name) in ('thin crust', 'thick crust')
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
  line jsonb;
  modifier_payload jsonb;
  menu public.menu_items%rowtype;
  modifier public.modifiers%rowtype;
  recipe public.recipes%rowtype;
  modifier_recipe public.modifier_recipes%rowtype;
  payment jsonb;
  qty numeric(14, 6);
  modifier_total numeric(14, 2);
  unit_price numeric(14, 2);
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
