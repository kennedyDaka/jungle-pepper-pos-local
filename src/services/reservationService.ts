import { supabase } from "@/services/repositories/supabaseClient";
import type { Reservation } from "@/types/domain";

export const reservationService = {
  async list(branchId: string, status?: string): Promise<Reservation[]> {
    const { data, error } = await supabase.rpc("get_reservations", {
      _branch_id: branchId,
      _status: status ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as Reservation[];
  },

  async updateStatus(id: string, status: "confirmed" | "cancelled") {
    const { error } = await supabase.rpc("update_reservation_status", {
      _reservation_id: id,
      _new_status: status,
    });
    if (error) throw new Error(error.message);
  },
};
