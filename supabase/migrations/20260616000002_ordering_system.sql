-- Phase 1b: Ordering System — tables table, orders columns, RPCs
-- NOTE: order_status enum is extended in migration 20260616000001 (must be separate transaction)

-- 1. Create tables table
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  label text not null,
  capacity integer not null default 4,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tables_unique_label_per_branch unique (branch_id, label)
);

-- Seed tables for the main branch (assumes at least one branch exists)
do $$
declare
  bid uuid;
begin
  select id into bid from public.branches where active limit 1;
  if bid is not null then
    insert into public.tables (branch_id, label, capacity, sort_order) values
      (bid, 'Table 1', 4, 1),
      (bid, 'Table 2', 4, 2),
      (bid, 'Table 3', 4, 3),
      (bid, 'Table 4', 6, 4),
      (bid, 'Table 5', 6, 5),
      (bid, 'Table 6', 8, 6),
      (bid, 'Table 7', 2, 7),
      (bid, 'Table 8', 2, 8),
      (bid, 'Counter', 1, 9)
    on conflict do nothing;
  end if;
end;
$$;

-- 3. Add columns to orders table
-- Make cashier_id nullable for website orders
alter table public.orders alter column cashier_id drop not null;
alter table public.orders alter column cashier_id drop default;

-- Drop old constraint that only allowed paid/void with voided_at rules
alter table public.orders drop constraint if exists orders_void_fields;

-- Add new columns
alter table public.orders add column if not exists table_id uuid references public.tables(id) on delete set null;
alter table public.orders add column if not exists prepared_by uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists served_at timestamptz;
alter table public.orders add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancelled_reason text;
alter table public.orders add column if not exists source text not null default 'pos'
  check (source in ('pos', 'waiter', 'website'));

-- Add new constraint
alter table public.orders add constraint orders_status_fields check (
  (status = 'void' and voided_at is not null and cancelled_at is null)
  or (status = 'cancelled' and cancelled_at is not null and voided_at is null)
  or (status in ('paid', 'pending', 'preparing', 'ready', 'served') and voided_at is null and cancelled_at is null)
);

-- RLS for tables table
alter table public.tables enable row level security;

create policy "Tables are viewable by authenticated users"
  on public.tables for select
  using (true);

create policy "Tables are manageable by admins"
  on public.tables for insert
  with check (app_private.has_role(auth.uid(), 'admin'));

create policy "Tables are updatable by admins"
  on public.tables for update
  using (app_private.has_role(auth.uid(), 'admin'));

create policy "Tables are deletable by admins"
  on public.tables for delete
  using (app_private.has_role(auth.uid(), 'admin'));

-- Grant permissions
grant all on public.tables to authenticated;

-- 4. New RPC: create_waiter_order
-- Creates a pending order linked to a table, with items and modifiers but NO stock deduction
create or replace function public.create_waiter_order(
  _payload jsonb,
  _branch_id uuid,
  _table_id uuid default null,
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
  packaging_payload jsonb;
  packaging_payloads jsonb;
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
    subtotal,
    discount,
    total,
    vat_rate,
    net_amount,
    vat_amount,
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
    values (order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''), line_takeaway, now())
    returning id into order_item_id;

    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta, created_at)
        values (order_item_id, modifier.id, modifier.price_delta, now());
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
          order_item_id,
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
      order_id,
      packaging.id,
      packaging.item_id,
      package_qty,
      package_unit_price,
      now()
    );
  end loop;

  return order_id;
end;
$$;

grant execute on function public.create_waiter_order(jsonb, uuid, uuid, uuid) to authenticated;

