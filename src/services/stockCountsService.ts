import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";

export interface StockCount {
  id: string;
  branch_id: string;
  item_id: string;
  count_date: string;
  qty: number;
  counted_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockCountWithItem extends StockCount {
  items?: {
    name: string;
    stock_type: string | null;
    qty_on_hand: number;
    units?: { code: string } | null;
    categories?: { name: string } | null;
  } | null;
}

/**
 * Get the opening qty for an item on a given date.
 * Opening = closing qty from the most recent count before this date.
 */
export async function getOpeningQty(
  itemId: string,
  branchId: string,
  date: string,
): Promise<number> {
  const { data, error } = await (supabase as any).rpc("get_opening_qty", {
    _item_id: itemId,
    _branch_id: branchId,
    _date: date,
  });
  raiseIfError(error, "Could not load opening qty");
  return Number(data ?? 0);
}

/**
 * Get the closing qty for an item on a given date.
 * Returns null if no count exists for that date.
 */
export async function getClosingQty(
  itemId: string,
  branchId: string,
  date: string,
): Promise<number | null> {
  const { data, error } = await (supabase as any).rpc("get_closing_qty", {
    _item_id: itemId,
    _branch_id: branchId,
    _date: date,
  });
  raiseIfError(error, "Could not load closing qty");
  return data === null || data === undefined ? null : Number(data);
}

export const stockCountsService = {
  /**
   * List all stock counts for a branch on a given date, joined with item info.
   */
  async listCounts(branchId: string, date: string): Promise<StockCountWithItem[]> {
    const { data, error } = await (supabase as any)
      .from("stock_counts")
      .select(
        "*, items(name, stock_type, qty_on_hand, units(code), categories(name))",
      )
      .eq("branch_id", branchId)
      .eq("count_date", date)
      .order("count_date", { ascending: false });

    raiseIfError(error, "Could not load stock counts");
    return (data ?? []) as StockCountWithItem[];
  },

  /**
   * List all stock counts for a date range.
   */
  async listCountsRange(
    branchId: string,
    fromDate: string,
    toDate: string,
  ): Promise<StockCountWithItem[]> {
    const { data, error } = await (supabase as any)
      .from("stock_counts")
      .select(
        "*, items(name, stock_type, qty_on_hand, units(code), categories(name))",
      )
      .eq("branch_id", branchId)
      .gte("count_date", fromDate)
      .lte("count_date", toDate)
      .order("count_date", { ascending: false });

    raiseIfError(error, "Could not load stock counts");
    return (data ?? []) as StockCountWithItem[];
  },

  /**
   * Bulk upsert stock counts for a given date.
   * Uses the save_stock_counts RPC for atomic operation.
   */
  async saveCounts(
    branchId: string,
    date: string,
    counts: Array<{ item_id: string; qty: number; notes?: string }>,
  ): Promise<void> {
    const { error } = await (supabase as any).rpc("save_stock_counts", {
      _branch_id: branchId,
      _count_date: date,
      _counts: counts,
    });
    raiseIfError(error, "Could not save stock counts");
  },

  /**
   * Get opening and closing quantities for all items in a branch
   * for a given date range. Returns a map of item_id -> { opening, closing, counts }.
   * Useful for flash reports and stock matrix.
   */
  async getOpenCloseMap(
    branchId: string,
    fromDate: string,
    toDate: string,
  ): Promise<
    Map<
      string,
      {
        opening: number;
        closing: number;
        counts: StockCountWithItem[];
      }
    >
  > {
    // Get the day before fromDate for opening
    const prevDate = new Date(fromDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().slice(0, 10);

    // Load all counts in range (including prev day for opening)
    const counts = await this.listCountsRange(branchId, prevDateStr, toDate);

    const map = new Map<
      string,
      { opening: number; closing: number; counts: StockCountWithItem[] }
    >();

    // Group counts by item
    const byItem = new Map<string, StockCountWithItem[]>();
    for (const count of counts) {
      const existing = byItem.get(count.item_id) ?? [];
      existing.push(count);
      byItem.set(count.item_id, existing);
    }

    for (const [itemId, itemCounts] of byItem) {
      const sorted = [...itemCounts].sort((a, b) =>
        a.count_date.localeCompare(b.count_date),
      );

      // Opening = most recent count before fromDate
      const openingCount = sorted.find((c) => c.count_date < fromDate);
      const opening = openingCount ? Number(openingCount.qty) : 0;

      // Closing = count on toDate (or last available)
      const closingCount = sorted.find((c) => c.count_date === toDate);
      const closing = closingCount ? Number(closingCount.qty) : null;

      if (closing !== null) {
        map.set(itemId, {
          opening,
          closing,
          counts: itemCounts.filter((c) => c.count_date === toDate),
        });
      }
    }

    return map;
  },
};
