-- Deactivate orphan items replaced by their active equivalents
-- PREGOS/BITOQUES (80G)  →  SLICED 120G
-- BREAD BURGER PKTS      →  BURGER BUNS

update public.items
set active = false,
    updated_at = now()
where name in ('PREGOS/BITOQUES (80G)', 'BREAD BURGER PKTS')
  and active;
