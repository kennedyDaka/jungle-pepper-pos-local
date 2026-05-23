-- Data-safe unit correction for counted prep packets and richer stock traceability.
-- Existing quantities are converted only when the item is still stored as kg.

insert into public.units (code, name)
select 'pkt', 'Packet'
where not exists (select 1 from public.units u where lower(u.code) = 'pkt');

do $$
declare
  pkt_unit_id uuid;
  cfg record;
  item_record record;
  target_name text;
  zero_branch constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  select id into pkt_unit_id from public.units where lower(code) = 'pkt' limit 1;

  for cfg in
    select *
    from (values
      (
        'CHEESE PIZZA PKTS (120G)'::text,
        0.120::numeric,
        array['cheese pizza pkts', 'cheese pizza pkts (120g)']::text[]
      ),
      (
        'CHEESE BURGER PKTS (40G)'::text,
        0.040::numeric,
        array['cheese burger pkts', 'cheese burger pkts (40g)']::text[]
      )
    ) as v(canonical_name, packet_kg, aliases)
  loop
    for item_record in
      select i.id, i.name, i.branch_id, u.code as unit_code
      from public.items i
      join public.units u on u.id = i.unit_id
      where lower(i.name) = any (cfg.aliases)
    loop
      target_name := item_record.name;

      if not exists (
        select 1
        from public.items other
        where other.id <> item_record.id
          and other.active
          and lower(other.name) = lower(cfg.canonical_name)
          and coalesce(other.branch_id, zero_branch) = coalesce(item_record.branch_id, zero_branch)
      ) then
        target_name := cfg.canonical_name;
      end if;

      if lower(item_record.unit_code) = 'kg' then
        update public.stock_movements
        set qty = round(qty / cfg.packet_kg, 3),
            qty_before = case when qty_before is null then null else round(qty_before / cfg.packet_kg, 3) end,
            qty_after = case when qty_after is null then null else round(qty_after / cfg.packet_kg, 3) end,
            unit_cost = round(unit_cost * cfg.packet_kg, 2)
        where item_id = item_record.id;

        update public.expense_stock_lines
        set qty = round(qty / cfg.packet_kg, 3),
            unit_cost = round(unit_cost * cfg.packet_kg, 2)
        where item_id = item_record.id;

        update public.production_inputs
        set qty_count = coalesce(qty_count, round(qty / cfg.packet_kg, 3)),
            weight_kg = coalesce(weight_kg, qty),
            qty = round(qty / cfg.packet_kg, 3),
            unit_cost = case when unit_cost is null then null else round(unit_cost * cfg.packet_kg, 2) end
        where item_id = item_record.id;

        update public.production_outputs
        set qty_count = coalesce(qty_count, round(qty / cfg.packet_kg, 3)),
            weight_kg = coalesce(weight_kg, qty),
            qty = round(qty / cfg.packet_kg, 3),
            unit_cost = case when unit_cost is null then null else round(unit_cost * cfg.packet_kg, 2) end
        where item_id = item_record.id;

        update public.items
        set name = target_name,
            unit_id = pkt_unit_id,
            qty_on_hand = round(qty_on_hand / cfg.packet_kg, 3),
            avg_cost = round(avg_cost * cfg.packet_kg, 2),
            reorder_level = round(reorder_level / cfg.packet_kg, 3),
            updated_at = now()
        where id = item_record.id;
      else
        update public.items
        set name = target_name,
            unit_id = pkt_unit_id,
            updated_at = now()
        where id = item_record.id;
      end if;
    end loop;
  end loop;
end $$;

-- Packet-count recipes: one pizza cheese packet is 120g, one burger cheese packet is 40g.
update public.recipes r
set qty = 1,
    updated_at = now()
from public.items i
where i.id = r.item_id
  and lower(i.name) in ('cheese pizza pkts', 'cheese pizza pkts (120g)', 'cheese burger pkts', 'cheese burger pkts (40g)');

-- Stop future sales from deducting the old separate kg "EXTRA CHEESE" inventory item.
delete from public.recipes r
using public.items i
where i.id = r.item_id
  and lower(i.name) = 'extra cheese';

-- Extras are available on savory dishes, never on bar/beverage items.
insert into public.modifiers (menu_item_id, name, price_delta, sort_order, active)
select m.id, v.modifier_name, v.price_delta, v.sort_order, true
from public.menu_items m
join public.categories c on c.id = m.category_id
cross join (values
  ('Extra Cheese', 6000::numeric, 10),
  ('Extra Chicken', 6000::numeric, 11),
  ('Extra Mushroom', 6000::numeric, 12),
  ('Extra Egg', 6000::numeric, 13),
  ('Extra Fried Onions', 6000::numeric, 14)
) as v(modifier_name, price_delta, sort_order)
where m.active
  and c.kind = 'menu'
  and c.name in (
    'Starters',
    'Salads',
    'Pastas',
    'Pizza',
    'Burgers',
    'Chips',
    'Pregos & Bitoques',
    'Frango',
    'Seafood'
  )
  and not exists (
    select 1
    from public.modifiers mod
    where mod.menu_item_id = m.id
      and lower(mod.name) = lower(v.modifier_name)
  );

