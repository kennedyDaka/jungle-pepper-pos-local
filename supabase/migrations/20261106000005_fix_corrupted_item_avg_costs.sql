-- Fix corrupted item avg costs (applied live 2026-11-06)
-- Root cause: PRAWN 800g (g) had a corrupted per-gram purchase cost (65372.50/g)
-- which poisoned production output costs (e.g., CAMARAO PASTA). Corrected to recent rate.
-- Also recompute production outputs from most recent batch raw material costs.

-- 1) Fix corrupted raw material
UPDATE public.items SET avg_cost = 54.75, updated_at = now()
WHERE id = '250bf374-a4c0-4b8b-8935-7ad5a3ffa740' AND name = 'PRAWN 800g';

-- 2) Recompute production output avg_cost from latest batch (raw material cost)
WITH latest_batch AS (
  SELECT DISTINCT ON (po.item_id) po.item_id, po.batch_id
  FROM public.production_outputs po
  JOIN public.production_batches pb ON pb.id = po.batch_id
  JOIN public.items i ON i.id = po.item_id
  WHERE i.active = true
  ORDER BY po.item_id, pb.created_at DESC
),
input_cost AS (
  SELECT lb.item_id, lb.batch_id,
    COALESCE(SUM(pi.qty * GREATEST(COALESCE(ii.avg_cost, 0), 0)), 0) as total_in,
    (SELECT COALESCE(SUM(po2.qty), 0) FROM public.production_outputs po2 WHERE po2.batch_id = lb.batch_id) as total_out
  FROM latest_batch lb
  JOIN public.production_inputs pi ON pi.batch_id = lb.batch_id
  JOIN public.items ii ON ii.id = pi.item_id
  GROUP BY lb.item_id, lb.batch_id
),
new_cost AS (
  SELECT item_id,
    CASE WHEN total_out > 0 THEN ROUND((total_in / total_out)::numeric, 2) ELSE 0 END as cost
  FROM input_cost
)
UPDATE public.items i SET avg_cost = GREATEST(nc.cost, 0), updated_at = now()
FROM new_cost nc
WHERE i.id = nc.item_id AND i.active = true;
