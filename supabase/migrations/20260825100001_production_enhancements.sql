-- ============================================================
-- Production Tracking Enhancements
-- Add cook_kg to track post-cooking weight for outputs
-- Ensure weight_kg is properly tracked for inputs
-- ============================================================

-- Add cook_kg to production_outputs (post-cooking weight)
ALTER TABLE public.production_outputs
  ADD COLUMN IF NOT EXISTS cook_kg NUMERIC;

-- Add cook_kg to production_inputs (post-processing weight)
ALTER TABLE public.production_inputs
  ADD COLUMN IF NOT EXISTS cook_kg NUMERIC;

-- Replace apply_production to accept cook_kg in the payload
-- IMPORTANT: Must match the original signature (_payload jsonb, _branch_id uuid)
-- so that the frontend's supabase.rpc("apply_production", { _payload }) works.
CREATE OR REPLACE FUNCTION public.apply_production(
  _payload jsonb,
  _branch_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  user_id uuid := auth.uid();
  batch_id uuid;
  line jsonb;
  movement public.stock_movements%rowtype;
  input_cost_total numeric(14, 2) := 0;
  output_qty_total numeric(14, 3) := 0;
  output_unit_cost numeric(14, 2) := 0;
begin
  if user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not (app_private.has_role(user_id, 'admin') or app_private.has_role(user_id, 'storekeeper')) then
    raise exception 'Only admins and storekeepers can record production';
  end if;

  if not app_private.can_access_branch(user_id, _branch_id) then
    raise exception 'You do not have access to this branch';
  end if;

  if jsonb_typeof(_payload -> 'inputs') <> 'array'
     or jsonb_array_length(_payload -> 'inputs') = 0
     or jsonb_typeof(_payload -> 'outputs') <> 'array'
     or jsonb_array_length(_payload -> 'outputs') = 0 then
    raise exception 'Production requires at least one input and output';
  end if;

  insert into public.production_batches (branch_id, note, created_by)
  values (_branch_id, nullif(_payload ->> 'note', ''), user_id)
  returning id into batch_id;

  -- Process inputs (raw ingredients consumed)
  for line in select * from jsonb_array_elements(_payload -> 'inputs') loop
    if coalesce((line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'Production input quantity must be positive';
    end if;

    movement := public.apply_stock_movement(
      (line ->> 'item_id')::uuid,
      'production_in',
      -abs((line ->> 'qty')::numeric),
      0,
      'Production input ' || batch_id::text,
      _branch_id,
      'production_batch',
      batch_id
    );

    insert into public.production_inputs (
      batch_id, item_id, stock_movement_id, qty, qty_count, weight_kg, cook_kg, unit_cost
    ) values (
      batch_id,
      (line ->> 'item_id')::uuid,
      movement.id,
      (line ->> 'qty')::numeric,
      nullif(line ->> 'qty_count', '')::numeric,
      nullif(line ->> 'weight_kg', '')::numeric,
      nullif(line ->> 'cook_kg', '')::numeric,
      movement.unit_cost
    );

    input_cost_total := input_cost_total + (abs(movement.qty) * movement.unit_cost);
  end loop;

  -- Calculate total output quantity for unit cost distribution
  for line in select * from jsonb_array_elements(_payload -> 'outputs') loop
    if coalesce((line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'Production output quantity must be positive';
    end if;
    output_qty_total := output_qty_total + (line ->> 'qty')::numeric;
  end loop;

  if output_qty_total > 0 then
    output_unit_cost := round(input_cost_total / output_qty_total, 2);
  end if;

  -- Process outputs (items produced)
  for line in select * from jsonb_array_elements(_payload -> 'outputs') loop
    movement := public.apply_stock_movement(
      (line ->> 'item_id')::uuid,
      'production_out',
      abs((line ->> 'qty')::numeric),
      coalesce(nullif(line ->> 'unit_cost', '')::numeric, output_unit_cost),
      'Production output ' || batch_id::text,
      _branch_id,
      'production_batch',
      batch_id
    );

    insert into public.production_outputs (
      batch_id, item_id, stock_movement_id, qty, qty_count, weight_kg, cook_kg, unit_cost
    ) values (
      batch_id,
      (line ->> 'item_id')::uuid,
      movement.id,
      (line ->> 'qty')::numeric,
      nullif(line ->> 'qty_count', '')::numeric,
      nullif(line ->> 'weight_kg', '')::numeric,
      nullif(line ->> 'cook_kg', '')::numeric,
      movement.unit_cost
    );
  end loop;

  -- Process wastage (optional)
  if jsonb_typeof(_payload -> 'wastage') = 'array' then
    for line in select * from jsonb_array_elements(_payload -> 'wastage') loop
      if coalesce((line ->> 'qty')::numeric, 0) <= 0 then
        raise exception 'Wastage quantity must be positive';
      end if;

      movement := public.apply_stock_movement(
        (line ->> 'item_id')::uuid,
        'wastage',
        -abs((line ->> 'qty')::numeric),
        0,
        nullif(line ->> 'reason', ''),
        _branch_id,
        'production_batch',
        batch_id
      );

      insert into public.production_wastage (batch_id, item_id, stock_movement_id, qty, reason)
      values (
        batch_id,
        (line ->> 'item_id')::uuid,
        movement.id,
        (line ->> 'qty')::numeric,
        coalesce(nullif(line ->> 'reason', ''), 'Production wastage')
      );
    end loop;
  end if;

  return batch_id;
end;
$$;
