-- Void all paid orders for 18 June 2026 at Main Branch
-- Reverses stock movements (adjustment +qty) and marks orders as void

do $$
declare
  rec record;
  mov record;
  v_admin_id uuid := 'debb9f0d-511b-44b1-933a-afe61d705d3b';
  v_branch_id uuid := '3c5f90ca-61f8-4556-a216-2fcf7df9390a';
  v_target_date date := '2026-06-18';
  rev_movement public.stock_movements;
  voided_count int := 0;
begin
  for rec in
    select o.id, o.branch_id
    from public.orders o
    where o.branch_id = v_branch_id
      and o.status = 'paid'
      and o.created_at::date = v_target_date
    order by o.created_at
  loop
    for mov in
      select sm.item_id, sm.qty
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
        v_admin_id,
        mov.item_id,
        'adjustment',
        abs(mov.qty),
        0,
        'Void reversal for order ' || rec.id::text,
        rec.branch_id,
        'void',
        rec.id
      );
    end loop;

    update public.orders
    set status = 'void',
        voided_by = v_admin_id,
        voided_at = now()
    where id = rec.id;

    voided_count := voided_count + 1;
  end loop;

  raise notice 'Voided % paid orders for %', voided_count, v_target_date;
end;
$$;
