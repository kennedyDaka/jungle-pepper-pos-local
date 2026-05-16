import { inventoryService } from "@/services/inventoryService";
import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { Category, MenuItem, OrderView } from "@/types/domain";
import type { Database } from "@/types/database";

type OrderWithRelations = Database["public"]["Tables"]["orders"]["Row"] & {
  payments?: Database["public"]["Tables"]["payments"]["Row"][];
  order_items?: Array<
    Database["public"]["Tables"]["order_items"]["Row"] & {
      menu_items?: Pick<MenuItem, "name"> & {
        categories?: Pick<Category, "name"> | null;
      };
    }
  >;
};

function toOrder(row: OrderWithRelations): OrderView {
  return {
    id: row.id,
    created_at: row.created_at,
    cashier_id: row.cashier_id,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    total: Number(row.total),
    status: row.status,
    note: row.note,
    payments: (row.payments ?? []).map((payment) => ({
      id: payment.id,
      order_id: payment.order_id,
      method: payment.method,
      amount: Number(payment.amount),
    })),
    order_items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      order_id: item.order_id,
      menu_item_id: item.menu_item_id,
      qty: Number(item.qty),
      unit_price: Number(item.unit_price),
      note: item.note,
      menu_items: item.menu_items
        ? {
            name: item.menu_items.name,
            categories: item.menu_items.categories
              ? { name: item.menu_items.categories.name }
              : undefined,
          }
        : undefined,
    })),
  };
}

export const dashboardService = {
  async getTodaySales(fromIso: string) {
    const { data, error } = await supabase
      .from("orders")
      .select("*, payments(*), order_items(*, menu_items(name, categories(name)))")
      .eq("status", "paid")
      .gte("created_at", fromIso);

    raiseIfError(error, "Could not load dashboard sales");
    const orders = ((data ?? []) as OrderWithRelations[]).map(toOrder);
    const total = orders.reduce((sum, order) => sum + Number(order.total), 0);
    const itemAgg = new Map<string, number>();

    orders.forEach((order) => {
      order.order_items?.forEach((item) => {
        const name = item.menu_items?.name ?? "-";
        itemAgg.set(name, (itemAgg.get(name) ?? 0) + Number(item.qty));
      });
    });

    return {
      total,
      count: orders.length,
      top: [...itemAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  },

  async getLowStockItems() {
    const items = await inventoryService.listItems({ activeOnly: true });
    return items.filter(
      (item) =>
        Number(item.reorder_level) > 0 && Number(item.qty_on_hand) <= Number(item.reorder_level),
    );
  },

  async getNegativeStockItems() {
    const items = await inventoryService.listItems({ activeOnly: true });
    return items.filter((item) => Number(item.qty_on_hand) < 0);
  },

  async getProductionCountSince(fromIso: string) {
    const { count, error } = await supabase
      .from("production_batches")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromIso);

    raiseIfError(error, "Could not load production count");
    return count ?? 0;
  },
};
