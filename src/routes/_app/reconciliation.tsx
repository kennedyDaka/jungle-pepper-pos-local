import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MWK, fmtQty, fmtDateTime } from "@/lib/format";
import { supabase } from "@/services/repositories/supabaseClient";
import { stockCountsService, type StockCountWithItem } from "@/services/stockCountsService";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingDown,
  TrendingUp,
  Search,
  ArrowDown,
  ArrowUp,
  Minus,
} from "lucide-react";

export const Route = createFileRoute("/_app/reconciliation")({
  component: ReconciliationPage,
});

type ReconciliationRow = {
  item_id: string;
  name: string;
  unit: string;
  category: string;
  stock_type: string;
  system_qty: number;
  physical_qty: number | null;
  discrepancy: number | null;
  reorder_level: number;
  avg_cost: number;
  movements_today: {
    purchase_in: number;
    sale: number;
    production_in: number;
    production_out: number;
    wastage: number;
    adjustment: number;
    other: number;
  };
  movement_details: Array<{
    type: string;
    qty: number;
    unit_cost: number;
    note: string | null;
    created_at: string;
  }>;
};

type MovementDetail = {
  id: string;
  item_id: string;
  type: string;
  qty: number;
  unit_cost: number;
  note: string | null;
  created_at: string;
  items?: { name: string; units?: { code: string } | null } | null;
};

