-- Kitchen vs Stores inventory split
-- Adds `location` column to items & stock_movements, assigns locations
-- per the business rules, creates kitchen duplicates for items that
-- exist in both locations, and updates recipes to point to kitchen items.

-- 1. Add 'transfer' to stock_movement_type for inter-location transfers
alter type public.stock_movement_type add value if not exists 'transfer';

-- 2. Add location column to items
alter table public.items add column if not exists location text not null default 'stores'
  check (location in ('kitchen', 'stores'));

-- 3. Replace unique index to include location
drop index if exists items_branch_name_unique_ci;
create unique index items_branch_loc_name_unique_ci
  on public.items (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), location, lower(name))
  where active;

-- 4. Add location column to stock_movements
alter table public.stock_movements add column if not exists location text;

-- 5. Update apply_stock_movement_internal to record location from the item
create or replace function app_private.apply_stock_movement_internal(
  _actor_id uuid,
  _item_id uuid,
  _type public.stock_movement_type,
  _qty numeric,
  _unit_cost numeric default 0,
  _note text default null,
  _branch_id uuid default null,
  _ref_type text default null,
  _ref_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_item public.items%rowtype;
  movement public.stock_movements%rowtype;
  before_qty numeric(14, 3);
  after_qty numeric(14, 3);
  resolved_unit_cost numeric(14, 2);
  next_avg_cost numeric(14, 2);
begin
  if _actor_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (
    app_private.has_role(_actor_id, 'admin')
    or app_private.has_role(_actor_id, 'storekeeper')
    or (_type = 'sale' and app_private.has_role(_actor_id, 'cashier'))
  ) then
    raise exception 'Insufficient permissions to move stock';
  end if;

  if _qty = 0 then
    raise exception 'Stock movement quantity cannot be zero';
  end if;

  select *
  into current_item
  from public.items
  where id = _item_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if current_item.branch_id is not null
     and _branch_id is not null
     and current_item.branch_id <> _branch_id then
    raise exception 'Inventory item belongs to a different branch';
  end if;

  if not app_private.can_access_branch(_actor_id, coalesce(_branch_id, current_item.branch_id)) then
    raise exception 'You do not have access to this branch';
  end if;

  before_qty := current_item.qty_on_hand;
  after_qty := before_qty + _qty;
  resolved_unit_cost := coalesce(nullif(_unit_cost, 0), current_item.avg_cost, 0);
  next_avg_cost := current_item.avg_cost;

  if _qty > 0 and resolved_unit_cost > 0 then
    next_avg_cost := case
      when after_qty > 0 then round(((before_qty * current_item.avg_cost) + (_qty * resolved_unit_cost)) / after_qty, 2)
      else resolved_unit_cost
    end;
  end if;

  update public.items
  set qty_on_hand = after_qty,
      avg_cost = next_avg_cost,
      branch_id = coalesce(branch_id, _branch_id),
      updated_at = now()
  where id = _item_id;

  insert into public.stock_movements (
    branch_id,
    item_id,
    type,
    qty,
    unit_cost,
    qty_before,
    qty_after,
    note,
    ref_type,
    ref_id,
    created_by,
    location
  )
  values (
    coalesce(_branch_id, current_item.branch_id),
    _item_id,
    _type,
    _qty,
    resolved_unit_cost,
    before_qty,
    after_qty,
    _note,
    _ref_type,
    _ref_id,
    _actor_id,
    current_item.location
  )
  returning * into movement;

  return movement;
end;
$$;

revoke all on function app_private.apply_stock_movement_internal(uuid, uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) from public, anon;
grant execute on function app_private.apply_stock_movement_internal(uuid, uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) to authenticated, service_role;

-- 6. Update public wrapper (signature unchanged, location flows through automatically)
create or replace function public.apply_stock_movement(
  _item_id uuid,
  _type public.stock_movement_type,
  _qty numeric,
  _unit_cost numeric default 0,
  _note text default null,
  _branch_id uuid default null,
  _ref_type text default null,
  _ref_id uuid default null
)
returns public.stock_movements
language sql
security definer
set search_path = ''
as $$
  select app_private.apply_stock_movement_internal(
    auth.uid(),
    _item_id,
    _type,
    _qty,
    _unit_cost,
    _note,
    _branch_id,
    _ref_type,
    _ref_id
  );
$$;

revoke execute on function public.apply_stock_movement(uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) from public, anon;
grant execute on function public.apply_stock_movement(uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) to authenticated;

-- 7. Assign locations to kitchen-only items (pre-portioned consumables)
update public.items set location = 'kitchen' where name in (
  'PIZZA PKTS (80G)',
  'BURGER (120G)',
  'SLICED 120G',
  'BURGERS (120G)',
  'PIZZA PKTS & BOLOG (80G)',
  'CHEESE PIZZA PKTS',
  'CHEESE BURGER PKTS',
  'GARLIC FULL',
  'MARISCO PKTS',
  'RICE COOKER'
);

-- 8. Create kitchen duplicates for items that exist in both locations.
--    For each: INSERT a copy with location='kitchen', capture its new UUID,
--    then transfer ALL current stock from stores to kitchen via a pair of
--    transfer movements (issue_out on stores, purchase_in on kitchen).

do $$
declare
  rec record;
  old_id uuid;
  new_id uuid;
  item_row public.items%rowtype;
  actor_id uuid;
begin
  -- Pick an actor for the transfer movements (first admin)
  select id into actor_id from public.profiles
  where id in (select user_id from public.user_roles where role = 'admin')
  limit 1;
  if actor_id is null then
    actor_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  for rec in (
    select unnest(array[
      'FRANGO HALF (600G)',
      'CAMARAO PASTA PKTS (80G)',
      'MILK',
      'MARGARINE',
      'FLOUR / DOUGH FLOUR BAG',
      'DOUGH PIZZA BASES THIN',
      'DOUGH PIZZA BASES THICK',
      'BREAD BURGER PKTS',
      'RICE BULK',
      'POTATOES BULK',
      'CHARCOAL'
    ]) as name
  ) loop
    -- Get the stores item
    select * into item_row from public.items
    where name = rec.name and location = 'stores' and active
    limit 1;
    continue when not found;

    old_id := item_row.id;

    -- Create kitchen duplicate
    insert into public.items (
      branch_id, name, stock_type, category_id, unit_id, supplier_id,
      qty_on_hand, avg_cost, reorder_level, bottle_ml, shot_ml, active, location
    )
    values (
      item_row.branch_id, item_row.name, item_row.stock_type,
      item_row.category_id, item_row.unit_id, item_row.supplier_id,
      0, item_row.avg_cost, item_row.reorder_level,
      item_row.bottle_ml, item_row.shot_ml, item_row.active, 'kitchen'
    )
    returning id into new_id;

    -- If stores item has stock, transfer it to kitchen
    if item_row.qty_on_hand > 0 then
      -- Deduct from stores
      perform app_private.apply_stock_movement_internal(
        actor_id, old_id, 'transfer'::public.stock_movement_type,
        -(item_row.qty_on_hand), item_row.avg_cost,
        'Initial bulk transfer to kitchen',
        item_row.branch_id, 'manual', null
      );

      -- Add to kitchen
      perform app_private.apply_stock_movement_internal(
        actor_id, new_id, 'transfer'::public.stock_movement_type,
        item_row.qty_on_hand, item_row.avg_cost,
        'Initial bulk transfer from stores',
        item_row.branch_id, 'manual', null
      );
    end if;

    -- Update recipes to point to kitchen item instead of stores item
    update public.recipes
    set item_id = new_id
    where item_id = old_id;

    -- Update modifier_recipes to point to kitchen item instead of stores item
    update public.modifier_recipes
    set item_id = new_id
    where item_id = old_id;
  end loop;
end;
$$;

-- 9. Backfill location on existing stock_movements from their item
update public.stock_movements sm
set location = i.location
from public.items i
where sm.item_id = i.id
  and sm.location is null;

-- 10. Update stock_movement_details view to include location
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
  sm.location,
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
    when sm.type = 'transfer' then 'Transfer'
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
    when sm.type = 'transfer' and sm.qty > 0 then 'Transfer in from stores'
    when sm.type = 'transfer' and sm.qty < 0 then 'Transfer out to kitchen'
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
