alter table public.orders
  add column if not exists physical_order_no text;

create unique index if not exists orders_physical_order_no_unique_ci
  on public.orders (lower(physical_order_no))
  where physical_order_no is not null and length(btrim(physical_order_no)) > 0;

alter table public.order_item_packaging
  alter column order_item_id drop not null,
  add column if not exists order_id uuid references public.orders(id) on delete cascade;

create index if not exists order_item_packaging_order_id_idx
  on public.order_item_packaging (order_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_item_packaging_has_parent'
      and conrelid = 'public.order_item_packaging'::regclass
  ) then
    alter table public.order_item_packaging
      add constraint order_item_packaging_has_parent
      check (order_item_id is not null or order_id is not null);
  end if;
end;
$$;

drop policy if exists "order item packaging staff read" on public.order_item_packaging;
create policy "order item packaging staff read"
  on public.order_item_packaging for select to authenticated
  using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and app_private.can_access_branch((select auth.uid()), o.branch_id)
    )
    or exists (
      select 1
      from public.orders o
      where o.id = order_id
        and app_private.can_access_branch((select auth.uid()), o.branch_id)
    )
  );

drop policy if exists "order item packaging staff insert" on public.order_item_packaging;
create policy "order item packaging staff insert"
  on public.order_item_packaging for insert to authenticated
  with check (
    (
      exists (
        select 1
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where oi.id = order_item_id
          and app_private.can_access_branch((select auth.uid()), o.branch_id)
      )
      or exists (
        select 1
        from public.orders o
        where o.id = order_id
          and app_private.can_access_branch((select auth.uid()), o.branch_id)
      )
    )
    and (app_private.has_role((select auth.uid()), 'admin') or app_private.has_role((select auth.uid()), 'cashier'))
  );

with recipe_extra_sources as (
  select distinct
    r.menu_item_id,
    'Extra ' || i.name as modifier_name,
    i.name as item_name
  from public.recipes r
  join public.menu_items m on m.id = r.menu_item_id
  join public.categories c on c.id = m.category_id
  join public.items i on i.id = r.item_id
  where m.active
    and c.kind = 'menu'
    and coalesce(i.stock_type::text, '') not in ('beverage', 'consumable')
    and not coalesce(r.takeaway_only, false)
    and lower(c.name) not in (
      'bar',
      'soft drinks',
      'mocktails / mixers',
      'wine by glass',
      'beers / ciders',
      'gin',
      'brandy',
      'rum',
      'whiskey',
      'whisky',
      'tequila',
      'liqueurs',
      'vodka',
      'wines',
      'spirits'
    )
)
insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select menu_item_id, modifier_name, 8000, 500 + row_number() over (partition by menu_item_id order by item_name), true
from recipe_extra_sources src
where not exists (
  select 1
  from public.modifiers mod
  where mod.menu_item_id = src.menu_item_id
    and lower(mod.name) = lower(src.modifier_name)
    and mod.active
);

update public.modifiers mod
set price_delta = 8000,
    active = true,
    updated_at = now()
where lower(mod.name) like 'extra %'
  and mod.price_delta <> 8000;

insert into public.modifier_recipes (modifier_id, item_id, qty)
select mod.id, r.item_id, r.qty
from public.recipes r
join public.menu_items m on m.id = r.menu_item_id
join public.categories c on c.id = m.category_id
join public.items i on i.id = r.item_id
join public.modifiers mod
  on mod.menu_item_id = r.menu_item_id
 and lower(mod.name) = lower('Extra ' || i.name)
where mod.active
  and m.active
  and c.kind = 'menu'
  and coalesce(i.stock_type::text, '') not in ('beverage', 'consumable')
  and not coalesce(r.takeaway_only, false)
  and lower(c.name) not in (
    'bar',
    'soft drinks',
    'mocktails / mixers',
    'wine by glass',
    'beers / ciders',
    'gin',
    'brandy',
    'rum',
    'whiskey',
    'whisky',
    'tequila',
    'liqueurs',
    'vodka',
    'wines',
    'spirits'
  )
on conflict (modifier_id, item_id) do update
set qty = excluded.qty,
    updated_at = now();

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
    note
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
    nullif(_payload ->> 'note', '')
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

    insert into public.order_item_packaging (
      order_id,
      packaging_option_id,
      item_id,
      qty,
      unit_price,
      stock_movement_id
    )
    values (
      order_id,
      packaging.id,
      packaging.item_id,
      package_qty,
      package_unit_price,
      movement.id
    )
    returning id into packaging_row_id;
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
    receipt_ref,
    'screen',
    user_id
  );

  return order_id;
end;
$$;

