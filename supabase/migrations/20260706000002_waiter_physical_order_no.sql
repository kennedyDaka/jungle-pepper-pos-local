-- Keep waiter-created pending orders aligned with POS payment:
-- 1. store the physical receipt/order number when the waiter enters it;
-- 2. keep order-item omissions valid by recording a positive omitted qty;
-- 3. respect payload unit_price overrides like create_pos_order does.

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
  receipt_ref text := nullif(btrim(coalesce(_payload ->> 'physical_order_no', '')), '');
  omission_recipe_id uuid;
  omission_item_id uuid;
  omission_qty numeric(14, 6);
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

  if discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  if receipt_ref is not null and exists (
    select 1
    from public.orders existing
    where lower(existing.physical_order_no) = lower(receipt_ref)
  ) then
    raise exception 'Physical order number % is already used', receipt_ref;
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
    physical_order_no,
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
    receipt_ref,
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

    unit_price := coalesce(
      nullif((line ->> 'unit_price')::text, '')::numeric,
      menu.price + modifier_total
    );

    insert into public.order_items (order_id, menu_item_id, qty, unit_price, note, takeaway, created_at)
    values (func.order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''), line_takeaway, now())
    returning id into order_item_id;

    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta, created_at)
        values (func.order_item_id, modifier.id, modifier.price_delta, now())
        on conflict on constraint order_item_modifiers_order_item_id_modifier_id_key do nothing;
      end loop;
    end if;

    if jsonb_typeof(line -> 'omissions') = 'array' then
      for omission in select * from jsonb_array_elements(line -> 'omissions') loop
        omission_recipe_id := nullif(omission ->> 'recipe_id', '')::uuid;
        omission_item_id := nullif(omission ->> 'item_id', '')::uuid;

        select recipe.id, recipe.item_id, abs(recipe.qty * qty)
        into omission_recipe_id, omission_item_id, omission_qty
        from public.recipes recipe
        where recipe.menu_item_id = menu.id
          and (
            (omission_recipe_id is not null and recipe.id = omission_recipe_id)
            or (
              omission_recipe_id is null
              and omission_item_id is not null
              and recipe.item_id = omission_item_id
            )
          )
        limit 1;

        if not found then
          raise exception 'Omitted ingredient is not part of %', menu.name;
        end if;

        insert into public.order_item_omissions (order_item_id, recipe_id, item_id, qty, created_at)
        values (
          func.order_item_id,
          omission_recipe_id,
          omission_item_id,
          omission_qty,
          now()
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
