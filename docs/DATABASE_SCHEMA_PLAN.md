# Supabase Database Architecture Plan

This plan is inferred from the current frontend and Supabase service layer. The app now points at Supabase through Vite environment variables, but the live project still needs the migration files in `supabase/migrations` applied before data queries can succeed.

## Frontend Entity Scan

The app currently uses these backend-facing entities:

- Auth and staff: `profiles`, `user_roles`, `branch_memberships`
- Branching: `branches`
- Catalog: `categories`, `units`, `suppliers`
- Inventory: `items`, `stock_movements`
- Menu and recipe setup: `menu_items`, `modifiers`, `recipes`
- POS: `orders`, `order_items`, `order_item_modifiers`, `payments`, `receipts`
- Expenses and stock purchases: `expense_categories`, `expenses`, `expense_stock_lines`
- Production: `production_batches`, `production_inputs`, `production_outputs`, `production_wastage`
- Future customer tracking: `customers`

Frontend routes map to backend domains like this:

- Dashboard: orders, order items, inventory, production batches
- POS: menu items, modifiers, recipes, orders, payments, receipts, stock movements
- Inventory: items, categories, units, suppliers, stock movements
- Production: items, production batches, production input/output/wastage lines, stock movements
- Expenses: expense categories, expenses, suppliers, stock purchase lines, stock movements
- Recipes: menu items, items, recipes
- Menu: categories, menu items, modifiers
- Reports: orders, payments, order items, expenses, inventory, stock movements
- Users: profiles, roles, future branch memberships

## Relationships

- A profile comes from `auth.users` and receives one or more app roles in `user_roles`.
- Branches are optional now, but operational tables include `branch_id` so multi-branch rollout does not require a rewrite.
- Categories are shared and split by `kind`: `menu` or `inventory`.
- Items belong to an inventory category, a unit, and optionally a supplier and branch.
- Stock movements belong to items and optionally reference an order, expense, or production batch.
- Menu items belong to menu categories and can have modifiers.
- Recipes connect menu items to inventory items and drive POS stock deductions.
- Orders belong to a cashier profile, optionally a branch and customer.
- Order items belong to orders and menu items; order item modifiers preserve selected modifiers and price deltas.
- Payments belong to orders.
- Receipts belong to orders and record print/PDF/screen issue events without connecting storage yet.
- Expenses belong to expense categories and can point to suppliers.
- Stock purchase lines connect expenses to inventory items and generated stock movements.
- Production batches own input, output, and wastage lines. Each line can point to its generated stock movement.

## Migration Files

The local migration-ready SQL lives in `supabase/migrations`:

- `20260516090000_initial_backend_schema.sql`: enums, tables, constraints, indexes, triggers, Data API grants.
- `20260516091000_rls_policies.sql`: private role helpers, RLS enablement, role-based policies.
- `20260516092000_backend_rpcs.sql`: service-bound RPCs for stock movement, POS checkout, stock purchases, production.
- `20260516093000_seed_reference_data.sql`: safe reference seed data only, no users or secrets.
- `20260516094000_enable_realtime_for_app_tables.sql`: Supabase Realtime publication registration for app tables.

## Role System

Roles are stored in `public.user_roles`, not in user-editable auth metadata.

- `admin`: manage users, roles, branches, menu, recipes, catalog, reports, inventory, expenses, production.
- `cashier`: read menu/catalog, finalize orders, create/read customers, issue receipts, trigger sale stock movements through POS.
- `storekeeper`: read reports/inventory, manage stock, suppliers, expenses, and production.

Branch access is prepared through `branch_memberships`. Current tables allow `branch_id` to be null so single-branch local data can migrate gradually.

## RLS Strategy

- RLS is enabled on every public table.
- The app grants table access to `authenticated` and relies on RLS for row access.
- No public table grants are given to `anon`.
- Authorization helpers live in `app_private` and use `security definer` with explicit `search_path`.
- Public RPCs stay callable by authenticated users only.
- Sensitive stock mutation is handled by a private checked function, so cashiers can deduct stock only through POS sale logic.
- Users can read their own profile and roles; admins manage all profiles and role assignments.
- Operational reads are role-limited and branch-aware.
- Direct deletes should remain rare; most frontend deletes should become soft deactivation where history matters.

## Constraints And Indexes

The schema includes:

- UUID primary keys with `gen_random_uuid()`.
- Enum constraints for app roles, category kinds, stock types, movement types, payment methods, order status, receipt channel.
- Positive money/quantity checks where values must be positive.
- Non-zero checks for stock movement quantities.
- Case-insensitive unique indexes for names, codes, usernames, emails, receipt numbers, and expense references.
- Foreign-key indexes for every join path used by frontend queries.
- Composite indexes for date/report queries, active catalog queries, branch filtering, and bin-card stock movement history.

## Supabase Connection Points

Do not put Supabase imports in route components. Keep components calling `src/services/*.ts`.

Current integration rules:

1. `@supabase/supabase-js` is installed and used only through the service/repository layer.
2. Use Vite env names, not Next.js env names:

```env
VITE_BACKEND_MODE=supabase
VITE_ENABLE_SUPABASE=true
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

3. The browser client lives under `src/services/repositories/supabaseClient.ts`.
4. `src/services/repositories/supabaseRepository.ts` is the backend status adapter.
5. Keep `src/types/domain.ts` as the UI contract.
6. Replace interim `src/types/database.ts` with generated Supabase types after the live schema is applied.
7. Continue integrating one workflow at a time: auth, menu read, inventory read, POS finalize, expenses, production, reports.
8. Do not reintroduce browser-local or mock fallbacks. Empty/error states should come from Supabase responses.

The pasted `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` values were converted to `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` because this is a Vite/TanStack app.
