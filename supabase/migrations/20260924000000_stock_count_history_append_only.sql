-- ============================================================
-- Stock count history (append-only) + frozen expected/variance
-- ============================================================
-- Problem:
--   stock_counts was upserted on (branch_id, item_id, count_date):
--   re-counting a date silently overwrote the earlier physical figure,
--   so the past (expected vs counted vs variance) was erased.
--
-- Fix:
--   1. Add expected_qty (system/book quantity at count time) and
--      variance (qty - expected_qty) columns, backfilling existing
--      rows from the adjustment movement created at count time.
--   2. Drop the per-day unique constraint so every count is appended
--      as an immutable revision. The latest revision is the current one.
--   3. Rewrite save_stock_counts to append revisions and freeze the
--      expected/variance snapshot on each row.
--   4. Add a SECURITY DEFINER RPC that returns the count history
--      timeline (with the counter's name) so any authenticated user
--      can view it without profiles RLS blocking non-admins.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Schema: new columns + append-only
-- ------------------------------------------------------------
ALTER TABLE public.stock_counts
  ADD COLUMN IF NOT EXISTS expected_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS variance NUMERIC;

-- Backfill from the adjustment movement that v3/v4 created at count time:
-- qty_before = qty_on_hand at count time (= expected), qty_after = counted.
UPDATE public.stock_counts sc
SET
  expected_qty = COALESCE(m.qty_before, sc.qty),
  variance     = sc.qty - COALESCE(m.qty_before, sc.qty)
FROM public.stock_movements m
WHERE m.ref_type = 'stock_count'
  AND m.type = 'adjustment'
  AND m.item_id  = sc.item_id
  AND m.branch_id = sc.branch_id
  AND (m.created_at AT TIME ZONE 'Africa/Maputo')::date = sc.count_date;

-- Rows with no adjustment movement (count matched the book) default to zero variance.
UPDATE public.stock_counts
SET expected_qty = COALESCE(expected_qty, qty),
    variance     = COALESCE(variance, 0)
WHERE expected_qty IS NULL OR variance IS NULL;

ALTER TABLE public.stock_counts
  ALTER COLUMN expected_qty SET NOT NULL,
  ALTER COLUMN variance SET NOT NULL;

-- Append-only: remove the one-count-per-day constraint.
ALTER TABLE public.stock_counts
  DROP CONSTRAINT IF EXISTS stock_counts_unique_per_day;

-- Help lookups of the latest revision per date.
CREATE INDEX IF NOT EXISTS idx_stock_counts_item_date_created
  ON public.stock_counts (item_id, count_date, created_at DESC);

-- ------------------------------------------------------------
-- 2. RPCs: opening/closing must pick the LATEST revision when a
--    date has been counted more than once.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_opening_qty(
  _item_id UUID,
  _branch_id UUID,
  _date DATE
)
RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (SELECT qty
     FROM public.stock_counts
     WHERE item_id = _item_id
       AND branch_id = _branch_id
       AND count_date < _date
     ORDER BY count_date DESC, created_at DESC
     LIMIT 1),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.get_closing_qty(
  _item_id UUID,
  _branch_id UUID,
  _date DATE
)
RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (SELECT qty
     FROM public.stock_counts
     WHERE item_id = _item_id
       AND branch_id = _branch_id
       AND count_date = _date
     ORDER BY count_date DESC, created_at DESC
     LIMIT 1),
    NULL
  );
$$;

-- ------------------------------------------------------------
-- 3. save_stock_counts v4: append revision, freeze expected/variance
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_stock_counts(
  _branch_id UUID,
  _count_date DATE,
  _counts JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  _item JSONB;
  _item_id UUID;
  _qty NUMERIC;
  _notes TEXT;
  _expected NUMERIC;
  _difference NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_counts)
  LOOP
    _item_id := (_item->>'item_id')::UUID;
    _qty     := (_item->>'qty')::NUMERIC;
    _notes   := _item->>'notes';

    -- Expected = the system/book quantity at the moment of counting.
    SELECT COALESCE(qty_on_hand, 0) INTO _expected
    FROM public.items
    WHERE id = _item_id;

    _difference := _qty - _expected;

    -- Append an immutable revision (history is never overwritten).
    INSERT INTO public.stock_counts (
      branch_id, item_id, count_date, qty, expected_qty, variance,
      counted_by, notes
    )
    VALUES (
      _branch_id, _item_id, _count_date, _qty, _expected, _difference,
      auth.uid(), _notes
    );

    -- Keep the movement ledger at ONE net adjustment per item per date so
    -- the flash report / bin cards stay correct; the raw revision history
    -- lives in stock_counts above.
    IF ABS(_difference) > 0.0001 THEN
      DELETE FROM public.stock_movements
      WHERE item_id = _item_id
        AND branch_id = _branch_id
        AND type = 'adjustment'
        AND ref_type = 'stock_count'
        AND (created_at AT TIME ZONE 'Africa/Maputo')::date = _count_date;

      INSERT INTO public.stock_movements (
        branch_id, item_id, type, qty, unit_cost,
        qty_before, qty_after, note, ref_type, created_by
      )
      VALUES (
        _branch_id, _item_id, 'adjustment', _difference, 0,
        _expected, _qty,
        COALESCE(_notes, 'Stock count adjustment'),
        'stock_count',
        auth.uid()
      );
    END IF;

    -- Update the running system quantity to match the physical count.
    UPDATE public.items
    SET qty_on_hand = _qty,
        updated_at = now()
    WHERE id = _item_id;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.save_stock_counts(JSONB, DATE);

GRANT EXECUTE ON FUNCTION public.save_stock_counts(UUID, DATE, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- 4. Count history timeline RPC (SECURITY DEFINER so profiles RLS
--    never hides a counter's name from other staff)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_item_count_history(
  _branch_id UUID,
  _item_id UUID
)
RETURNS TABLE (
  id UUID,
  count_date DATE,
  qty NUMERIC,
  expected_qty NUMERIC,
  variance NUMERIC,
  notes TEXT,
  counted_by UUID,
  counter_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    sc.id,
    sc.count_date,
    sc.qty,
    sc.expected_qty,
    sc.variance,
    sc.notes,
    sc.counted_by,
    COALESCE(p.full_name, p.username, 'Unknown') AS counter_name,
    sc.created_at
  FROM public.stock_counts sc
  LEFT JOIN public.profiles p ON p.id = sc.counted_by
  WHERE sc.branch_id = _branch_id
    AND sc.item_id = _item_id
  ORDER BY sc.count_date ASC, sc.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_item_count_history(UUID, UUID) TO authenticated;

-- Realtime for stock_counts stays enabled (already in enable_realtime migration).