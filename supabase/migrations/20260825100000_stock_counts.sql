-- ============================================================
-- Stock Counts: Daily physical inventory count records
-- Each row represents one item's count on a specific date.
-- closing_qty of day N becomes opening_qty of day N+1.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID NOT NULL REFERENCES public.branches(id),
  item_id     UUID NOT NULL REFERENCES public.items(id),
  count_date  DATE NOT NULL,
  qty         NUMERIC NOT NULL DEFAULT 0,
  counted_by  UUID REFERENCES public.profiles(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One count per item per branch per day
  CONSTRAINT stock_counts_unique_per_day UNIQUE (branch_id, item_id, count_date)
);

CREATE INDEX idx_stock_counts_date ON public.stock_counts (branch_id, count_date);
CREATE INDEX idx_stock_counts_item  ON public.stock_counts (item_id);

-- ============================================================
-- RLS policies
-- ============================================================
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock counts"
  ON public.stock_counts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert stock counts"
  ON public.stock_counts FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update stock counts"
  ON public.stock_counts FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- RPC: Get opening qty for an item on a given date
-- Opening = closing qty of the most recent count before this date
-- ============================================================
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
     ORDER BY count_date DESC
     LIMIT 1),
    0
  );
$$;

-- ============================================================
-- RPC: Get closing qty for an item on a given date
-- ============================================================
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
     LIMIT 1),
    NULL
  );
$$;

-- ============================================================
-- RPC: Bulk upsert stock counts for multiple items at once
-- Input: array of { item_id, qty, notes? }
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
BEGIN
  FOR _item IN SELECT * FROM jsonb_array_elements(_counts)
  LOOP
    _item_id := (_item->>'item_id')::UUID;
    _qty     := (_item->>'qty')::NUMERIC;
    _notes   := _item->>'notes';

    INSERT INTO public.stock_counts (branch_id, item_id, count_date, qty, counted_by, notes)
    VALUES (_branch_id, _item_id, _count_date, _qty, auth.uid(), _notes)
    ON CONFLICT (branch_id, item_id, count_date)
    DO UPDATE SET
      qty = EXCLUDED.qty,
      counted_by = auth.uid(),
      notes = EXCLUDED.notes,
      updated_at = now();
  END LOOP;
END;
$$;
