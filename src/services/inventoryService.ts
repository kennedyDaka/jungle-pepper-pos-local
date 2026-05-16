import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type {
  Category,
  InventoryItemView,
  StockMovementType,
  StockMovementView,
  StockType,
  Unit,
} from "@/types/domain";
import type { Database } from "@/types/database";

type ItemRowWithRelations = Database["public"]["Tables"]["items"]["Row"] & {
  categories?: Pick<Category, "name"> | null;
  units?: Pick<Unit, "code" | "name"> | null;
  suppliers?: { name: string } | null;
};

type MovementRowWithRelations = Database["public"]["Tables"]["stock_movements"]["Row"] & {
  items?: {
    name: string;
    units?: Pick<Unit, "code"> | null;
  } | null;
};

function toItem(row: ItemRowWithRelations): InventoryItemView {
  return {
    id: row.id,
    name: row.name,
    stock_type: row.stock_type,
    category_id: row.category_id,
    unit_id: row.unit_id,
    supplier_id: row.supplier_id,
    qty_on_hand: Number(row.qty_on_hand),
    avg_cost: Number(row.avg_cost),
    reorder_level: Number(row.reorder_level),
    active: row.active,
    bottle_ml: row.bottle_ml === null ? null : Number(row.bottle_ml),
    shot_ml: row.shot_ml === null ? null : Number(row.shot_ml),
    categories: row.categories ? { name: row.categories.name } : undefined,
    units: row.units ? { code: row.units.code, name: row.units.name } : undefined,
    suppliers: row.suppliers ? { name: row.suppliers.name } : null,
  };
}

function toMovement(row: MovementRowWithRelations): StockMovementView {
  return {
    id: row.id,
    item_id: row.item_id,
    type: row.type,
    qty: Number(row.qty),
    unit_cost: Number(row.unit_cost),
    qty_before: row.qty_before === null ? null : Number(row.qty_before),
    qty_after: row.qty_after === null ? null : Number(row.qty_after),
    note: row.note,
    created_at: row.created_at,
    items: row.items
      ? {
          name: row.items.name,
          units: row.items.units ? { code: row.items.units.code } : undefined,
        }
      : undefined,
  };
}

export const inventoryService = {
  async listItems(options: { activeOnly?: boolean } = { activeOnly: true }) {
    let query = supabase
      .from("items")
      .select("*, categories(name), units(code, name), suppliers(name)")
      .order("name");

    if (options.activeOnly) query = query.eq("active", true);

    const { data, error } = await query;
    raiseIfError(error, "Could not load inventory items");
    return ((data ?? []) as ItemRowWithRelations[]).map(toItem);
  },

  async listCategories() {
    const { data, error } = await supabase
      .from("categories")
      .select("id, kind, name, sort_order")
      .eq("kind", "inventory")
      .eq("active", true)
      .order("name");

    raiseIfError(error, "Could not load inventory categories");
    return (data ?? []) as Category[];
  },

  async listUnits() {
    const { data, error } = await supabase.from("units").select("id, code, name").order("code");
    raiseIfError(error, "Could not load units");
    return (data ?? []) as Unit[];
  },

  async archiveItem(id: string) {
    const { error } = await supabase.from("items").update({ active: false }).eq("id", id);
    raiseIfError(error, "Could not archive inventory item");
  },

  async createItem(input: {
    name: string;
    stock_type: StockType;
    category_id: string;
    unit_id: string;
    reorder_level: number;
    bottle_ml?: number | null;
    shot_ml?: number | null;
  }) {
    const { data, error } = await supabase
      .from("items")
      .insert({
        name: input.name,
        stock_type: input.stock_type,
        category_id: input.category_id,
        unit_id: input.unit_id,
        reorder_level: input.reorder_level,
        bottle_ml: input.bottle_ml ?? null,
        shot_ml: input.shot_ml ?? null,
        active: true,
      })
      .select("*, categories(name), units(code, name), suppliers(name)")
      .single();

    raiseIfError(error, "Could not create inventory item");
    return toItem(data as ItemRowWithRelations);
  },

  async applyStockMovement(input: {
    itemId: string;
    type: StockMovementType;
    qty: number;
    unitCost: number;
    note?: string;
  }) {
    const { data, error } = await supabase.rpc("apply_stock_movement", {
      _item_id: input.itemId,
      _type: input.type,
      _qty: input.qty,
      _unit_cost: input.unitCost,
      _note: input.note || undefined,
      _ref_type: "manual",
    });

    raiseIfError(error, "Could not apply stock movement");
    return data;
  },

  async listStockMovements(itemId: string) {
    const { data, error } = await supabase
      .from("stock_movements")
      .select("*, items(name, units(code))")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(200);

    raiseIfError(error, "Could not load stock movements");
    return ((data ?? []) as MovementRowWithRelations[]).map(toMovement);
  },
};
