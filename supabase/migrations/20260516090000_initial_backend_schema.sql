-- Jungle Pepper POS live Supabase backend schema.
-- Creates the public tables, relationships, constraints, indexes, auth profile trigger, and Data API grants required by the frontend services.

create extension if not exists pgcrypto;

create schema if not exists app_private;

drop event trigger if exists ensure_rls;
drop function if exists public.rls_auto_enable();

create type public.app_role as enum ('admin', 'cashier', 'storekeeper');
create type public.category_kind as enum ('menu', 'inventory');
create type public.stock_type as enum ('raw', 'production', 'consumable', 'beverage');
create type public.stock_movement_type as enum (
  'purchase_in',
  'adjustment',
  'sale',
  'production_in',
  'production_out',
  'wastage'
);
create type public.payment_method as enum ('cash', 'airtel_money', 'mpamba', 'bank_card');
create type public.order_status as enum ('paid', 'void');
create type public.receipt_channel as enum ('screen', 'print', 'pdf', 'email');

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  full_name text not null default '',
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,40}$'),
  constraint profiles_email_not_blank check (length(btrim(email)) > 0)
);

create unique index profiles_username_unique_ci on public.profiles (lower(username));
create unique index profiles_email_unique_ci on public.profiles (lower(email));

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_username text;
  safe_username text;
begin
  base_username := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(split_part(new.email, '@', 1), ''),
    'user'
  );
  safe_username := lower(regexp_replace(base_username, '[^a-z0-9._-]+', '-', 'g'));
  safe_username := left(trim(both '-' from safe_username), 30);

  if length(safe_username) < 3 then
    safe_username := 'user';
  end if;

  insert into public.profiles (id, username, full_name, email)
  values (
    new.id,
    safe_username || '-' || left(new.id::text, 8),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), new.email, 'New user'),
    coalesce(new.email, new.id::text || '@auth.local')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_auth_user();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  address text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_code_format check (code ~ '^[a-z0-9-]{2,40}$'),
  constraint branches_name_not_blank check (length(btrim(name)) > 0)
);

create unique index branches_code_unique_ci on public.branches (lower(code));

create table public.branch_memberships (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (branch_id, user_id)
);

create unique index branch_memberships_one_default_per_user
  on public.branch_memberships (user_id)
  where is_default and active;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  kind public.category_kind not null,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0)
);

create unique index categories_kind_name_unique_ci on public.categories (kind, lower(name));

create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_code_format check (code ~ '^[a-z0-9_/-]{1,20}$'),
  constraint units_name_not_blank check (length(btrim(name)) > 0)
);

create unique index units_code_unique_ci on public.units (lower(code));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank check (length(btrim(name)) > 0)
);

create unique index suppliers_name_unique_ci on public.suppliers (lower(name)) where active;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (length(btrim(name)) > 0)
);

create unique index customers_phone_unique on public.customers (phone) where phone is not null;
create unique index customers_email_unique_ci on public.customers (lower(email)) where email is not null;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  name text not null,
  stock_type public.stock_type not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  qty_on_hand numeric(14, 3) not null default 0,
  avg_cost numeric(14, 2) not null default 0,
  reorder_level numeric(14, 3) not null default 0,
  bottle_ml numeric(10, 3),
  shot_ml numeric(10, 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_name_not_blank check (length(btrim(name)) > 0),
  constraint items_non_negative_cost check (avg_cost >= 0),
  constraint items_non_negative_reorder check (reorder_level >= 0),
  constraint items_beverage_volume check (
    stock_type <> 'beverage'
    or (
      (bottle_ml is null or bottle_ml > 0)
      and (shot_ml is null or shot_ml > 0)
    )
  )
);

create unique index items_branch_name_unique_ci
  on public.items (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where active;

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  type public.stock_movement_type not null,
  qty numeric(14, 3) not null,
  unit_cost numeric(14, 2) not null default 0,
  qty_before numeric(14, 3),
  qty_after numeric(14, 3),
  note text,
  ref_type text,
  ref_id uuid,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint stock_movements_qty_not_zero check (qty <> 0),
  constraint stock_movements_non_negative_cost check (unit_cost >= 0)
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text,
  price numeric(14, 2) not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_items_name_not_blank check (length(btrim(name)) > 0),
  constraint menu_items_non_negative_price check (price >= 0)
);

