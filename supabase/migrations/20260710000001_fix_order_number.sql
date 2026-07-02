-- Change order A9A90211-EB4 to sequential number 001
-- The order was placed on 02/07/2026 by kennedydaka93@gmail.com
-- and includes Focaccia and Cheese + Portuguese Chicken Pizza
do $$
declare
  target_id uuid;
begin
  select id into target_id
  from public.orders
  where id::text like 'a9a90211-eb4%'
    and created_at >= '2026-07-02'::date
    and created_at < '2026-07-03'::date
  order by created_at desc
  limit 1;

  if not found then
    raise notice 'Order with prefix a9a90211-eb4 not found on 2026-07-02';
    return;
  end if;

  if exists (select 1 from public.orders where lower(physical_order_no) = '001' and id <> target_id) then
    raise notice 'Order number 001 is already taken, skipping';
    return;
  end if;

  update public.orders
  set physical_order_no = '001',
      updated_at = now()
  where id = target_id;

  raise notice 'Order % updated to 001', target_id;
end;
$$;
