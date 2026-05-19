import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";

export type PackagingOptionView = {
  id: string;
  name: string;
  item_id: string;
  price: number;
  active: boolean;
  sort_order: number;
  items?: {
    name: string;
    units?: { code: string } | null;
  } | null;
};

export const packagingService = {
  async listOptions() {
    const { data, error } = await supabase
      .from("packaging_options")
      .select("id, name, item_id, price, active, sort_order, items(name, units(code))")
      .eq("active", true)
      .order("sort_order");

    raiseIfError(error, "Could not load takeaway packaging");
    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      item_id: row.item_id,
      price: Number(row.price),
      active: row.active,
      sort_order: row.sort_order,
      items: row.items,
    })) as PackagingOptionView[];
  },

  async updatePrice(id: string, price: number) {
    const { error } = await supabase
      .from("packaging_options")
      .update({ price: Math.max(0, Number(price) || 0) })
      .eq("id", id);

    raiseIfError(error, "Could not update packaging price");
  },
};
