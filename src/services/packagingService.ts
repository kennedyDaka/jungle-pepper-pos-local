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

export type PackagingStockItemView = {
  id: string;
  name: string;
  qty_on_hand: number;
  units?: { code: string } | null;
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

  async listPackagingItems() {
    const { data, error } = await supabase
      .from("items")
      .select("id, name, qty_on_hand, units(code)")
      .eq("active", true)
      .eq("stock_type", "consumable")
      .order("name");

    raiseIfError(error, "Could not load packaging stock items");
    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      qty_on_hand: Number(row.qty_on_hand),
      units: row.units,
    })) as PackagingStockItemView[];
  },

  async createOption(input: { name: string; item_id: string; price: number }) {
    const { error } = await supabase.from("packaging_options").insert({
      name: input.name.trim(),
      item_id: input.item_id,
      price: Math.max(0, Number(input.price) || 0),
      active: true,
      sort_order: 999,
    });

    raiseIfError(error, "Could not add takeaway packaging");
  },

  async updateOption(id: string, input: { name?: string; price?: number }) {
    const patch: { name?: string; price?: number } = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.price !== undefined) patch.price = Math.max(0, Number(input.price) || 0);

    const { error } = await supabase.from("packaging_options").update(patch).eq("id", id);

    raiseIfError(error, "Could not update takeaway packaging");
  },

  async updatePrice(id: string, price: number) {
    const { error } = await supabase
      .from("packaging_options")
      .update({ price: Math.max(0, Number(price) || 0) })
      .eq("id", id);

    raiseIfError(error, "Could not update packaging price");
  },

  async deactivateOption(id: string) {
    const { error } = await supabase
      .from("packaging_options")
      .update({ active: false })
      .eq("id", id);

    raiseIfError(error, "Could not delete takeaway packaging");
  },
};