create unique index menu_items_branch_name_unique_ci
  on public.menu_items (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where active;

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  price_delta numeric(14, 2) not null default 0,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modifiers_name_not_blank check (length(btrim(name)) > 0)
);

create unique index modifiers_menu_name_unique_ci
  on public.modifiers (menu_item_id, lower(name))
  where active;

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  qty numeric(14, 3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_positive_qty check (qty > 0),
  unique (menu_item_id, item_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  subtotal numeric(14, 2) not null,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,
  status public.order_status not null default 'paid',
  note text,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_non_negative_money check (subtotal >= 0 and discount >= 0 and total >= 0),
  constraint orders_void_fields check (
    (status = 'void' and voided_at is not null)
    or (status = 'paid' and voided_at is null)
  )
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  qty numeric(14, 3) not null,
  unit_price numeric(14, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  constraint order_items_positive_qty check (qty > 0),
  constraint order_items_non_negative_price check (unit_price >= 0)
);

create table public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  modifier_id uuid not null references public.modifiers(id) on delete restrict,
  price_delta numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (order_item_id, modifier_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method public.payment_method not null,
  amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  constraint payments_positive_amount check (amount > 0)
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  receipt_no text not null,
  channel public.receipt_channel not null default 'screen',
  storage_path text,
  issued_by uuid references public.profiles(id) on delete set null default auth.uid(),
  issued_at timestamptz not null default now(),
  constraint receipts_receipt_no_not_blank check (length(btrim(receipt_no)) > 0)
);

create unique index receipts_receipt_no_unique_ci on public.receipts (lower(receipt_no));

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_name_not_blank check (length(btrim(name)) > 0)
);

create unique index expense_categories_name_unique_ci
  on public.expense_categories (lower(name))
  where active;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  ref_no text not null,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  amount numeric(14, 2) not null,
  payment_method public.payment_method not null,
  description text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  expense_date date not null default current_date,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_ref_no_not_blank check (length(btrim(ref_no)) > 0),
  constraint expenses_positive_amount check (amount > 0)
);

create unique index expenses_ref_no_unique_ci on public.expenses (lower(ref_no));

create table public.expense_stock_lines (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  stock_movement_id uuid references public.stock_movements(id) on delete set null,
  qty numeric(14, 3) not null,
  unit_cost numeric(14, 2) not null,
  line_total numeric(14, 2) generated always as (qty * unit_cost) stored,
  created_at timestamptz not null default now(),
  constraint expense_stock_lines_positive_qty check (qty > 0),
  constraint expense_stock_lines_non_negative_cost check (unit_cost >= 0)
);

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete restrict,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.production_inputs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  stock_movement_id uuid references public.stock_movements(id) on delete set null,
  qty numeric(14, 3) not null,
  qty_count numeric(14, 3),
  weight_kg numeric(14, 3),
  unit_cost numeric(14, 2),
  created_at timestamptz not null default now(),
  constraint production_inputs_positive_qty check (qty > 0)
);

create table public.production_outputs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  stock_movement_id uuid references public.stock_movements(id) on delete set null,
  qty numeric(14, 3) not null,
  qty_count numeric(14, 3),
  weight_kg numeric(14, 3),
  unit_cost numeric(14, 2),
  created_at timestamptz not null default now(),
  constraint production_outputs_positive_qty check (qty > 0)
);

