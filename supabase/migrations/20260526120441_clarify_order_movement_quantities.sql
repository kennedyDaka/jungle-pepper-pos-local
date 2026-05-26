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
  with candidates as (
    select
      o.id as order_id,
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
      menu_item_name,
      menu_category,
      bool_or(takeaway) as takeaway,
      sum(order_item_qty) as order_item_qty
    from scoped_candidates
    group by order_id, menu_item_name, menu_category
  )
  select
    upper(substr(order_id::text, 1, 8)) as invoice_no,
    case when bool_or(takeaway) then 'Takeaway' else 'Table' end as order_type,
    string_agg(
      menu_item_name || ' x' || trim(to_char(order_item_qty, 'FM999999990.###')),
      ', '
      order by menu_item_name
    ) as menu_item_names,
    string_agg(distinct menu_category, ', ' order by menu_category) as menu_categories
  from item_totals
  group by order_id
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
