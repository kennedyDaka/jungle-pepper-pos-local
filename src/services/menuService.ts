import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { Category, MenuItem, MenuItemView, Modifier } from "@/types/domain";
import type { Database } from "@/types/database";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveKind(categoryName: string | null): MenuItem["kind"] {
  const name = categoryName?.toLowerCase() ?? "";
  if (name === "pizza") return "pizza";
  if (name === "pastas") return "pasta";
  return "normal";
}

type MenuRowWithRelations = Database["public"]["Tables"]["menu_items"]["Row"] & {
  categories?: Pick<Category, "name"> | null;
};

function toMenuItem(row: MenuRowWithRelations): MenuItemView {
  return {
    id: row.id,
    name: row.name,
    category_id: row.category_id,
    price: Number(row.price),
    description: row.description,
    active: row.active,
    sort_order: row.sort_order,
    categories: row.categories ? { name: row.categories.name } : undefined,
  };
}

function toWebsiteMenuItem(row: MenuRowWithRelations): MenuItem {
  const catName = row.categories?.name ?? null;
  return {
    id: row.id,
    name: row.name,
    slug: slugify(row.name),
    category_id: row.category_id,
    price: Number(row.price),
    description: row.description,
    active: row.active,
    sort_order: row.sort_order,
    kind: deriveKind(catName),
    featured: false,
    spicy: false,
    vegetarian: false,
    image_url: null,
    category_name: catName,
  };
}

export const menuService = {
  async listCategories() {
    const { data, error } = await supabase
      .from("categories")
      .select("id, kind, name, sort_order")
      .eq("kind", "menu")
      .eq("active", true)
      .order("sort_order");

    raiseIfError(error, "Could not load menu categories");
    return (data ?? []) as Category[];
  },

  async listMenuItems(options: { activeOnly?: boolean } = {}) {
    let query = supabase.from("menu_items").select("*, categories(name)").order("sort_order");

    if (options.activeOnly) query = query.eq("active", true);

    const { data, error } = await query;
    raiseIfError(error, "Could not load menu items");
    return ((data ?? []) as MenuRowWithRelations[]).map(toMenuItem);
  },

  async listModifiers() {
    const { data, error } = await supabase
      .from("modifiers")
      .select("id, menu_item_id, name, price_delta")
      .eq("active", true)
      .order("name");

    raiseIfError(error, "Could not load menu modifiers");
    return (data ?? []) as Modifier[];
  },

  async listRecipeOptions() {
    const { data, error } = await supabase
      .from("recipes")
      .select("id, menu_item_id, item_id, qty, takeaway_only, items(name, units(code))")
      .order("created_at");

    raiseIfError(error, "Could not load recipe options");
    return (data ?? []).map((row: any) => ({
      id: row.id,
      menu_item_id: row.menu_item_id,
      item_id: row.item_id,
      qty: Number(row.qty),
      takeaway_only: Boolean(row.takeaway_only),
      items: row.items
        ? {
            name: row.items.name,
            units: row.items.units ? { code: row.items.units.code } : undefined,
          }
        : undefined,
    }));
  },

  async listWebsiteMenuItems() {
    let query = supabase
      .from("menu_items")
      .select("*, categories!inner(name)")
      .eq("categories.kind", "menu")
      .eq("active", true)
      .order("sort_order");

    const { data, error } = await query;
    raiseIfError(error, "Could not load menu items");
    return ((data ?? []) as MenuRowWithRelations[]).map(toWebsiteMenuItem);
  },

  async getWebsiteMenuItemById(id: string) {
    const { data, error } = await supabase
      .from("menu_items")
      .select("*, categories(name)")
      .eq("id", id)
      .eq("active", true)
      .maybeSingle();

    raiseIfError(error, "Could not load menu item");
    return data ? toWebsiteMenuItem(data as MenuRowWithRelations) : null;
  },

  async deleteMenuItem(id: string) {
    const { error } = await supabase.from("menu_items").update({ active: false }).eq("id", id);
    raiseIfError(error, "Could not delete menu item");
  },

  async saveMenuItem(input: {
    id?: string;
    name: string;
    price: number;
    category_id: string;
    description?: string | null;
    active?: boolean;
  }) {
    if (input.id) {
      const { data, error } = await supabase
        .from("menu_items")
        .update({
          name: input.name,
          price: input.price,
          category_id: input.category_id,
          description: input.description ?? null,
          active: input.active ?? true,
        })
        .eq("id", input.id)
        .select("*, categories(name)")
        .single();

      raiseIfError(error, "Could not update menu item");
      return toMenuItem(data as MenuRowWithRelations);
    }

    const { count, error: countError } = await supabase
      .from("menu_items")
      .select("id", { count: "exact", head: true });
    raiseIfError(countError, "Could not calculate menu sort order");

    const { data, error } = await supabase
      .from("menu_items")
      .insert({
        name: input.name,
        price: input.price,
        category_id: input.category_id,
        description: input.description ?? null,
        active: input.active ?? true,
        sort_order: (count ?? 0) + 1,
      })
      .select("*, categories(name)")
      .single();

    raiseIfError(error, "Could not create menu item");
    return toMenuItem(data as MenuRowWithRelations);
  },
};
