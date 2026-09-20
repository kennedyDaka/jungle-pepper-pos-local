-- ============================================================
-- save_stock_counts v3: upsert counts + adjustment movement + update qty_on_hand
-- When a stock count is saved:
-- 1. Upsert the stock count record
-- 2. Calculate difference from current qty_on_hand
-- 3. Insert/replace an adjustment stock movement (bin card history)
-- 4. Update qty_on_hand to the counted value
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_stock_counts(
  _branch_id UUID,
  _count_date DATE,
  _counts JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  _item JSONB;
  _item_id UUID;
  _qty NUMERIC;
  _notes TEXT;
  _current_qty NUMERIC;
  _difference NUMERIC;
BEGIN
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
        AND created_at::date = _count_date;

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
