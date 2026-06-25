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
  order_packaging?: Array<
    Database["public"]["Tables"]["order_item_packaging"]["Row"] & {
      packaging_options?: { name: string } | null;
      items?: { name: string; units?: Pick<Unit, "code"> | null } | null;
    }
  >;
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
      order_item_omissions?: Array<{
        id: string;
        order_item_id: string;
        recipe_id: string | null;
        item_id: string;
        qty: number;
        created_at: string;
        items?: { name: string; units?: Pick<Unit, "code"> | null } | null;
      }>;
      order_item_packaging?: Array<
        Database["public"]["Tables"]["order_item_packaging"]["Row"] & {
          packaging_options?: { name: string } | null;
          items?: { name: string; units?: Pick<Unit, "code"> | null } | null;
        }
      >;
    }
  >;
};

type QueryPage<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

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

type RawMovementWithRelations = Database["public"]["Tables"]["stock_movements"]["Row"] & {
  branches?: BranchRelation;
  profiles?: StaffRelation;
  items?: {
    name: string;
    stock_type: string;
    bottle_ml: number | null;
    shot_ml: number | null;
    units?: Pick<Unit, "code" | "name"> | null;
  } | null;
};

type MovementOrderContext = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "physical_order_no" | "sale_type" | "source"
>;

function toStaff(row?: StaffRelation) {
  return row ? { username: row.username, full_name: row.full_name } : null;
}

const REPORT_PAGE_SIZE = 1000;

async function fetchAllReportPages<T>(
  buildPage: (from: number, to: number) => QueryPage<T>,
  errorMessage: string,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += REPORT_PAGE_SIZE) {
    const to = from + REPORT_PAGE_SIZE - 1;
    const { data, error } = await buildPage(from, to);
    raiseIfError(error as any, errorMessage);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < REPORT_PAGE_SIZE) break;
  }
  return rows;
}

function chunks<T>(rows: T[], size = 100) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

