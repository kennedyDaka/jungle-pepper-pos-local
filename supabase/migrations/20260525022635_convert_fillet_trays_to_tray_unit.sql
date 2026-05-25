do $$
declare
  fillet_id uuid;
  kg_unit_id uuid;
  tray_unit_id uuid;
  kg_to_tray numeric := 2; -- One 500g tray is 0.5kg, so kg quantities double when shown as trays.
begin
  select id into fillet_id
  from public.items
  where lower(name) = lower('FILLET TRAYS (500G)')
  limit 1;

  select id into kg_unit_id
  from public.units
  where code = 'kg'
  limit 1;

  select id into tray_unit_id
  from public.units
  where code = 'tray'
  limit 1;

  if fillet_id is null or kg_unit_id is null or tray_unit_id is null then
    return;
  end if;

  if exists (
    select 1
    from public.items
    where id = fillet_id
      and unit_id = kg_unit_id
  ) then
    update public.stock_movements
    set qty = qty * kg_to_tray,
        qty_before = case when qty_before is null then null else qty_before * kg_to_tray end,
        qty_after = case when qty_after is null then null else qty_after * kg_to_tray end,
        unit_cost = round(unit_cost / kg_to_tray, 2)
    where item_id = fillet_id;

    update public.recipes
    set qty = qty * kg_to_tray
    where item_id = fillet_id;

    update public.modifier_recipes
    set qty = qty * kg_to_tray
    where item_id = fillet_id;

    update public.expense_stock_lines
    set qty = qty * kg_to_tray,
        unit_cost = round(unit_cost / kg_to_tray, 2)
    where item_id = fillet_id;

    update public.production_inputs
    set qty = qty * kg_to_tray,
        unit_cost = case when unit_cost is null then null else round(unit_cost / kg_to_tray, 2) end
    where item_id = fillet_id;

    update public.production_outputs
    set qty = qty * kg_to_tray,
        unit_cost = case when unit_cost is null then null else round(unit_cost / kg_to_tray, 2) end
    where item_id = fillet_id;

    update public.production_wastage
    set qty = qty * kg_to_tray
    where item_id = fillet_id;

    update public.items
    set unit_id = tray_unit_id,
        qty_on_hand = qty_on_hand * kg_to_tray,
        avg_cost = round(avg_cost / kg_to_tray, 2),
        updated_at = now()
    where id = fillet_id;
  end if;
end;
$$;
