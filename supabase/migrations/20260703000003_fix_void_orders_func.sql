-- Update void_orders_for_date to accept optional _actor_id for maintenance contexts
-- where auth.uid() may be null (e.g. management API / migrations)

drop function if exists public.void_orders_for_date;

create or replace function public.void_orders_for_date(
  _branch_id uuid,
  _date date default current_date,
  _actor_id uuid default null
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
  uid uuid;
  voided_count int := 0;
  reversed_orders jsonb := '[]'::jsonb;
begin
  uid := coalesce(_actor_id, auth.uid());

  if uid is null or not app_private.has_role(uid, 'admin') then
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
      rev_movement := app_private.apply_stock_movement_internal(
        uid,
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

    update public.orders
    set status = 'void',
        voided_by = uid,
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

grant execute on function public.void_orders_for_date(uuid, date, uuid) to authenticated;
