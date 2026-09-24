import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError } from "@/services/repositories/supabaseErrors";

export interface StockCount {
  id: string;
  branch_id: string;
  item_id: string;
  count_date: string;
  qty: number;
  expected_qty: number;
  variance: number;
  counted_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CountHistoryRow {
  id: string;
  count_date: string;
  qty: number;
  expected_qty: number;
  variance: number;
  notes: string | null;
  counted_by: string | null;
  counter_name: string | null;
  created_at: string;
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
   * List the LATEST revision of each item's count for a branch on a given date.
   * stock_counts is append-only, so a date can hold multiple revisions; this
   * returns the most recent one per item.
   */
  async listCounts(branchId: string, date: string): Promise<StockCountWithItem[]> {
    const { data, error } = await (supabase as any)
      .from("stock_counts")
      .select(
        "*, items(name, stock_type, qty_on_hand, units(code), categories(name))",
      )
      .eq("branch_id", branchId)
      .eq("count_date", date)
      .order("created_at", { ascending: true });

    raiseIfError(error, "Could not load stock counts");
    const rows = (data ?? []) as StockCountWithItem[];

    // Latest revision wins: later created_at values overwrite earlier ones.
    const latestByItem = new Map<string, StockCountWithItem>();
    for (const row of rows) {
      latestByItem.set(row.item_id, row);
    }
    return [...latestByItem.values()];
  },

  /**
   * List counts across a date range, keeping only the LATEST revision per
   * (item, count_date), ordered by count_date DESC (most recent first).
   * Flash report / stock matrix rely on this ordering: the first match for
   * "most recent count before the range" is the row they want.
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
      .order("count_date", { ascending: false })
      .order("created_at", { ascending: false });

    raiseIfError(error, "Could not load stock counts");
    const rows = (data ?? []) as StockCountWithItem[];

    // First-wins per (item, count_date) = the latest revision.
    const latestByKey = new Map<string, StockCountWithItem>();
    for (const row of rows) {
      const key = `${row.item_id}|${row.count_date}`;
      if (!latestByKey.has(key)) latestByKey.set(key, row);
    }
    return [...latestByKey.values()];
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
   * Get the full count history (all revisions) for a single item.
   * Chronological: earliest to latest. Includes the counter's name.
   */
  async listItemHistory(
    branchId: string,
    itemId: string,
  ): Promise<CountHistoryRow[]> {
    const { data, error } = await (supabase as any).rpc(
      "get_item_count_history",
      { _branch_id: branchId, _item_id: itemId },
    );
    raiseIfError(error, "Could not load count history");
    return (data ?? []) as CountHistoryRow[];
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
        a.count_date === b.count_date
          ? a.created_at.localeCompare(b.created_at)
          : a.count_date.localeCompare(b.count_date),
      );

      // Opening = most recent count before fromDate (latest date, latest revision)
      let opening = 0;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].count_date < fromDate) {
          opening = Number(sorted[i].qty);
          break;
        }
      }

      // Closing = latest revision on toDate
      let closing: number | null = null;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].count_date === toDate) {
          closing = Number(sorted[i].qty);
          break;
        }
      }

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
