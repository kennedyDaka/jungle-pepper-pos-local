create index if not exists stock_movements_created_at_idx
  on public.stock_movements (created_at desc);

create index if not exists stock_movements_type_created_at_idx
  on public.stock_movements (type, created_at desc);

create index if not exists orders_status_created_at_idx
  on public.orders (status, created_at desc);

create index if not exists orders_status_branch_created_at_idx
  on public.orders (status, branch_id, created_at desc);