async function fetchByOrderIds<T>(
  orderIds: string[],
  buildQuery: (ids: string[]) => QueryPage<T>,
  errorMessage: string,
) {
  const rows: T[] = [];
  for (const idChunk of chunks(orderIds)) {
    const { data, error } = await buildQuery(idChunk);
    raiseIfError(error as any, errorMessage);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function fetchByIds<T>(
  ids: string[],
  buildQuery: (ids: string[]) => QueryPage<T>,
  errorMessage: string,
) {
  return fetchByOrderIds(ids, buildQuery, errorMessage);
}

function groupBy<T>(rows: T[], pickKey: (row: T) => string | null | undefined) {
  const grouped = new Map<string, T[]>();
  rows.forEach((row) => {
    const key = pickKey(row);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  });
  return grouped;
}

function uniqueText(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).join(", ");
}

function titleCase(value: string | null | undefined) {
  return (value ?? "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeQtyText(value: string | null | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return Number.isInteger(numeric) ? String(numeric) : Number(numeric.toFixed(3)).toString();
}

function parsePosMovementNote(note: string | null | undefined) {
  const text = note ?? "";
  const orderId = text.match(/POS order\s+([0-9a-f-]{20,})/i)?.[1] ?? null;
  const itemMatch = text.match(/\sitem\s+(.+?)\s+x([0-9]+(?:\.[0-9]+)?)/i);
  const packagingSaleMatch = text.match(/\spackaging sale\s+(.+?)\s+x([0-9]+(?:\.[0-9]+)?)/i);
  const packagingMatch = text.match(/\spackaging\s+(.+?)\s+x([0-9]+(?:\.[0-9]+)?)/i);
  const modifierMatch = text.match(/\smodifier\s+(.+)$/i);
  const itemQty = normalizeQtyText(itemMatch?.[2]);
  const packagingQty = normalizeQtyText(packagingMatch?.[2] ?? packagingSaleMatch?.[2]);
  const itemName = itemMatch?.[1]?.trim() ?? null;
  const packagingName = (packagingMatch?.[1] ?? packagingSaleMatch?.[1])?.trim() ?? null;
  const modifierName = modifierMatch?.[1]?.trim() ?? null;
  const menuItem = itemName && itemQty ? `${itemName} x${itemQty}` : itemName;
  const packagingItem =
    packagingName && packagingQty ? `${packagingName} x${packagingQty}` : packagingName;

  return {
    orderId,
    itemName,
    itemQty: itemQty === null ? null : Number(itemQty),
    packagingName,
    modifierName,
    menuItem,
    packagingItem,
  };
}

function movementOrderId(movement: RawMovementWithRelations) {
  if (movement.ref_type === "order") return movement.ref_id;
  return parsePosMovementNote(movement.note).orderId;
}

async function loadMovementOrders(movements: RawMovementWithRelations[]) {
  const orderIds = Array.from(
    new Set(movements.map(movementOrderId).filter((id): id is string => Boolean(id))),
  );
  if (orderIds.length === 0) return new Map<string, MovementOrderContext>();

  const orders = await fetchByIds<MovementOrderContext>(
    orderIds,
    (ids) =>
      supabase
        .from("orders")
        .select("id, physical_order_no, sale_type, source")
        .in("id", ids) as QueryPage<MovementOrderContext>,
    "Could not load movement order references",
  );

  return new Map(orders.map((order) => [order.id, order]));
}

function orderReference(order?: MovementOrderContext | null, fallback?: string | null) {
  return order?.physical_order_no || (fallback ? fallback.slice(0, 8).toUpperCase() : null);
}

function toPackagingRow(
  packaging: Database["public"]["Tables"]["order_item_packaging"]["Row"] & {
    packaging_options?: { name: string } | null;
    items?: { name: string; units?: Pick<Unit, "code"> | null } | null;
  },
) {
  return {
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
  };
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
    physical_order_no: (row as any).physical_order_no ?? null,
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
      order_item_omissions: (item.order_item_omissions ?? []).map((omission) => ({
        id: omission.id,
        order_item_id: omission.order_item_id,
        recipe_id: omission.recipe_id,
        item_id: omission.item_id,
        qty: Number(omission.qty),
        items: omission.items
          ? {
              name: omission.items.name,
              units: omission.items.units ? { code: omission.items.units.code } : undefined,
            }
          : undefined,
      })),
      order_item_packaging: (item.order_item_packaging ?? []).map(toPackagingRow),
    })),
    order_packaging: (row.order_packaging ?? []).map(toPackagingRow),
  };
}

