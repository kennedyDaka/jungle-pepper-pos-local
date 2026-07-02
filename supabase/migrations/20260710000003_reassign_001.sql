-- Reassign old 001 to 001A, then set A9A90211-EB4 to 001
do $$
begin
  update public.orders
  set physical_order_no = '001A',
      updated_at = now()
  where id = '7f6708d3-f5c6-4a3b-9b6d-48ef1c5fefa9'
    and physical_order_no = '001';

  if not found then
    raise notice 'Old order 7f6708d3 already changed';
  else
    raise notice 'Old 001 reassigned to 001A';
  end if;

  update public.orders
  set physical_order_no = '001',
      updated_at = now()
  where id = '118d61f6-03ef-478d-ba58-654afe17661d'
    and physical_order_no = 'A9A90211-EB4';

  if not found then
    raise notice 'Order 118d61f6 already changed or not found';
  else
    raise notice 'Order A9A90211-EB4 updated to 001';
  end if;
end;
$$;
