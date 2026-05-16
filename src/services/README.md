# Services

Frontend routes should call service modules in this folder instead of calling a backend SDK directly.

Current implementation: Supabase-backed services using the shared client in `repositories/supabaseClient.ts`.

Keep route components stable by adding backend logic here instead of importing Supabase directly into UI files.