create or replace view public.stock_movement_details
with (security_invoker = true)
as
select
  sm.id,
  sm.branch_id,
  sm.item_id,
  sm.type,
  sm.qty,
  sm.unit_cost,
  sm.qty_before,
  sm.qty_after,
  sm.note,
  sm.ref_type,
  sm.ref_id,
  sm.created_by,
  sm.created_at,
  b.name as branch_name,
  p.username as user_username,
  p.full_name as user_full_name,
  i.name as item_name,
  i.stock_type,
  i.bottle_ml,
  i.shot_ml,
  u.code as unit_code,
  u.name as unit_name,
  coalesce(order_item_ctx.invoice_no, order_packaging_ctx.invoice_no, order_ctx.invoice_no) as invoice_no,
  coalesce(order_item_ctx.order_type, order_packaging_ctx.order_type, order_ctx.order_type) as order_type,
  coalesce(
    order_item_ctx.menu_item_name || ' x' || trim(to_char(order_item_ctx.order_item_qty, 'FM999999990.###')),
    order_packaging_ctx.packaging_names,
    order_ctx.menu_item_names
  ) as menu_item_names,
  coalesce(order_item_ctx.menu_category, order_packaging_ctx.menu_categories, order_ctx.menu_categories) as menu_categories,
  production_ctx.production_ref,
  production_ctx.production_outputs,
  production_ctx.production_inputs,
  expense_ctx.expense_ref,
  expense_ctx.expense_category,
  expense_ctx.supplier_name,
  case
    when sm.ref_type in ('order', 'order_item') then 'MW POS'
    when sm.ref_type = 'production' then 'Production'
    when sm.ref_type = 'expense' then 'Procurement'
    when sm.ref_type = 'opening_stock' then 'Opening Stock'
    when sm.ref_type = 'manual' then 'Manual Stock'
    when sm.type = 'issue_out' then 'Issue Out'
    when sm.type = 'wastage' then 'Wastage'
    when sm.type = 'complimentary' then 'Complimentary'
    when sm.type = 'breakage' then 'Breakage'
    else coalesce(nullif(initcap(replace(sm.ref_type, '_', ' ')), ''), initcap(replace(sm.type::text, '_', ' ')))
  end as source_label,
  case
    when sm.ref_type = 'order_item' then concat_ws(
      ' - ',
      'MW POS ' || coalesce(order_item_ctx.invoice_no, upper(substr(order_item_ctx.order_id::text, 1, 8))),
      order_item_ctx.order_type,
      order_item_ctx.menu_item_name || ' x' || trim(to_char(order_item_ctx.order_item_qty, 'FM999999990.###')),
      nullif(order_item_ctx.modifier_names, '')
    )
    when sm.ref_type = 'order' then concat_ws(
      ' - ',
      'MW POS ' || coalesce(order_packaging_ctx.invoice_no, order_ctx.invoice_no, upper(substr(sm.ref_id::text, 1, 8))),
      coalesce(order_packaging_ctx.order_type, order_ctx.order_type),
      coalesce(order_packaging_ctx.packaging_names, order_ctx.menu_item_names)
    )
    when sm.ref_type = 'production' then concat_ws(
      ' - ',
      'Production ' || coalesce(production_ctx.production_ref, upper(substr(sm.ref_id::text, 1, 8))),
      case
        when sm.type = 'production_out' then 'Produced: ' || coalesce(production_ctx.production_outputs, i.name)
        else 'Used for: ' || coalesce(production_ctx.production_outputs, 'production batch')
      end,
      nullif(production_ctx.note, '')
    )
    when sm.ref_type = 'expense' then concat_ws(
      ' - ',
      'Expense ' || coalesce(expense_ctx.expense_ref, upper(substr(sm.ref_id::text, 1, 8))),
      expense_ctx.supplier_name,
      expense_ctx.expense_category,
      nullif(expense_ctx.description, '')
    )
    when sm.ref_type = 'opening_stock' then 'Opening stock'
    else coalesce(nullif(sm.note, ''), coalesce(nullif(initcap(replace(sm.ref_type, '_', ' ')), ''), initcap(replace(sm.type::text, '_', ' '))))
  end as source_detail,
  case
    when sm.ref_type = 'order_item' then order_item_ctx.menu_item_name
    when sm.ref_type = 'order' then coalesce(order_packaging_ctx.packaging_names, order_ctx.menu_item_names, 'POS order')
    when sm.ref_type = 'production' and sm.type = 'production_out' then coalesce(production_ctx.production_outputs, i.name)
    when sm.ref_type = 'production' then coalesce(production_ctx.production_outputs, 'Production')
    when sm.ref_type = 'expense' then coalesce(expense_ctx.supplier_name, expense_ctx.expense_category, 'Procurement')
    else coalesce(nullif(sm.note, ''), sm.ref_type, sm.type::text)
  end as destination,
  order_item_ctx.modifier_names,
  order_item_ctx.order_item_qty
