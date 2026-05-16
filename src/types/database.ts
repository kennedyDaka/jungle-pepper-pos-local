export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      branch_memberships: {
        Row: {
          active: boolean;
          branch_id: string;
          created_at: string;
          id: string;
          is_default: boolean;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          branch_id: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          user_id: string;
        };
        Update: {
          active?: boolean;
          branch_id?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branch_memberships_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branch_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      branches: {
        Row: {
          active: boolean;
          address: string | null;
          code: string;
          created_at: string;
          id: string;
          name: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          code: string;
          created_at?: string;
          id?: string;
          name: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          code?: string;
          created_at?: string;
          id?: string;
          name?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["category_kind"];
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["category_kind"];
          name: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["category_kind"];
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          active: boolean;
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      expense_categories: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      expense_stock_lines: {
        Row: {
          created_at: string;
          expense_id: string;
          id: string;
          item_id: string;
          line_total: number | null;
          qty: number;
          stock_movement_id: string | null;
          unit_cost: number;
        };
        Insert: {
          created_at?: string;
          expense_id: string;
          id?: string;
          item_id: string;
          line_total?: number | null;
          qty: number;
          stock_movement_id?: string | null;
          unit_cost: number;
        };
        Update: {
          created_at?: string;
          expense_id?: string;
          id?: string;
          item_id?: string;
          line_total?: number | null;
          qty?: number;
          stock_movement_id?: string | null;
          unit_cost?: number;
        };
        Relationships: [
          {
            foreignKeyName: "expense_stock_lines_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_stock_lines_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_stock_lines_stock_movement_id_fkey";
            columns: ["stock_movement_id"];
            isOneToOne: false;
            referencedRelation: "stock_movements";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          amount: number;
          branch_id: string | null;
          category_id: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          expense_date: string;
          id: string;
          payment_method: Database["public"]["Enums"]["payment_method"];
          ref_no: string;
          supplier_id: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          branch_id?: string | null;
          category_id: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expense_date?: string;
          id?: string;
          payment_method: Database["public"]["Enums"]["payment_method"];
          ref_no: string;
          supplier_id?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          branch_id?: string | null;
          category_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expense_date?: string;
          id?: string;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          ref_no?: string;
          supplier_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      items: {
        Row: {
          active: boolean;
          avg_cost: number;
          bottle_ml: number | null;
          branch_id: string | null;
          category_id: string;
          created_at: string;
          id: string;
          name: string;
          qty_on_hand: number;
          reorder_level: number;
          shot_ml: number | null;
          stock_type: Database["public"]["Enums"]["stock_type"];
          supplier_id: string | null;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          avg_cost?: number;
          bottle_ml?: number | null;
          branch_id?: string | null;
          category_id: string;
          created_at?: string;
          id?: string;
          name: string;
          qty_on_hand?: number;
          reorder_level?: number;
          shot_ml?: number | null;
          stock_type: Database["public"]["Enums"]["stock_type"];
          supplier_id?: string | null;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          avg_cost?: number;
          bottle_ml?: number | null;
          branch_id?: string | null;
          category_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          qty_on_hand?: number;
          reorder_level?: number;
          shot_ml?: number | null;
          stock_type?: Database["public"]["Enums"]["stock_type"];
          supplier_id?: string | null;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "items_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_items: {
        Row: {
          active: boolean;
          branch_id: string | null;
          category_id: string;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          price: number;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          branch_id?: string | null;
          category_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          price: number;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          branch_id?: string | null;
          category_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          price?: number;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_items_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "menu_items_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      modifier_recipes: {
        Row: {
          created_at: string;
          id: string;
          item_id: string;
          modifier_id: string;
          qty: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          item_id: string;
          modifier_id: string;
          qty: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          item_id?: string;
          modifier_id?: string;
          qty?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "modifier_recipes_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "modifier_recipes_modifier_id_fkey";
            columns: ["modifier_id"];
            isOneToOne: false;
            referencedRelation: "modifiers";
            referencedColumns: ["id"];
          },
        ];
      };
      modifiers: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          menu_item_id: string;
          name: string;
          price_delta: number;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          menu_item_id: string;
          name: string;
          price_delta?: number;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          menu_item_id?: string;
          name?: string;
          price_delta?: number;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "modifiers_menu_item_id_fkey";
            columns: ["menu_item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item_modifiers: {
        Row: {
          created_at: string;
          id: string;
          modifier_id: string;
          order_item_id: string;
          price_delta: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          modifier_id: string;
          order_item_id: string;
          price_delta?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          modifier_id?: string;
          order_item_id?: string;
          price_delta?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey";
            columns: ["modifier_id"];
            isOneToOne: false;
            referencedRelation: "modifiers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          menu_item_id: string;
          note: string | null;
          order_id: string;
          qty: number;
          takeaway: boolean;
          unit_price: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          menu_item_id: string;
          note?: string | null;
          order_id: string;
          qty: number;
          takeaway?: boolean;
          unit_price: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          menu_item_id?: string;
          note?: string | null;
          order_id?: string;
          qty?: number;
          takeaway?: boolean;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey";
            columns: ["menu_item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          branch_id: string | null;
          cashier_id: string;
          created_at: string;
          customer_id: string | null;
          discount: number;
          id: string;
          note: string | null;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          total: number;
          updated_at: string;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          branch_id?: string | null;
          cashier_id?: string;
          created_at?: string;
          customer_id?: string | null;
          discount?: number;
          id?: string;
          note?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          total: number;
          updated_at?: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          branch_id?: string | null;
          cashier_id?: string;
          created_at?: string;
          customer_id?: string | null;
          discount?: number;
          id?: string;
          note?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          total?: number;
          updated_at?: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          id?: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      production_batches: {
        Row: {
          branch_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          note: string | null;
          updated_at: string;
        };
        Insert: {
          branch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          updated_at?: string;
        };
        Update: {
          branch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_batches_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      production_inputs: {
        Row: {
          batch_id: string;
          created_at: string;
          id: string;
          item_id: string;
          qty: number;
          qty_count: number | null;
          stock_movement_id: string | null;
          unit_cost: number | null;
          weight_kg: number | null;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          id?: string;
          item_id: string;
          qty: number;
          qty_count?: number | null;
          stock_movement_id?: string | null;
          unit_cost?: number | null;
          weight_kg?: number | null;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          qty?: number;
          qty_count?: number | null;
          stock_movement_id?: string | null;
          unit_cost?: number | null;
          weight_kg?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "production_inputs_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "production_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_inputs_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_inputs_stock_movement_id_fkey";
            columns: ["stock_movement_id"];
            isOneToOne: false;
            referencedRelation: "stock_movements";
            referencedColumns: ["id"];
          },
        ];
      };
      production_outputs: {
        Row: {
          batch_id: string;
          created_at: string;
          id: string;
          item_id: string;
          qty: number;
          qty_count: number | null;
          stock_movement_id: string | null;
          unit_cost: number | null;
          weight_kg: number | null;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          id?: string;
          item_id: string;
          qty: number;
          qty_count?: number | null;
          stock_movement_id?: string | null;
          unit_cost?: number | null;
          weight_kg?: number | null;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          qty?: number;
          qty_count?: number | null;
          stock_movement_id?: string | null;
          unit_cost?: number | null;
          weight_kg?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "production_outputs_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "production_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_outputs_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_outputs_stock_movement_id_fkey";
            columns: ["stock_movement_id"];
            isOneToOne: false;
            referencedRelation: "stock_movements";
            referencedColumns: ["id"];
          },
        ];
      };
      production_wastage: {
        Row: {
          batch_id: string;
          created_at: string;
          id: string;
          item_id: string;
          qty: number;
          reason: string;
          stock_movement_id: string | null;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          id?: string;
          item_id: string;
          qty: number;
          reason: string;
          stock_movement_id?: string | null;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          qty?: number;
          reason?: string;
          stock_movement_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "production_wastage_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "production_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_wastage_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_wastage_stock_movement_id_fkey";
            columns: ["stock_movement_id"];
            isOneToOne: false;
            referencedRelation: "stock_movements";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          updated_at: string;
          username: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          full_name?: string;
          id: string;
          updated_at?: string;
          username: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          updated_at?: string;
          username?: string;
        };
        Relationships: [];
      };
      receipts: {
        Row: {
          channel: Database["public"]["Enums"]["receipt_channel"];
          id: string;
          issued_at: string;
          issued_by: string | null;
          order_id: string;
          receipt_no: string;
          storage_path: string | null;
        };
        Insert: {
          channel?: Database["public"]["Enums"]["receipt_channel"];
          id?: string;
          issued_at?: string;
          issued_by?: string | null;
          order_id: string;
          receipt_no: string;
          storage_path?: string | null;
        };
        Update: {
          channel?: Database["public"]["Enums"]["receipt_channel"];
          id?: string;
          issued_at?: string;
          issued_by?: string | null;
          order_id?: string;
          receipt_no?: string;
          storage_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "receipts_issued_by_fkey";
            columns: ["issued_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receipts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      recipes: {
        Row: {
          created_at: string;
          id: string;
          item_id: string;
          menu_item_id: string;
          qty: number;
          takeaway_only: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          item_id: string;
          menu_item_id: string;
          qty: number;
          takeaway_only?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          item_id?: string;
          menu_item_id?: string;
          qty?: number;
          takeaway_only?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recipes_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipes_menu_item_id_fkey";
            columns: ["menu_item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          branch_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          item_id: string;
          note: string | null;
          qty: number;
          qty_after: number | null;
          qty_before: number | null;
          ref_id: string | null;
          ref_type: string | null;
          type: Database["public"]["Enums"]["stock_movement_type"];
          unit_cost: number;
        };
        Insert: {
          branch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          item_id: string;
          note?: string | null;
          qty: number;
          qty_after?: number | null;
          qty_before?: number | null;
          ref_id?: string | null;
          ref_type?: string | null;
          type: Database["public"]["Enums"]["stock_movement_type"];
          unit_cost?: number;
        };
        Update: {
          branch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          item_id?: string;
          note?: string | null;
          qty?: number;
          qty_after?: number | null;
          qty_before?: number | null;
          ref_id?: string | null;
          ref_type?: string | null;
          type?: Database["public"]["Enums"]["stock_movement_type"];
          unit_cost?: number;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          active: boolean;
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      units: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_production: {
        Args: { _branch_id?: string; _payload: Json };
        Returns: string;
      };
      apply_stock_movement: {
        Args: {
          _branch_id?: string;
          _item_id: string;
          _note?: string;
          _qty: number;
          _ref_id?: string;
          _ref_type?: string;
          _type: Database["public"]["Enums"]["stock_movement_type"];
          _unit_cost?: number;
        };
        Returns: {
          branch_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          item_id: string;
          note: string | null;
          qty: number;
          qty_after: number | null;
          qty_before: number | null;
          ref_id: string | null;
          ref_type: string | null;
          type: Database["public"]["Enums"]["stock_movement_type"];
          unit_cost: number;
        };
        SetofOptions: {
          from: "*";
          to: "stock_movements";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_stock_purchase: {
        Args: { _affect_stock?: boolean; _branch_id?: string; _payload: Json };
        Returns: string;
      };
      bootstrap_first_admin: { Args: { _user_id: string }; Returns: undefined };
      finalize_order: {
        Args: { _branch_id?: string; _customer_id?: string; _payload: Json };
        Returns: string;
      };
    };
    Enums: {
      app_role: "admin" | "cashier" | "storekeeper";
      category_kind: "menu" | "inventory";
      order_status: "paid" | "void";
      payment_method: "cash" | "airtel_money" | "mpamba" | "bank_card";
      receipt_channel: "screen" | "print" | "pdf" | "email";
      stock_movement_type:
        | "purchase_in"
        | "adjustment"
        | "sale"
        | "production_in"
        | "production_out"
        | "wastage"
        | "issue_out"
        | "complimentary"
        | "breakage";
      stock_type: "raw" | "production" | "consumable" | "beverage";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "cashier", "storekeeper"],
      category_kind: ["menu", "inventory"],
      order_status: ["paid", "void"],
      payment_method: ["cash", "airtel_money", "mpamba", "bank_card"],
      receipt_channel: ["screen", "print", "pdf", "email"],
      stock_movement_type: [
        "purchase_in",
        "adjustment",
        "sale",
        "production_in",
        "production_out",
        "wastage",
        "issue_out",
        "complimentary",
        "breakage",
      ],
      stock_type: ["raw", "production", "consumable", "beverage"],
    },
  },
} as const;
