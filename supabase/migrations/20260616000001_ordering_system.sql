-- Phase 1a: Extend order_status enum (standalone — must be separate from using the new values)
alter type public.order_status add value if not exists 'pending' after 'void';
alter type public.order_status add value if not exists 'preparing' after 'pending';
alter type public.order_status add value if not exists 'ready' after 'preparing';
alter type public.order_status add value if not exists 'served' after 'ready';
alter type public.order_status add value if not exists 'cancelled' after 'served';
