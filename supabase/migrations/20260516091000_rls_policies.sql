-- RLS and role helpers for the future Supabase backend.
-- Authorization uses public.user_roles, not user-editable auth metadata.

create or replace function app_private.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = _user_id
      and ur.role = _role
      and p.active
  );
$$;

create or replace function app_private.is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = _user_id
      and ur.role in ('admin', 'cashier', 'storekeeper')
      and p.active
  );
$$;

create or replace function app_private.has_any_user_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles);
$$;

create or replace function app_private.can_access_branch(_user_id uuid, _branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    _branch_id is null
    or app_private.has_role(_user_id, 'admin')
    or exists (
      select 1
      from public.branch_memberships bm
      join public.profiles p on p.id = bm.user_id
      where bm.user_id = _user_id
        and bm.branch_id = _branch_id
        and bm.active
        and p.active
    );
$$;

revoke all on function app_private.has_role(uuid, public.app_role) from public, anon;
revoke all on function app_private.is_staff(uuid) from public, anon;
revoke all on function app_private.has_any_user_role() from public, anon;
revoke all on function app_private.can_access_branch(uuid, uuid) from public, anon;
grant execute on function app_private.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function app_private.is_staff(uuid) to authenticated, service_role;
grant execute on function app_private.has_any_user_role() to authenticated, service_role;
grant execute on function app_private.can_access_branch(uuid, uuid) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.branches enable row level security;
alter table public.branch_memberships enable row level security;
alter table public.categories enable row level security;
alter table public.units enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.menu_items enable row level security;
alter table public.modifiers enable row level security;
alter table public.recipes enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_stock_lines enable row level security;
alter table public.production_batches enable row level security;
alter table public.production_inputs enable row level security;
alter table public.production_outputs enable row level security;
alter table public.production_wastage enable row level security;

create policy "profiles select self or admin"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or app_private.has_role((select auth.uid()), 'admin'));

create policy "profiles admin insert"
  on public.profiles for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "profiles admin update"
  on public.profiles for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "user roles select own or admin"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or app_private.has_role((select auth.uid()), 'admin'));

create policy "user roles bootstrap first admin"
  on public.user_roles for insert to authenticated
  with check (
    role = 'admin'
    and user_id = (select auth.uid())
    and not app_private.has_any_user_role()
  );

create policy "user roles admin write"
  on public.user_roles for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "branches staff read"
  on public.branches for select to authenticated
  using (active and app_private.is_staff((select auth.uid())));

create policy "branches admin write"
  on public.branches for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "branch memberships select own or admin"
  on public.branch_memberships for select to authenticated
  using (user_id = (select auth.uid()) or app_private.has_role((select auth.uid()), 'admin'));

create policy "branch memberships admin write"
  on public.branch_memberships for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "categories staff read"
  on public.categories for select to authenticated
  using (active and app_private.is_staff((select auth.uid())));

create policy "categories admin write"
  on public.categories for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "units staff read"
  on public.units for select to authenticated
  using (app_private.is_staff((select auth.uid())));

create policy "units admin write"
  on public.units for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "suppliers staff read"
  on public.suppliers for select to authenticated
  using (active and app_private.is_staff((select auth.uid())));

create policy "suppliers admin storekeeper write"
  on public.suppliers for all to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  )
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  );

create policy "customers staff read"
  on public.customers for select to authenticated
  using (active and app_private.is_staff((select auth.uid())));

create policy "customers admin cashier write"
  on public.customers for all to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'cashier')
  )
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'cashier')
  );

