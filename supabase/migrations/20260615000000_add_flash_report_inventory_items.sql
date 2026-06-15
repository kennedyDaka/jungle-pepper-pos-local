-- Add inventory items needed by the Flash Report
-- SAUCE FRANGO and SAUCE CAMARAO (production sauces, produced in-house)

create temp table flash_items (
  name text primary key,
  stock_type public.stock_type not null,
  category_name text not null,
  unit_code text not null
) on commit drop;

insert into flash_items (name, stock_type, category_name, unit_code)
values
  ('SAUCE FRANGO', 'production', 'Produced prep', 'kg'),
  ('SAUCE CAMARAO', 'production', 'Produced prep', 'kg');

insert into public.items (name, stock_type, category_id, unit_id, active)
select
  f.name,
  f.stock_type,
  c.id,
  u.id,
  true
from flash_items f
join public.categories c on c.kind = 'inventory' and lower(c.name) = lower(f.category_name)
join public.units u on lower(u.code) = lower(f.unit_code)
where not exists (
  select 1 from public.items i
  where i.active and lower(i.name) = lower(f.name)
);