update public.modifiers mod
set price_delta = 6000,
    sort_order = v.sort_order,
    active = true,
    updated_at = now()
from (values
  ('Extra Cheese', 10),
  ('Extra Chicken', 11),
  ('Extra Mushroom', 12),
  ('Extra Egg', 13),
  ('Extra Fried Onions', 14)
) as v(modifier_name, sort_order),
public.menu_items m,
public.categories c
where lower(mod.name) = lower(v.modifier_name)
  and m.id = mod.menu_item_id
  and c.id = m.category_id
  and c.kind = 'menu'
  and c.name in (
    'Starters',
    'Salads',
    'Pastas',
    'Pizza',
    'Burgers',
    'Chips',
    'Pregos & Bitoques',
    'Frango',
    'Seafood'
  );

delete from public.modifier_recipes mr
using public.modifiers mod
where mr.modifier_id = mod.id
  and lower(mod.name) in ('extra cheese', 'extra chicken', 'extra mushroom', 'extra egg', 'extra fried onions');

insert into public.modifier_recipes (modifier_id, item_id, qty)
select mod.id, i.id, v.qty
from public.modifiers mod
join public.menu_items m on m.id = mod.menu_item_id
join public.categories c on c.id = m.category_id
join lateral (
  select case
      when lower(mod.name) = 'extra cheese' and c.name = 'Pizza' then 'pizza_cheese'
      when lower(mod.name) = 'extra cheese' then 'burger_cheese'
      when lower(mod.name) = 'extra chicken' then 'chicken_pkt'
      when lower(mod.name) = 'extra mushroom' then 'mushroom'
      when lower(mod.name) = 'extra egg' then 'egg'
      when lower(mod.name) = 'extra fried onions' then 'fried_onions'
    end as item_key,
    case
      when lower(mod.name) in ('extra chicken', 'extra egg', 'extra cheese') then 1::numeric
      else 0.040::numeric
    end as qty
) v on v.item_key is not null
join public.items i on (
  (v.item_key = 'pizza_cheese' and lower(i.name) in ('cheese pizza pkts', 'cheese pizza pkts (120g)'))
  or (v.item_key = 'burger_cheese' and lower(i.name) in ('cheese burger pkts', 'cheese burger pkts (40g)'))
  or (v.item_key = 'chicken_pkt' and lower(i.name) = 'pizza pkts (80g)')
  or (v.item_key = 'mushroom' and lower(i.name) = 'mushroom')
  or (v.item_key = 'egg' and lower(i.name) = 'eggs')
  or (v.item_key = 'fried_onions' and lower(i.name) = 'fried onions')
)
where mod.active
  and c.kind = 'menu'
  and c.name in (
    'Starters',
    'Salads',
    'Pastas',
    'Pizza',
    'Burgers',
    'Chips',
    'Pregos & Bitoques',
    'Frango',
    'Seafood'
  )
  and lower(mod.name) in ('extra cheese', 'extra chicken', 'extra mushroom', 'extra egg', 'extra fried onions')
on conflict (modifier_id, item_id) do update
set qty = excluded.qty,
    updated_at = now();

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
  order_ctx.invoice_no,
  order_ctx.order_type,
  order_ctx.menu_item_names,
  order_ctx.menu_categories,
  production_ctx.production_ref,
  production_ctx.production_outputs,
  production_ctx.production_inputs,
  expense_ctx.expense_ref,
  expense_ctx.expense_category,
  expense_ctx.supplier_name,
  case
    when sm.ref_type = 'order' then 'MW POS'
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
    when sm.ref_type = 'order' then coalesce(order_ctx.menu_item_names, 'POS order')
    when sm.ref_type = 'production' and sm.type = 'production_out' then coalesce(production_ctx.production_outputs, i.name)
    when sm.ref_type = 'production' then coalesce(production_ctx.production_outputs, 'Production')
    when sm.ref_type = 'expense' then coalesce(expense_ctx.supplier_name, expense_ctx.expense_category, 'Procurement')
    else coalesce(nullif(sm.note, ''), sm.ref_type, sm.type::text)
  end as destination
from public.stock_movements sm
join public.items i on i.id = sm.item_id
left join public.units u on u.id = i.unit_id
left join public.branches b on b.id = sm.branch_id
left join public.profiles p on p.id = sm.created_by
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
