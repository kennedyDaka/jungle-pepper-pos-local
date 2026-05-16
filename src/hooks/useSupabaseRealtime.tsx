import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/services/repositories/supabaseClient";

const liveTables = [
  "profiles",
  "user_roles",
  "categories",
  "units",
  "suppliers",
  "items",
  "stock_movements",
  "menu_items",
  "modifiers",
  "recipes",
  "orders",
  "order_items",
  "order_item_modifiers",
  "payments",
  "receipts",
  "expense_categories",
  "expenses",
  "expense_stock_lines",
  "production_batches",
  "production_inputs",
  "production_outputs",
  "production_wastage",
] as const;

export function useSupabaseRealtime(queryClient: QueryClient) {
  useEffect(() => {
    const channel = supabase.channel("jungle-pepper-live-data");

    liveTables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        queryClient.invalidateQueries();
      });
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
