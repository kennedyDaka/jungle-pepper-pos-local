export type Role = "admin" | "cashier" | "storekeeper";
export type OrderStatus =
  | "paid"
  | "void"
  | "pending"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled";
export type OrderSource = "pos" | "waiter" | "website";
export type CategoryKind = "menu" | "inventory";
export type StockType = "raw" | "production" | "consumable" | "beverage";
export type PaymentMethod =
  | "cash"
  | "airtel_money"
  | "mpamba"
  | "bank_card"
  | "national_bank"
  | "standard_bank"
  | "capital_bank"
  | "eco_bank";
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

export interface Table {
  id: string;
  branch_id?: string | null;
  label: string;
  capacity: number;
  active: boolean;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  name: string;
  slug: string;
  category_id: string;
  price: number;
  description?: string | null;
  active: boolean;
  sort_order: number;
  kind: "normal" | "pizza" | "pasta";
  featured: boolean;
  spicy: boolean;
  vegetarian: boolean;
  image_url: string | null;
  category_name?: string | null;
}

export interface Reservation {
  id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  reservation_date: string;
  reservation_time: string;
  guests: number;
  occasion: string | null;
  notes: string | null;
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
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
  branch_id?: string | null;
  created_at: string;
  cashier_id?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  physical_order_no?: string | null;
  sale_type?: "regular" | "staff_meal";
  vat_rate?: number;
  net_amount?: number;
  vat_amount?: number;
  staff_meal_reason?: string | null;
  staff_meal_approved_by?: string | null;
  status: OrderStatus;
  note?: string | null;
  table_id?: string | null;
  source?: OrderSource;
  prepared_by?: string | null;
  served_at?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
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
  branches?: { name: string } | null;
  profiles?: Pick<UserProfile, "username" | "full_name"> | null;
  tables?: Pick<Table, "label"> | null;
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
      order_item_omissions?: Array<{
        id: string;
        recipe_id?: string | null;
        item_id: string;
        qty: number;
        items?: Pick<InventoryItem, "name"> & { units?: Pick<Unit, "code"> };
      }>;
      order_item_packaging?: Array<{
        id: string;
        item_id: string;
        qty: number;
        unit_price: number;
        packaging_options?: { name: string } | null;
        items?: Pick<InventoryItem, "name"> & { units?: Pick<Unit, "code"> };
      }>;
    }
  >;
  order_packaging?: Array<{
    id: string;
    item_id: string;
    qty: number;
    unit_price: number;
    packaging_options?: { name: string } | null;
    items?: Pick<InventoryItem, "name"> & { units?: Pick<Unit, "code"> };
  }>;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Expense {
  id: string;
  branch_id?: string | null;
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
  branches?: { name: string } | null;
  profiles?: Pick<UserProfile, "username" | "full_name"> | null;
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
  qty_count?: number | null;
  package_size?: number | null;
  package_unit?: string | null;
  unit_cost: number;
  total_cost?: number | null;
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
  branch_id?: string | null;
  item_id: string;
  type: StockMovementType;
  qty: number;
  unit_cost: number;
  qty_before?: number | null;
  qty_after?: number | null;
  note?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface StockMovementView extends StockMovement {
  items?: Pick<InventoryItem, "name"> & {
    units?: Pick<Unit, "code">;
    stock_type?: StockType | string | null;
    bottle_ml?: number | null;
    shot_ml?: number | null;
  };
  branches?: { name: string } | null;
  profiles?: Pick<UserProfile, "username" | "full_name"> | null;
  source_label?: string | null;
  source_detail?: string | null;
  destination?: string | null;
  invoice_no?: string | null;
  order_type?: string | null;
  menu_item_names?: string | null;
  menu_categories?: string | null;
  modifier_names?: string | null;
  order_item_qty?: number | null;
  production_ref?: string | null;
  production_outputs?: string | null;
  production_inputs?: string | null;
  expense_ref?: string | null;
  expense_category?: string | null;
  supplier_name?: string | null;
}

export interface ProductionBatch {
  id: string;
  branch_id?: string | null;
  created_by?: string | null;
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
  branches?: { name: string } | null;
  profiles?: Pick<UserProfile, "username" | "full_name"> | null;
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
