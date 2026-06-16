-- Add waiter_pin column to branches and create verify_branch_pin RPC

alter table public.branches
add column waiter_pin text;

-- Default PIN for existing branches
update public.branches set waiter_pin = '1234' where waiter_pin is null and active = true;

create or replace function public.verify_branch_pin(
  _branch_id uuid,
  _pin text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored_pin text;
begin
  select waiter_pin into stored_pin from public.branches where id = _branch_id;
  if not found then
    return false;
  end if;
  return stored_pin = _pin;
end;
$$;

grant execute on function public.verify_branch_pin(uuid, text) to anon, authenticated;

-- Grant anon access to branches for the waiter page to discover branch
grant usage on schema public to anon;
grant select on public.branches to anon;
