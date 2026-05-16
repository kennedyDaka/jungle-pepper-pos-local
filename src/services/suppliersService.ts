import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { Supplier } from "@/types/domain";

export const suppliersService = {
  async listSuppliers() {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("active", true)
      .order("name");

    raiseIfError(error, "Could not load suppliers");
    return (data ?? []) as Supplier[];
  },

  async saveSupplier(input: { id?: string; name: string; phone?: string; email?: string }) {
    if (input.id) {
      const { data, error } = await supabase
        .from("suppliers")
        .update({
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
        })
        .eq("id", input.id)
        .select("id, name")
        .single();

      raiseIfError(error, "Could not update supplier");
      return data as Supplier;
    }

    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        active: true,
      })
      .select("id, name")
      .single();

    raiseIfError(error, "Could not create supplier");
    return data as Supplier;
  },
};
