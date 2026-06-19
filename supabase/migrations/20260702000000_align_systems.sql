-- Migration: Align all ordering/payment systems
--
-- 1. New RPC: create_pos_order — single-step POS payment with unit_price overrides
-- 2. Fix process_payment: SELECT FOR UPDATE, staff_meal metadata, cashier_id
-- 3. Fix create_waiter_order: insert omissions
-- 4. Fix get_kitchen_orders: change to SECURITY DEFINER

-- ============================================================
-- 1. New RPC: create_pos_order
--    Creates order as paid (source = 'pos') in a single call.
--    Accepts an optional unit_price per item for price overrides.
-- ============================================================

create or replace function public.create_pos_order(
  _payload jsonb,
  _branch_id uuid,
  _payments jsonb default '[]'::jsonb,
  _physical_order_no text default null,
  _sale_at timestamptz default null,
  _sale_type text default 'regular',
  _staff_meal_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
<<func>>
declare
  user_id uuid := auth.uid();
  order_id uuid;
  order_item_id uuid;
  line jsonb;
  modifier_payload jsonb;
  packaging_payload jsonb;
  packaging_payloads jsonb;
  omission jsonb;
  item_lines jsonb := case jsonb_typeof(_payload -> 'items')
    when 'array' then _payload -> 'items'
    else '[]'::jsonb
  end;
  packaging_sale_lines jsonb := case jsonb_typeof(_payload -> 'packaging_sales')
    when 'array' then _payload -> 'packaging_sales'
    else '[]'::jsonb
  end;
  menu public.menu_items%rowtype;
  modifier public.modifiers%rowtype;
  packaging public.packaging_options%rowtype;
  recipe public.recipes%rowtype;
  payment jsonb;
  payment_total numeric(14, 2) := 0;
  payment_amount numeric(14, 2);
  qty numeric(14, 6);
  modifier_total numeric(14, 2);
  unit_price numeric(14, 2);
  package_unit_price numeric(14, 2);
  package_qty_per_item numeric(14, 6);
  package_qty numeric(14, 6);
  subtotal numeric(14, 2) := 0;
  discount numeric(14, 2) := coalesce((_payload ->> 'discount')::numeric, 0);
  resolved_sale_at timestamptz := coalesce(_sale_at, now());
  resolved_sale_type text := _sale_type;
  total numeric(14, 2);
  vat_rate numeric(6, 4) := 0.175;
  net_amount numeric(14, 2);
  vat_amount numeric(14, 2);
  line_takeaway boolean;
  crust_option_count integer;
  selected_crust_count integer;
  note text;
  movement public.stock_movements%rowtype;
  receipt_ref text;
  recipe_omitted boolean;
  modifier_recipe public.modifier_recipes%rowtype;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'cashier')) then
    raise exception 'Only admins and cashiers can create orders';
  end if;

  if not app_private.can_access_branch(user_id, _branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if jsonb_array_length(item_lines) = 0 and jsonb_array_length(packaging_sale_lines) = 0 then
    raise exception 'Order requires at least one line item';
  end if;

  if discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  if resolved_sale_type = 'staff_meal' and _staff_meal_reason is null then
    raise exception 'Staff meal reason is required';
  end if;

  -- === Compute subtotal (first pass) ===

  for line in select * from jsonb_array_elements(item_lines) loop
    qty := coalesce((line ->> 'qty')::numeric, 0);
    if qty <= 0 then
      raise exception 'Order line quantity must be positive';
    end if;

    select * into menu
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
        select * into modifier
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

    select count(*) into crust_option_count
    from public.modifiers
    where menu_item_id = menu.id
      and active
      and lower(name) in ('thin crust', 'thick crust');

    if crust_option_count > 0 and selected_crust_count <> 1 then
      raise exception 'Choose exactly one pizza crust';
    end if;

    -- Use provided unit_price if present, else compute from menu + modifiers
    unit_price := coalesce(
      nullif((line ->> 'unit_price')::text, '')::numeric,
      menu.price + modifier_total
    );

    if unit_price < 0 then
      raise exception 'Unit price cannot be negative';
    end if;

    subtotal := subtotal + (unit_price * qty);

    line_takeaway := coalesce((line ->> 'takeaway')::boolean, false);
    if line_takeaway then
      packaging_payloads := case jsonb_typeof(line -> 'packaging')
        when 'array' then line -> 'packaging'
        when 'object' then jsonb_build_array(line -> 'packaging')
        else '[]'::jsonb
      end;

      if jsonb_array_length(packaging_payloads) = 0 then
        raise exception 'Choose packaging for takeaway items';
      end if;

      for packaging_payload in select * from jsonb_array_elements(packaging_payloads) loop
        select * into packaging
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
      end loop;
    end if;
  end loop;

  for packaging_payload in select * from jsonb_array_elements(packaging_sale_lines) loop
    package_qty := coalesce((packaging_payload ->> 'qty')::numeric, 0);
    if package_qty <= 0 then
      raise exception 'Packaging sale quantity must be positive';
    end if;

    select * into packaging
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

    subtotal := subtotal + (package_unit_price * package_qty);
  end loop;

  -- === Validate payments ===

  if jsonb_typeof(_payments) = 'array' and jsonb_array_length(_payments) > 0 then
    for payment in select * from jsonb_array_elements(_payments) loop
      payment_amount := coalesce((payment ->> 'amount')::numeric, 0);
      if payment_amount <= 0 then
        raise exception 'Payment amount must be positive';
      end if;
      payment_total := payment_total + payment_amount;
    end loop;
  end if;

  total := greatest(subtotal - discount, 0);
  net_amount := round(total / (1 + vat_rate), 2);
  vat_amount := total - net_amount;

  if payment_total < total then
    raise exception 'Payment total is less than order total';
  end if;

  receipt_ref := coalesce(nullif(btrim(coalesce(_physical_order_no, '')), ''), upper(substr(gen_random_uuid()::text, 1, 12)));

  note := nullif(btrim(coalesce(_payload ->> 'note', '')), '');

  -- === Create order as paid ===

  for i in 1..5 loop
    begin
      insert into public.orders (
    branch_id,
    cashier_id,
    subtotal,
    discount,
    total,
    vat_rate,
    net_amount,
    vat_amount,
    sale_type,
    staff_meal_reason,
    status,
    note,
    source,
    physical_order_no,
    created_at,
    updated_at
  )
  values (
    _branch_id,
    user_id,
    coalesce(subtotal, 0),
    coalesce(discount, 0),
    coalesce(total, 0),
    coalesce(vat_rate, 0.175),
    coalesce(net_amount, 0),
    coalesce(vat_amount, 0),
    resolved_sale_type,
    _staff_meal_reason,
    'paid',
    note,
    'pos',
    receipt_ref,
    resolved_sale_at,
    now()
  )
  returning id into func.order_id;
      exit;
    exception when unique_violation then
      receipt_ref := upper(substr(gen_random_uuid()::text, 1, 12));
    end;
  end loop;

  -- === Insert items & deduct stock ===

  for line in select * from jsonb_array_elements(item_lines) loop
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

    unit_price := coalesce(
      nullif((line ->> 'unit_price')::text, '')::numeric,
      menu.price + modifier_total
    );

    insert into public.order_items (order_id, menu_item_id, qty, unit_price, note, takeaway, created_at)
    values (func.order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''), line_takeaway, resolved_sale_at)
    returning id into order_item_id;

    -- modifiers
    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;
        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta, created_at)
        values (func.order_item_id, modifier.id, modifier.price_delta, resolved_sale_at)
        on conflict (order_item_id, modifier_id) do nothing;
      end loop;
    end if;

    -- omissions
    if jsonb_typeof(line -> 'omissions') = 'array' then
      for omission in select * from jsonb_array_elements(line -> 'omissions') loop
        insert into public.order_item_omissions (order_item_id, recipe_id, item_id)
        values (
          func.order_item_id,
          (omission ->> 'recipe_id')::uuid,
          (omission ->> 'item_id')::uuid
        );
      end loop;
    end if;

    -- packaging (takeaway items only)
    if line_takeaway then
      packaging_payloads := case jsonb_typeof(line -> 'packaging')
        when 'array' then line -> 'packaging'
        when 'object' then jsonb_build_array(line -> 'packaging')
        else '[]'::jsonb
      end;

      for packaging_payload in select * from jsonb_array_elements(packaging_payloads) loop
        select * into packaging
        from public.packaging_options
        where id = (packaging_payload ->> 'option_id')::uuid
          and active;

        package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);
        package_qty_per_item := coalesce(nullif(packaging_payload ->> 'qty_per_item', '')::numeric, 1);
        package_qty := qty * package_qty_per_item;

        insert into public.order_item_packaging (
          order_item_id, packaging_option_id, item_id, qty, unit_price, created_at
        )
        values (
          func.order_item_id, packaging.id, packaging.item_id, package_qty, package_unit_price, resolved_sale_at
        );
      end loop;
    end if;

    -- === Deduct stock for this item ===

    -- modifiers stock
    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        for modifier_recipe in
          select * from public.modifier_recipes
          where modifier_id = modifier.id
        loop
          movement := public.apply_stock_movement(
            modifier_recipe.item_id,
            'sale',
            -abs(modifier_recipe.qty * qty),
            0,
            'POS order ' || func.order_id::text || ' item ' || menu.name || ' x' || qty::text || ' modifier ' || modifier.name,
            _branch_id,
            'order_item',
            func.order_item_id
          );
          perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
        end loop;
      end loop;
    end if;

    -- packaging stock (takeaway items)
    if line_takeaway then
      packaging_payloads := case jsonb_typeof(line -> 'packaging')
        when 'array' then line -> 'packaging'
        when 'object' then jsonb_build_array(line -> 'packaging')
        else '[]'::jsonb
      end;

      for packaging_payload in select * from jsonb_array_elements(packaging_payloads) loop
        select * into packaging
        from public.packaging_options
        where id = (packaging_payload ->> 'option_id')::uuid
          and active;

        package_qty_per_item := coalesce(nullif(packaging_payload ->> 'qty_per_item', '')::numeric, 1);
        package_qty := qty * package_qty_per_item;

        movement := public.apply_stock_movement(
          packaging.item_id,
          'sale',
          -abs(package_qty),
          0,
          'POS order ' || func.order_id::text || ' item ' || menu.name || ' x' || qty::text || ' packaging ' || packaging.name || ' x' || package_qty::text,
          _branch_id,
          'order_item',
          func.order_item_id
        );
        perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
      end loop;
    end if;

    -- recipe stock (respect omissions)
    for recipe in
      select * from public.recipes
      where menu_item_id = menu.id
        and (not takeaway_only or line_takeaway)
    loop
      recipe_omitted := false;

      select exists (
        select 1
        from public.order_item_omissions oio
        where oio.order_item_id = func.order_item_id
          and (oio.recipe_id = recipe.id or (oio.recipe_id is null and oio.item_id = recipe.item_id))
      )
      into recipe_omitted;

      if recipe_omitted then
        continue;
      end if;

      movement := public.apply_stock_movement(
        recipe.item_id,
        'sale',
        -abs(recipe.qty * qty),
        0,
        'POS order ' || func.order_id::text || ' item ' || menu.name || ' x' || qty::text,
        _branch_id,
        'order_item',
        func.order_item_id
      );
      perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
    end loop;
  end loop;

  -- === Packaging sales (order-level) ===

  for packaging_payload in select * from jsonb_array_elements(packaging_sale_lines) loop
    select * into packaging
    from public.packaging_options
    where id = (packaging_payload ->> 'option_id')::uuid
      and active;

    package_qty := (packaging_payload ->> 'qty')::numeric;
    package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);

    insert into public.order_item_packaging (
      order_id, packaging_option_id, item_id, qty, unit_price, created_at
    )
    values (
      func.order_id, packaging.id, packaging.item_id, package_qty, package_unit_price, resolved_sale_at
    );

    movement := public.apply_stock_movement(
      packaging.item_id,
      'sale',
      -abs(package_qty),
      0,
      'POS order ' || func.order_id::text || ' packaging sale ' || packaging.name || ' x' || package_qty::text,
      _branch_id,
      'order',
      func.order_id
    );
    perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
  end loop;

  -- === Insert payments ===

  if jsonb_typeof(_payments) = 'array' then
    for payment in select * from jsonb_array_elements(_payments) loop
      insert into public.payments (order_id, method, amount, created_at)
      values (func.order_id, (payment ->> 'method')::public.payment_method, (payment ->> 'amount')::numeric, resolved_sale_at);
    end loop;
  end if;

  -- === Insert receipt ===

  <<receipt_retry>>
  for i in 1..5 loop
    begin
      insert into public.receipts (order_id, receipt_no, channel, issued_by, issued_at)
      values (func.order_id, receipt_ref, 'screen', user_id, resolved_sale_at);
      exit;
    exception when unique_violation then
      receipt_ref := upper(substr(gen_random_uuid()::text, 1, 12));
    end;
  end loop receipt_retry;

  return func.order_id;