create policy "items staff read"
  on public.items for select to authenticated
  using (
    active
    and app_private.is_staff((select auth.uid()))
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "items admin storekeeper insert"
  on public.items for insert to authenticated
  with check (
    (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "items admin storekeeper update"
  on public.items for update to authenticated
  using (
    (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  )
  with check (
    (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "items admin delete"
  on public.items for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "stock movements admin storekeeper read"
  on public.stock_movements for select to authenticated
  using (
    (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "stock movements staff insert"
  on public.stock_movements for insert to authenticated
  with check (
    (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
      or (type = 'sale' and app_private.has_role((select auth.uid()), 'cashier'))
    )
    and created_by = (select auth.uid())
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "menu items staff read"
  on public.menu_items for select to authenticated
  using (
    active
    and app_private.is_staff((select auth.uid()))
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "menu items admin write"
  on public.menu_items for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "modifiers staff read"
  on public.modifiers for select to authenticated
  using (
    active
    and app_private.is_staff((select auth.uid()))
    and exists (
      select 1 from public.menu_items mi
      where mi.id = menu_item_id
        and app_private.can_access_branch((select auth.uid()), mi.branch_id)
    )
  );

create policy "modifiers admin write"
  on public.modifiers for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "recipes staff read"
  on public.recipes for select to authenticated
  using (
    app_private.is_staff((select auth.uid()))
    and exists (
      select 1 from public.menu_items mi
      where mi.id = menu_item_id
        and app_private.can_access_branch((select auth.uid()), mi.branch_id)
    )
  );

create policy "recipes admin write"
  on public.recipes for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "orders role based read"
  on public.orders for select to authenticated
  using (
    app_private.can_access_branch((select auth.uid()), branch_id)
    and (
      cashier_id = (select auth.uid())
      or app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
  );

create policy "orders admin cashier insert"
  on public.orders for insert to authenticated
  with check (
    cashier_id = (select auth.uid())
    and (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'cashier')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "orders admin update"
  on public.orders for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "order items parent order read"
  on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy "order items parent order insert"
  on public.order_items for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.cashier_id = (select auth.uid())
        and (
          app_private.has_role((select auth.uid()), 'admin')
          or app_private.has_role((select auth.uid()), 'cashier')
        )
    )
  );

create policy "order item modifiers parent order read"
  on public.order_item_modifiers for select to authenticated
  using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
    )
  );

create policy "order item modifiers parent order insert"
  on public.order_item_modifiers for insert to authenticated
  with check (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and o.cashier_id = (select auth.uid())
        and (
          app_private.has_role((select auth.uid()), 'admin')
          or app_private.has_role((select auth.uid()), 'cashier')
        )
    )
  );

create policy "payments parent order read"
  on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy "payments parent order insert"
  on public.payments for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.cashier_id = (select auth.uid())
        and (
          app_private.has_role((select auth.uid()), 'admin')
          or app_private.has_role((select auth.uid()), 'cashier')
        )
    )
  );

create policy "receipts parent order read"
  on public.receipts for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy "receipts parent order insert"
  on public.receipts for insert to authenticated
  with check (
    issued_by = (select auth.uid())
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.cashier_id = (select auth.uid())
          or app_private.has_role((select auth.uid()), 'admin')
        )
    )
  );

create policy "expense categories staff read"
  on public.expense_categories for select to authenticated
  using (active and app_private.is_staff((select auth.uid())));

create policy "expense categories admin write"
  on public.expense_categories for all to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "expenses admin storekeeper read"
  on public.expenses for select to authenticated
  using (
    (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "expenses admin storekeeper insert"
  on public.expenses for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "expenses admin storekeeper update"
  on public.expenses for update to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  )
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  );

create policy "expense stock lines parent expense read"
  on public.expense_stock_lines for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));

create policy "expense stock lines parent expense insert"
  on public.expense_stock_lines for insert to authenticated
  with check (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id
        and e.created_by = (select auth.uid())
    )
  );

create policy "production batches admin storekeeper read"
  on public.production_batches for select to authenticated
  using (
    (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "production batches admin storekeeper insert"
  on public.production_batches for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      app_private.has_role((select auth.uid()), 'admin')
      or app_private.has_role((select auth.uid()), 'storekeeper')
    )
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "production batches admin storekeeper update"
  on public.production_batches for update to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  )
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  );

create policy "production inputs parent batch read"
  on public.production_inputs for select to authenticated
  using (exists (select 1 from public.production_batches b where b.id = batch_id));

create policy "production inputs parent batch insert"
  on public.production_inputs for insert to authenticated
  with check (exists (select 1 from public.production_batches b where b.id = batch_id and b.created_by = (select auth.uid())));

create policy "production outputs parent batch read"
  on public.production_outputs for select to authenticated
  using (exists (select 1 from public.production_batches b where b.id = batch_id));

create policy "production outputs parent batch insert"
  on public.production_outputs for insert to authenticated
  with check (exists (select 1 from public.production_batches b where b.id = batch_id and b.created_by = (select auth.uid())));

create policy "production wastage parent batch read"
  on public.production_wastage for select to authenticated
  using (exists (select 1 from public.production_batches b where b.id = batch_id));

create policy "production wastage parent batch insert"
  on public.production_wastage for insert to authenticated
  with check (exists (select 1 from public.production_batches b where b.id = batch_id and b.created_by = (select auth.uid())));
