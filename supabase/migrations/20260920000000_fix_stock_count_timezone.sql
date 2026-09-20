-- ============================================================
-- Fix: 'time zone "CAT" not recognized' when saving a stock count
-- whose figure differs from the system figure.
--
-- Root cause:
--   The live save_stock_counts(_branch_id, _count_date, _counts) had
--   been edited directly in the SQL editor to delete the previous
--   adjustment movement with:
--
--       DATE(created_at AT TIME ZONE 'CAT') = _count_date
--
--   "CAT" is a Windows/CLDR abbreviation (Central Africa Time). It is
--   not a name Postgres recognises, so the statement raised
--       ERROR: 22023: time zone "CAT" not recognized
--   Because the DELETE only runs when the counted qty differs from
--   qty_on_hand, counts that matched the system figure saved fine while
--   every real physical count failed.
--
-- Fix:
--   Use the IANA zone name 'Africa/Maputo' (Central Africa Time, UTC+2).
-- ============================================================

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
  _current_qty NUMERIC;
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

    -- Upsert the stock count record
    INSERT INTO public.stock_counts (branch_id, item_id, count_date, qty, counted_by, notes)
    VALUES (_branch_id, _item_id, _count_date, _qty, auth.uid(), _notes)
    ON CONFLICT (branch_id, item_id, count_date)
    DO UPDATE SET
      qty = EXCLUDED.qty,
      counted_by = auth.uid(),
      notes = EXCLUDED.notes,
      updated_at = now();

    -- Get current qty_on_hand
    SELECT qty_on_hand INTO _current_qty
    FROM public.items
    WHERE id = _item_id;

    _current_qty := COALESCE(_current_qty, 0);
    _difference := _qty - _current_qty;

    -- Only create adjustment movement if there's a difference
    IF ABS(_difference) > 0.0001 THEN
      -- Remove any previous stock_count adjustment for this item on this date.
      -- Counts are recorded in Central Africa Time (UTC+2), so the movement
      -- date must be evaluated in that zone, not in the server's UTC.
      DELETE FROM public.stock_movements
      WHERE item_id = _item_id
        AND branch_id = _branch_id
        AND type = 'adjustment'
        AND ref_type = 'stock_count'
        AND (created_at AT TIME ZONE 'Africa/Maputo')::date = _count_date;

      -- Insert adjustment movement for the difference
      INSERT INTO public.stock_movements (
        branch_id, item_id, type, qty, unit_cost,
        qty_before, qty_after, note, ref_type, created_by
      )
      VALUES (
        _branch_id, _item_id, 'adjustment', _difference, 0,
        _current_qty, _qty,
        COALESCE(_notes, 'Stock count adjustment'),
        'stock_count',
        auth.uid()
      );
    END IF;

    -- Update qty_on_hand to match the physical count
    UPDATE public.items
    SET qty_on_hand = _qty,
        updated_at = now()
    WHERE id = _item_id;
  END LOOP;
END;
$$;

-- Drop the stale 2-argument overload left in the live database.
-- It references columns that do not exist (stock_movements.occurred_at,
-- stock_counts.opening/closing) and is not called by the app.
DROP FUNCTION IF EXISTS public.save_stock_counts(JSONB, DATE);

GRANT EXECUTE ON FUNCTION public.save_stock_counts(UUID, DATE, JSONB) TO authenticated;
