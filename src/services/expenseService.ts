import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";
import type {
  ExpenseCategory,
  ExpenseStockLineView,
  ExpenseView,
  PaymentMethod,
  Supplier,
  Unit,
} from "@/types/domain";
import type { Database } from "@/types/database";

type ExpenseRowWithRelations = Database["public"]["Tables"]["expenses"]["Row"] & {
  branches?: { name: string } | null;
  creator?: { username: string; full_name: string } | null;
  expense_categories?: Pick<ExpenseCategory, "name"> | null;
  suppliers?: Pick<Supplier, "name"> | null;
  expense_stock_lines?: ExpenseStockLineRowWithRelations[];
};

type ExpenseStockLineRowWithRelations =
  Database["public"]["Tables"]["expense_stock_lines"]["Row"] & {
    items?: {
      name: string;
      units?: Pick<Unit, "code"> | null;
    } | null;
    stock_movements?: Pick<
      Database["public"]["Tables"]["stock_movements"]["Row"],
      "id" | "type" | "qty" | "qty_before" | "qty_after" | "note" | "created_at"
    > | null;
  };

function nextExpenseRef() {
  const now = new Date();
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `EXP-${stamp}-${suffix}`;
}

function toExpenseStockLine(row: ExpenseStockLineRowWithRelations): ExpenseStockLineView {
  return {
    id: row.id,
    expense_id: row.expense_id,
    item_id: row.item_id,
    stock_movement_id: row.stock_movement_id,
    qty: Number(row.qty),
    qty_count: row.qty_count === null ? null : Number(row.qty_count),
    package_size: row.package_size === null ? null : Number(row.package_size),
    package_unit: row.package_unit,
    unit_cost: Number(row.unit_cost),
    total_cost: row.total_cost === null ? null : Number(row.total_cost),
    line_total: Number(row.line_total),
    created_at: row.created_at,
    items: row.items
      ? {
          name: row.items.name,
          units: row.items.units ? { code: row.items.units.code } : undefined,
        }
      : undefined,
    stock_movements: row.stock_movements
      ? {
          id: row.stock_movements.id,
          item_id: row.item_id,
          type: row.stock_movements.type,
          qty: Number(row.stock_movements.qty),
          unit_cost: row.unit_cost === null ? 0 : Number(row.unit_cost),
          qty_before:
            row.stock_movements.qty_before === null ? null : Number(row.stock_movements.qty_before),
          qty_after:
            row.stock_movements.qty_after === null ? null : Number(row.stock_movements.qty_after),
          note: row.stock_movements.note,
          created_at: row.stock_movements.created_at,
        }
      : null,
  };
}

function toExpense(row: ExpenseRowWithRelations): ExpenseView {
  return {
    id: row.id,
    ref_no: row.ref_no,
    category_id: row.category_id,
    amount: Number(row.amount),
    payment_method: row.payment_method,
    description: row.description,
    supplier_id: row.supplier_id,
    branch_id: row.branch_id,
    expense_date: row.expense_date,
    created_at: row.created_at,
    branches: row.branches ? { name: row.branches.name } : null,
    profiles: row.creator
      ? { username: row.creator.username, full_name: row.creator.full_name }
      : null,
    expense_categories: row.expense_categories ? { name: row.expense_categories.name } : undefined,
    suppliers: row.suppliers ? { name: row.suppliers.name } : null,
    expense_stock_lines: (row.expense_stock_lines ?? []).map(toExpenseStockLine),
  };
}

export const expenseService = {
  async listCategories() {
    const { data, error } = await supabase
      .from("expense_categories")
      .select("id, name, active, created_at")
      .eq("active", true)
      .order("name");

    raiseIfError(error, "Could not load expense categories");
    return (data ?? []) as ExpenseCategory[];
  },

  async listSuppliers() {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("active", true)
      .order("name");

    raiseIfError(error, "Could not load suppliers");
    return (data ?? []) as Supplier[];
  },

  async listExpenses(from: string, to: string, branchId?: string | null) {
    let query = supabase
      .from("expenses")
      .select(
        "*, branches(name), creator:profiles!expenses_created_by_fkey(username, full_name), expense_categories(name), suppliers(name), expense_stock_lines(*, items(name, units(code)), stock_movements(id, type, qty, qty_before, qty_after, note, created_at))",
      )
      .gte("expense_date", from)
      .lte("expense_date", to);

    if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);

    const { data, error } = await query
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });

    raiseIfError(error, "Could not load expenses");
    return ((data ?? []) as ExpenseRowWithRelations[]).map(toExpense);
  },

  async recordExpense(input: {
    category_id: string;
    amount: number;
    payment_method: PaymentMethod;
    description?: string;
    supplier_id?: string | null;
    expense_date: string;
  }) {
    const { error } = await supabase.from("expenses").insert({
      ref_no: nextExpenseRef(),
      category_id: input.category_id,
      amount: Number(input.amount),
      payment_method: input.payment_method,
      description: input.description ?? "",
      supplier_id: input.supplier_id ?? null,
      expense_date: input.expense_date,
    });

    raiseIfError(error, "Could not record expense");
  },

  async recordStockPurchase(input: {
    lines: Array<{
      item_id: string;
      qty: number;
      unit_cost: number;
      qty_count?: number | null;
      package_size?: number | null;
      package_unit?: string | null;
      total_cost?: number | null;
    }>;
    payment_method: PaymentMethod;
    expense_date: string;
    description?: string;
    supplier_id?: string | null;
    affect_stock?: boolean;
  }) {
    const { error } = await supabase.rpc("apply_stock_purchase", {
      _payload: {
        lines: input.lines,
        payment_method: input.payment_method,
        expense_date: input.expense_date,
        description: input.description ?? "",
        supplier_id: input.supplier_id ?? null,
      },
      _affect_stock: input.affect_stock ?? true,
    });

    raiseIfError(error, "Could not record stock purchase");
  },
};
