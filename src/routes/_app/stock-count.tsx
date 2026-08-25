import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MWK, fmtQty } from "@/lib/format";
import { inventoryService } from "@/services/inventoryService";
import { stockCountsService } from "@/services/stockCountsService";
import { supabase } from "@/services/repositories/supabaseClient";
import { toast } from "sonner";
import { Save, Check, AlertTriangle, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_app/stock-count" as never)({
  component: StockCountPage,
});

type CountEntry = {
  item_id: string;
  name: string;
  current_qty: number;
  counted_qty: string;
  notes: string;
  unit: string;
  changed: boolean;
};

function StockCountPage() {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [entries, setEntries] = useState<CountEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Get branch
  const membership = useQuery({
    queryKey: ["auth", "branch-membership"],
    queryFn: async () => {
      const { data: membershipData, error: membershipError } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (membershipData)
        return membershipData as { branch_id: string; branches: { id: string; name: string } };
      const { data: branchData, error: branchError } = await supabase
        .from("branches")
        .select("id, name")
        .eq("active", true)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branchData) return null;
      return { branch_id: branchData.id, branches: { id: branchData.id, name: branchData.name } };
    },
  });

  const branchId = membership.data?.branch_id;

  // Load items
  const items = useQuery({
    queryKey: ["stock-count", "items"],
    queryFn: () => inventoryService.listItems({ activeOnly: true }),
  });

  // Load existing counts for selected date
  const existingCounts = useQuery({
    queryKey: ["stock-count", "counts", branchId, selectedDate],
    queryFn: () => stockCountsService.listCounts(branchId!, selectedDate),
    enabled: !!branchId,
  });

  // Initialize entries when items/counts load
  useEffect(() => {
    if (!items.data) return;

    const countMap = new Map<string, { qty: number; notes: string | null }>();
    for (const count of existingCounts.data ?? []) {
      countMap.set(count.item_id, {
        qty: Number(count.qty),
        notes: count.notes,
      });
    }

    const newEntries: CountEntry[] = items.data.map((item) => {
      const existing = countMap.get(item.id);
      return {
        item_id: item.id,
        name: item.name,
        current_qty: Number(item.qty_on_hand),
        counted_qty: existing !== undefined ? String(existing.qty) : "",
        notes: existing?.notes ?? "",
        unit: item.units?.code ?? "",
        changed: false,
      };
    });

    setEntries(newEntries);
    setHydrated(true);
  }, [items.data, existingCounts.data]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("No branch found");

      const changedEntries = entries.filter(
        (e) => e.changed && e.counted_qty !== "",
      );

      if (changedEntries.length === 0) {
        throw new Error("No counts to save");
      }

      const counts = changedEntries.map((e) => ({
        item_id: e.item_id,
        qty: Number(e.counted_qty),
        notes: e.notes || undefined,
      }));

      await stockCountsService.saveCounts(branchId, selectedDate, counts);
    },
    onSuccess: (_, __, context) => {
      const count = entries.filter((e) => e.changed && e.counted_qty !== "").length;
      toast.success(`${count} item${count === 1 ? "" : "s"} count${count === 1 ? "" : "s"} saved`);
      qc.invalidateQueries({ queryKey: ["stock-count"] });
      setEntries((prev) =>
        prev.map((e) => ({ ...e, changed: false })),
      );
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Filter items
  const categories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const item of items.data ?? []) {
      const cat = item.categories?.name ?? "Uncategorized";
      cats.set(cat, (cats.get(cat) ?? 0) + 1);
    }
    return [...cats.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items.data]);

  const filtered = useMemo(() => {
    let list = entries;
    if (search.trim()) {
      const needle = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(needle) ||
          e.unit.toLowerCase().includes(needle),
      );
    }
    if (categoryFilter !== "all") {
      const catItemIds = new Set(
        (items.data ?? [])
          .filter((i) => i.categories?.name === categoryFilter)
          .map((i) => i.id),
      );
      list = list.filter((e) => catItemIds.has(e.item_id));
    }
    return list;
  }, [entries, search, categoryFilter, items.data]);

  const changedCount = entries.filter((e) => e.changed && e.counted_qty !== "").length;

  const updateCount = (itemId: string, value: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.item_id === itemId
          ? { ...e, counted_qty: value, changed: true }
          : e,
      ),
    );
  };

  const updateNotes = (itemId: string, value: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.item_id === itemId
          ? { ...e, notes: value, changed: e.counted_qty !== "" }
          : e,
      ),
    );
  };

  const resetToSystem = (itemId: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.item_id === itemId
          ? {
              ...e,
              counted_qty: String(e.current_qty),
              changed: true,
            }
          : e,
      ),
    );
  };

  if (!branchId) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        {membership.isLoading ? "Loading branch..." : "No branch found for your account."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Stock Count</h1>
          <p className="text-sm text-muted-foreground">
            Record daily physical inventory counts. Closing count today becomes tomorrow's opening.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Count Date</Label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="mt-5">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || changedCount === 0}
              className="gap-1.5"
            >
              {saveMutation.isPending ? (
                "Saving..."
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save {changedCount} count{changedCount === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {items.isLoading && <LoadingState label="Loading inventory items..." />}
      {items.error && <ErrorState error={items.error} label="Could not load items" />}
      {existingCounts.isLoading && <LoadingState label="Loading existing counts..." />}

      {!items.isLoading && !items.error && (
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-48 flex-1 max-w-xs"
            />
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setCategoryFilter("all")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  categoryFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                All ({entries.length})
              </button>
              {categories.map(([cat, count]) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    categoryFilter === cat
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {cat} ({count})
                </button>
              ))}
            </div>
          </div>

          {hydrated && (
            <div className="space-y-0">
              {/* Header */}
              <div className="grid grid-cols-[1fr_100px_100px_80px_1fr_auto] gap-2 px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div>Item</div>
                <div className="text-right">System Qty</div>
                <div className="text-right">Counted Qty *</div>
                <div className="text-right">Unit</div>
                <div>Notes</div>
                <div></div>
              </div>

              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No items to count.
                </p>
              )}

              {filtered.map((entry) => {
                const discrepancy =
                  entry.counted_qty !== ""
                    ? Number(entry.counted_qty) - entry.current_qty
                    : 0;
                const hasDiscrepancy =
                  entry.counted_qty !== "" && Math.abs(discrepancy) > 0.001;

                return (
                  <div
                    key={entry.item_id}
                    className={`grid grid-cols-[1fr_100px_100px_80px_1fr_auto] gap-2 items-center px-3 py-2 border-b border-border/50 transition-colors ${
                      entry.changed
                        ? "bg-primary/5"
                        : hasDiscrepancy
                          ? "bg-warning/5"
                          : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">
                        {entry.name}
                      </span>
                      {hasDiscrepancy && (
                        <span
                          className={`text-[10px] font-semibold ${
                            discrepancy < 0 ? "text-destructive" : "text-success"
                          }`}
                        >
                          {discrepancy > 0 ? "+" : ""}
                          {fmtQty(discrepancy)} {entry.unit}
                        </span>
                      )}
                    </div>
                    <div className="text-right text-sm text-muted-foreground tabular-nums">
                      {fmtQty(entry.current_qty)}
                    </div>
                    <div>
                      <Input
                        type="number"
                        value={entry.counted_qty}
                        onChange={(e) =>
                          updateCount(entry.item_id, e.target.value)
                        }
                        placeholder="—"
                        className={`h-8 text-right tabular-nums text-sm ${
                          hasDiscrepancy
                            ? discrepancy < 0
                              ? "border-destructive/50 focus-visible:ring-destructive"
                              : "border-success/50 focus-visible:ring-success"
                            : ""
                        }`}
                        step="any"
                      />
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {entry.unit}
                    </div>
                    <div>
                      <Input
                        value={entry.notes}
                        onChange={(e) =>
                          updateNotes(entry.item_id, e.target.value)
                        }
                        placeholder="Notes..."
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => resetToSystem(entry.item_id)}
                        title="Use system qty"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              {filtered.length > 0 && (
                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      // Auto-fill all items with system qty
                      setEntries((prev) =>
                        prev.map((e) => ({
                          ...e,
                          counted_qty: String(e.current_qty),
                          changed: true,
                        })),
                      );
                      toast.info("All items pre-filled with system quantity");
                    }}
                    className="text-xs"
                  >
                    Pre-fill all with system qty
                  </Button>
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || changedCount === 0}
                    className="gap-1.5"
                  >
                    {saveMutation.isPending ? (
                      "Saving..."
                    ) : (
                      <>
                        <Save className="h-4 w-4" /> Save {changedCount} count
                        {changedCount === 1 ? "" : "s"}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {existingCounts.data && existingCounts.data.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold text-sm mb-2">
            Counts already recorded for {selectedDate}
          </h2>
          <p className="text-xs text-muted-foreground">
            {existingCounts.data.length} items have been counted today.
            Saving again will update the existing counts.
          </p>
        </Card>
      )}
    </div>
  );
}
