-- Change order A9A90211-EB4 (ID: 118d61f6-03ef-478d-ba58-654afe17661d) to 001
do $$
begin
  if exists (select 1 from public.orders where lower(physical_order_no) = '001' and id <> '118d61f6-03ef-478d-ba58-654afe17661d') then
    raise notice 'Order number 001 is already taken, skipping';
    return;
  end if;

  update public.orders
  set physical_order_no = '001',
      updated_at = now()
  where id = '118d61f6-03ef-478d-ba58-654afe17661d'
    and physical_order_no = 'A9A90211-EB4';

  if not found then
    raise notice 'Order 118d61f6-... not found or already changed';
  else
    raise notice 'Order updated to 001';
  end if;
end;
$$;