end;
$$;

grant execute on function public.create_pos_order(jsonb, uuid, jsonb, text, timestamptz, text, text) to authenticated;

-- ============================================================
-- 2. Fix process_payment
--    - SELECT FOR UPDATE to prevent double-payment races
--    - Accept _sale_type and _staff_meal_reason parameters
--    - Set sale_type, staff_meal_reason, cashier_id on UPDATE
-- ============================================================

-- Drop the old 5-parameter overload to avoid ambiguity
drop function if exists public.process_payment(uuid, jsonb, text, timestamptz, numeric);

create or replace function public.process_payment(
  _order_id uuid,
  _payments jsonb,
  _physical_order_no text default null,
  _sale_at timestamptz default null,
  _discount numeric default null,
  _sale_type text default null,
  _staff_meal_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  user_id uuid := auth.uid();
  current_order public.orders%rowtype;
  order_item record;
  order_item_id uuid;
  menu public.menu_items%rowtype;
  modifier public.modifiers%rowtype;
  packaging public.packaging_options%rowtype;
  recipe public.recipes%rowtype;
  modifier_recipe public.modifier_recipes%rowtype;
  payment jsonb;
  payment_total numeric(14, 2) := 0;
  payment_amount numeric(14, 2);
  movement public.stock_movements%rowtype;
  resolved_sale_at timestamptz := coalesce(_sale_at, now());
  resolved_discount numeric(14, 2);
  resolved_total numeric(14, 2);
  resolved_net numeric(14, 2);
  resolved_vat numeric(14, 2);
  resolved_sale_type text;
  vat_rate numeric(6, 4) := 0.175;
  line_takeaway boolean;
  packaging_payload jsonb;
  packaging_payloads jsonb;
  package_qty numeric(14, 6);
  package_unit_price numeric(14, 2);
  package_qty_per_item numeric(14, 6);
  receipt_ref text;
  recipe_omitted boolean;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'cashier')) then
    raise exception 'Only admins and cashiers can process payments';
  end if;

  -- SELECT FOR UPDATE to prevent concurrent double-payment
  select * into current_order
  from public.orders
  where id = _order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if not app_private.can_access_branch(user_id, current_order.branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if current_order.status = 'paid' then
    raise exception 'Order is already paid';
  end if;

  if current_order.status = 'void' or current_order.status = 'cancelled' then
    raise exception 'Cannot process payment for a % order', current_order.status;
  end if;

  resolved_discount := coalesce(_discount, current_order.discount, 0);

  if resolved_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  -- Determine sale_type
  if _sale_type is not null then
    resolved_sale_type := _sale_type;
  elsif resolved_discount >= current_order.subtotal then
    resolved_sale_type := 'staff_meal';
  else
    resolved_sale_type := current_order.sale_type;
  end if;

  if resolved_sale_type = 'staff_meal' and _staff_meal_reason is null and current_order.staff_meal_reason is null then
    raise exception 'Staff meal reason is required';
  end if;

  -- Validate and sum payments (if any)
  if jsonb_typeof(_payments) = 'array' and jsonb_array_length(_payments) > 0 then
    for payment in select * from jsonb_array_elements(_payments) loop
      payment_amount := coalesce((payment ->> 'amount')::numeric, 0);
      if payment_amount <= 0 then
        raise exception 'Payment amount must be positive';
      end if;
      payment_total := payment_total + payment_amount;
    end loop;
  end if;

  -- Recalculate total
  resolved_total := greatest(current_order.subtotal - resolved_discount, 0);
  resolved_net := round(resolved_total / (1 + vat_rate), 2);
  resolved_vat := resolved_total - resolved_net;

  if payment_total < resolved_total then
    raise exception 'Payment total is less than order total';
  end if;

  -- Generate receipt reference
  receipt_ref := coalesce(nullif(btrim(coalesce(_physical_order_no, '')), ''), upper(substr(_order_id::text, 1, 12)));

  -- Update order to paid
  update public.orders
  set status = 'paid',
      discount = resolved_discount,
      total = resolved_total,
      net_amount = resolved_net,
      vat_amount = resolved_vat,
      physical_order_no = receipt_ref,
      sale_type = resolved_sale_type,
      staff_meal_reason = coalesce(_staff_meal_reason, current_order.staff_meal_reason),
      cashier_id = user_id,
      updated_at = now()
  where id = _order_id;

  -- Insert payments (if any)
  if jsonb_typeof(_payments) = 'array' then
    for payment in select * from jsonb_array_elements(_payments) loop
      insert into public.payments (order_id, method, amount, created_at)
      values (_order_id, (payment ->> 'method')::public.payment_method, (payment ->> 'amount')::numeric, resolved_sale_at);
    end loop;
  end if;

  -- Deduct stock for each order item
  for order_item in
    select oi.*, mi.name as menu_name
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = _order_id
  loop
    order_item_id := order_item.id;

    -- Process modifiers stock
    for modifier in
      select m.*
      from public.order_item_modifiers oim
      join public.modifiers m on m.id = oim.modifier_id
      where oim.order_item_id = order_item.id
    loop
      for modifier_recipe in
        select *
        from public.modifier_recipes
        where modifier_id = modifier.id
      loop
        movement := public.apply_stock_movement(
          modifier_recipe.item_id,
          'sale',
          -abs(modifier_recipe.qty * order_item.qty),
          0,
          'POS order ' || _order_id::text || ' item ' || order_item.menu_name || ' x' || order_item.qty::text || ' modifier ' || modifier.name,
          current_order.branch_id,
          'order_item',
          order_item_id
        );

        perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
      end loop;
    end loop;

    -- Process packaging stock
    line_takeaway := order_item.takeaway;

    if line_takeaway then
      for packaging in
        select po.*, oip.qty as package_qty, oip.unit_price
        from public.order_item_packaging oip
        join public.packaging_options po on po.id = oip.packaging_option_id
        where oip.order_item_id = order_item.id
      loop
        movement := public.apply_stock_movement(
          packaging.item_id,
          'sale',
          -abs(packaging.package_qty),
          0,
          'POS order ' || _order_id::text || ' item ' || order_item.menu_name || ' x' || order_item.qty::text || ' packaging ' || packaging.name || ' x' || packaging.package_qty::text,
          current_order.branch_id,
          'order_item',
          order_item_id
        );

        perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
      end loop;
    end if;

    -- Process recipe stock deductions (respect omissions)
    for recipe in
      select *
      from public.recipes
      where menu_item_id = order_item.menu_item_id
        and (not takeaway_only or line_takeaway)
    loop
      recipe_omitted := false;

      select exists (
        select 1
        from public.order_item_omissions oio
        where oio.order_item_id = order_item.id
          and (oio.recipe_id = recipe.id or (oio.recipe_id is null and oio.item_id = recipe.item_id))
      )
      into recipe_omitted;

      if recipe_omitted then
        continue;
      end if;

      movement := public.apply_stock_movement(
        recipe.item_id,
        'sale',
        -abs(recipe.qty * order_item.qty),
        0,
        'POS order ' || _order_id::text || ' item ' || order_item.menu_name || ' x' || order_item.qty::text,
        current_order.branch_id,
        'order_item',
        order_item_id
      );

      perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
    end loop;
  end loop;

  -- Process packaging sales (order-level packaging)
  for packaging in
    select po.*, oip.qty as package_qty, oip.unit_price
    from public.order_item_packaging oip
    join public.packaging_options po on po.id = oip.packaging_option_id
    where oip.order_id = _order_id
      and oip.order_item_id is null
  loop
    movement := public.apply_stock_movement(
      packaging.item_id,
      'sale',
      -abs(packaging.package_qty),
      0,
      'POS order ' || _order_id::text || ' packaging sale ' || packaging.name || ' x' || packaging.package_qty::text,
      current_order.branch_id,
      'order',
      _order_id
    );

    perform app_private.backdate_stock_movement(user_id, movement.id, resolved_sale_at);
  end loop;

  -- Insert receipt
  <<receipt_retry>>
  for i in 1..5 loop
    begin
      insert into public.receipts (order_id, receipt_no, channel, issued_by, issued_at)
      values (
        _order_id,
        receipt_ref,
        'screen',
        user_id,
        resolved_sale_at
      );
      exit;
    exception when unique_violation then
      receipt_ref := upper(substr(_order_id::text, 1, 12));
    end;
  end loop receipt_retry;

  return _order_id;
end;
$$;

grant execute on function public.process_payment(uuid, jsonb, text, timestamptz, numeric, text, text) to authenticated;

-- ============================================================
-- 3. Fix create_waiter_order: insert omissions from payload
-- ============================================================

create or replace function public.create_waiter_order(
  _payload jsonb,
  _branch_id uuid,
  _table_id uuid default null,
  _customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
<<func>>
declare
  user_id uuid := auth.uid();
  order_id uuid;
  order_item_id uuid;
  line jsonb;
  modifier_payload jsonb;
  packaging_payload jsonb;
  packaging_payloads jsonb;
  omission jsonb;
  item_lines jsonb := case jsonb_typeof(_payload -> 'items')
    when 'array' then _payload -> 'items'
    else '[]'::jsonb
  end;
  packaging_sale_lines jsonb := case jsonb_typeof(_payload -> 'packaging_sales')
    when 'array' then _payload -> 'packaging_sales'
    else '[]'::jsonb
  end;
  menu public.menu_items%rowtype;
  modifier public.modifiers%rowtype;
  packaging public.packaging_options%rowtype;
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
  line_takeaway boolean;
  crust_option_count integer;
  selected_crust_count integer;
  note text;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'cashier')) then
    raise exception 'Only admins and cashiers can create orders';
  end if;

  if not app_private.can_access_branch(user_id, _branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if _table_id is not null then
    if not exists (select 1 from public.tables where id = _table_id and active) then
      raise exception 'Table not found or inactive';
    end if;
  end if;

  if jsonb_array_length(item_lines) = 0 and jsonb_array_length(packaging_sale_lines) = 0 then
    raise exception 'Order requires at least one line item';
  end if;

  for line in select * from jsonb_array_elements(item_lines) loop
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
      packaging_payloads := case jsonb_typeof(line -> 'packaging')
        when 'array' then line -> 'packaging'
        when 'object' then jsonb_build_array(line -> 'packaging')
        else '[]'::jsonb
      end;

      if jsonb_array_length(packaging_payloads) = 0 then
        raise exception 'Choose packaging for takeaway items';
      end if;

      for packaging_payload in select * from jsonb_array_elements(packaging_payloads) loop
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
      end loop;
    end if;
  end loop;

  for packaging_payload in select * from jsonb_array_elements(packaging_sale_lines) loop
    package_qty := coalesce((packaging_payload ->> 'qty')::numeric, 0);
    if package_qty <= 0 then
      raise exception 'Packaging sale quantity must be positive';
    end if;

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

    subtotal := subtotal + (package_unit_price * package_qty);
  end loop;

  total := greatest(subtotal - discount, 0);
  net_amount := round(total / (1 + vat_rate), 2);
  vat_amount := total - net_amount;

  note := nullif(btrim(coalesce(_payload ->> 'note', '')), '');

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
    status,
    note,
    table_id,
    source,
    created_at,
    updated_at
  )
  values (
    _branch_id,
    _customer_id,
    user_id,
    coalesce(subtotal, 0),
    coalesce(discount, 0),
    coalesce(total, 0),
    coalesce(vat_rate, 0.175),
    coalesce(net_amount, 0),
    coalesce(vat_amount, 0),
    'regular',
    'pending',
    note,
    _table_id,
    'waiter',
    now(),
    now()
  )
  returning id into order_id;

  for line in select * from jsonb_array_elements(item_lines) loop
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

    insert into public.order_items (order_id, menu_item_id, qty, unit_price, note, takeaway, created_at)
    values (func.order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''), line_takeaway, now())
    returning id into order_item_id;

    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta, created_at)
        values (func.order_item_id, modifier.id, modifier.price_delta, now())
        on conflict (order_item_id, modifier_id) do nothing;
      end loop;
    end if;

    -- NEW: insert omissions
    if jsonb_typeof(line -> 'omissions') = 'array' then
      for omission in select * from jsonb_array_elements(line -> 'omissions') loop
        insert into public.order_item_omissions (order_item_id, recipe_id, item_id)
        values (
          func.order_item_id,
          (omission ->> 'recipe_id')::uuid,
          (omission ->> 'item_id')::uuid
        );
      end loop;
    end if;

    if line_takeaway then
      packaging_payloads := case jsonb_typeof(line -> 'packaging')
        when 'array' then line -> 'packaging'
        when 'object' then jsonb_build_array(line -> 'packaging')
        else '[]'::jsonb
      end;

      for packaging_payload in select * from jsonb_array_elements(packaging_payloads) loop
        select *
        into packaging
        from public.packaging_options
        where id = (packaging_payload ->> 'option_id')::uuid
          and active;

        package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);
        package_qty_per_item := coalesce(nullif(packaging_payload ->> 'qty_per_item', '')::numeric, 1);
        package_qty := qty * package_qty_per_item;

        insert into public.order_item_packaging (
          order_item_id,
          packaging_option_id,
          item_id,
          qty,
          unit_price,
          created_at
        )
        values (
          func.order_item_id,
          packaging.id,
          packaging.item_id,
          package_qty,
          package_unit_price,
          now()
        );
      end loop;
    end if;
  end loop;

  for packaging_payload in select * from jsonb_array_elements(packaging_sale_lines) loop
    select *
    into packaging
    from public.packaging_options
    where id = (packaging_payload ->> 'option_id')::uuid
      and active;

    package_qty := (packaging_payload ->> 'qty')::numeric;
    package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);

    insert into public.order_item_packaging (
      order_id,
      packaging_option_id,
      item_id,
      qty,
      unit_price,
      created_at
    )
    values (
      func.order_id,
      packaging.id,
      packaging.item_id,
      package_qty,
      package_unit_price,
      now()
    );
  end loop;

  return func.order_id;
