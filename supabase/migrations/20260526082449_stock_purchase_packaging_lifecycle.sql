alter table public.expense_stock_lines
  add column if not exists qty_count numeric(14, 6),
  add column if not exists package_size numeric(14, 6),
  add column if not exists package_unit text,
  add column if not exists total_cost numeric(14, 2);

insert into public.expense_categories (name, active)
select category_name, true
from (values
  ('Stock Purchase'),
  ('Overheads'),
  ('Transport'),
  ('Fuel'),
  ('Rent'),
  ('Utilities'),
  ('Salaries'),
  ('Wages'),
  ('Maintenance'),
  ('Repairs'),
  ('Cleaning'),
  ('Airtime'),
  ('Internet'),
  ('Marketing'),
  ('Delivery'),
  ('Security'),
  ('Bank Charges'),
  ('Office Supplies'),
  ('Petty Cash'),
  ('Insurance'),
  ('Licenses & Permits'),
  ('Equipment'),
  ('Professional Fees'),
  ('Staff Welfare'),
  ('Miscellaneous')
) as v(category_name)
where not exists (
  select 1
  from public.expense_categories ec
  where lower(ec.name) = lower(v.category_name)
    and ec.active
);

update public.items
set active = false,
    updated_at = now()
where lower(name) = 'extra cheese'
  and active;

delete from public.recipes r
using public.items i
where i.id = r.item_id
  and lower(i.name) = 'extra cheese';

delete from public.modifier_recipes mr
using public.items i
where i.id = mr.item_id
  and lower(i.name) = 'extra cheese';

with food_menu as (
  select m.id
  from public.menu_items m
  join public.categories c on c.id = m.category_id
  where m.active
    and c.kind = 'menu'
    and not (
      c.name ilike '%bar%'
      or c.name ilike '%drink%'
      or c.name ilike '%beer%'
      or c.name ilike '%wine%'
      or c.name ilike '%gin%'
      or c.name ilike '%brandy%'
      or c.name ilike '%rum%'
      or c.name ilike '%whiskey%'
      or c.name ilike '%whisky%'
      or c.name ilike '%vodka%'
      or c.name ilike '%tequila%'
      or c.name ilike '%liqueur%'
      or c.name ilike '%soft%'
      or c.name ilike '%mocktail%'
      or c.name ilike '%tea%'
      or c.name ilike '%coffee%'
    )
),
extra_options as (
  select *
  from (values
    ('Extra Cheese', 8000::numeric, 10),
    ('Extra Chicken', 8000::numeric, 11),
    ('Extra Mushroom', 8000::numeric, 12),
    ('Extra Egg', 8000::numeric, 13),
    ('Extra Fried Onions', 8000::numeric, 14)
  ) as v(name, price_delta, sort_order)
)
insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select food_menu.id, extra_options.name, extra_options.price_delta, extra_options.sort_order, true
from food_menu
cross join extra_options
where not exists (
  select 1
  from public.modifiers existing
  where existing.menu_item_id = food_menu.id
    and lower(existing.name) = lower(extra_options.name)
    and existing.active
);

update public.modifiers mod
set price_delta = 8000,
    active = true,
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
      when lower(mod.name) = 'extra cheese' and c.name = 'Pizza' then 'pizza_cheese'
      when lower(mod.name) = 'extra cheese' then 'burger_cheese'
      when lower(mod.name) = 'extra chicken' then 'chicken_pkt'
      when lower(mod.name) = 'extra mushroom' then 'mushroom'
      when lower(mod.name) = 'extra egg' then 'egg'
      when lower(mod.name) = 'extra fried onions' then 'fried_onions'
    end as item_key,
    case
      when lower(mod.name) in ('extra chicken', 'extra egg', 'extra cheese') then 1::numeric
      else 0.040::numeric
    end as qty
) v on v.item_key is not null
join public.items i on (
  (v.item_key = 'pizza_cheese' and lower(i.name) in ('cheese pizza pkts', 'cheese pizza pkts (120g)'))
  or (v.item_key = 'burger_cheese' and lower(i.name) in ('cheese burger pkts', 'cheese burger pkts (40g)'))
  or (v.item_key = 'chicken_pkt' and lower(i.name) = 'pizza pkts (80g)')
  or (v.item_key = 'mushroom' and lower(i.name) = 'mushroom')
  or (v.item_key = 'egg' and lower(i.name) = 'eggs')
  or (v.item_key = 'fried_onions' and lower(i.name) = 'fried onions')
)
where mod.active
  and i.active
  and lower(mod.name) in ('extra cheese', 'extra chicken', 'extra mushroom', 'extra egg', 'extra fried onions')
