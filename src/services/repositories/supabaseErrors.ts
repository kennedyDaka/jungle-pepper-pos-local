import type { PostgrestError } from "@supabase/supabase-js";

export function toAppError(error: unknown, fallback = "Supabase request failed") {
  if (!error) return new Error(fallback);
  if (error instanceof Error) return error;

  const pgError = error as Partial<PostgrestError>;
  if (pgError.code === "PGRST205") {
    return new Error(
      "Supabase table or function is missing. Apply the project migrations before using live data.",
    );
  }
  if (pgError.message) return new Error(pgError.message);
  return new Error(fallback);
}

export function raiseIfError(error: unknown, fallback?: string) {
  if (error) throw toAppError(error, fallback);
}