-- 5. New RPC: create_website_order
-- Creates a pending order from the public website (no auth required)
-- cashier_id and waiter_id remain null
create or replace function public.create_website_order(
  _payload jsonb,
  _branch_id uuid,
  _customer_id uuid default null,
  _customer_name text default null,
  _customer_phone text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  order_id uuid;
  order_item_id uuid;
  line jsonb;
  modifier_payload jsonb;
  packaging_payload jsonb;
  packaging_payloads jsonb;
  item_lines jsonb := case jsonb_typeof(_payload -> 'items')
    when 'array' then _payload -> 'items'
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
  resolved_customer_id uuid := _customer_id;
  crust_option_count integer;
  selected_crust_count integer;
  note text;
begin
  -- Validate branch exists and is active
  if not exists (select 1 from public.branches where id = _branch_id and active) then
    raise exception 'Branch not found';
  end if;

  -- Create or resolve customer
  if resolved_customer_id is null and (_customer_name is not null or _customer_phone is not null) then
    if _customer_phone is not null then
      select id into resolved_customer_id
      from public.customers
      where phone = _customer_phone
      limit 1;
    end if;

    if resolved_customer_id is null and _customer_name is not null then
      insert into public.customers (name, phone)
      values (_customer_name, _customer_phone)
      returning id into resolved_customer_id;
    end if;
  end if;

  if jsonb_array_length(item_lines) = 0 then
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

    line_takeaway := coalesce((line ->> 'takeaway')::boolean, true);
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

  total := greatest(subtotal - discount, 0);
  net_amount := round(total / (1 + vat_rate), 2);
  vat_amount := total - net_amount;

  note := nullif(btrim(coalesce(_payload ->> 'note', '')), '');

  insert into public.orders (
    branch_id,
    customer_id,
    subtotal,
    discount,
    total,
    vat_rate,
    net_amount,
    vat_amount,
    sale_type,
    status,
    note,
    source,
    created_at,
    updated_at
  )
  values (
    _branch_id,
    resolved_customer_id,
    subtotal,
    discount,
    total,
    vat_rate,
    net_amount,
    vat_amount,
    'regular',
    'pending',
    note,
    'website',
    now(),
    now()
  )
  returning id into order_id;

  for line in select * from jsonb_array_elements(item_lines) loop
    qty := (line ->> 'qty')::numeric;
    line_takeaway := coalesce((line ->> 'takeaway')::boolean, true);
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
    values (order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''), line_takeaway, now())
    returning id into order_item_id;

    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta, created_at)
        values (order_item_id, modifier.id, modifier.price_delta, now());
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
          order_item_id,
          packaging.id,
          packaging.item_id,
          package_qty,
          package_unit_price,
          now()
        );
      end loop;
    end if;
  end loop;

  return order_id;
end;
$$;

-- Grant execute to anon (public) and authenticated
grant execute on function public.create_website_order(jsonb, uuid, uuid, text, text) to anon, authenticated;

