-- Revert kitchen/stores inventory split
-- Transfers stock from kitchen items back to stores, deletes kitchen
-- duplicates, removes location columns, restores original functions.

-- 1. Transfer stock from kitchen duplicates back to stores and delete kitchen items
do $$
declare
  rec record;
  kit_item public.items%rowtype;
  sto_item public.items%rowtype;
  actor_id uuid;
begin
  select id into actor_id from public.profiles
  where id in (select user_id from public.user_roles where role = 'admin')
  limit 1;
  if actor_id is null then
    actor_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  -- Process duplicated items (kitchen version exists alongside stores version)
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
      'CHARCOAL',
      'CHEESE BURGER PKTS (40G)',
      'CHEESE PIZZA PKTS (120G)'
    ]) as name
  ) loop
    -- Get the kitchen item
    select * into kit_item from public.items
    where name = rec.name and location = 'kitchen' and active
    limit 1;
    continue when not found;

    -- Get the stores item
    select * into sto_item from public.items
    where name = rec.name and location = 'stores' and active
    limit 1;

    -- Transfer kitchen stock back to stores if there's any
    if kit_item.qty_on_hand > 0 then
      -- Deduct from kitchen
      perform app_private.apply_stock_movement_internal(
        actor_id, kit_item.id, 'transfer'::public.stock_movement_type,
        -(kit_item.qty_on_hand), kit_item.avg_cost,
        'Revert split: transfer back from kitchen',
        kit_item.branch_id, 'manual', null
      );

      -- Add to stores (if stores item exists)
      if found then
        perform app_private.apply_stock_movement_internal(
          actor_id, sto_item.id, 'transfer'::public.stock_movement_type,
          kit_item.qty_on_hand, kit_item.avg_cost,
          'Revert split: transfer back to stores',
          sto_item.branch_id, 'manual', null
        );
      end if;
    end if;

    -- Update recipes to point back to stores item
    if found then
      update public.recipes
      set item_id = sto_item.id
      where item_id = kit_item.id;
    end if;

    -- Update modifier_recipes to point back to stores item
    if found then
      update public.modifier_recipes
      set item_id = sto_item.id
      where item_id = kit_item.id;
    end if;

    -- Delete the kitchen duplicate
    delete from public.items where id = kit_item.id;
  end loop;

  -- Revert items that were set to 'kitchen' directly back to 'stores'
  update public.items set location = 'stores' where location = 'kitchen';

  -- Remove location value from remaining items (set to null/default)
  update public.items set location = default where location is not null;
end;
$$;

-- 2. Revert stock_movement_details view to the version before the split
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

-- 3. Revert apply_stock_movement_internal — remove location column from insert
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
    created_by
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
    _actor_id
  )
  returning * into movement;

  return movement;
end;
$$;

revoke all on function app_private.apply_stock_movement_internal(uuid, uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) from public, anon;
grant execute on function app_private.apply_stock_movement_internal(uuid, uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid) to authenticated, service_role;

-- 4. Restore original unique index on items
drop index if exists items_branch_loc_name_unique_ci;
create unique index items_branch_name_unique_ci
  on public.items (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where active;

-- 5. Remove location column from stock_movements
alter table public.stock_movements drop column if exists location;

-- 6. Remove location column from items
alter table public.items drop column if exists location;
