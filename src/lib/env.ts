export const env = {
  backendMode: import.meta.env.VITE_BACKEND_MODE ?? "supabase",
  enableSupabase: import.meta.env.VITE_ENABLE_SUPABASE !== "false",
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  mraEisEnabled: import.meta.env.VITE_MRA_EIS_ENABLED === "true",
  mraEisUrl: import.meta.env.VITE_MRA_EIS_URL ?? "",
  mraEisToken: import.meta.env.VITE_MRA_EIS_TOKEN ?? "",
  mraEisSyncMenu: import.meta.env.VITE_MRA_EIS_SYNC_MENU === "true",
} as const;

export function assertSupabaseEnv() {
  if (!env.enableSupabase || env.backendMode !== "supabase") {
    throw new Error(
      "Supabase mode is not enabled. Check VITE_BACKEND_MODE and VITE_ENABLE_SUPABASE.",
    );
  }
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error("Supabase URL and publishable key are required.");
  }
}
