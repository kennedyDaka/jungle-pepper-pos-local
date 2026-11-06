-- Fix: public.process_payment
-- Auto-reconcile negative/zero costs and recipe omission ambiguity (applied live 2026-11-06)

CREATE OR REPLACE FUNCTION public.process_payment(_order_id uuid, _payments jsonb, _physical_order_no text DEFAULT NULL::text, _sale_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _discount numeric DEFAULT NULL::numeric, _sale_type text DEFAULT NULL::text, _staff_meal_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  user_id uuid := auth.uid();
  current_order public.orders%rowtype;
  order_item record;
  order_item_id uuid;
  menu public.menu_items%rowtype;
  modifier public.modifiers%rowtype;
  packaging public.packaging_options%rowtype;
  recipe_rec public.recipes%rowtype;
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
    for recipe_rec in
      select r.*
      from public.recipes r
      where menu_item_id = order_item.menu_item_id
        and (not takeaway_only or line_takeaway)
    loop
      recipe_omitted := false;

      select exists (
        select 1
        from public.order_item_omissions oio
        where oio.order_item_id = order_item.id
          and (oio.recipe_id = recipe_rec.id or (oio.recipe_id is null and oio.item_id = recipe_rec.item_id))
      )
      into recipe_omitted;

      if recipe_omitted then
        continue;
      end if;

      movement := public.apply_stock_movement(
        recipe_rec.item_id,
        'sale',
        -abs(recipe_rec.qty * order_item.qty),
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
$function$;