function ReconciliationPage() {
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "discrepancy" | "no-count" | "ok">("all");
  const [selectedItem, setSelectedItem] = useState<ReconciliationRow | null>(null);

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
    queryKey: ["recon", "items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name, qty_on_hand, avg_cost, reorder_level, stock_type, units(code), categories(name)")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Load physical counts for selected date
  const physicalCounts = useQuery({
    queryKey: ["recon", "counts", branchId, selectedDate],
    queryFn: () => stockCountsService.listCounts(branchId!, selectedDate),
    enabled: !!branchId,
  });

  // Load movements for selected date
  const movements = useQuery({
    queryKey: ["recon", "movements", branchId, selectedDate],
    queryFn: async () => {
      const fromIso = `${selectedDate}T00:00:00Z`;
      const toIso = `${selectedDate}T23:59:59Z`;
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, item_id, type, qty, unit_cost, note, created_at, items(name, units(code))")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MovementDetail[];
    },
    enabled: !!branchId,
  });

  // Build reconciliation rows
  const reconRows = useMemo((): ReconciliationRow[] => {
    const countMap = new Map<string, StockCountWithItem>();
    for (const count of physicalCounts.data ?? []) {
      countMap.set(count.item_id, count);
    }

    // Group movements by item
    const movByItem = new Map<string, MovementDetail[]>();
    for (const mov of movements.data ?? []) {
      const existing = movByItem.get(mov.item_id) ?? [];
      existing.push(mov);
      movByItem.set(mov.item_id, existing);
    }

    return (items.data ?? []).map((item) => {
      const physicalCount = countMap.get(item.id);
      const physicalQty = physicalCount ? Number(physicalCount.qty) : null;
      const systemQty = Number(item.qty_on_hand);
      const discrepancy = physicalQty !== null ? physicalQty - systemQty : null;

      const itemMovements = movByItem.get(item.id) ?? [];
      const movementsToday = {
        purchase_in: 0,
        sale: 0,
        production_in: 0,
        production_out: 0,
        wastage: 0,
        adjustment: 0,
        other: 0,
      };

      for (const mov of itemMovements) {
        const qty = Number(mov.qty);
        switch (mov.type) {
          case "purchase_in":
            movementsToday.purchase_in += qty;
            break;
          case "sale":
            movementsToday.sale += qty;
            break;
          case "production_in":
            movementsToday.production_in += qty;
            break;
          case "production_out":
            movementsToday.production_out += qty;
            break;
          case "wastage":
            movementsToday.wastage += qty;
            break;
          case "adjustment":
            movementsToday.adjustment += qty;
            break;
          default:
            movementsToday.other += qty;
        }
      }

      return {
        item_id: item.id,
        name: item.name,
        unit: (item.units as any)?.code ?? "",
        category: (item.categories as any)?.name ?? "Uncategorized",
        stock_type: item.stock_type ?? "",
        system_qty: systemQty,
        physical_qty: physicalQty,
        discrepancy,
        reorder_level: Number(item.reorder_level),
        avg_cost: Number(item.avg_cost),
        movements_today: movementsToday,
        movement_details: itemMovements.map((m) => ({
          type: m.type,
          qty: Number(m.qty),
          unit_cost: Number(m.unit_cost),
          note: m.note,
          created_at: m.created_at,
        })),
      };
    });
  }, [items.data, physicalCounts.data, movements.data]);

  // Filter rows
  const filtered = useMemo(() => {
    let list = reconRows;

    if (search.trim()) {
      const needle = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          r.category.toLowerCase().includes(needle),
      );
    }

    if (categoryFilter !== "all") {
      list = list.filter((r) => r.category === categoryFilter);
    }

    if (statusFilter === "discrepancy") {
      list = list.filter((r) => r.discrepancy !== null && Math.abs(r.discrepancy) > 0.001);
    } else if (statusFilter === "no-count") {
      list = list.filter((r) => r.physical_qty === null);
    } else if (statusFilter === "ok") {
      list = list.filter((r) => r.discrepancy !== null && Math.abs(r.discrepancy) <= 0.001);
    }

    return list;
  }, [reconRows, search, categoryFilter, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = reconRows.length;
    const counted = reconRows.filter((r) => r.physical_qty !== null).length;
    const discrepancies = reconRows.filter(
      (r) => r.discrepancy !== null && Math.abs(r.discrepancy) > 0.001,
    );
    const negative = discrepancies.filter((r) => (r.discrepancy ?? 0) < 0);
    const positive = discrepancies.filter((r) => (r.discrepancy ?? 0) > 0);
    const totalDiscrepancyValue = discrepancies.reduce(
      (sum, r) => sum + Math.abs(r.discrepancy ?? 0) * r.avg_cost,
      0,
    );

    return {
      total,
      counted,
      notCounted: total - counted,
      discrepancyCount: discrepancies.length,
      negativeCount: negative.length,
      positiveCount: positive.length,
      totalDiscrepancyValue,
    };
  }, [reconRows]);

  // Categories for filter
  const categories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const row of reconRows) {
      cats.set(row.category, (cats.get(row.category) ?? 0) + 1);
    }
    return [...cats.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [reconRows]);

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
          <h1 className="text-2xl font-bold">Daily Reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Compare physical stock counts vs system quantities. Discrepancies highlighted.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Items Counted</div>
          <div className="text-xl font-bold mt-1">
            {stats.counted}/{stats.total}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Discrepancies</div>
          <div className={`text-xl font-bold mt-1 ${stats.discrepancyCount > 0 ? "text-warning" : "text-success"}`}>
            {stats.discrepancyCount}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Shortages</div>
          <div className="text-xl font-bold mt-1 text-destructive">
            {stats.negativeCount}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Overages</div>
          <div className="text-xl font-bold mt-1 text-success">
            {stats.positiveCount}
          </div>
        </Card>
      </div>

      {stats.totalDiscrepancyValue > 0 && (
        <Card className="p-3 border-warning">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="text-sm">
              Total discrepancy value:{" "}
              <span className="font-bold">{MWK(stats.totalDiscrepancyValue)}</span>
            </span>
          </div>
        </Card>
      )}

      {(items.isLoading || physicalCounts.isLoading || movements.isLoading) && (
        <LoadingState label="Loading reconciliation data..." />
      )}
      {(items.error || physicalCounts.error || movements.error) && (
        <ErrorState error={items.error || physicalCounts.error || movements.error} label="Could not load data" />
      )}

      {!items.isLoading && !items.error && (
        <Card className="p-4">
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All items</SelectItem>
                <SelectItem value="discrepancy">Has discrepancy</SelectItem>
                <SelectItem value="no-count">Not counted</SelectItem>
                <SelectItem value="ok">Counts match</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setCategoryFilter("all")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  categoryFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                All
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

          {/* Table Header */}
          <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px_60px] gap-2 px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <div>Item</div>
            <div className="text-right">System</div>
            <div className="text-right">Physical</div>
            <div className="text-right">Variance</div>
            <div className="text-right">Movements</div>
            <div className="text-right">Value</div>
            <div className="text-center">Status</div>
          </div>

          {/* Rows */}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center">
              No items to display.
            </p>
          )}

          {filtered.map((row) => {
            const hasDiscrepancy =
              row.discrepancy !== null && Math.abs(row.discrepancy) > 0.001;
            const noCount = row.physical_qty === null;
            const isShortage = (row.discrepancy ?? 0) < 0;
            const isOverage = (row.discrepancy ?? 0) > 0;
            const movementTotal =
              row.movements_today.purchase_in +
              row.movements_today.sale +
              row.movements_today.production_in +
              row.movements_today.production_out +
              row.movements_today.wastage +
              row.movements_today.adjustment +
              row.movements_today.other;
            const discrepancyValue = hasDiscrepancy
              ? Math.abs(row.discrepancy!) * row.avg_cost
              : 0;

            return (
              <div
                key={row.item_id}
                className={`grid grid-cols-[1fr_80px_80px_80px_80px_80px_60px] gap-2 items-center px-3 py-2 border-b border-border/50 cursor-pointer transition-colors hover:bg-secondary/30 ${
                  hasDiscrepancy
                    ? isShortage
                      ? "bg-destructive/5"
                      : "bg-success/5"
                    : noCount
                      ? "bg-warning/5"
                      : ""
                }`}
                onClick={() => setSelectedItem(row)}
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium truncate block">{row.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {row.unit} · {row.category}
                  </span>
                </div>
                <div className="text-right text-sm tabular-nums">
                  {fmtQty(row.system_qty)}
                </div>
                <div
                  className={`text-right text-sm tabular-nums font-medium ${
                    noCount ? "text-muted-foreground italic" : ""
                  }`}
                >
                  {noCount ? "—" : fmtQty(row.physical_qty!)}
                </div>
                <div
                  className={`text-right text-sm tabular-nums font-semibold ${
                    hasDiscrepancy
                      ? isShortage
                        ? "text-destructive"
                        : "text-success"
                      : "text-muted-foreground"
                  }`}
                >
                  {noCount
                    ? "—"
                    : hasDiscrepancy
                      ? `${row.discrepancy! > 0 ? "+" : ""}${fmtQty(row.discrepancy!)}`
                      : "0"}
                </div>
                <div className="text-right text-xs text-muted-foreground tabular-nums">
                  {movementTotal !== 0 ? `${fmtQty(movementTotal)} ${row.unit}` : "—"}
                </div>
                <div className="text-right text-xs tabular-nums">
                  {discrepancyValue > 0 ? MWK(discrepancyValue) : "—"}
                </div>
                <div className="text-center">
                  {noCount ? (
                    <XCircle className="h-4 w-4 text-warning mx-auto" />
                  ) : hasDiscrepancy ? (
                    <AlertTriangle
                      className={`h-4 w-4 mx-auto ${
                        isShortage ? "text-destructive" : "text-success"
                      }`}
                    />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-success mx-auto" />
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Item Detail Dialog */}
      {selectedItem && (
        <Dialog open onOpenChange={() => setSelectedItem(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{selectedItem.name}</DialogTitle>
              <DialogDescription>
                Reconciliation details for {selectedDate}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-auto space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">System Qty</div>
                  <div className="text-lg font-bold mt-1">
                    {fmtQty(selectedItem.system_qty)} {selectedItem.unit}
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Physical Count</div>
                  <div className="text-lg font-bold mt-1">
                    {selectedItem.physical_qty !== null
                      ? `${fmtQty(selectedItem.physical_qty)} ${selectedItem.unit}`
                      : "Not counted"}
                  </div>
                </Card>
                <Card
                  className={`p-3 ${
                    selectedItem.discrepancy !== null && Math.abs(selectedItem.discrepancy) > 0.001
                      ? selectedItem.discrepancy! < 0
                        ? "border-destructive"
                        : "border-success"
                      : ""
                  }`}
                >
                  <div className="text-xs text-muted-foreground">Variance</div>
                  <div
                    className={`text-lg font-bold mt-1 ${
                      selectedItem.discrepancy !== null && Math.abs(selectedItem.discrepancy) > 0.001
                        ? selectedItem.discrepancy! < 0
                          ? "text-destructive"
                          : "text-success"
                        : ""
                    }`}
                  >
                    {selectedItem.physical_qty !== null
                      ? `${selectedItem.discrepancy! > 0 ? "+" : ""}${fmtQty(selectedItem.discrepancy!)} ${selectedItem.unit}`
                      : "—"}
                  </div>
                  {selectedItem.discrepancy !== null && Math.abs(selectedItem.discrepancy) > 0.001 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {MWK(Math.abs(selectedItem.discrepancy!) * selectedItem.avg_cost)}
                    </div>
                  )}
                </Card>
              </div>

              {/* Movement Summary */}
              <div>
                <h3 className="font-semibold text-sm mb-2">Movements Today</h3>
                <div className="grid grid-cols-4 gap-2">
                  <MovementStat
                    label="Purchases"
                    value={selectedItem.movements_today.purchase_in}
                    unit={selectedItem.unit}
                    icon={<ArrowUp className="h-3 w-3 text-success" />}
                  />
                  <MovementStat
                    label="Sales"
                    value={selectedItem.movements_today.sale}
                    unit={selectedItem.unit}
                    icon={<ArrowDown className="h-3 w-3 text-destructive" />}
                  />
                  <MovementStat
                    label="Production In"
                    value={selectedItem.movements_today.production_in}
                    unit={selectedItem.unit}
                    icon={<ArrowUp className="h-3 w-3 text-success" />}
                  />
                  <MovementStat
                    label="Production Out"
                    value={selectedItem.movements_today.production_out}
                    unit={selectedItem.unit}
                    icon={<ArrowDown className="h-3 w-3 text-destructive" />}
                  />
                  <MovementStat
                    label="Wastage"
                    value={selectedItem.movements_today.wastage}
                    unit={selectedItem.unit}
                    icon={<Minus className="h-3 w-3 text-warning" />}
                  />
                  <MovementStat
                    label="Adjustments"
                    value={selectedItem.movements_today.adjustment}
                    unit={selectedItem.unit}
                    icon={<Minus className="h-3 w-3 text-muted-foreground" />}
                  />
                  <MovementStat
                    label="Other"
                    value={selectedItem.movements_today.other}
                    unit={selectedItem.unit}
                    icon={<Minus className="h-3 w-3 text-muted-foreground" />}
                  />
                </div>
              </div>

              {/* Movement Details */}
              {selectedItem.movement_details.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-2">
                    Movement Details ({selectedItem.movement_details.length})
                  </h3>
                  <div className="space-y-1 max-h-60 overflow-auto">
                    {selectedItem.movement_details.map((mov, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-secondary/30"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${
                              Number(mov.qty) > 0 ? "bg-success" : "bg-destructive"
                            }`}
                          />
                          <span className="font-medium">{mov.type}</span>
                          {mov.note && (
                            <span className="text-muted-foreground truncate max-w-[200px]">
                              {mov.note}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`tabular-nums ${
                              Number(mov.qty) > 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {Number(mov.qty) > 0 ? "+" : ""}
                            {fmtQty(mov.qty)} {selectedItem.unit}
                          </span>
                          <span className="text-muted-foreground tabular-nums w-16 text-right">
                            {MWK(Math.abs(Number(mov.qty)) * Number(mov.unit_cost))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedItem.movement_details.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No movements recorded for this item on {selectedDate}.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button onClick={() => setSelectedItem(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function MovementStat({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-2 rounded border border-border bg-secondary/20">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">
        {value !== 0 ? `${fmtQty(value)} ${unit}` : "—"}
      </div>
    </div>
  );
}
