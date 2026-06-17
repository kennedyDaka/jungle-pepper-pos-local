-- Add pasta shape modifiers to the `modifiers` table for all active pasta items.
-- This makes pasta shapes consistent with pizza crusts (tracked in order_item_modifiers).
-- Pasta items are identified via the "Pastas" menu category.

insert into public.modifiers (menu_item_id, name, price_delta, active, sort_order, created_at, updated_at)
select mi.id, 'Spaghetti', 0, true, 1, now(), now()
from public.menu_items mi
join public.categories c on c.id = mi.category_id
where lower(c.name) = 'pastas' and mi.active
on conflict do nothing;

insert into public.modifiers (menu_item_id, name, price_delta, active, sort_order, created_at, updated_at)
select mi.id, 'Penne', 0, true, 2, now(), now()
from public.menu_items mi
join public.categories c on c.id = mi.category_id
where lower(c.name) = 'pastas' and mi.active
on conflict do nothing;

insert into public.modifiers (menu_item_id, name, price_delta, active, sort_order, created_at, updated_at)
select mi.id, 'Fettucine', 0, true, 3, now(), now()
from public.menu_items mi
join public.categories c on c.id = mi.category_id
where lower(c.name) = 'pastas' and mi.active
on conflict do nothing;

-- ============================================================
-- Reservations table
-- ============================================================

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete cascade,
  customer_name text not null,
  phone text not null,
  email text,
  reservation_date date not null,
  reservation_time time without time zone not null,
  guests integer not null check (guests > 0 and guests <= 50),
  occasion text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reservations enable row level security;

-- RPC: create_reservation — for anon website customers (security definer)
create or replace function public.create_reservation(
  _customer_name text,
  _phone text,
  _reservation_date date,
  _reservation_time time without time zone,
  _guests integer,
  _email text default null,
  _occasion text default null,
  _notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch_id uuid;
  v_id uuid;
begin
  -- Auto-detect first active branch
  select id into v_branch_id from public.branches where active order by name limit 1;
  if v_branch_id is null then
    raise exception 'No active branch found';
  end if;

  if _reservation_date < current_date then
    raise exception 'Reservation date cannot be in the past';
  end if;

  if _guests < 1 or _guests > 50 then
    raise exception 'Guests must be between 1 and 50';
  end if;

  insert into public.reservations (branch_id, customer_name, phone, email, reservation_date, reservation_time, guests, occasion, notes)
  values (v_branch_id, _customer_name, _phone, _email, _reservation_date, _reservation_time, _guests, _occasion, _notes)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'reservation_date', _reservation_date,
    'reservation_time', _reservation_time
  );
end;
$$;

revoke execute on function public.create_reservation(text, text, date, time without time zone, integer, text, text, text) from anon, authenticated;
grant execute on function public.create_reservation(text, text, date, time without time zone, integer, text, text, text) to anon, authenticated;

-- RPC: get_reservations — for authenticated POS users
create or replace function public.get_reservations(
  _branch_id uuid,
  _status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'customer_name', r.customer_name,
      'phone', r.phone,
      'email', r.email,
      'reservation_date', r.reservation_date,
      'reservation_time', r.reservation_time,
      'guests', r.guests,
      'occasion', r.occasion,
      'notes', r.notes,
      'status', r.status,
      'created_at', r.created_at
    ) order by r.reservation_date desc, r.reservation_time desc
  )
  into v_result
  from public.reservations r
  where r.branch_id = _branch_id
    and (_status is null or r.status = _status);

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke execute on function public.get_reservations(uuid, text) from anon, authenticated;
grant execute on function public.get_reservations(uuid, text) to authenticated;

-- RPC: update_reservation_status — for authenticated POS users to confirm/cancel
create or replace function public.update_reservation_status(
  _reservation_id uuid,
  _new_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if _new_status not in ('pending', 'confirmed', 'cancelled') then
    raise exception 'Invalid status: %', _new_status;
  end if;

  update public.reservations
  set status = _new_status, updated_at = now()
  where id = _reservation_id;

  if not found then
    raise exception 'Reservation not found';
  end if;
end;
$$;

revoke execute on function public.update_reservation_status(uuid, text) from anon, authenticated;
grant execute on function public.update_reservation_status(uuid, text) to authenticated;

-- Add anon select on branches and reservations for health-check queries
drop policy if exists "anon can list active branches" on public.branches;
create policy "anon can list active branches" on public.branches
  for select
  using (active = true);