from public.stock_movements sm
join public.items i on i.id = sm.item_id
left join public.units u on u.id = i.unit_id
left join public.branches b on b.id = sm.branch_id
left join public.profiles p on p.id = sm.created_by
left join lateral (
  select
    o.id as order_id,
    coalesce(nullif(o.physical_order_no, ''), upper(substr(o.id::text, 1, 8))) as invoice_no,
    case when oi.takeaway then 'Takeaway' else 'Table' end as order_type,
    mi.name as menu_item_name,
    c.name as menu_category,
    oi.qty as order_item_qty,
    string_agg(distinct mod.name, ', ' order by mod.name) as modifier_names
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.menu_items mi on mi.id = oi.menu_item_id
  left join public.categories c on c.id = mi.category_id
  left join public.order_item_modifiers oim on oim.order_item_id = oi.id
  left join public.modifiers mod on mod.id = oim.modifier_id
  where oi.id = sm.ref_id
  group by o.id, oi.id, oi.takeaway, mi.name, c.name, oi.qty
) order_item_ctx on sm.ref_type = 'order_item'
left join lateral (
  select
    coalesce(nullif(o.physical_order_no, ''), upper(substr(o.id::text, 1, 8))) as invoice_no,
    'Takeaway'::text as order_type,
    string_agg(
      coalesce(po.name, pi.name) || ' x' || trim(to_char(oip.qty, 'FM999999990.###')),
      ', '
      order by coalesce(po.name, pi.name)
    ) as packaging_names,
    'Packaging'::text as menu_categories
  from public.orders o
  join public.order_item_packaging oip on oip.order_id = o.id
  left join public.packaging_options po on po.id = oip.packaging_option_id
  left join public.items pi on pi.id = oip.item_id
  where o.id = sm.ref_id
    and (
      oip.stock_movement_id = sm.id
      or (oip.stock_movement_id is null and oip.item_id = sm.item_id)
    )
  group by o.id
) order_packaging_ctx on sm.ref_type = 'order'
left join lateral (
  with candidates as (
    select
      o.id as order_id,
      o.physical_order_no,
      oi.id as order_item_id,
      oi.takeaway,
      oi.qty as order_item_qty,
      mi.name as menu_item_name,
      c.name as menu_category,
      coalesce(recipe_ctx.line_qty, 0)
        + coalesce(modifier_ctx.line_qty, 0)
        + coalesce(packaging_ctx.line_qty, 0) as line_qty
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.menu_items mi on mi.id = oi.menu_item_id
    left join public.categories c on c.id = mi.category_id
    left join lateral (
      select sum(r.qty * oi.qty) as line_qty
      from public.recipes r
      where r.menu_item_id = oi.menu_item_id
        and r.item_id = sm.item_id
        and (not r.takeaway_only or oi.takeaway)
    ) recipe_ctx on true
    left join lateral (
      select sum(mr.qty * oi.qty) as line_qty
      from public.order_item_modifiers oim
      join public.modifier_recipes mr on mr.modifier_id = oim.modifier_id
      where oim.order_item_id = oi.id
        and mr.item_id = sm.item_id
    ) modifier_ctx on true
    left join lateral (
      select sum(oip.qty) as line_qty
      from public.order_item_packaging oip
      where oip.order_item_id = oi.id
        and oip.item_id = sm.item_id
    ) packaging_ctx on true
    where o.id = sm.ref_id
  ),
  exact_candidates as (
    select *
    from candidates
    where line_qty > 0
      and abs(line_qty - abs(sm.qty)) <= 0.0001
  ),
  scoped_candidates as (
    select *
    from exact_candidates
    union all
    select *
    from candidates
    where line_qty > 0
      and not exists (select 1 from exact_candidates)
  ),
  item_totals as (
    select
      order_id,
      physical_order_no,
      menu_item_name,
      menu_category,
      bool_or(takeaway) as takeaway,
      sum(order_item_qty) as order_item_qty
    from scoped_candidates
    group by order_id, physical_order_no, menu_item_name, menu_category
  )
  select
    coalesce(nullif(physical_order_no, ''), upper(substr(order_id::text, 1, 8))) as invoice_no,
    case when bool_or(takeaway) then 'Takeaway' else 'Table' end as order_type,
    string_agg(
      menu_item_name || ' x' || trim(to_char(order_item_qty, 'FM999999990.###')),
      ', '
      order by menu_item_name
    ) as menu_item_names,
    string_agg(distinct menu_category, ', ' order by menu_category) as menu_categories
  from item_totals
  group by order_id, physical_order_no
) order_ctx on sm.ref_type = 'order'
left join lateral (
  select
    upper(substr(pb.id::text, 1, 8)) as production_ref,
    string_agg(distinct output_items.name, ', ' order by output_items.name) as production_outputs,
    string_agg(distinct input_items.name, ', ' order by input_items.name) as production_inputs,
    pb.note
  from public.production_batches pb
  left join public.production_outputs po on po.batch_id = pb.id
  left join public.items output_items on output_items.id = po.item_id
  left join public.production_inputs pi on pi.batch_id = pb.id
  left join public.items input_items on input_items.id = pi.item_id
  where pb.id = sm.ref_id
  group by pb.id, pb.note
) production_ctx on sm.ref_type = 'production'
left join lateral (
  select
    e.ref_no as expense_ref,
    ec.name as expense_category,
    s.name as supplier_name,
    e.description
  from public.expenses e
  left join public.expense_categories ec on ec.id = e.category_id
  left join public.suppliers s on s.id = e.supplier_id
  where e.id = sm.ref_id
) expense_ctx on sm.ref_type = 'expense';

grant select on public.stock_movement_details to authenticated;
