-- Keep pizza base deductions tied only to the chosen crust modifier.
delete from public.recipes r
using public.menu_items mi, public.categories c, public.items i
where r.menu_item_id = mi.id
  and mi.category_id = c.id
  and r.item_id = i.id
  and c.name = 'Pizza'
  and lower(i.name) in ('dough pizza bases thin', 'dough pizza bases thick');

update public.modifier_recipes mr
set qty = 1,
    updated_at = now()
from public.modifiers mod, public.menu_items mi, public.categories c, public.items i
where mr.modifier_id = mod.id
  and mod.menu_item_id = mi.id
  and mi.category_id = c.id
  and mr.item_id = i.id
  and c.name = 'Pizza'
  and lower(mod.name) in ('thin crust', 'thick crust')
  and lower(i.name) in ('dough pizza bases thin', 'dough pizza bases thick');

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
  subtotal numeric(14, 2) := 0;
  discount numeric(14, 2) := coalesce((_payload ->> 'discount')::numeric, 0);
  total numeric(14, 2);
  payment_total numeric(14, 2) := 0;
  movement public.stock_movements%rowtype;
  line_takeaway boolean;
  crust_option_count integer;
  selected_crust_count integer;
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
      if jsonb_typeof(line -> 'packaging') <> 'object' then
        raise exception 'Choose packaging for takeaway items';
      end if;

      packaging_payload := line -> 'packaging';
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

      subtotal := subtotal + (package_unit_price * qty);
    end if;
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

    if line_takeaway and jsonb_typeof(line -> 'packaging') = 'object' then
      packaging_payload := line -> 'packaging';
      select *
      into packaging
      from public.packaging_options
      where id = (packaging_payload ->> 'option_id')::uuid
        and active;

      package_unit_price := coalesce((packaging_payload ->> 'unit_price')::numeric, packaging.price, 0);

      movement := public.apply_stock_movement(
        packaging.item_id,
        'sale',
        -abs(qty),
        0,
        'POS order ' || order_id::text || ' item ' || menu.name || ' x' || qty::text || ' packaging ' || packaging.name,
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
        qty,
        package_unit_price,
        movement.id
      )
      returning id into packaging_row_id;
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

revoke execute on function public.finalize_order(jsonb, uuid, uuid) from public, anon;
grant execute on function public.finalize_order(jsonb, uuid, uuid) to authenticated;

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
  coalesce(order_item_ctx.invoice_no, order_ctx.invoice_no) as invoice_no,
  coalesce(order_item_ctx.order_type, order_ctx.order_type) as order_type,
  coalesce(
    order_item_ctx.menu_item_name || ' x' || trim(to_char(order_item_ctx.order_item_qty, 'FM999999990.###')),
    order_ctx.menu_item_names
  ) as menu_item_names,
  coalesce(order_item_ctx.menu_category, order_ctx.menu_categories) as menu_categories,
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
      'MW POS ' || coalesce(order_ctx.invoice_no, upper(substr(sm.ref_id::text, 1, 8))),
      order_ctx.order_type,
      order_ctx.menu_item_names
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
    when sm.ref_type = 'order' then coalesce(order_ctx.menu_item_names, 'POS order')
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
    upper(substr(o.id::text, 1, 8)) as invoice_no,
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
    upper(substr(o.id::text, 1, 8)) as invoice_no,
    case when bool_or(oi.takeaway) then 'Takeaway' else 'Table' end as order_type,
    string_agg(distinct mi.name, ', ' order by mi.name) as menu_item_names,
    string_agg(distinct c.name, ', ' order by c.name) as menu_categories
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.menu_items mi on mi.id = oi.menu_item_id
  left join public.categories c on c.id = mi.category_id
  where o.id = sm.ref_id
    and (
      exists (
        select 1
        from public.recipes r
        where r.menu_item_id = oi.menu_item_id
          and r.item_id = sm.item_id
      )
      or exists (
        select 1
        from public.order_item_modifiers oim
        join public.modifier_recipes mr on mr.modifier_id = oim.modifier_id
        where oim.order_item_id = oi.id
          and mr.item_id = sm.item_id
      )
      or exists (
        select 1
        from public.order_item_packaging oip
        where oip.order_item_id = oi.id
          and oip.item_id = sm.item_id
      )
    )
  group by o.id
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
  where o.status = 'paid'
    and (not r.takeaway_only or oi.takeaway)
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
  upper(substr(o.id::text, 1, 8)) as invoice_no,
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
