-- ============================================================
-- Fix finalize_order to handle order item omissions
-- When a customer says "no cheese", the cheese recipe should
-- NOT be deducted from inventory.
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_order(
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
  omission_payload jsonb;
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
  recipe_deduct_qty numeric(14, 3);
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

  -- Phase 1: Calculate subtotal
  for line in select * from jsonb_array_elements(_payload -> 'items') loop
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

  -- Create the order record
  insert into public.orders (
    branch_id,
    customer_id,
    cashier_id,
    subtotal,
    discount,
    total,
    status,
    note
  ) values (
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

  -- Phase 2: Create order items, record omissions, and deduct recipes
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

    -- Record modifiers
    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;
        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta)
        values (order_item_id, modifier.id, modifier.price_delta);
      end loop;
    end if;

    -- Record omissions (items customer asked to remove)
    if jsonb_typeof(line -> 'omissions') = 'array' then
      for omission_payload in select * from jsonb_array_elements(line -> 'omissions') loop
        if (omission_payload ->> 'item_id') is not null then
          insert into public.order_item_omissions (order_item_id, recipe_id, item_id, qty)
          values (
            order_item_id,
            nullif(omission_payload ->> 'recipe_id', '')::uuid,
            (omission_payload ->> 'item_id')::uuid,
            coalesce((omission_payload ->> 'qty')::numeric, 1)
          );
        end if;
      end loop;
    end if;

    -- Deduct recipes, skipping omitted items
    for recipe in select * from public.recipes where menu_item_id = menu.id loop
      recipe_deduct_qty := abs(recipe.qty * qty);

      -- Check if this recipe item was omitted on this line
      if jsonb_typeof(line -> 'omissions') = 'array' then
        for omission_payload in select * from jsonb_array_elements(line -> 'omissions') loop
          if (omission_payload ->> 'item_id')::uuid = recipe.item_id then
            -- Item was omitted — reduce deduction by the omission qty
            recipe_deduct_qty := greatest(0, recipe_deduct_qty - coalesce((omission_payload ->> 'qty')::numeric, recipe.qty));
          end if;
        end loop;
      end if;

      -- Only deduct if there's something left to deduct
      if recipe_deduct_qty > 0 then
        movement := public.apply_stock_movement(
          recipe.item_id,
          'sale',
          -recipe_deduct_qty,
          0,
          'POS order ' || order_id::text || CASE
            WHEN recipe_deduct_qty < abs(recipe.qty * qty)
            THEN ' (omission adjusted)'
            ELSE ''
          END,
          _branch_id,
          'order',
          order_id
        );
      end if;
    end loop;
  end loop;

  -- Record payments
  for payment in select * from jsonb_array_elements(_payload -> 'payments') loop
    insert into public.payments (order_id, method, amount)
    values (order_id, (payment ->> 'method')::public.payment_method, (payment ->> 'amount')::numeric);
  end loop;

  -- Issue receipt
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
