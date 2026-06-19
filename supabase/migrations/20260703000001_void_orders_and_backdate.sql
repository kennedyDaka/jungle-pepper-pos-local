-- 1. Wrapper to apply stock movement with a custom date (for backdating inventory entries)

create or replace function public.apply_stock_movement_with_date(
  _item_id uuid,
  _type public.stock_movement_type,
  _qty numeric,
  _unit_cost numeric default 0,
  _note text default null,
  _branch_id uuid default null,
  _ref_type text default null,
  _ref_id uuid default null,
  _created_at timestamptz default now()
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  movement public.stock_movements;
begin
  if _created_at > now() + interval '5 minutes' then
    raise exception 'Date cannot be in the future';
  end if;

  movement := public.apply_stock_movement(
    _item_id, _type, _qty, _unit_cost, _note, _branch_id, _ref_type, _ref_id
  );

  perform app_private.backdate_stock_movement(auth.uid(), movement.id, _created_at);

  return movement;
end;
$$;

grant execute on function public.apply_stock_movement_with_date(uuid, public.stock_movement_type, numeric, numeric, text, uuid, text, uuid, timestamptz) to authenticated;

-- 2. Void all paid orders for a given branch and date, reversing their stock movements

create or replace function public.void_orders_for_date(
  _branch_id uuid,
  _date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  mov record;
  rev_movement public.stock_movements;
  voided_count int := 0;
  reversed_orders jsonb := '[]'::jsonb;
begin
  if not app_private.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can void orders';
  end if;

  for rec in
    select o.id, o.branch_id
    from public.orders o
    where o.branch_id = _branch_id
      and o.status = 'paid'
      and o.created_at::date = _date
    order by o.created_at
  loop
    -- Reverse all stock movements linked to this order
    for mov in
      select sm.id, sm.item_id, sm.qty
      from public.stock_movements sm
      where (
        (sm.ref_type = 'order_item' and sm.ref_id in (
          select oi.id from public.order_items oi where oi.order_id = rec.id
        ))
        or
        (sm.ref_type = 'order' and sm.ref_id = rec.id)
      )
        and sm.qty < 0
    loop
      rev_movement := public.apply_stock_movement(
        mov.item_id,
        'adjustment',
        abs(mov.qty),
        0,
        'Void reversal for order ' || rec.id::text || ' (original movement ' || mov.id::text || ')',
        rec.branch_id,
        'void',
        rec.id
      );
    end loop;

    -- Void the order
    update public.orders
    set status = 'void',
        voided_by = auth.uid(),
        voided_at = now()
    where id = rec.id;

    voided_count := voided_count + 1;
    reversed_orders := reversed_orders || jsonb_build_object('order_id', rec.id);
  end loop;

  return jsonb_build_object(
    'voided_count', voided_count,
    'orders', reversed_orders
  );
end;
$$;

grant execute on function public.void_orders_for_date(uuid, date) to authenticated;
