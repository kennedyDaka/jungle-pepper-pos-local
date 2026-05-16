-- Reference seed data only. No users are seeded here because identities
-- should be created through Supabase Auth when the backend is connected.

insert into public.branches (code, name, address, phone)
select 'main', 'Main Branch', 'Kidney Crescent, Blantyre', null
where not exists (select 1 from public.branches where lower(code) = 'main');

insert into public.categories (kind, name, sort_order)
values
  ('inventory', 'Raw ingredients', 1),
  ('inventory', 'Consumables', 2),
  ('inventory', 'Beverages', 3),
  ('menu', 'Pizza', 1),
  ('menu', 'Meals', 2),
  ('menu', 'Drinks', 3)
on conflict do nothing;

insert into public.units (code, name)
values
  ('kg', 'Kilogram'),
  ('g', 'Gram'),
  ('ea', 'Each'),
  ('bottle', 'Bottle'),
  ('ml', 'Millilitre'),
  ('pkt', 'Packet')
on conflict do nothing;

insert into public.suppliers (name)
select 'Local Market'
where not exists (select 1 from public.suppliers where lower(name) = 'local market');

insert into public.suppliers (name)
select 'Beverage Supplier'
where not exists (select 1 from public.suppliers where lower(name) = 'beverage supplier');

insert into public.suppliers (name)
select 'Packaging Supplier'
where not exists (select 1 from public.suppliers where lower(name) = 'packaging supplier');

insert into public.expense_categories (name)
select 'Stock Purchase'
where not exists (select 1 from public.expense_categories where lower(name) = 'stock purchase');

insert into public.expense_categories (name)
select 'Rent'
where not exists (select 1 from public.expense_categories where lower(name) = 'rent');

insert into public.expense_categories (name)
select 'Utilities'
where not exists (select 1 from public.expense_categories where lower(name) = 'utilities');

insert into public.expense_categories (name)
select 'Packaging'
where not exists (select 1 from public.expense_categories where lower(name) = 'packaging');
