import { createClient } from "@supabase/supabase-js";
import { assertSupabaseEnv, env } from "@/lib/env";
import type { Database } from "@/types/database";

assertSupabaseEnv();

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
