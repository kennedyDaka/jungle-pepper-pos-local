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
  packaging_payloads jsonb;
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
