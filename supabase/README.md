# Supabase

This folder contains migration-ready SQL for the live Supabase backend.

Current contents:

- `migrations/` contains SQL for project `eueynkwysiyucmefpyhs`
- `seed/` data scripts for demo or launch data
- `functions/bootstrap-first-admin` creates the first admin through a guarded Edge Function

Do not add access tokens or service-role keys here.

Frontend runtime configuration lives in `.env.local` using `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`.

GitHub Actions migration deploys require these repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_ID` set to `eueynkwysiyucmefpyhs`
