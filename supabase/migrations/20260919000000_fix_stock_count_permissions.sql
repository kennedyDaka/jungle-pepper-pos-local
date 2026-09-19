-- ============================================================
-- Fix: "permission denied for table stock_movements" when saving
-- stock counts that have a variance.
--
-- Root cause:
--   * save_stock_counts(uuid, date, jsonb) runs as SECURITY INVOKER
--     and writes the variance row into stock_movements itself.
--   * The authenticated role lost INSERT/UPDATE/DELETE grants on
--     stock_movements, so any count whose qty differs from qty_on_hand
--     failed with "permission denied for table stock_movements".
--     Counts with zero variance saved fine (no movement written).
--
-- Fix:
--   1. Recreate save_stock_counts(uuid, date, jsonb) as SECURITY DEFINER
--      with an explicit safe search_path, so internal writes to
--      stock_movements run with the function owner's privileges.
--   2. Restore the standard authenticated grants on stock_movements
--      (RLS remains enabled and still governs which rows are visible).
--   3. Drop the broken legacy overload save_stock_counts(jsonb, date):
--      it references columns (opening/closing, branch-less UNIQUE) that
--      no longer exist and no frontend code calls it.
-- ============================================================

-- 1) Restore grants (idempotent, safe to re-run)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_counts TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.items TO authenticated;

-- 2) Drop the legacy 2-arg overload (references stale columns)
DROP FUNCTION IF EXISTS public.save_stock_counts(jsonb, date);

-- 3) Recreate the 3-arg RPC as SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.save_stock_counts(
  _branch_id UUID,
  _count_date DATE,
  _counts JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
      -- Remove any previous stock_count adjustment for this item on this date
      DELETE FROM public.stock_movements
      WHERE item_id = _item_id
        AND branch_id = _branch_id
        AND type = 'adjustment'
        AND ref_type = 'stock_count'
        AND DATE(created_at AT TIME ZONE 'CAT') = _count_date;

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

REVOKE ALL ON FUNCTION public.save_stock_counts(uuid, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_stock_counts(uuid, date, jsonb) TO authenticated;
