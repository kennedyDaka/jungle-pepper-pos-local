-- ============================================================
-- Production Tracking Enhancements
-- Add cook_kg to track post-cooking weight for outputs
-- Ensure weight_kg is properly tracked for inputs
-- ============================================================

-- Add cook_kg to production_outputs (post-cooking weight)
ALTER TABLE public.production_outputs
  ADD COLUMN IF NOT EXISTS cook_kg NUMERIC;

-- Add cook_kg to production_inputs (post-processing weight)
ALTER TABLE public.production_inputs
  ADD COLUMN IF NOT EXISTS cook_kg NUMERIC;

-- Update the production RPC to accept cook_kg
CREATE OR REPLACE FUNCTION public.apply_production(_branch_id UUID, _payload JSONB)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  _batch_id UUID;
  _item JSONB;
  _input JSONB;
  _output JSONB;
  _waste JSONB;
BEGIN
  -- Create batch
  INSERT INTO public.production_batches (branch_id, created_by, note)
  VALUES (_branch_id, auth.uid(), _payload->>'note')
  RETURNING id INTO _batch_id;

  -- Process inputs
  FOR _input IN SELECT * FROM jsonb_array_elements(_payload->'inputs')
  LOOP
    INSERT INTO public.production_inputs (batch_id, item_id, qty, qty_count, weight_kg, cook_kg)
    VALUES (
      _batch_id,
      (_input->>'item_id')::UUID,
      (_input->>'qty')::NUMERIC,
      (_input->>'qty_count')::NUMERIC,
      (_input->>'weight_kg')::NUMERIC,
      (_input->>'cook_kg')::NUMERIC
    );

    -- Create stock movement for input (consumption)
    PERFORM public.apply_stock_movement(
      _branch_id,
      (_input->>'item_id')::UUID,
      'production_out',
      -(_input->>'qty')::NUMERIC,
      'Production batch ' || _batch_id,
      'production',
      _batch_id
    );
  END LOOP;

  -- Process outputs
  FOR _output IN SELECT * FROM jsonb_array_elements(_payload->'outputs')
  LOOP
    INSERT INTO public.production_outputs (batch_id, item_id, qty, qty_count, weight_kg, cook_kg)
    VALUES (
      _batch_id,
      (_output->>'item_id')::UUID,
      (_output->>'qty')::NUMERIC,
      (_output->>'qty_count')::NUMERIC,
      (_output->>'weight_kg')::NUMERIC,
      (_output->>'cook_kg')::NUMERIC
    );

    -- Create stock movement for output (production)
    PERFORM public.apply_stock_movement(
      _branch_id,
      (_output->>'item_id')::UUID,
      'production_in',
      (_output->>'qty')::NUMERIC,
      'Production batch ' || _batch_id,
      'production',
      _batch_id
    );
  END LOOP;

  -- Process wastage
  IF _payload->'wastage' IS NOT NULL THEN
    FOR _waste IN SELECT * FROM jsonb_array_elements(_payload->'wastage')
    LOOP
      IF (_waste->>'item_id') IS NOT NULL AND (_waste->>'qty')::NUMERIC > 0 THEN
        INSERT INTO public.production_wastage (batch_id, item_id, qty, reason)
        VALUES (
          _batch_id,
          (_waste->>'item_id')::UUID,
          (_waste->>'qty')::NUMERIC,
          COALESCE(_waste->>'reason', '')
        );

        -- Create stock movement for waste
        PERFORM public.apply_stock_movement(
          _branch_id,
          (_waste->>'item_id')::UUID,
          'wastage',
          -(_waste->>'qty')::NUMERIC,
          'Waste from batch ' || _batch_id,
          'production',
          _batch_id
        );
      END IF;
    END LOOP;
  END IF;

  RETURN _batch_id::TEXT;
END;
$$;
