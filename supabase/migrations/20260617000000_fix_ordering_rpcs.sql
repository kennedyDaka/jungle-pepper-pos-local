-- Fix create_website_order: make packaging optional, add table_id param
-- Fix create_waiter_order: no changes needed (waiters always dine-in)

drop function if exists public.create_website_order;

create or replace function public.create_website_order(
  _payload jsonb,
  _branch_id uuid,
  _table_id uuid default null,
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
  if not exists (select 1 from public.branches where id = _branch_id and active) then
    raise exception 'Branch not found';
  end if;

  if _table_id is not null then
    if not exists (select 1 from public.tables where id = _table_id and active) then
      raise exception 'Table not found or inactive';
    end if;
  end if;

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

    line_takeaway := coalesce((line ->> 'takeaway')::boolean, false);
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

        if not found then
          continue;
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
    table_id,
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
    _table_id,
    'website',
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

        if not found then
          continue;
        end if;

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

grant execute on function public.create_website_order(jsonb, uuid, uuid, uuid, text, text) to anon, authenticated;
