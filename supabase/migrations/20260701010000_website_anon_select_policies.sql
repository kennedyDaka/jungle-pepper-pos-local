-- Website public read policies: anon users can read active categories,
-- menu_items, and modifiers (needed for the customer-facing menu).

grant select on public.categories to anon;

create policy "categories anon read"
  on public.categories
  for select
  to anon
  using (active = true);

grant select on public.menu_items to anon;

create policy "menu items anon read"
  on public.menu_items
  for select
  to anon
  using (active = true);

grant select on public.modifiers to anon;

create policy "modifiers anon read"
  on public.modifiers
  for select
  to anon
  using (active = true);
