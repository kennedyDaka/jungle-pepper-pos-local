alter type public.stock_movement_type add value if not exists 'issue_out';
alter type public.stock_movement_type add value if not exists 'complimentary';
alter type public.stock_movement_type add value if not exists 'breakage';

alter table public.order_items
  add column if not exists takeaway boolean not null default false;

alter table public.recipes
  add column if not exists takeaway_only boolean not null default false;

alter table public.items
  alter column qty_on_hand type numeric(14, 6),
  alter column reorder_level type numeric(14, 6);

alter table public.stock_movements
  alter column qty type numeric(14, 6),
  alter column qty_before type numeric(14, 6),
  alter column qty_after type numeric(14, 6);

alter table public.recipes
  alter column qty type numeric(14, 6);

alter table public.expense_stock_lines
  drop column if exists line_total;

alter table public.expense_stock_lines
  alter column qty type numeric(14, 6);

alter table public.expense_stock_lines
  add column if not exists line_total numeric(14, 2)
  generated always as ((qty * unit_cost)::numeric(14, 2)) stored;

alter table public.production_inputs
  alter column qty type numeric(14, 6),
  alter column qty_count type numeric(14, 6),
  alter column weight_kg type numeric(14, 6);

alter table public.production_outputs
  alter column qty type numeric(14, 6),
  alter column qty_count type numeric(14, 6),
  alter column weight_kg type numeric(14, 6);

alter table public.production_wastage
  alter column qty type numeric(14, 6);

drop function if exists public.apply_stock_purchase(jsonb, uuid);

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
    movement_id := null;

    if _affect_stock then
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
      movement_id := movement.id;
    end if;

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
      movement_id,
      (line ->> 'qty')::numeric,
      (line ->> 'unit_cost')::numeric
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
  line_takeaway boolean;
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

revoke execute on function public.apply_stock_purchase(jsonb, uuid, boolean) from public, anon;
revoke execute on function public.finalize_order(jsonb, uuid, uuid) from public, anon;

grant execute on function public.apply_stock_purchase(jsonb, uuid, boolean) to authenticated;
grant execute on function public.finalize_order(jsonb, uuid, uuid) to authenticated;
