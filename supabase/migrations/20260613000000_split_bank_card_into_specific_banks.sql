-- Add specific bank names to payment_method enum
-- bank_card is kept for backward compatibility with existing orders

alter type public.payment_method add value 'national_bank' after 'bank_card';
alter type public.payment_method add value 'standard_bank' after 'national_bank';
alter type public.payment_method add value 'capital_bank' after 'standard_bank';
alter type public.payment_method add value 'eco_bank' after 'capital_bank';