function toRawMovement(movement: RawMovementWithRelations, order?: MovementOrderContext | null) {
  const parsed = parsePosMovementNote(movement.note);
  const isPosSale =
    movement.type === "sale" && ["order", "order_item"].includes(movement.ref_type ?? "");
  const destination = isPosSale
    ? [
        parsed.menuItem,
        parsed.modifierName ? `modifier ${parsed.modifierName}` : null,
        parsed.packagingItem ? `packaging ${parsed.packagingItem}` : null,
      ]
        .filter(Boolean)
        .join(" - ")
    : null;
  const reference = orderReference(order, parsed.orderId ?? movement.ref_id);
  const sourceLabel = isPosSale
    ? "MW POS"
    : movement.ref_type
      ? titleCase(movement.ref_type)
      : titleCase(movement.type);
  const orderType =
    order?.sale_type === "staff_meal"
      ? "Staff Meal"
      : order?.sale_type === "regular"
        ? null
        : titleCase(order?.sale_type);
  const sourceDetail = isPosSale
    ? uniqueText(["MW POS", reference, orderType, destination]).split(", ").join(" - ")
    : (movement.note ?? sourceLabel);

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
    branches: movement.branches ? { name: movement.branches.name } : null,
    profiles: toStaff(movement.profiles ?? null),
    items: movement.items?.name
      ? {
          name: movement.items.name,
          stock_type: movement.items.stock_type,
          bottle_ml: movement.items.bottle_ml === null ? null : Number(movement.items.bottle_ml),
          shot_ml: movement.items.shot_ml === null ? null : Number(movement.items.shot_ml),
          units: movement.items.units ? { code: movement.items.units.code } : undefined,
        }
      : undefined,
    source_label: sourceLabel,
    source_detail: sourceDetail,
    destination: destination || movement.note || null,
    invoice_no: reference,
    order_type: orderType,
    menu_item_names: parsed.menuItem,
    menu_categories: parsed.itemName?.toLowerCase().includes("pizza") ? "Pizza" : null,
    modifier_names: parsed.modifierName,
    order_item_qty: parsed.itemQty,
    production_ref:
      movement.ref_type === "production" && movement.ref_id
        ? movement.ref_id.slice(0, 8).toUpperCase()
        : null,
    production_outputs: null,
    production_inputs: null,
    expense_ref:
      movement.ref_type === "expense" && movement.ref_id
        ? movement.ref_id.slice(0, 8).toUpperCase()
        : null,
    expense_category: null,
    supplier_name: null,
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
    const orders = await fetchAllReportPages<OrderWithRelations>((from, to) => {
      let query = supabase
        .from("orders")
        .select("*, branches(name), cashier:profiles!orders_cashier_id_fkey(username, full_name)")
        .eq("status", "paid")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);

      if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);
      return query
        .order("created_at", { ascending: false })
        .range(from, to) as QueryPage<OrderWithRelations>;
    }, "Could not load sales report");

    const orderIds = orders.map((order) => order.id);
    if (orderIds.length === 0) return [];

    const [payments, orderItems, orderPackaging] = await Promise.all([
      fetchByIds<Database["public"]["Tables"]["payments"]["Row"]>(
        orderIds,
        (ids) => supabase.from("payments").select("*").in("order_id", ids) as QueryPage<any>,
        "Could not load report payments",
      ),
      fetchByIds<NonNullable<OrderWithRelations["order_items"]>[number]>(
        orderIds,
        (ids) =>
          supabase
            .from("order_items")
            .select("*, menu_items(name, categories(name))")
            .in("order_id", ids) as QueryPage<any>,
        "Could not load report order items",
      ),
      fetchByIds<NonNullable<OrderWithRelations["order_packaging"]>[number]>(
        orderIds,
        (ids) =>
          supabase
            .from("order_item_packaging")
            .select("*, packaging_options(name), items(name, units(code))")
            .in("order_id", ids)
            .is("order_item_id", null) as QueryPage<any>,
        "Could not load report order packaging",
      ),
    ]);

    const orderItemIds = orderItems.map((item) => item.id);
    const [modifiers, omissions, itemPackaging] =
      orderItemIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            fetchByIds<
              NonNullable<
                NonNullable<OrderWithRelations["order_items"]>[number]["order_item_modifiers"]
              >[number]
            >(
              orderItemIds,
              (ids) =>
                supabase
                  .from("order_item_modifiers")
                  .select("*, modifiers(name, price_delta)")
                  .in("order_item_id", ids) as QueryPage<any>,
              "Could not load report order modifiers",
            ),
            fetchByIds<
              NonNullable<
                NonNullable<OrderWithRelations["order_items"]>[number]["order_item_omissions"]
              >[number]
            >(
              orderItemIds,
              (ids) =>
                (supabase as any)
                  .from("order_item_omissions")
                  .select("*, items(name, units(code))")
                  .in("order_item_id", ids) as QueryPage<any>,
              "Could not load report order omissions",
            ),
            fetchByIds<
              NonNullable<
                NonNullable<OrderWithRelations["order_items"]>[number]["order_item_packaging"]
              >[number]
            >(
              orderItemIds,
              (ids) =>
                supabase
                  .from("order_item_packaging")
                  .select("*, packaging_options(name), items(name, units(code))")
                  .in("order_item_id", ids) as QueryPage<any>,
              "Could not load report item packaging",
            ),
          ]);

    const paymentsByOrder = groupBy(payments, (payment) => payment.order_id);
    const orderItemsByOrder = groupBy(orderItems, (item) => item.order_id);
    const orderPackagingByOrder = groupBy(orderPackaging, (packaging) => packaging.order_id);
    const modifiersByItem = groupBy(modifiers, (modifier) => modifier.order_item_id);
    const omissionsByItem = groupBy(omissions, (omission) => omission.order_item_id);
    const itemPackagingByItem = groupBy(itemPackaging, (packaging) => packaging.order_item_id);

    return orders
      .map((order) => ({
        ...order,
        payments: paymentsByOrder.get(order.id) ?? [],
        order_packaging: orderPackagingByOrder.get(order.id) ?? [],
        order_items: (orderItemsByOrder.get(order.id) ?? []).map((item) => ({
          ...item,
          order_item_modifiers: modifiersByItem.get(item.id) ?? [],
          order_item_omissions: omissionsByItem.get(item.id) ?? [],
          order_item_packaging: itemPackagingByItem.get(item.id) ?? [],
        })),
      }))
      .map(toOrder);
  },

  async listItems() {
    return inventoryService.listItems({ activeOnly: true });
  },

  async listStockMovements(fromIso: string, toIso: string, branchId?: string | null) {
    const data = await fetchAllReportPages<RawMovementWithRelations>((from, to) => {
      let query = supabase
        .from("stock_movements")
        .select(
          "*, branches(name), profiles:profiles!stock_movements_created_by_fkey(username, full_name), items(name, stock_type, bottle_ml, shot_ml, units(code, name))",
        )
        .gte("created_at", fromIso)
        .lte("created_at", toIso);

      if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);
      return query
        .order("created_at", { ascending: true })
        .range(from, to) as QueryPage<RawMovementWithRelations>;
    }, "Could not load stock movement report");

    const orderById = await loadMovementOrders(data);
    return groupPosSaleMovements(
      data.map((movement) =>
        toRawMovement(movement, orderById.get(movementOrderId(movement) ?? "")),
      ),
      "asc",
    );
  },

  async listWastage(fromIso: string, toIso: string, branchId?: string | null) {
    const data = await fetchAllReportPages<RawMovementWithRelations>((from, to) => {
      let query = supabase
        .from("stock_movements")
        .select(
          "*, branches(name), profiles:profiles!stock_movements_created_by_fkey(username, full_name), items(name, stock_type, bottle_ml, shot_ml, units(code, name))",
        )
        .eq("type", "wastage")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);

      if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);
      return query
        .order("created_at", { ascending: false })
        .range(from, to) as QueryPage<RawMovementWithRelations>;
    }, "Could not load wastage report");

    const orderById = await loadMovementOrders(data);
    return data.map((movement) =>
      toRawMovement(movement, orderById.get(movementOrderId(movement) ?? "")),
    );
  },

  async listProduction(fromIso: string, toIso: string, branchId?: string | null) {
    const data = await fetchAllReportPages<ProductionBatchWithRelations>((from, to) => {
      let query = supabase
        .from("production_batches")
        .select(
          "*, branches(name), creator:profiles!production_batches_created_by_fkey(username, full_name), production_inputs(*, items(name, units(code))), production_outputs(*, items(name, units(code))), production_wastage(*, items(name, units(code)))",
        )
        .gte("created_at", fromIso)
        .lte("created_at", toIso);

      if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);
      return query
        .order("created_at", { ascending: false })
        .range(from, to) as QueryPage<ProductionBatchWithRelations>;
    }, "Could not load production report");

    return data.map((batch) => ({
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
    const data = await fetchAllReportPages<any>((from, to) => {
      let query = supabase
        .from("order_inventory_deduction_audit")
        .select("*")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);

      if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);
      return query.order("created_at", { ascending: false }).range(from, to) as QueryPage<any>;
    }, "Could not load inventory deduction audit");

    return data.map((row) => ({
      ...row,
      expected_qty: Number(row.expected_qty),
      actual_qty: Number(row.actual_qty),
      movement_lines: Number(row.movement_lines),
      difference_qty: Number(row.difference_qty),
    }));
  },
};
