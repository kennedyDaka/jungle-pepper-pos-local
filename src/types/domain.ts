export type Role = "admin" | "cashier" | "storekeeper";
export type CategoryKind = "menu" | "inventory";
export type StockType = "raw" | "production" | "consumable" | "beverage";
export type PaymentMethod = "cash" | "airtel_money" | "mpamba" | "bank_card";
export type StockMovementType =
  | "purchase_in"
  | "adjustment"
  | "sale"
  | "production_in"
  | "production_out"
  | "wastage"
  | "issue_out"
  | "complimentary"
  | "breakage";

export interface AuthUser {
  id: string;
  email: string;
  user_metadata: {
    username: string;
    full_name: string;
  };
}

export interface AuthSession {
  access_token: string;
  user: AuthUser;
}

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  email: string;
  active: boolean;
  created_at: string;
  roles: Role[];
  pin?: string;
  password?: string;
}

export interface Category {
  id: string;
  kind: CategoryKind;
  name: string;
  sort_order: number;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  stock_type: StockType;
  category_id: string;
  unit_id: string;
  supplier_id?: string | null;
  qty_on_hand: number;
  avg_cost: number;
  reorder_level: number;
  active: boolean;
  bottle_ml?: number | null;
  shot_ml?: number | null;
}

export interface InventoryItemView extends InventoryItem {
  categories?: Pick<Category, "name">;
  units?: Pick<Unit, "code" | "name">;
  suppliers?: Pick<Supplier, "name"> | null;
}

export interface MenuItem {
  id: string;
  name: string;
  category_id: string;
  price: number;
  description?: string | null;
  active: boolean;
  sort_order: number;
}

export interface MenuItemView extends MenuItem {
  categories?: Pick<Category, "name">;
}

export interface Modifier {
  id: string;
  menu_item_id: string;
  name: string;
  price_delta: number;
}

export interface Recipe {
  id: string;
  menu_item_id: string;
  item_id: string;
  qty: number;
  takeaway_only?: boolean;
}

export interface RecipeView extends Recipe {
  items?: Pick<InventoryItem, "name"> & {
    units?: Pick<Unit, "code">;
  };
}

export interface Order {
  id: string;
  created_at: string;
  cashier_id: string;
  subtotal: number;
  discount: number;
  total: number;
  status: "paid" | "void";
  note?: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  qty: number;
  unit_price: number;
  note?: string | null;
  takeaway?: boolean;
}

export interface OrderItemModifier {
  id: string;
  order_item_id: string;
  modifier_id: string;
}

export interface Payment {
  id: string;
  order_id: string;
  method: PaymentMethod;
  amount: number;
}

export interface OrderView extends Order {
  payments?: Payment[];
  order_items?: Array<
    OrderItem & {
      menu_items?: Pick<MenuItem, "name"> & {
        categories?: Pick<Category, "name">;
      };
      order_item_modifiers?: Array<
        OrderItemModifier & {
          modifiers?: Pick<Modifier, "name" | "price_delta">;
        }
      >;
    }
  >;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Expense {
  id: string;
  ref_no: string;
  category_id: string;
  amount: number;
  payment_method: PaymentMethod;
  description?: string | null;
  supplier_id?: string | null;
  expense_date: string;
  created_at: string;
}

export interface ExpenseView extends Expense {
  expense_categories?: Pick<ExpenseCategory, "name">;
  suppliers?: Pick<Supplier, "name"> | null;
  expense_stock_lines?: ExpenseStockLineView[];
}

export interface ExpenseStockLineView {
  id: string;
  expense_id: string;
  item_id: string;
  stock_movement_id?: string | null;
  qty: number;
  unit_cost: number;
  line_total: number;
  created_at: string;
  items?: Pick<InventoryItem, "name"> & {
    units?: Pick<Unit, "code">;
  };
  stock_movements?: Pick<
    StockMovement,
    | "id"
    | "item_id"
    | "type"
    | "qty"
    | "unit_cost"
    | "qty_before"
    | "qty_after"
    | "note"
    | "created_at"
  > | null;
}

export interface StockMovement {
  id: string;
  item_id: string;
  type: StockMovementType;
  qty: number;
  unit_cost: number;
  qty_before?: number | null;
  qty_after?: number | null;
  note?: string | null;
  created_at: string;
}

export interface StockMovementView extends StockMovement {
  items?: Pick<InventoryItem, "name"> & {
    units?: Pick<Unit, "code">;
  };
}

export interface ProductionBatch {
  id: string;
  created_at: string;
  note?: string | null;
}

export interface ProductionLine {
  id: string;
  batch_id: string;
  item_id: string;
  qty: number;
  qty_count?: number | null;
  weight_kg?: number | null;
  unit_cost?: number | null;
}

export interface ProductionWaste {
  id: string;
  batch_id: string;
  item_id: string;
  qty: number;
  reason: string;
}

export interface ProductionBatchView extends ProductionBatch {
  production_inputs: Array<
    ProductionLine & {
      items?: Pick<InventoryItem, "name"> & { units?: Pick<Unit, "code"> };
    }
  >;
  production_outputs: Array<
    ProductionLine & {
      items?: Pick<InventoryItem, "name"> & { units?: Pick<Unit, "code"> };
    }
  >;
  production_wastage: ProductionWaste[];
}