on conflict (modifier_id, item_id) do update
set qty = excluded.qty,
    updated_at = now();

create or replace function public.apply_stock_purchase(
  _payload jsonb,
  _branch_id uuid default null,
  _affect_stock boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  user_id uuid := auth.uid();
  stock_category_id uuid;
  expense_id uuid;
  line jsonb;
  movement public.stock_movements%rowtype;
  movement_id uuid;
  total numeric(14, 2) := 0;
  ref text;
  item_branch_id uuid;
  line_qty numeric(14, 6);
  line_unit_cost numeric(14, 2);
  line_total numeric(14, 2);
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'storekeeper')) then
    raise exception 'Only admins and storekeepers can record stock purchases';
  end if;

  if not app_private.can_access_branch(user_id, _branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if jsonb_typeof(_payload -> 'lines') <> 'array' or jsonb_array_length(_payload -> 'lines') = 0 then
    raise exception 'Stock purchase requires at least one line';
  end if;

  select id
  into stock_category_id
  from public.expense_categories
  where lower(name) = 'stock purchase'
    and active
  limit 1;

  if stock_category_id is null then
    raise exception 'Stock Purchase expense category is missing';
  end if;

  for line in select * from jsonb_array_elements(_payload -> 'lines') loop
    line_qty := coalesce(nullif(line ->> 'qty', '')::numeric, 0);
    line_total := coalesce(
      nullif(line ->> 'total_cost', '')::numeric,
      line_qty * coalesce(nullif(line ->> 'unit_cost', '')::numeric, 0)
    );
    line_unit_cost := coalesce(
      nullif(line ->> 'unit_cost', '')::numeric,
      case when line_qty > 0 then round(line_total / line_qty, 2) else 0 end
    );

    if line_qty <= 0 then
      raise exception 'Stock purchase line quantity must be positive';
    end if;
    if line_total < 0 or line_unit_cost < 0 then
      raise exception 'Stock purchase line cost cannot be negative';
    end if;

    select branch_id
    into item_branch_id
    from public.items
    where id = (line ->> 'item_id')::uuid
      and active;

    if not found then
      raise exception 'Inventory item not found or inactive';
    end if;

    if not app_private.can_access_branch(user_id, coalesce(_branch_id, item_branch_id)) then
      raise exception 'You do not have access to this inventory item';
    end if;

    total := total + line_total;
  end loop;

  ref := 'EXP-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || lower(left(gen_random_uuid()::text, 6));

  insert into public.expenses (
    branch_id,
    ref_no,
    category_id,
    amount,
    payment_method,
    description,
    supplier_id,
    expense_date,
    created_by
  )
  values (
    _branch_id,
    ref,
    stock_category_id,
    total,
    (_payload ->> 'payment_method')::public.payment_method,
    nullif(_payload ->> 'description', ''),
    nullif(_payload ->> 'supplier_id', '')::uuid,
    coalesce((_payload ->> 'expense_date')::date, current_date),
    user_id
  )
  returning id into expense_id;

  for line in select * from jsonb_array_elements(_payload -> 'lines') loop
    movement_id := null;
    line_qty := coalesce(nullif(line ->> 'qty', '')::numeric, 0);
    line_total := coalesce(
      nullif(line ->> 'total_cost', '')::numeric,
      line_qty * coalesce(nullif(line ->> 'unit_cost', '')::numeric, 0)
    );
    line_unit_cost := coalesce(
      nullif(line ->> 'unit_cost', '')::numeric,
      case when line_qty > 0 then round(line_total / line_qty, 2) else 0 end
    );

    if _affect_stock then
      movement := public.apply_stock_movement(
        (line ->> 'item_id')::uuid,
        'purchase_in',
        line_qty,
        line_unit_cost,
        ref || ': ' || coalesce(nullif(_payload ->> 'description', ''), 'Stock purchase'),
        _branch_id,
        'expense',
        expense_id
      );
      movement_id := movement.id;
    end if;

    insert into public.expense_stock_lines (
      expense_id,
      item_id,
      stock_movement_id,
      qty,
      qty_count,
      package_size,
      package_unit,
      unit_cost,
      total_cost
    )
    values (
      expense_id,
      (line ->> 'item_id')::uuid,
      movement_id,
      line_qty,
      nullif(line ->> 'qty_count', '')::numeric,
      nullif(line ->> 'package_size', '')::numeric,
      nullif(line ->> 'package_unit', ''),
      line_unit_cost,
      line_total
    );
  end loop;

  return expense_id;
end;
$$;

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
  package_qty_per_item numeric(14, 6);
  package_qty numeric(14, 6);
  subtotal numeric(14, 2) := 0;
  discount numeric(14, 2) := coalesce((_payload ->> 'discount')::numeric, 0);
  total numeric(14, 2);
  vat_rate numeric(6, 4) := 0.175;
  net_amount numeric(14, 2);
  vat_amount numeric(14, 2);
  payment_total numeric(14, 2) := 0;
  movement public.stock_movements%rowtype;
  line_takeaway boolean;
  crust_option_count integer;
  selected_crust_count integer;
  is_staff_meal boolean := coalesce((_payload ->> 'staff_meal')::boolean, false);
  staff_reason text := nullif(btrim(coalesce(_payload ->> 'staff_meal_reason', '')), '');
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

  if is_staff_meal and staff_reason is null then
    raise exception 'Staff meal requires an approval note';
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
      package_qty_per_item := coalesce(nullif(packaging_payload ->> 'qty_per_item', '')::numeric, 1);
      if package_unit_price < 0 then
        raise exception 'Packaging price cannot be negative';
      end if;
      if package_qty_per_item <= 0 then
        raise exception 'Packaging quantity must be positive';
      end if;

      subtotal := subtotal + (package_unit_price * qty * package_qty_per_item);
    end if;
  end loop;

  if is_staff_meal then
    discount := subtotal;
  end if;

  total := greatest(subtotal - discount, 0);
  if is_staff_meal then
    total := 0;
  end if;

  net_amount := round(total / (1 + vat_rate), 2);
  vat_amount := total - net_amount;

  if jsonb_typeof(_payload -> 'payments') = 'array' then
    for payment in select * from jsonb_array_elements(_payload -> 'payments') loop
      if coalesce((payment ->> 'amount')::numeric, 0) <= 0 then
        raise exception 'Payment amount must be positive';
      end if;

      payment_total := payment_total + coalesce((payment ->> 'amount')::numeric, 0);
    end loop;
  elsif total > 0 then
    raise exception 'Order requires payments';
  end if;

  if is_staff_meal and payment_total > 0 then
    raise exception 'Staff meals cannot include payments';
  end if;

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
    vat_rate,
    net_amount,
    vat_amount,
    sale_type,
    staff_meal_reason,
    staff_meal_approved_by,
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
    vat_rate,
    net_amount,
    vat_amount,
    case when is_staff_meal then 'staff_meal' else 'regular' end,
    staff_reason,
    case when is_staff_meal then user_id else null end,
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
            'POS order ' || order_id::text || ' item ' || menu.name || ' x' || qty::text || ' modifier ' || modifier.name,
            _branch_id,
            'order_item',
            order_item_id
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
      package_qty_per_item := coalesce(nullif(packaging_payload ->> 'qty_per_item', '')::numeric, 1);
      package_qty := qty * package_qty_per_item;

      movement := public.apply_stock_movement(
        packaging.item_id,
        'sale',
        -abs(package_qty),
        0,
        'POS order ' || order_id::text || ' item ' || menu.name || ' x' || qty::text || ' packaging ' || packaging.name || ' x' || package_qty::text,
        _branch_id,
        'order_item',
        order_item_id
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
        package_qty,
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
        'POS order ' || order_id::text || ' item ' || menu.name || ' x' || qty::text,
        _branch_id,
        'order_item',
        order_item_id
      );
    end loop;
  end loop;

  if jsonb_typeof(_payload -> 'payments') = 'array' then
    for payment in select * from jsonb_array_elements(_payload -> 'payments') loop
      insert into public.payments (order_id, method, amount)
      values (order_id, (payment ->> 'method')::public.payment_method, (payment ->> 'amount')::numeric);
    end loop;
  end if;

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

create or replace function public.apply_production(
  _payload jsonb,
  _branch_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  user_id uuid := auth.uid();
  batch_id uuid;
  line jsonb;
  movement public.stock_movements%rowtype;
  input_cost_total numeric(14, 2) := 0;
  output_qty_total numeric(14, 3) := 0;
  output_unit_cost numeric(14, 2) := 0;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'storekeeper')) then
    raise exception 'Only admins and storekeepers can record production';
  end if;

  if not app_private.can_access_branch(user_id, _branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if jsonb_typeof(_payload -> 'inputs') <> 'array'
     or jsonb_array_length(_payload -> 'inputs') = 0
     or jsonb_typeof(_payload -> 'outputs') <> 'array'
     or jsonb_array_length(_payload -> 'outputs') = 0 then
    raise exception 'Production requires at least one input and output';
  end if;

  insert into public.production_batches (branch_id, note, created_by)
  values (_branch_id, nullif(_payload ->> 'note', ''), user_id)
  returning id into batch_id;

  for line in select * from jsonb_array_elements(_payload -> 'inputs') loop
    if coalesce((line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'Production input quantity must be positive';
    end if;

    movement := public.apply_stock_movement(
      (line ->> 'item_id')::uuid,
      'production_in',
      -abs((line ->> 'qty')::numeric),
      0,
      'Production input ' || batch_id::text,
      _branch_id,
      'production',
      batch_id
    );

    insert into public.production_inputs (
      batch_id,
      item_id,
      stock_movement_id,
      qty,
      qty_count,
      weight_kg,
      unit_cost
    )
    values (
      batch_id,
      (line ->> 'item_id')::uuid,
      movement.id,
      (line ->> 'qty')::numeric,
      nullif(line ->> 'qty_count', '')::numeric,
      nullif(line ->> 'weight_kg', '')::numeric,
      movement.unit_cost
    );

    input_cost_total := input_cost_total + (abs(movement.qty) * movement.unit_cost);
  end loop;

  for line in select * from jsonb_array_elements(_payload -> 'outputs') loop
    if coalesce((line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'Production output quantity must be positive';
    end if;

    output_qty_total := output_qty_total + (line ->> 'qty')::numeric;
  end loop;

  if output_qty_total > 0 then
    output_unit_cost := round(input_cost_total / output_qty_total, 2);
  end if;

  for line in select * from jsonb_array_elements(_payload -> 'outputs') loop
    movement := public.apply_stock_movement(
      (line ->> 'item_id')::uuid,
      'production_out',
      abs((line ->> 'qty')::numeric),
      coalesce(nullif(line ->> 'unit_cost', '')::numeric, output_unit_cost),
      'Production output ' || batch_id::text,
      _branch_id,
      'production',
      batch_id
    );

    insert into public.production_outputs (
      batch_id,
      item_id,
      stock_movement_id,
      qty,
      qty_count,
      weight_kg,
      unit_cost
    )
    values (
      batch_id,
      (line ->> 'item_id')::uuid,
      movement.id,
      (line ->> 'qty')::numeric,
      nullif(line ->> 'qty_count', '')::numeric,
      nullif(line ->> 'weight_kg', '')::numeric,
      movement.unit_cost
    );
  end loop;

  if jsonb_typeof(_payload -> 'wastage') = 'array' then
    for line in select * from jsonb_array_elements(_payload -> 'wastage') loop
      if coalesce((line ->> 'qty')::numeric, 0) <= 0 then
        raise exception 'Wastage quantity must be positive';
      end if;

      movement := public.apply_stock_movement(
        (line ->> 'item_id')::uuid,
        'wastage',
        -abs((line ->> 'qty')::numeric),
        0,
        nullif(line ->> 'reason', ''),
        _branch_id,
        'production',
        batch_id
      );

      insert into public.production_wastage (
        batch_id,
        item_id,
        stock_movement_id,
        qty,
        reason
      )
      values (
        batch_id,
        (line ->> 'item_id')::uuid,
        movement.id,
        (line ->> 'qty')::numeric,
        coalesce(nullif(line ->> 'reason', ''), 'Production wastage')
      );
    end loop;
  end if;

  return batch_id;
end;
$$;

revoke execute on function public.apply_stock_purchase(jsonb, uuid, boolean) from public, anon;
revoke execute on function public.finalize_order(jsonb, uuid, uuid) from public, anon;
revoke execute on function public.apply_production(jsonb, uuid) from public, anon;
grant execute on function public.apply_stock_purchase(jsonb, uuid, boolean) to authenticated;
grant execute on function public.finalize_order(jsonb, uuid, uuid) to authenticated;
grant execute on function public.apply_production(jsonb, uuid) to authenticated;
