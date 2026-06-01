import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { Json } from "@/types/database";

export type OrderPackagingPayload = {
  option_id: string;
  unit_price: number;
  qty_per_item?: number;
};

export interface FinalizeOrderPayload {
  discount: number;
  note?: string | null;
  physical_order_no?: string | null;
  sale_at?: string | null;
  staff_meal?: boolean;
  staff_meal_reason?: string | null;
  items: Array<{
    menu_item_id: string;
    qty: number;
    takeaway?: boolean;
    note?: string | null;
    modifiers: Array<{ modifier_id: string }>;
    omissions?: Array<{ recipe_id?: string | null; item_id?: string | null }>;
    packaging?: OrderPackagingPayload[] | OrderPackagingPayload | null;
  }>;
  packaging_sales?: Array<{
    option_id: string;
    qty: number;
    unit_price: number;
  }>;
  payments: Array<{ method: string; amount: number }>;
}

export const posService = {
  async finalizeOrder(payload: FinalizeOrderPayload) {
    const { data, error } = await supabase.rpc("finalize_order", {
      _payload: payload as unknown as Json,
    });

    raiseIfError(error, "Could not finalize order");
    if (!data) throw new Error("Supabase did not return an order id");
    return data;
  },
};