create table public.production_wastage (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  stock_movement_id uuid references public.stock_movements(id) on delete set null,
  qty numeric(14, 3) not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint production_wastage_positive_qty check (qty > 0),
  constraint production_wastage_reason_not_blank check (length(btrim(reason)) > 0)
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app_private.touch_updated_at();

create trigger branches_touch_updated_at
  before update on public.branches
  for each row execute function app_private.touch_updated_at();

create trigger categories_touch_updated_at
  before update on public.categories
  for each row execute function app_private.touch_updated_at();

create trigger units_touch_updated_at
  before update on public.units
  for each row execute function app_private.touch_updated_at();

create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row execute function app_private.touch_updated_at();

create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function app_private.touch_updated_at();

create trigger items_touch_updated_at
  before update on public.items
  for each row execute function app_private.touch_updated_at();

create trigger menu_items_touch_updated_at
  before update on public.menu_items
  for each row execute function app_private.touch_updated_at();

create trigger modifiers_touch_updated_at
  before update on public.modifiers
  for each row execute function app_private.touch_updated_at();

create trigger recipes_touch_updated_at
  before update on public.recipes
  for each row execute function app_private.touch_updated_at();

create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function app_private.touch_updated_at();

create trigger expense_categories_touch_updated_at
  before update on public.expense_categories
  for each row execute function app_private.touch_updated_at();

create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function app_private.touch_updated_at();

create trigger production_batches_touch_updated_at
  before update on public.production_batches
  for each row execute function app_private.touch_updated_at();

create index user_roles_user_id_idx on public.user_roles (user_id);
create index branch_memberships_user_id_idx on public.branch_memberships (user_id);
create index categories_kind_sort_idx on public.categories (kind, active, sort_order);
create index items_branch_active_category_idx on public.items (branch_id, active, category_id);
create index items_category_id_idx on public.items (category_id);
create index items_unit_id_idx on public.items (unit_id);
create index items_supplier_id_idx on public.items (supplier_id);
create index stock_movements_item_created_idx on public.stock_movements (item_id, created_at desc);
create index stock_movements_branch_created_idx on public.stock_movements (branch_id, created_at desc);
create index stock_movements_ref_idx on public.stock_movements (ref_type, ref_id);
create index menu_items_branch_active_sort_idx on public.menu_items (branch_id, active, category_id, sort_order);
create index menu_items_category_id_idx on public.menu_items (category_id);
create index modifiers_menu_item_id_idx on public.modifiers (menu_item_id);
create index recipes_menu_item_id_idx on public.recipes (menu_item_id);
create index recipes_item_id_idx on public.recipes (item_id);
create index orders_created_status_idx on public.orders (created_at desc, status);
create index orders_cashier_created_idx on public.orders (cashier_id, created_at desc);
create index orders_branch_created_idx on public.orders (branch_id, created_at desc);
create index orders_customer_created_idx on public.orders (customer_id, created_at desc) where customer_id is not null;
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_menu_item_id_idx on public.order_items (menu_item_id);
create index order_item_modifiers_order_item_id_idx on public.order_item_modifiers (order_item_id);
create index order_item_modifiers_modifier_id_idx on public.order_item_modifiers (modifier_id);
create index payments_order_id_idx on public.payments (order_id);
create index receipts_order_id_idx on public.receipts (order_id);
create index expenses_date_category_idx on public.expenses (expense_date desc, category_id);
create index expenses_branch_date_idx on public.expenses (branch_id, expense_date desc);
create index expenses_supplier_id_idx on public.expenses (supplier_id) where supplier_id is not null;
create index expense_stock_lines_expense_id_idx on public.expense_stock_lines (expense_id);
create index expense_stock_lines_item_id_idx on public.expense_stock_lines (item_id);
create index production_batches_created_idx on public.production_batches (created_at desc);
create index production_batches_branch_created_idx on public.production_batches (branch_id, created_at desc);
create index production_inputs_batch_id_idx on public.production_inputs (batch_id);
create index production_inputs_item_id_idx on public.production_inputs (item_id);
create index production_outputs_batch_id_idx on public.production_outputs (batch_id);
create index production_outputs_item_id_idx on public.production_outputs (item_id);
create index production_wastage_batch_id_idx on public.production_wastage (batch_id);
create index production_wastage_item_id_idx on public.production_wastage (item_id);

grant usage on schema public to authenticated;
grant usage on schema app_private to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- Stock movements are an audit ledger. Mutations should go through checked RPCs.
revoke insert, update, delete on public.stock_movements from authenticated;

revoke all on function app_private.touch_updated_at() from public, anon, authenticated;
revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;