-- 6. New RPC: update_order_status
-- Valid state transitions: pending -> preparing -> ready -> served
-- Also handles: pending -> cancelled, preparing -> cancelled
create or replace function public.update_order_status(
  _order_id uuid,
  _new_status public.order_status,
  _note text default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  user_id uuid := auth.uid();
  current_order public.orders%rowtype;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'cashier')) then
    raise exception 'Only admins and cashiers can update order status';
  end if;

  select * into current_order from public.orders where id = _order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  if not app_private.can_access_branch(user_id, current_order.branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if current_order.status in ('paid', 'void', 'cancelled') then
    raise exception 'Cannot update status of a % order', current_order.status;
  end if;

  -- Validate state transitions
  if _new_status = 'preparing' and current_order.status <> 'pending' then
    raise exception 'Only pending orders can move to preparing';
  end if;

  if _new_status = 'ready' and current_order.status <> 'preparing' then
    raise exception 'Only preparing orders can move to ready';
  end if;

  if _new_status = 'served' and current_order.status <> 'ready' then
    raise exception 'Only ready orders can move to served';
  end if;

  if _new_status = 'cancelled' and current_order.status not in ('pending', 'preparing') then
    raise exception 'Only pending or preparing orders can be cancelled';
  end if;

  if _new_status = 'cancelled' then
    update public.orders
    set status = 'cancelled',
        cancelled_by = user_id,
        cancelled_at = now(),
        cancelled_reason = _note,
        updated_at = now()
    where id = _order_id;
  elseif _new_status = 'served' then
    update public.orders
    set status = 'served',
        served_at = now(),
        updated_at = now()
    where id = _order_id;
  elseif _new_status = 'ready' then
    update public.orders
    set status = 'ready',
        prepared_by = user_id,
        updated_at = now()
    where id = _order_id;
  else
    update public.orders
    set status = _new_status,
        updated_at = now()
    where id = _order_id;
  end if;
end;
$$;

grant execute on function public.update_order_status(uuid, public.order_status, text) to authenticated;

-- 7. New RPC: process_payment
-- Processes payment for a pending/preparing/ready/served order, deducts stock
create or replace function public.process_payment(
  _order_id uuid,
  _payments jsonb,
  _physical_order_no text default null,
  _sale_at timestamptz default null,
  _discount numeric default null
)
returns uuid
language plpgsql
security invoker
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
  resolved_discount numeric(14, 2) := coalesce(_discount, current_order.discount);
  resolved_total numeric(14, 2);
  resolved_net numeric(14, 2);
  resolved_vat numeric(14, 2);
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

  select * into current_order from public.orders where id = _order_id;

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

  if resolved_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  -- Validate and sum payments
  if jsonb_typeof(_payments) = 'array' and jsonb_array_length(_payments) > 0 then
    for payment in select * from jsonb_array_elements(_payments) loop
      payment_amount := coalesce((payment ->> 'amount')::numeric, 0);
      if payment_amount <= 0 then
        raise exception 'Payment amount must be positive';
      end if;
      payment_total := payment_total + payment_amount;
    end loop;
  else
    raise exception 'Order requires at least one payment';
  end if;

  -- Recalculate total
  resolved_total := greatest(current_order.subtotal - resolved_discount, 0);
  resolved_net := round(resolved_total / (1 + vat_rate), 2);
  resolved_vat := resolved_total - resolved_net;

  if payment_total < resolved_total then
    raise exception 'Payment total is less than order total';
  end if;

  -- Generate receipt reference
  receipt_ref := coalesce(nullif(btrim(coalesce(_physical_order_no, '')), ''), upper(substr(_order_id::text, 1, 8)));

  -- Update order to paid
  update public.orders
  set status = 'paid',
      discount = resolved_discount,
      total = resolved_total,
      net_amount = resolved_net,
      vat_amount = resolved_vat,
      physical_order_no = receipt_ref,
      updated_at = now()
  where id = _order_id;

  -- Insert payments
  if jsonb_typeof(_payments) = 'array' then
    for payment in select * from jsonb_array_elements(_payments) loop
      insert into public.payments (order_id, method, amount, created_at)
      values (_order_id, (payment ->> 'method')::public.payment_method, (payment ->> 'amount')::numeric, resolved_sale_at);
    end loop;
  end if;

  -- Deduct stock for each order item (same logic as finalize_order)
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
      where oim.order_item_id = order_item_id
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
        where oip.order_item_id = order_item_id
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

    -- Process recipe stock deductions
    for recipe in
      select *
      from public.recipes
      where menu_item_id = order_item.menu_item_id
        and (not takeaway_only or line_takeaway)
    loop
      recipe_omitted := false;

      -- Check for omissions
      select exists (
        select 1
        from public.order_item_omissions oio
        where oio.order_item_id = order_item_id
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
  insert into public.receipts (order_id, receipt_no, channel, issued_by, issued_at)
  values (
    _order_id,
    receipt_ref,
    'screen',
    user_id,
    resolved_sale_at
  );

  return _order_id;
end;
$$;

grant execute on function public.process_payment(uuid, jsonb, text, timestamptz, numeric) to authenticated;

-- 8. New RPC: get_tables (simple list for pickers)
create or replace function public.get_active_tables(_branch_id uuid)
returns setof public.tables
language sql
security invoker
set search_path = ''
as $$
  select *
  from public.tables
  where branch_id = _branch_id
    and active
  order by sort_order;
$$;

grant execute on function public.get_active_tables(uuid) to authenticated;

-- 9. New RPC: get_kitchen_orders
-- Returns pending/preparing orders for kitchen display
create or replace function public.get_kitchen_orders(_branch_id uuid)
returns table (
  order_id uuid,
  table_label text,
  status public.order_status,
  created_at timestamptz,
  items jsonb
)
language sql
security invoker
set search_path = ''
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
