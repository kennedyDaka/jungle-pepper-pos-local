-- Service-role-only helper used by the bootstrap-first-admin Edge Function.
-- The advisory lock prevents two first-admin setup requests from winning at once.

create or replace function public.bootstrap_first_admin(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _user_id is null then
    raise exception 'User id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('jungle_pepper_bootstrap_first_admin'));

  if exists (select 1 from public.user_roles) then
    raise exception 'First admin has already been created';
  end if;

  insert into public.user_roles (user_id, role)
  values (_user_id, 'admin');
end;
$$;

revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;
