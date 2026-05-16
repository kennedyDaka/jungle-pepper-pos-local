-- Register app tables with the Supabase Realtime publication.
-- The frontend subscribes to postgres_changes and invalidates cached queries when these tables change.

do $$
declare
  app_table text;
  app_tables text[] := array[
    'profiles',
    'user_roles',
    'branches',
    'branch_memberships',
    'categories',
    'units',
    'suppliers',
    'customers',
    'items',
    'stock_movements',
    'menu_items',
    'modifiers',
    'recipes',
    'orders',
    'order_items',
    'order_item_modifiers',
    'payments',
    'receipts',
    'expense_categories',
    'expenses',
    'expense_stock_lines',
    'production_batches',
    'production_inputs',
    'production_outputs',
    'production_wastage'
  ];
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    return;
  end if;

  foreach app_table in array app_tables loop
    if to_regclass(format('public.%I', app_table)) is not null
      and not exists (
        select 1
        from pg_publication publication
        join pg_publication_rel publication_rel
          on publication_rel.prpubid = publication.oid
        join pg_class class
          on class.oid = publication_rel.prrelid
        join pg_namespace namespace
          on namespace.oid = class.relnamespace
        where publication.pubname = 'supabase_realtime'
          and namespace.nspname = 'public'
          and class.relname = app_table
      ) then
      execute format('alter publication supabase_realtime add table public.%I', app_table);
    end if;
  end loop;
end;
$$;
