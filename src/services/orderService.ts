import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type { Json } from "@/types/database";
import type { OrderStatus, Table } from "@/types/domain";

export type WaiterOrderItem = {
  menu_item_id: string;
  qty: number;
  takeaway?: boolean;
  note?: string | null;
  modifiers: Array<{ modifier_id: string }>;
  omissions?: Array<{ recipe_id?: string | null; item_id?: string | null }>;
  packaging?: Array<{ option_id: string; unit_price: number; qty_per_item?: number }> | null;
};

export type WaiterOrderPayload = {
  discount: number;
  note?: string | null;
  items: WaiterOrderItem[];
  packaging_sales?: Array<{ option_id: string; qty: number; unit_price: number }>;
};

export type WebsiteOrderPayload = {
  discount: number;
  note?: string | null;
  items: WaiterOrderItem[];
};

export type PaymentInput = {
  method: string;
  amount: number;
};

export const orderService = {
  async createWaiterOrder(payload: WaiterOrderPayload, branchId: string, tableId?: string, customerId?: string) {
    const { data, error } = await supabase.rpc("create_waiter_order", {
      _payload: payload as unknown as Json,
      _branch_id: branchId,
      _table_id: tableId ?? undefined,
      _customer_id: customerId ?? undefined,
    });
    raiseIfError(error, "Could not create waiter order");
    if (!data) throw new Error("Supabase did not return an order id");
    return data;
  },

  async createWebsiteOrder(
    payload: WebsiteOrderPayload,
    branchId: string,
    options?: { tableId?: string; customerName?: string; customerPhone?: string; customerId?: string },
  ) {
    const { data, error } = await supabase.rpc("create_website_order", {
      _payload: payload as unknown as Json,
      _branch_id: branchId,
      _table_id: options?.tableId ?? undefined,
      _customer_id: options?.customerId ?? undefined,
      _customer_name: options?.customerName ?? undefined,
      _customer_phone: options?.customerPhone ?? undefined,
    });
    raiseIfError(error, "Could not create website order");
    if (!data) throw new Error("Supabase did not return an order id");
    return data;
  },

  async updateOrderStatus(orderId: string, newStatus: OrderStatus, note?: string) {
    const { error } = await supabase.rpc("update_order_status", {
      _order_id: orderId,
      _new_status: newStatus,
      _note: note ?? undefined,
    });
    raiseIfError(error, "Could not update order status");
  },

  async processPayment(
    orderId: string,
    payments: PaymentInput[],
    options?: { physicalOrderNo?: string; saleAt?: string; discount?: number },
  ) {
    const { data, error } = await supabase.rpc("process_payment", {
      _order_id: orderId,
      _payments: payments as unknown as Json,
      _physical_order_no: options?.physicalOrderNo ?? undefined,
      _sale_at: options?.saleAt ?? undefined,
      _discount: options?.discount ?? undefined,
    });
    raiseIfError(error, "Could not process payment");
    if (!data) throw new Error("Supabase did not return an order id");
    return data;
  },

  async getActiveTables(branchId: string) {
    const { data, error } = await supabase.rpc("get_active_tables", { _branch_id: branchId });
    raiseIfError(error, "Could not fetch tables");
    return (data ?? []) as Table[];
  },

  async getKitchenOrders(branchId: string) {
    const { data, error } = await supabase.rpc("get_kitchen_orders", { _branch_id: branchId });
    raiseIfError(error, "Could not fetch kitchen orders");
    return data ?? [];
  },

  async getPendingOrders(branchId: string) {
    const { data: orders, error } = await supabase.rpc("get_pending_orders", { _branch_id: branchId });
    raiseIfError(error, "Could not fetch pending orders");
    if (!orders || orders.length === 0) return [];
    const orderIds = orders.map((o: any) => o.id);
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select(`
        *,
        menu_items(name, categories(name)),
        order_item_modifiers(modifiers(name, price_delta))
      `)
      .in("order_id", orderIds);
    raiseIfError(itemsError, "Could not fetch order items");
    return orders.map((order: any) => ({
      ...order,
      tables: order.table_label ? { label: order.table_label } : null,
      profiles: order.cashier_name ? { full_name: order.cashier_name, username: null } : null,
      order_items: (items ?? []).filter((i: any) => i.order_id === order.id),
    }));
  },
};
