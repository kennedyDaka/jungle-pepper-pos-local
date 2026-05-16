-- Tighten RLS policy shape and add missing foreign-key indexes reported by Supabase advisors.

create index if not exists stock_movements_created_by_idx on public.stock_movements (created_by);
create index if not exists orders_voided_by_idx on public.orders (voided_by);
create index if not exists receipts_issued_by_idx on public.receipts (issued_by);
create index if not exists expenses_category_id_idx on public.expenses (category_id);
create index if not exists expenses_created_by_idx on public.expenses (created_by);
create index if not exists expense_stock_lines_stock_movement_id_idx on public.expense_stock_lines (stock_movement_id);
create index if not exists production_batches_created_by_idx on public.production_batches (created_by);
create index if not exists production_inputs_stock_movement_id_idx on public.production_inputs (stock_movement_id);
create index if not exists production_outputs_stock_movement_id_idx on public.production_outputs (stock_movement_id);
create index if not exists production_wastage_stock_movement_id_idx on public.production_wastage (stock_movement_id);

drop policy if exists "user roles bootstrap first admin" on public.user_roles;
drop policy if exists "user roles admin write" on public.user_roles;
drop policy if exists "branches admin write" on public.branches;
drop policy if exists "branch memberships admin write" on public.branch_memberships;
drop policy if exists "categories admin write" on public.categories;
drop policy if exists "units admin write" on public.units;
drop policy if exists "suppliers admin storekeeper write" on public.suppliers;
drop policy if exists "customers admin cashier write" on public.customers;
drop policy if exists "menu items admin write" on public.menu_items;
drop policy if exists "modifiers admin write" on public.modifiers;
drop policy if exists "recipes admin write" on public.recipes;
drop policy if exists "expense categories admin write" on public.expense_categories;

create policy "user roles insert bootstrap or admin"
  on public.user_roles for insert to authenticated
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or (
      role = 'admin'
      and user_id = (select auth.uid())
      and not app_private.has_any_user_role()
    )
  );

create policy "user roles admin update"
  on public.user_roles for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "user roles admin delete"
  on public.user_roles for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "branches admin insert"
  on public.branches for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "branches admin update"
  on public.branches for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "branches admin delete"
  on public.branches for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "branch memberships admin insert"
  on public.branch_memberships for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "branch memberships admin update"
  on public.branch_memberships for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "branch memberships admin delete"
  on public.branch_memberships for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "categories admin insert"
  on public.categories for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "categories admin update"
  on public.categories for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "categories admin delete"
  on public.categories for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "units admin insert"
  on public.units for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "units admin update"
  on public.units for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "units admin delete"
  on public.units for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "suppliers admin storekeeper insert"
  on public.suppliers for insert to authenticated
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  );

create policy "suppliers admin storekeeper update"
  on public.suppliers for update to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  )
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  );

create policy "suppliers admin storekeeper delete"
  on public.suppliers for delete to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'storekeeper')
  );

create policy "customers admin cashier insert"
  on public.customers for insert to authenticated
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'cashier')
  );

create policy "customers admin cashier update"
  on public.customers for update to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'cashier')
  )
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'cashier')
  );

create policy "customers admin cashier delete"
  on public.customers for delete to authenticated
  using (
    app_private.has_role((select auth.uid()), 'admin')
    or app_private.has_role((select auth.uid()), 'cashier')
  );

create policy "menu items admin insert"
  on public.menu_items for insert to authenticated
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "menu items admin update"
  on public.menu_items for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (
    app_private.has_role((select auth.uid()), 'admin')
    and app_private.can_access_branch((select auth.uid()), branch_id)
  );

create policy "menu items admin delete"
  on public.menu_items for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "modifiers admin insert"
  on public.modifiers for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "modifiers admin update"
  on public.modifiers for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "modifiers admin delete"
  on public.modifiers for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "recipes admin insert"
  on public.recipes for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "recipes admin update"
  on public.recipes for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "recipes admin delete"
  on public.recipes for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));

create policy "expense categories admin insert"
  on public.expense_categories for insert to authenticated
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "expense categories admin update"
  on public.expense_categories for update to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'))
  with check (app_private.has_role((select auth.uid()), 'admin'));

create policy "expense categories admin delete"
  on public.expense_categories for delete to authenticated
  using (app_private.has_role((select auth.uid()), 'admin'));
