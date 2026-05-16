import { inventoryService } from "@/services/inventoryService";
import { menuService } from "@/services/menuService";
import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { RecipeView, Unit } from "@/types/domain";
import type { Database } from "@/types/database";

type RecipeRowWithRelations = Database["public"]["Tables"]["recipes"]["Row"] & {
  items?: {
    name: string;
    units?: Pick<Unit, "code"> | null;
  } | null;
};

function toRecipe(row: RecipeRowWithRelations): RecipeView {
  return {
    id: row.id,
    menu_item_id: row.menu_item_id,
    item_id: row.item_id,
    qty: Number(row.qty),
    takeaway_only: row.takeaway_only,
    items: row.items
      ? {
          name: row.items.name,
          units: row.items.units ? { code: row.items.units.code } : undefined,
        }
      : undefined,
  };
}

export const recipeService = {
  async listMenuItems() {
    return menuService.listMenuItems({ activeOnly: true });
  },

  async listInventoryItems() {
    return inventoryService.listItems({ activeOnly: true });
  },

  async listRecipes(menuItemId: string) {
    const { data, error } = await supabase
      .from("recipes")
      .select("*, items(name, units(code))")
      .eq("menu_item_id", menuItemId)
      .order("created_at");

    raiseIfError(error, "Could not load recipes");
    return ((data ?? []) as RecipeRowWithRelations[]).map(toRecipe);
  },

  async addRecipe(input: {
    menu_item_id: string;
    item_id: string;
    qty: number;
    takeaway_only?: boolean;
  }) {
    const { error } = await supabase.from("recipes").insert({
      menu_item_id: input.menu_item_id,
      item_id: input.item_id,
      qty: input.qty,
      takeaway_only: input.takeaway_only ?? false,
    });

    raiseIfError(error, "Could not add recipe ingredient");
  },

  async deleteRecipe(id: string) {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    raiseIfError(error, "Could not remove recipe ingredient");
  },
};
