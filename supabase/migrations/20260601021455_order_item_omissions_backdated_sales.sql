create table if not exists public.order_item_omissions (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete set null,
  item_id uuid not null references public.items(id) on delete restrict,
  qty numeric(14, 6) not null,
  created_at timestamptz not null default now(),
  constraint order_item_omissions_positive_qty check (qty > 0)
);

create index if not exists order_item_omissions_order_item_id_idx
  on public.order_item_omissions (order_item_id);

create index if not exists order_item_omissions_item_id_idx
  on public.order_item_omissions (item_id);

alter table public.order_item_omissions enable row level security;

drop policy if exists "order item omissions parent order read" on public.order_item_omissions;
create policy "order item omissions parent order read"
  on public.order_item_omissions for select to authenticated
  using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
    )
  );

drop policy if exists "order item omissions parent order insert" on public.order_item_omissions;
create policy "order item omissions parent order insert"
  on public.order_item_omissions for insert to authenticated
  with check (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and o.cashier_id = (select auth.uid())
        and (
          app_private.has_role((select auth.uid()), 'admin')
          or app_private.has_role((select auth.uid()), 'cashier')
        )
    )
  );

grant select, insert on public.order_item_omissions to authenticated;

create or replace function app_private.backdate_stock_movement(
  _actor_id uuid,
  _movement_id uuid,
  _created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _actor_id is null then
    raise exception 'Authentication is required';
  end if;

  if _created_at > now() + interval '5 minutes' then
    raise exception 'Sale date cannot be in the future';
  end if;

  if not (
    app_private.has_role(_actor_id, 'admin')
    or app_private.has_role(_actor_id, 'cashier')
    or app_private.has_role(_actor_id, 'storekeeper')
  ) then
    raise exception 'Insufficient permissions to date stock movement';
  end if;

  update public.stock_movements
  set created_at = _created_at
  where id = _movement_id
    and created_by = _actor_id;
end;
$$;

revoke all on function app_private.backdate_stock_movement(uuid, uuid, timestamptz) from public, anon;
grant execute on function app_private.backdate_stock_movement(uuid, uuid, timestamptz)
  to authenticated, service_role;

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
  item_lines jsonb := case jsonb_typeof(_payload -> 'items')
    when 'array' then _payload -> 'items'
    else '[]'::jsonb
  end;
  packaging_sale_lines jsonb := case jsonb_typeof(_payload -> 'packaging_sales')
    when 'array' then _payload -> 'packaging_sales'
    else '[]'::jsonb
  end;
  receipt_ref text := nullif(btrim(coalesce(_payload ->> 'physical_order_no', '')), '');
  sale_at timestamptz := coalesce(nullif(_payload ->> 'sale_at', '')::timestamptz, now());
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
  recipe_omitted boolean;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if sale_at > now() + interval '5 minutes' then
    raise exception 'Sale date cannot be in the future';
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

  if receipt_ref is null then
    raise exception 'Physical receipt/order number is required';
  end if;

  if exists (
    select 1
    from public.orders existing
    where lower(existing.physical_order_no) = lower(receipt_ref)
  ) then
    raise exception 'Physical receipt/order number already exists';
  end if;

  if jsonb_array_length(item_lines) = 0 and jsonb_array_length(packaging_sale_lines) = 0 then
    raise exception 'Order requires at least one line item';
  end if;

  if is_staff_meal and staff_reason is null then
    raise exception 'Staff meal requires an approval note';
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
    physical_order_no,
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
    note,
    created_at,
    updated_at
  )
  values (
    _branch_id,
    _customer_id,
    user_id,
    receipt_ref,
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
    nullif(_payload ->> 'note', ''),
    sale_at,
    sale_at
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
    values (order_id, menu.id, qty, unit_price, nullif(line ->> 'note', ''), line_takeaway, sale_at)
    returning id into order_item_id;

    if jsonb_typeof(line -> 'modifiers') = 'array' then
      for modifier_payload in select * from jsonb_array_elements(line -> 'modifiers') loop
        select * into modifier from public.modifiers where id = (modifier_payload ->> 'modifier_id')::uuid;

        insert into public.order_item_modifiers (order_item_id, modifier_id, price_delta, created_at)
        values (order_item_id, modifier.id, modifier.price_delta, sale_at);

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

          perform app_private.backdate_stock_movement(user_id, movement.id, sale_at);
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

        perform app_private.backdate_stock_movement(user_id, movement.id, sale_at);

        insert into public.order_item_packaging (
          order_item_id,
          packaging_option_id,
          item_id,
          qty,
          unit_price,
          stock_movement_id,
          created_at
        )
        values (
          order_item_id,
          packaging.id,
          packaging.item_id,
          package_qty,
          package_unit_price,
          movement.id,
          sale_at
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
      recipe_omitted := false;

      if jsonb_typeof(line -> 'omissions') = 'array' then
        select exists (
          select 1
          from jsonb_array_elements(line -> 'omissions') omit
          where nullif(omit ->> 'recipe_id', '')::uuid = recipe.id
             or (
               nullif(omit ->> 'recipe_id', '') is null
               and nullif(omit ->> 'item_id', '')::uuid = recipe.item_id
             )
        )
        into recipe_omitted;
      end if;

      if recipe_omitted then
        insert into public.order_item_omissions (
          order_item_id,
          recipe_id,
          item_id,
          qty,
          created_at
        )
        values (
          order_item_id,
          recipe.id,
          recipe.item_id,
          abs(recipe.qty * qty),
          sale_at
        );
        continue;
      end if;

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

      perform app_private.backdate_stock_movement(user_id, movement.id, sale_at);
    end loop;
  end loop;

  for packaging_payload in select * from jsonb_array_elements(packaging_sale_lines) loop
    select *
    into packaging
    from public.packaging_options
    where id = (packaging_payload ->> 'option_id')::uuid
      and active;

    package_qty := (packaging_payload ->> 'qty')::numeric;
    package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);

    movement := public.apply_stock_movement(
      packaging.item_id,
      'sale',
      -abs(package_qty),
      0,
      'POS order ' || order_id::text || ' packaging sale ' || packaging.name || ' x' || package_qty::text,
      _branch_id,
      'order',
      order_id
    );

    perform app_private.backdate_stock_movement(user_id, movement.id, sale_at);

    insert into public.order_item_packaging (
      order_id,
      packaging_option_id,
      item_id,
      qty,
      unit_price,
      stock_movement_id,
      created_at
    )
    values (
      order_id,
      packaging.id,
      packaging.item_id,
      package_qty,
      package_unit_price,
      movement.id,
      sale_at
    )
    returning id into packaging_row_id;
  end loop;

  if jsonb_typeof(_payload -> 'payments') = 'array' then
    for payment in select * from jsonb_array_elements(_payload -> 'payments') loop
      insert into public.payments (order_id, method, amount, created_at)
      values (order_id, (payment ->> 'method')::public.payment_method, (payment ->> 'amount')::numeric, sale_at);
    end loop;
  end if;

  insert into public.receipts (order_id, receipt_no, channel, issued_by, issued_at)
  values (
    order_id,
    receipt_ref,
    'screen',
    user_id,
    sale_at
  );

  return order_id;
end;
$$;

grant execute on function public.finalize_order(jsonb, uuid, uuid) to authenticated;

create or replace view public.order_inventory_deduction_audit
with (security_invoker = true)
as
with expected_parts as (
  select
    o.id as order_id,
    r.item_id,
    sum(r.qty * oi.qty) as expected_qty
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.recipes r on r.menu_item_id = oi.menu_item_id
  left join public.order_item_omissions oio
    on oio.order_item_id = oi.id
   and (
     oio.recipe_id = r.id
     or (oio.recipe_id is null and oio.item_id = r.item_id)
   )
  where o.status = 'paid'
    and (not r.takeaway_only or oi.takeaway)
    and oio.id is null
  group by o.id, r.item_id
  union all
  select
    o.id as order_id,
    mr.item_id,
    sum(mr.qty * oi.qty) as expected_qty
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.order_item_modifiers oim on oim.order_item_id = oi.id
  join public.modifier_recipes mr on mr.modifier_id = oim.modifier_id
  where o.status = 'paid'
  group by o.id, mr.item_id
  union all
  select
    o.id as order_id,
    oip.item_id,
    sum(oip.qty) as expected_qty
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.order_item_packaging oip on oip.order_item_id = oi.id
  where o.status = 'paid'
  group by o.id, oip.item_id
  union all
  select
    o.id as order_id,
    oip.item_id,
    sum(oip.qty) as expected_qty
  from public.orders o
  join public.order_item_packaging oip on oip.order_id = o.id
  where o.status = 'paid'
  group by o.id, oip.item_id
),
expected as (
  select order_id, item_id, sum(expected_qty) as expected_qty
  from expected_parts
  group by order_id, item_id
),
actual as (
  select
    case when sm.ref_type = 'order_item' then oi.order_id else sm.ref_id end as order_id,
    sm.item_id,
    sum(abs(sm.qty)) as actual_qty,
    count(*) as movement_lines
  from public.stock_movements sm
  left join public.order_items oi on oi.id = sm.ref_id
  where sm.type = 'sale'
    and sm.ref_type in ('order', 'order_item')
  group by case when sm.ref_type = 'order_item' then oi.order_id else sm.ref_id end, sm.item_id
),
combined as (
  select coalesce(e.order_id, a.order_id) as order_id, coalesce(e.item_id, a.item_id) as item_id
  from expected e
  full join actual a on a.order_id = e.order_id and a.item_id = e.item_id
)
select
  o.created_at,
  o.id as order_id,
  o.branch_id,
  b.name as branch_name,
  coalesce(nullif(o.physical_order_no, ''), upper(substr(o.id::text, 1, 8))) as invoice_no,
  i.id as item_id,
  i.name as item_name,
  u.code as unit_code,
  coalesce(e.expected_qty, 0)::numeric(14, 6) as expected_qty,
  coalesce(a.actual_qty, 0)::numeric(14, 6) as actual_qty,
  coalesce(a.movement_lines, 0)::integer as movement_lines,
  (coalesce(e.expected_qty, 0) - coalesce(a.actual_qty, 0))::numeric(14, 6) as difference_qty,
  case
    when abs(coalesce(e.expected_qty, 0) - coalesce(a.actual_qty, 0)) <= 0.0001 then 'ok'
    when coalesce(e.expected_qty, 0) > coalesce(a.actual_qty, 0) then 'under_deducted'
    else 'over_deducted'
  end as audit_status
from combined c
join public.orders o on o.id = c.order_id
left join public.branches b on b.id = o.branch_id
join public.items i on i.id = c.item_id
left join public.units u on u.id = i.unit_id
left join expected e on e.order_id = c.order_id and e.item_id = c.item_id
left join actual a on a.order_id = c.order_id and a.item_id = c.item_id
where o.status = 'paid';

grant select on public.order_inventory_deduction_audit to authenticated;
