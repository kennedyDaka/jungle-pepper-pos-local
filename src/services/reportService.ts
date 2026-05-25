import { expenseService } from "@/services/expenseService";
import { inventoryService } from "@/services/inventoryService";
import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import { groupPosSaleMovements } from "@/services/stockMovementDisplay";
import type { Category, MenuItem, Modifier, OrderView, Unit } from "@/types/domain";
import type { Database } from "@/types/database";

type StaffRelation = { username: string; full_name: string } | null;
type BranchRelation = { name: string } | null;

type OrderWithRelations = Database["public"]["Tables"]["orders"]["Row"] & {
  branches?: BranchRelation;
  cashier?: StaffRelation;
  payments?: Database["public"]["Tables"]["payments"]["Row"][];
  order_items?: Array<
    Database["public"]["Tables"]["order_items"]["Row"] & {
      menu_items?: Pick<MenuItem, "name"> & {
        categories?: Pick<Category, "name"> | null;
      };
      order_item_modifiers?: Array<
        Database["public"]["Tables"]["order_item_modifiers"]["Row"] & {
          modifiers?: Pick<Modifier, "name" | "price_delta"> | null;
        }
      >;
      order_item_packaging?: Array<
        Database["public"]["Tables"]["order_item_packaging"]["Row"] & {
          packaging_options?: { name: string } | null;
          items?: { name: string; units?: Pick<Unit, "code"> | null } | null;
        }
      >;
    }
  >;
};

type MovementWithRelations = Database["public"]["Views"]["stock_movement_details"]["Row"];

type ProductionLineWithRelations = Database["public"]["Tables"]["production_inputs"]["Row"] & {
  items?: {
    name: string;
    units?: Pick<Unit, "code"> | null;
  } | null;
};

type ProductionWasteWithRelations = Database["public"]["Tables"]["production_wastage"]["Row"] & {
  items?: {
    name: string;
    units?: Pick<Unit, "code"> | null;
  } | null;
};

type ProductionBatchWithRelations = Database["public"]["Tables"]["production_batches"]["Row"] & {
  branches?: BranchRelation;
  creator?: StaffRelation;
  production_inputs?: ProductionLineWithRelations[];
  production_outputs?: ProductionLineWithRelations[];
  production_wastage?: ProductionWasteWithRelations[];
};

function toStaff(row?: StaffRelation) {
  return row ? { username: row.username, full_name: row.full_name } : null;
}

function toOrder(row: OrderWithRelations): OrderView {
  return {
    id: row.id,
    branch_id: row.branch_id,
    created_at: row.created_at,
    cashier_id: row.cashier_id,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    total: Number(row.total),
    sale_type: (row as any).sale_type ?? "regular",
    vat_rate: Number((row as any).vat_rate ?? 0.175),
    net_amount: Number((row as any).net_amount ?? 0),
    vat_amount: Number((row as any).vat_amount ?? 0),
    staff_meal_reason: (row as any).staff_meal_reason ?? null,
    staff_meal_approved_by: (row as any).staff_meal_approved_by ?? null,
    status: row.status,
    note: row.note,
    branches: row.branches ? { name: row.branches.name } : null,
    profiles: toStaff(row.cashier),
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
      takeaway: item.takeaway,
      menu_items: item.menu_items
        ? {
            name: item.menu_items.name,
            categories: item.menu_items.categories
              ? { name: item.menu_items.categories.name }
              : undefined,
          }
        : undefined,
      order_item_modifiers: (item.order_item_modifiers ?? []).map((orderModifier) => ({
        id: orderModifier.id,
        order_item_id: orderModifier.order_item_id,
        modifier_id: orderModifier.modifier_id,
        modifiers: orderModifier.modifiers
          ? {
              name: orderModifier.modifiers.name,
              price_delta: Number(orderModifier.modifiers.price_delta),
            }
          : undefined,
      })),
      order_item_packaging: (item.order_item_packaging ?? []).map((packaging) => ({
        id: packaging.id,
        item_id: packaging.item_id,
        qty: Number(packaging.qty),
        unit_price: Number(packaging.unit_price),
        packaging_options: packaging.packaging_options
          ? { name: packaging.packaging_options.name }
          : null,
        items: packaging.items
          ? {
              name: packaging.items.name,
              units: packaging.items.units ? { code: packaging.items.units.code } : undefined,
            }
          : undefined,
      })),
    })),
  };
}

function toMovement(movement: MovementWithRelations) {
  return {
    id: movement.id,
    branch_id: movement.branch_id,
    item_id: movement.item_id,
    type: movement.type,
    qty: Number(movement.qty),
    unit_cost: Number(movement.unit_cost),
    qty_before: movement.qty_before === null ? null : Number(movement.qty_before),
    qty_after: movement.qty_after === null ? null : Number(movement.qty_after),
    note: movement.note,
    ref_type: movement.ref_type,
    ref_id: movement.ref_id,
    created_by: movement.created_by,
    created_at: movement.created_at,
    branches: movement.branch_name ? { name: movement.branch_name } : null,
    profiles:
      movement.user_username || movement.user_full_name
        ? { username: movement.user_username ?? "", full_name: movement.user_full_name ?? "" }
        : null,
    items: movement.item_name
      ? {
          name: movement.item_name,
          stock_type: movement.stock_type,
          bottle_ml: movement.bottle_ml === null ? null : Number(movement.bottle_ml),
          shot_ml: movement.shot_ml === null ? null : Number(movement.shot_ml),
          units: movement.unit_code ? { code: movement.unit_code } : undefined,
        }
      : undefined,
    source_label: movement.source_label,
    source_detail: movement.source_detail,
    destination: movement.destination,
    invoice_no: movement.invoice_no,
    order_type: movement.order_type,
    menu_item_names: movement.menu_item_names,
    menu_categories: movement.menu_categories,
    modifier_names: movement.modifier_names,
    order_item_qty: movement.order_item_qty === null ? null : Number(movement.order_item_qty),
    production_ref: movement.production_ref,
    production_outputs: movement.production_outputs,
    production_inputs: movement.production_inputs,
    expense_ref: movement.expense_ref,
    expense_category: movement.expense_category,
    supplier_name: movement.supplier_name,
  };
}

