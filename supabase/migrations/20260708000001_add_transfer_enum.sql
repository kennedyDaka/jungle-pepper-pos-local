-- Add 'transfer' to stock_movement_type (separate transaction from its use)
alter type public.stock_movement_type add value if not exists 'transfer';