end;
$$;

grant execute on function public.create_waiter_order(jsonb, uuid, uuid, uuid) to authenticated;

-- ============================================================
-- 4. Fix get_kitchen_orders: change to SECURITY DEFINER
--    so cashiers and waiters can see orders regardless of RLS.
-- ============================================================

create or replace function public.get_kitchen_orders(_branch_id uuid)
returns table (
  order_id uuid,
  table_label text,
  status public.order_status,
  created_at timestamptz,
  items jsonb
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    o.id as order_id,
    t.label as table_label,
    o.status,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'menu_item_name', mi.name,
          'qty', oi.qty,
          'note', oi.note,
          'modifiers', (
            select jsonb_agg(m.name)
            from public.order_item_modifiers oim
            join public.modifiers m on m.id = oim.modifier_id
            where oim.order_item_id = oi.id
          )
        )
        order by mi.name
      ) filter (where oi.id is not null),
      '[]'::jsonb
    ) as items
  from public.orders o
  left join public.tables t on t.id = o.table_id
  left join public.order_items oi on oi.order_id = o.id
  left join public.menu_items mi on mi.id = oi.menu_item_id
  where o.branch_id = _branch_id
    and o.status in ('pending', 'preparing')
  group by o.id, t.label, o.status, o.created_at
  order by o.created_at;
