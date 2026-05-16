-- Future RPCs for Gradual Supabase integration.
-- These are designed to match the current local service method boundaries.

create or replace function app_private.apply_stock_movement_internal(
  _actor_id uuid,
  _item_id uuid,
  _type public.stock_movement_type,
  _qty numeric,
  _unit_cost numeric default 0,
  _note text default null,
  _branch_id uuid default null,
  _ref_type text default null,
  _ref_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_item public.items%rowtype;
  movement public.stock_movements%rowtype;
  before_qty numeric(14, 3);
  after_qty numeric(14, 3);
  resolved_unit_cost numeric(14, 2);
  next_avg_cost numeric(14, 2);
begin
  if _actor_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (
    app_private.has_role(_actor_id, 'admin')
    or app_private.has_role(_actor_id, 'storekeeper')
    or (_type = 'sale' and app_private.has_role(_actor_id, 'cashier'))
  ) then
    raise exception 'Insufficient permissions to move stock';
  end if;

  if _qty = 0 then
    raise exception 'Stock movement quantity cannot be zero';
  end if;

  select *
  into current_item
  from public.items
  where id = _item_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if current_item.branch_id is not null
     and _branch_id is not null
     and current_item.branch_id <> _branch_id then
    raise exception 'Inventory item belongs to a different branch';
  end if;

  if not app_private.can_access_branch(_actor_id, coalesce(_branch_id, current_item.branch_id)) then
    raise exception 'You do not have access to this branch';
  end if;

  before_qty := current_item.qty_on_hand;
  after_qty := before_qty + _qty;
  resolved_unit_cost := coalesce(nullif(_unit_cost, 0), current_item.avg_cost, 0);
  next_avg_cost := current_item.avg_cost;

  if _qty > 0 and resolved_unit_cost > 0 then
    next_avg_cost := case
      when after_qty > 0 then round(((before_qty * current_item.avg_cost) + (_qty * resolved_unit_cost)) / after_qty, 2)
      else resolved_unit_cost
    end;
  end if;

  update public.items
  set qty_on_hand = after_qty,
      avg_cost = next_avg_cost,
      branch_id = coalesce(branch_id, _branch_id),
      updated_at = now()
  where id = _item_id;

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
    coalesce(_branch_id, current_item.branch_id),
    _item_id,
    _type,
    _qty,
    resolved_unit_cost,
    before_qty,
    after_qty,
    _note,
    _ref_type,
    _ref_id,
    _actor_id
  )
  returning * into movement;

  return movement;
end;
$$;

revoke all on function app_private.apply_stock_movement_internal(uuid, uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) from public, anon;
grant execute on function app_private.apply_stock_movement_internal(uuid, uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) to authenticated, service_role;

create or replace function public.apply_stock_movement(
  _item_id uuid,
  _type public.stock_movement_type,
  _qty numeric,
  _unit_cost numeric default 0,
  _note text default null,
  _branch_id uuid default null,
  _ref_type text default null,
  _ref_id uuid default null
)
returns public.stock_movements
language sql
security invoker
set search_path = ''
as $$
  select app_private.apply_stock_movement_internal(
    auth.uid(),
    _item_id,
    _type,
    _qty,
    _unit_cost,
    _note,
    _branch_id,
    _ref_type,
    _ref_id
  );
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
  line jsonb;
  modifier_payload jsonb;
  menu public.menu_items%rowtype;
  modifier public.modifiers%rowtype;
  recipe public.recipes%rowtype;
  payment jsonb;
  qty numeric(14, 3);
  modifier_total numeric(14, 2);
  unit_price numeric(14, 2);
  subtotal numeric(14, 2) := 0;
  discount numeric(14, 2) := coalesce((_payload ->> 'discount')::numeric, 0);
  total numeric(14, 2);
  payment_total numeric(14, 2) := 0;
  movement public.stock_movements%rowtype;
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

        modifier_total := modifier_total + modifier.price_delta;
      end loop;
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
    select * into menu from public.menu_items where id = (line ->> 'menu_item_id')::uuid;

    modifier_total := 0;
    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;
        modifier_total := modifier_total + modifier.price_delta;
      end loop;
    end if;

    unit_price := menu.price + modifier_total;

    insert into public.order_items (order_id, menu_item_id, qty, unit_price, note)
    values (order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''))
    returning id into order_item_id;

    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta)
        values (order_item_id, modifier.id, modifier.price_delta);
      end loop;
    end if;

    for recipe in select * from public.recipes where menu_item_id = menu.id loop
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

create or replace function public.apply_stock_purchase(
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
  stock_category_id uuid;
  expense_id uuid;
  line jsonb;
  movement public.stock_movements%rowtype;
  total numeric(14, 2) := 0;
  ref text;
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
    if coalesce((line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'Stock purchase line quantity must be positive';
    end if;
    if coalesce((line ->> 'unit_cost')::numeric, 0) < 0 then
      raise exception 'Stock purchase line unit cost cannot be negative';
    end if;
    total := total + ((line ->> 'qty')::numeric * (line ->> 'unit_cost')::numeric);
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
    movement := public.apply_stock_movement(
      (line ->> 'item_id')::uuid,
      'purchase_in',
      (line ->> 'qty')::numeric,
      (line ->> 'unit_cost')::numeric,
      ref || ': ' || coalesce(nullif(_payload ->> 'description', ''), 'Stock purchase'),
      _branch_id,
      'expense',
      expense_id
    );

    insert into public.expense_stock_lines (
      expense_id,
      item_id,
      stock_movement_id,
      qty,
      unit_cost
    )
    values (
      expense_id,
      (line ->> 'item_id')::uuid,
      movement.id,
      (line ->> 'qty')::numeric,
      (line ->> 'unit_cost')::numeric
    );
  end loop;

  return expense_id;
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
      'production_batch',
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
      'production_batch',
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
        'production_batch',
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

revoke execute on function public.apply_stock_movement(uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) from public, anon;
revoke execute on function public.finalize_order(jsonb, uuid, uuid) from public, anon;
revoke execute on function public.apply_stock_purchase(jsonb, uuid) from public, anon;
revoke execute on function public.apply_production(jsonb, uuid) from public, anon;

grant execute on function public.apply_stock_movement(uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) to authenticated;
grant execute on function public.finalize_order(jsonb, uuid, uuid) to authenticated;
grant execute on function public.apply_stock_purchase(jsonb, uuid) to authenticated;
grant execute on function public.apply_production(jsonb, uuid) to authenticated;
