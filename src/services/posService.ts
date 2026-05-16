import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { Json } from "@/types/database";

export interface FinalizeOrderPayload {
  discount: number;
  note?: string | null;
  items: Array<{
    menu_item_id: string;
    qty: number;
    takeaway?: boolean;
    note?: string | null;
    modifiers: Array<{ modifier_id: string }>;
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
