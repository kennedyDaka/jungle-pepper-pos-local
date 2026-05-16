import { env } from "@/lib/env";

export function getSupabaseRepositoryStatus() {
  return {
    connected: true,
    url: env.supabaseUrl,
    message: "Supabase is the active runtime data source.",
  };
}
