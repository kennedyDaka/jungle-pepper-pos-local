-- Fix: app_private.apply_stock_movement_internal
-- Auto-reconcile negative/zero costs and recipe omission ambiguity (applied live 2026-11-06)

CREATE OR REPLACE FUNCTION app_private.apply_stock_movement_internal(_actor_id uuid, _item_id uuid, _type stock_movement_type, _qty numeric, _unit_cost numeric DEFAULT 0, _note text DEFAULT NULL::text, _branch_id uuid DEFAULT NULL::uuid, _ref_type text DEFAULT NULL::text, _ref_id uuid DEFAULT NULL::uuid)
 RETURNS stock_movements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_item public.items%rowtype;
  movement public.stock_movements%rowtype;
  before_qty numeric(14, 3);
  after_qty numeric(14, 3);
  resolved_unit_cost numeric(14, 2);
  next_avg_cost numeric(14, 2);
  effective_unit_cost numeric(14, 2);
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
  effective_unit_cost := case when resolved_unit_cost < 0 then 0 else resolved_unit_cost end;
  next_avg_cost := current_item.avg_cost;
  
  if next_avg_cost < 0 then
    next_avg_cost := 0;
  end if;

  if _qty > 0 and effective_unit_cost > 0 then
    if before_qty <= 0 then
      next_avg_cost := effective_unit_cost;
    elsif after_qty > 0 then
      next_avg_cost := round(((before_qty * current_item.avg_cost) + (_qty * effective_unit_cost)) / after_qty, 2);
    else
      next_avg_cost := effective_unit_cost;
    end if;
  elsif _qty > 0 and effective_unit_cost <= 0 and current_item.avg_cost > 0 then
    next_avg_cost := current_item.avg_cost;
  elsif _qty > 0 and effective_unit_cost <= 0 and current_item.avg_cost <= 0 then
    next_avg_cost := 0;
  end if;
  
  if next_avg_cost < 0 then
    next_avg_cost := 0;
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
    effective_unit_cost,
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
$function$;
