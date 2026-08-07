-- Remove Fettucine from the menu.
-- Fettucine pasta shape modifiers are deactivated (not deleted) so existing
-- order_item_modifiers history and FKs remain intact.
update public.modifiers
set active = false,
    updated_at = now()
where lower(name) = 'fettucine';

-- Deactivate all Fettucine pasta dishes. Kept as rows so historical orders
-- and recipes referencing them remain valid.
update public.menu_items
set active = false,
    updated_at = now()
where lower(name) like 'fettucine%';