$$;

grant execute on function public.get_kitchen_orders(uuid) to authenticated;

-- ============================================================
-- 5. Fix get_pending_orders: return customer_name and customer_phone
--    by joining with customers table
-- ============================================================

drop function if exists public.get_pending_orders(uuid);

create or replace function public.get_pending_orders(_branch_id uuid)
returns table (
  id uuid,
  branch_id uuid,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  subtotal numeric,
  discount numeric,
  total numeric,
  vat_rate numeric,
  net_amount numeric,
  vat_amount numeric,
  sale_type text,
  status text,
  note text,
  physical_order_no text,
  table_id uuid,
  source text,
  created_at timestamptz,
  updated_at timestamptz,
  table_label text,
  cashier_name text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    o.id,
    o.branch_id,
    o.customer_id,
    c.name as customer_name,
    c.phone as customer_phone,
    o.subtotal,
    o.discount,
    o.total,
    o.vat_rate,
    o.net_amount,
    o.vat_amount,
    o.sale_type,
    o.status::text,
    o.note,
    o.physical_order_no,
    o.table_id,
    o.source,
    o.created_at,
    o.updated_at,
    t.label as table_label,
    p.full_name as cashier_name
  from public.orders o
  left join public.tables t on t.id = o.table_id
  left join public.profiles p on p.id = o.cashier_id
  left join public.customers c on c.id = o.customer_id
  where o.branch_id = _branch_id
    and o.status in ('pending', 'preparing', 'ready', 'served')
  order by o.created_at;
$$;

grant execute on function public.get_pending_orders(uuid) to authenticated;