function toProductionLine(line: ProductionLineWithRelations) {
  return {
    id: line.id,
    batch_id: line.batch_id,
    item_id: line.item_id,
    qty: Number(line.qty),
    qty_count: line.qty_count === null ? null : Number(line.qty_count),
    weight_kg: line.weight_kg === null ? null : Number(line.weight_kg),
    unit_cost: line.unit_cost === null ? null : Number(line.unit_cost),
    created_at: line.created_at,
    items: line.items
      ? {
          name: line.items.name,
          units: line.items.units ? { code: line.items.units.code } : undefined,
        }
      : undefined,
  };
}

function toProductionWaste(line: ProductionWasteWithRelations) {
  return {
    id: line.id,
    batch_id: line.batch_id,
    item_id: line.item_id,
    qty: Number(line.qty),
    reason: line.reason,
    created_at: line.created_at,
    items: line.items
      ? {
          name: line.items.name,
          units: line.items.units ? { code: line.items.units.code } : undefined,
        }
      : undefined,
  };
}

export const reportService = {
  async listBranches() {
    const { data, error } = await supabase
      .from("branches")
      .select("id, code, name")
      .eq("active", true)
      .order("name");

    raiseIfError(error, "Could not load branches");
    return data ?? [];
  },

  async listSales(fromIso: string, toIso: string, branchId?: string | null) {
    let query = supabase
      .from("orders")
      .select(
        "*, branches(name), cashier:profiles!orders_cashier_id_fkey(username, full_name), payments(*), order_items(*, menu_items(name, categories(name)), order_item_modifiers(*, modifiers(name, price_delta)), order_item_packaging(*, packaging_options(name), items(name, units(code))))",
      )
      .eq("status", "paid")
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);

    const { data, error } = await query.order("created_at", { ascending: false });

    raiseIfError(error, "Could not load sales report");
    return ((data ?? []) as OrderWithRelations[]).map(toOrder);
  },

  async listItems() {
    return inventoryService.listItems({ activeOnly: true });
  },

  async listStockMovements(fromIso: string, toIso: string, branchId?: string | null) {
    let query = supabase
      .from("stock_movement_details")
      .select("*")
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);

    const { data, error } = await query.order("created_at", { ascending: true });

    raiseIfError(error, "Could not load stock movement report");
    return groupPosSaleMovements(((data ?? []) as MovementWithRelations[]).map(toMovement), "asc");
  },

  async listWastage(fromIso: string, toIso: string, branchId?: string | null) {
    let query = supabase
      .from("stock_movement_details")
      .select("*")
      .eq("type", "wastage")
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);

    const { data, error } = await query.order("created_at", { ascending: false });

    raiseIfError(error, "Could not load wastage report");
    return ((data ?? []) as MovementWithRelations[]).map(toMovement);
  },

  async listProduction(fromIso: string, toIso: string, branchId?: string | null) {
    let query = supabase
      .from("production_batches")
      .select(
        "*, branches(name), creator:profiles!production_batches_created_by_fkey(username, full_name), production_inputs(*, items(name, units(code))), production_outputs(*, items(name, units(code))), production_wastage(*, items(name, units(code)))",
      )
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);

    const { data, error } = await query.order("created_at", { ascending: false });

    raiseIfError(error, "Could not load production report");
    return ((data ?? []) as ProductionBatchWithRelations[]).map((batch) => ({
      id: batch.id,
      branch_id: batch.branch_id,
      created_by: batch.created_by,
      created_at: batch.created_at,
      note: batch.note,
      branches: batch.branches ? { name: batch.branches.name } : null,
      profiles: toStaff(batch.creator),
      production_inputs: (batch.production_inputs ?? []).map(toProductionLine),
      production_outputs: (batch.production_outputs ?? []).map(toProductionLine),
      production_wastage: (batch.production_wastage ?? []).map(toProductionWaste),
    }));
  },

  async listExpenses(from: string, to: string, branchId?: string | null) {
    return expenseService.listExpenses(from, to, branchId);
  },

  async listDeductionAudit(fromIso: string, toIso: string, branchId?: string | null) {
    let query = supabase
      .from("order_inventory_deduction_audit")
      .select("*")
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);

    const { data, error } = await query.order("created_at", { ascending: false });
    raiseIfError(error, "Could not load inventory deduction audit");
    return (data ?? []).map((row) => ({
      ...row,
      expected_qty: Number(row.expected_qty),
      actual_qty: Number(row.actual_qty),
      movement_lines: Number(row.movement_lines),
      difference_qty: Number(row.difference_qty),
    }));
  },
};
