-- Split CHEESE BURGER PKTS (40G) and CHEESE PIZZA PKTS (120G) to both locations

do $$
declare
  rec record;
  old_id uuid;
  new_id uuid;
  item_row public.items%rowtype;
  actor_id uuid;
begin
  select id into actor_id from public.profiles
  where id in (select user_id from public.user_roles where role = 'admin')
  limit 1;
  if actor_id is null then
    actor_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  for rec in (
    select unnest(array[
      'CHEESE BURGER PKTS (40G)',
      'CHEESE PIZZA PKTS (120G)'
    ]) as name
  ) loop
    select * into item_row from public.items
    where name = rec.name and location = 'stores' and active
    limit 1;
    continue when not found;

    old_id := item_row.id;

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

    if item_row.qty_on_hand > 0 then
      perform app_private.apply_stock_movement_internal(
        actor_id, old_id, 'transfer'::public.stock_movement_type,
        -(item_row.qty_on_hand), item_row.avg_cost,
        'Initial bulk transfer to kitchen',
        item_row.branch_id, 'manual', null
      );

      perform app_private.apply_stock_movement_internal(
        actor_id, new_id, 'transfer'::public.stock_movement_type,
        item_row.qty_on_hand, item_row.avg_cost,
        'Initial bulk transfer from stores',
        item_row.branch_id, 'manual', null
      );
    end if;

    update public.recipes
    set item_id = new_id
    where item_id = old_id;

    update public.modifier_recipes
    set item_id = new_id
    where item_id = old_id;
  end loop;
end;
$$;
