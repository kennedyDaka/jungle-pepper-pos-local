# Supabase Migration Plan

The frontend is now wired to Supabase through the service layer. Route components still call
`src/services/*.ts`; they do not import the Supabase SDK directly.

## Current Status

- `@supabase/supabase-js` is installed.
- `.env.local` and `.env.l` use Supabase runtime mode.
- Runtime data services use `src/services/repositories/supabaseClient.ts`.
- Realtime table subscriptions invalidate React Query data through `src/hooks/useSupabaseRealtime.tsx`.
- Browser-local mock repositories were removed.
- The live project URL/key are configured.
- The migration files now create the missing app tables, including `public.items`.

## Required Live Database Step

To make the connected frontend fully operational, apply the SQL files in `supabase/migrations` to the project:

1. `20260516090000_initial_backend_schema.sql`
2. `20260516091000_rls_policies.sql`
3. `20260516092000_backend_rpcs.sql`
4. `20260516093000_seed_reference_data.sql`
5. `20260516094000_enable_realtime_for_app_tables.sql`

## Frontend Integration Boundary

- Auth/users: `src/services/authService.ts` and `src/services/usersService.ts`
- Products/menu: `src/services/menuService.ts` and `src/services/productsService.ts`
- Inventory: `src/services/inventoryService.ts`
- Sales/POS: `src/services/posService.ts` and `src/services/salesService.ts`
- Suppliers: `src/services/suppliersService.ts`
- Expenses: `src/services/expenseService.ts`
- Production: `src/services/productionService.ts`
- Reports/dashboard: `src/services/reportService.ts`, `src/services/dashboardService.ts`

Keep this boundary intact so UI changes are not needed when generated Supabase types replace the hand-written interim
types in `src/types/database.ts`.

## After Schema Is Applied

1. Create or invite the first admin in Supabase Auth.
2. Insert a matching row in `profiles`.
3. Insert `admin` into `user_roles` for that profile.
4. Generate database types into `src/types/database.ts`.
5. Run through login, inventory, POS checkout, stock purchase, production, reports, and users.
6. Confirm realtime table changes refresh open app sessions.
7. Run Supabase advisors and fix any RLS/index/security findings.
