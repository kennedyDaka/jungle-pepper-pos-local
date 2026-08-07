-- Merge kitchen duplicates into stores items, deactivate kitchen items.
-- No schema changes — just data consolidation.

do $$
declare
  rec record;
  sto public.items%rowtype;
  kit public.items%rowtype;
begin
  -- Process duplicated items (same name, stores + kitchen)
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
    select * into sto from public.items
      where name = rec.name and location = 'stores' and active
      limit 1;
    select * into kit from public.items
      where name = rec.name and location = 'kitchen' and active
      limit 1;

    continue when not found or sto.id is null or kit.id is null;

    -- Merge kitchen stock into stores
    update public.items
      set qty_on_hand = coalesce(sto.qty_on_hand, 0) + coalesce(kit.qty_on_hand, 0),
          avg_cost = case
            when coalesce(kit.qty_on_hand, 0) <= 0 then sto.avg_cost
            when coalesce(sto.qty_on_hand, 0) <= 0 then kit.avg_cost
            else round(((sto.qty_on_hand * sto.avg_cost) + (kit.qty_on_hand * kit.avg_cost)) / (sto.qty_on_hand + kit.qty_on_hand), 2)
          end
      where id = sto.id;

    -- Re-point recipes from kitchen to stores
    update public.recipes set item_id = sto.id where item_id = kit.id;
    -- Re-point modifier_recipes from kitchen to stores
    -- First delete rows where stores already has the same modifier (avoid PK violation)
    delete from public.modifier_recipes
      where item_id = kit.id
        and modifier_id in (select modifier_id from public.modifier_recipes where item_id = sto.id);
    -- Then re-point remaining kitchen modifier_recipes to stores
    update public.modifier_recipes set item_id = sto.id where item_id = kit.id;
    -- Re-point historical stock movements from kitchen to stores
    update public.stock_movements set item_id = sto.id where item_id = kit.id;
    -- Re-point production_outputs
    update public.production_outputs set item_id = sto.id where item_id = kit.id;
    -- Re-point production_inputs
    update public.production_inputs set item_id = sto.id where item_id = kit.id;

    -- Deactivate kitchen duplicate
    update public.items set active = false, qty_on_hand = 0 where id = kit.id;
  end loop;

  -- For items that were set to 'kitchen' directly (no stores counterpart),
  -- just set their location to 'stores' so they remain visible
  update public.items set location = 'stores' where location = 'kitchen' and active;
end;
$$;
