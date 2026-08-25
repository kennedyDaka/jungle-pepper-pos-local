import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { staffDisplay } from "@/lib/staffDisplay";
import { inventoryService } from "@/services/inventoryService";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MWK, fmtQty, fmtDate } from "@/lib/format";
import { fmtServingQty, fullServingsPerContainer, servingLabel, servingQty } from "@/lib/beverage";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Save, RotateCcw, Search, AlertTriangle, CheckCircle, XCircle, ArrowDown, ArrowUp, Minus, FlaskConical } from "lucide-react";
import { productionService } from "@/services/productionService";
import { stockCountsService, type StockCountWithItem } from "@/services/stockCountsService";
import { supabase } from "@/services/repositories/supabaseClient";

export const Route = createFileRoute("/_app/inventory")({
  component: InventoryPage,
});

type InventoryTab = "items" | "stock-count" | "reconciliation";

// ── Production (Produced) dialog types ──
type ProdLine = { item_id: string; qty_count: number; weight_kg: number; cook_kg: number };
type ProdWaste = { item_id: string; qty: number; reason: string };
const blankProdLine = (): ProdLine => ({ item_id: "", qty_count: 0, weight_kg: 0, cook_kg: 0 });

// ── Stock Count types ──
type CountEntry = {
  item_id: string;
  name: string;
  current_qty: number;
  counted_qty: string;
  notes: string;
  unit: string;
  changed: boolean;
};

// ── Reconciliation types ──
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

function InventoryPage() {
  const [tab, setTab] = useState<InventoryTab>("items");
  const tabs: { id: InventoryTab; label: string }[] = [
    { id: "items", label: "Items" },
    { id: "stock-count", label: "Stock Count" },
    { id: "reconciliation", label: "Reconciliation" },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "items" && <ItemsTab />}
      {tab === "stock-count" && <StockCountTab />}
      {tab === "reconciliation" && <ReconciliationTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ITEMS TAB
// ═══════════════════════════════════════════════════════════════
function ItemsTab() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const [search, setSearch] = useState("");
  const [stockOpen, setStockOpen] = useState<any | null>(null);
  const [binOpen, setBinOpen] = useState<any | null>(null);
  const [adjOpen, setAdjOpen] = useState<any | null>(null);
  const [removeOpen, setRemoveOpen] = useState<{
    item: any;
    type: "issue_out" | "wastage" | "breakage" | "complimentary";
    title: string;
    notePlaceholder: string;
  } | null>(null);
  const [producedOpen, setProducedOpen] = useState<any | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState<any | null>(null);

  const items = useQuery({
    queryKey: ["inv", "items"],
    queryFn: () => inventoryService.listItems(),
  });

  const deleteItem = async (i: any) => {
    if (!confirm(`Delete "${i.name}"? This soft-deletes it (history preserved).`)) return;
    await inventoryService.archiveItem(i.id);
    toast.success("Item removed");
    qc.invalidateQueries({ queryKey: ["inv"] });
  };

  const filtered = (items.data ?? []).filter((i: any) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <div className="flex gap-2">
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          {isAdmin && (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New item
            </Button>
          )}
        </div>
      </div>
      {items.isLoading && <LoadingState label="Loading live inventory..." />}
      {items.error && <ErrorState error={items.error} label="Could not load inventory" />}
      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left">
              <th className="p-2">Item</th>
              <th className="p-2">Category</th>
              <th className="p-2">Type</th>
              <th className="p-2 text-right">On hand</th>
              <th className="p-2">Unit</th>
              <th className="p-2 text-right">Avg cost</th>
              <th className="p-2 text-right">Reorder</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i: any) => {
              const servings = servingQty(i.qty_on_hand, i);
              return (
                <tr key={i.id} className="border-t border-border hover:bg-secondary/30">
                  <td className="p-2 font-medium">{i.name}</td>
                  <td className="p-2 text-muted-foreground">{i.categories?.name}</td>
                  <td className="p-2 text-xs uppercase text-muted-foreground">{i.stock_type}</td>
                  <td
                    className={`p-2 text-right ${Number(i.qty_on_hand) < 0 ? "text-destructive" : Number(i.qty_on_hand) <= Number(i.reorder_level) && Number(i.reorder_level) > 0 ? "text-warning" : ""}`}
                  >
                    {servings === null ? (
                      fmtQty(i.qty_on_hand)
                    ) : (
                      <>
                        <div>
                          {fmtServingQty(servings)} {servingLabel(i, servings)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtQty(i.qty_on_hand)} {i.units?.code}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="p-2">{i.units?.code}</td>
                  <td className="p-2 text-right">{MWK(i.avg_cost)}</td>
                  <td className="p-2 text-right">{fmtQty(i.reorder_level)}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setStockOpen(i)}>
                      <Plus className="h-3 w-3 mr-1" />
                      Stock-in
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdjOpen(i)}>
                      Adjust
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setRemoveOpen({
                          item: i,
                          type: "issue_out",
                          title: "Issue out",
                          notePlaceholder: "Department / staff / use",
                        })
                      }
                    >
                      Issue
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setProducedOpen(i)}
                    >
                      <FlaskConical className="h-3 w-3 mr-1" />
                      Produced
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setRemoveOpen({
                          item: i,
                          type: "wastage",
                          title: "Record wastage",
                          notePlaceholder: "Reason",
                        })
                      }
                    >
                      Waste
                    </Button>
                    {i.stock_type === "beverage" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setRemoveOpen({
                              item: i,
                              type: "breakage",
                              title: "Record breakage",
                              notePlaceholder: "Bottle / glass / reason",
                            })
                          }
                        >
                          Breakage
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setRemoveOpen({
                              item: i,
                              type: "complimentary",
                              title: "Complimentary issue",
                              notePlaceholder: "Guest / approval / reason",
                            })
                          }
                        >
                          Comp
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setBinOpen(i)}>
                      Bin card
                    </Button>
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditOpen(i)}>
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteItem(i)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {stockOpen && (
        <MovementDialog
          item={stockOpen}
          type="purchase_in"
          title="Stock-in (Purchase)"
          requireCost
          onClose={() => setStockOpen(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["inv"] });
          }}
        />
      )}
      {adjOpen && (
        <MovementDialog
          item={adjOpen}
          type="adjustment"
          title="Stock adjustment"
          allowNegative
          onClose={() => setAdjOpen(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["inv"] });
          }}
        />
      )}
      {removeOpen && (
        <MovementDialog
          item={removeOpen.item}
          type={removeOpen.type}
          title={removeOpen.title}
          forceNegative
          notePlaceholder={removeOpen.notePlaceholder}
          onClose={() => setRemoveOpen(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["inv"] });
          }}
        />
      )}
      {producedOpen && (
        <ProducedDialog
          onClose={() => setProducedOpen(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["inv"] });
            qc.invalidateQueries({ queryKey: ["prod"] });
          }}
        />
      )}
      {binOpen && <BinCardDialog item={binOpen} onClose={() => setBinOpen(null)} />}
      {newOpen && (
        <NewItemDialog
          onClose={() => setNewOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["inv"] });
            setNewOpen(false);
          }}
        />
      )}
      {editOpen && (
        <EditItemDialog
          item={editOpen}
          onClose={() => setEditOpen(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["inv"] });
            setEditOpen(null);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRODUCED DIALOG (production batch — from inventory)
// ═══════════════════════════════════════════════════════════════
function ProducedDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [inputs, setInputs] = useState<ProdLine[]>([blankProdLine()]);
  const [outputs, setOutputs] = useState<ProdLine[]>([blankProdLine()]);
  const [wastage, setWastage] = useState<ProdWaste[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const items = useQuery({
    queryKey: ["prod", "items"],
    queryFn: () => productionService.listItems(),
  });

  const itemMap = new Map<string, any>();
  items.data?.forEach((i: any) => itemMap.set(i.id, i));
  const unitOf = (id: string) => itemMap.get(id)?.units?.code ?? "";

  const effectiveQty = (l: ProdLine) => {
    const u = unitOf(l.item_id);
    if (u === "kg") return Number(l.weight_kg) || 0;
    if (u === "g") return (Number(l.weight_kg) || 0) * 1000;
    return Number(l.qty_count) || 0;
  };

  const submit = async () => {
    const buildPayload = (lines: ProdLine[]) =>
      lines
        .filter((l) => l.item_id && (Number(l.qty_count) > 0 || Number(l.weight_kg) > 0))
        .map((l) => ({
          item_id: l.item_id,
          qty: effectiveQty(l),
          qty_count: Number(l.qty_count) || null,
          weight_kg: Number(l.weight_kg) || null,
          cook_kg: Number(l.cook_kg) || null,
        }));
    const cleanIn = buildPayload(inputs);
    const cleanOut = buildPayload(outputs);
    if (!cleanIn.length || !cleanOut.length) {
      toast.error("Add at least one input and output");
      return;
    }
    const cleanWastage = wastage
      .filter((line) => line.item_id && Number(line.qty) > 0)
      .map((line) => ({
        item_id: line.item_id,
        qty: Number(line.qty),
        reason: line.reason.trim() || "Production wastage",
      }));
    setBusy(true);
    await productionService.applyProduction({
      inputs: cleanIn,
      outputs: cleanOut,
      wastage: cleanWastage,
      note,
    });
    setBusy(false);
    toast.success("Production batch saved");
    onDone();
    onClose();
  };

  const ItemSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select item" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {items.data?.map((i: any) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name} ({i.units?.code})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const ProdLineRow = ({
    l,
    idx,
    lines,
    setLines,
    showCookKg,
  }: {
    l: ProdLine;
    idx: number;
    lines: ProdLine[];
    setLines: (x: ProdLine[]) => void;
    showCookKg?: boolean;
  }) => {
    const u = unitOf(l.item_id);
    const eff = effectiveQty(l);
    return (
      <div className="space-y-1 p-2 border border-border rounded-md">
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <ItemSelect
              value={l.item_id}
              onChange={(v) =>
                setLines(lines.map((x, i) => (i === idx ? { ...x, item_id: v } : x)))
              }
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLines(lines.filter((_, i) => i !== idx))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Quantity (pieces / pkts)</Label>
            <Input
              type="number"
              step="0.001"
              value={l.qty_count || ""}
              placeholder="0"
              onChange={(e) =>
                setLines(
                  lines.map((x, i) =>
                    i === idx ? { ...x, qty_count: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </div>
          <div>
            <Label className="text-xs">Weight (kg)</Label>
            <Input
              type="number"
              step="0.001"
              value={l.weight_kg || ""}
              placeholder="0.000"
              onChange={(e) =>
                setLines(
                  lines.map((x, i) =>
                    i === idx ? { ...x, weight_kg: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </div>
        </div>
        {showCookKg && (
          <div>
            <Label className="text-xs">Cook kg (post-cooking weight)</Label>
            <Input
              type="number"
              step="0.001"
              value={l.cook_kg || ""}
              placeholder="0.000"
              onChange={(e) =>
                setLines(
                  lines.map((x, i) =>
                    i === idx ? { ...x, cook_kg: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </div>
        )}
        {l.item_id && (
          <div className="text-xs text-muted-foreground">
            Stock will move by{" "}
            <span className="font-medium text-foreground">
              {fmtQty(eff)} {u}
            </span>
            {u === "kg" || u === "g" ? " (using weight)" : " (using quantity)"}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Record Production</DialogTitle>
          <DialogDescription>
            Enter raw ingredients consumed (inputs) and items produced (outputs). This deducts
            raw stock and credits produced items.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {items.isLoading && <LoadingState label="Loading items..." />}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Inputs */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">Inputs (raw consumed)</h3>
              {inputs.map((l, idx) => (
                <ProdLineRow key={idx} l={l} idx={idx} lines={inputs} setLines={setInputs} />
              ))}
              <Button size="sm" variant="secondary" onClick={() => setInputs([...inputs, blankProdLine()])}>
                <Plus className="h-3 w-3 mr-1" />
                Add input
              </Button>
            </div>
            {/* Outputs */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">Outputs (items produced)</h3>
              <p className="text-xs text-muted-foreground">Cost auto-rolled from inputs</p>
              {outputs.map((l, idx) => (
                <ProdLineRow key={idx} l={l} idx={idx} lines={outputs} setLines={setOutputs} showCookKg />
              ))}
              <Button size="sm" variant="secondary" onClick={() => setOutputs([...outputs, blankProdLine()])}>
                <Plus className="h-3 w-3 mr-1" />
                Add output
              </Button>
            </div>
          </div>
          {/* Wastage */}
          <div>
            <h3 className="font-semibold text-sm mb-1">Wastage (optional)</h3>
            {wastage.map((w, idx) => (
              <div key={idx} className="flex gap-2 items-center mb-1">
                <div className="flex-1">
                  <Select
                    value={w.item_id}
                    onValueChange={(v) =>
                      setWastage(wastage.map((x, i) => (i === idx ? { ...x, item_id: v } : x)))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Item" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.data?.map((i: any) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} ({i.units?.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  className="w-28"
                  type="number"
                  step="0.001"
                  placeholder="Qty"
                  value={w.qty}
                  onChange={(e) =>
                    setWastage(
                      wastage.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)),
                    )
                  }
                />
                <Input
                  className="flex-1"
                  placeholder="Reason"
                  value={w.reason}
                  onChange={(e) =>
                    setWastage(
                      wastage.map((x, i) => (i === idx ? { ...x, reason: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setWastage(wastage.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setWastage([...wastage, { item_id: "", qty: 0, reason: "" }])}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add wastage
            </Button>
          </div>
          <div>
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save batch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// STOCK COUNT TAB
// ═══════════════════════════════════════════════════════════════
function StockCountTab() {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [entries, setEntries] = useState<CountEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

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

  const items = useQuery({
    queryKey: ["stock-count", "items"],
    queryFn: () => inventoryService.listItems({ activeOnly: true }),
  });

  const existingCounts = useQuery({
    queryKey: ["stock-count", "counts", branchId, selectedDate],
    queryFn: () => stockCountsService.listCounts(branchId!, selectedDate),
    enabled: !!branchId,
  });

  useEffect(() => {
    if (!items.data) return;
    const countMap = new Map<string, { qty: number; notes: string | null }>();
    for (const count of existingCounts.data ?? []) {
      countMap.set(count.item_id, { qty: Number(count.qty), notes: count.notes });
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("No branch found");
      const changedEntries = entries.filter((e) => e.changed && e.counted_qty !== "");
      if (changedEntries.length === 0) throw new Error("No counts to save");
      const counts = changedEntries.map((e) => ({
        item_id: e.item_id,
        qty: Number(e.counted_qty),
        notes: e.notes || undefined,
      }));
      await stockCountsService.saveCounts(branchId, selectedDate, counts);
    },
    onSuccess: () => {
      const count = entries.filter((e) => e.changed && e.counted_qty !== "").length;
      toast.success(`${count} item${count === 1 ? "" : "s"} count${count === 1 ? "" : "s"} saved`);
      qc.invalidateQueries({ queryKey: ["stock-count"] });
      setEntries((prev) => prev.map((e) => ({ ...e, changed: false })));
    },
    onError: (e: any) => toast.error(e.message),
  });

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
      list = list.filter((e) => e.name.toLowerCase().includes(needle) || e.unit.toLowerCase().includes(needle));
    }
    if (categoryFilter !== "all") {
      const catItemIds = new Set(
        (items.data ?? []).filter((i) => i.categories?.name === categoryFilter).map((i) => i.id),
      );
      list = list.filter((e) => catItemIds.has(e.item_id));
    }
    return list;
  }, [entries, search, categoryFilter, items.data]);

  const changedCount = entries.filter((e) => e.changed && e.counted_qty !== "").length;

  const updateCount = (itemId: string, value: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.item_id === itemId ? { ...e, counted_qty: value, changed: true } : e)),
    );
  };

  const updateNotes = (itemId: string, value: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.item_id === itemId ? { ...e, notes: value, changed: e.counted_qty !== "" } : e,
      ),
    );
  };

  const resetToSystem = (itemId: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.item_id === itemId ? { ...e, counted_qty: String(e.current_qty), changed: true } : e,
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
          <h2 className="text-xl font-bold">Stock Count</h2>
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
              <div className="grid grid-cols-[1fr_100px_100px_80px_1fr_auto] gap-2 px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div>Item</div>
                <div className="text-right">System Qty</div>
                <div className="text-right">Counted Qty *</div>
                <div className="text-right">Unit</div>
                <div>Notes</div>
                <div></div>
              </div>

              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground p-4 text-center">No items to count.</p>
              )}

              {filtered.map((entry) => {
                const discrepancy =
                  entry.counted_qty !== "" ? Number(entry.counted_qty) - entry.current_qty : 0;
                const hasDiscrepancy = entry.counted_qty !== "" && Math.abs(discrepancy) > 0.001;

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
                      <span className="text-sm font-medium truncate block">{entry.name}</span>
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
                        onChange={(e) => updateCount(entry.item_id, e.target.value)}
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
                    <div className="text-right text-xs text-muted-foreground">{entry.unit}</div>
                    <div>
                      <Input
                        value={entry.notes}
                        onChange={(e) => updateNotes(entry.item_id, e.target.value)}
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
          <h2 className="font-semibold text-sm mb-2">Counts already recorded for {selectedDate}</h2>
          <p className="text-xs text-muted-foreground">
            {existingCounts.data.length} items have been counted today. Saving again will update the
            existing counts.
          </p>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RECONCILIATION TAB
// ═══════════════════════════════════════════════════════════════
function ReconciliationTab() {
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "discrepancy" | "no-count" | "ok">("all");
  const [selectedItem, setSelectedItem] = useState<ReconciliationRow | null>(null);

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

  const physicalCounts = useQuery({
    queryKey: ["recon", "counts", branchId, selectedDate],
    queryFn: () => stockCountsService.listCounts(branchId!, selectedDate),
    enabled: !!branchId,
  });

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

  const reconRows = useMemo((): ReconciliationRow[] => {
    const countMap = new Map<string, StockCountWithItem>();
    for (const count of physicalCounts.data ?? []) {
      countMap.set(count.item_id, count);
    }
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
        purchase_in: 0, sale: 0, production_in: 0, production_out: 0,
        wastage: 0, adjustment: 0, other: 0,
      };
      for (const mov of itemMovements) {
        const qty = Number(mov.qty);
        switch (mov.type) {
          case "purchase_in": movementsToday.purchase_in += qty; break;
          case "sale": movementsToday.sale += qty; break;
          case "production_in": movementsToday.production_in += qty; break;
          case "production_out": movementsToday.production_out += qty; break;
          case "wastage": movementsToday.wastage += qty; break;
          case "adjustment": movementsToday.adjustment += qty; break;
          default: movementsToday.other += qty;
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

  const filtered = useMemo(() => {
    let list = reconRows;
    if (search.trim()) {
      const needle = search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(needle) || r.category.toLowerCase().includes(needle));
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

  const stats = useMemo(() => {
    const total = reconRows.length;
    const counted = reconRows.filter((r) => r.physical_qty !== null).length;
    const discrepancies = reconRows.filter((r) => r.discrepancy !== null && Math.abs(r.discrepancy) > 0.001);
    const negative = discrepancies.filter((r) => (r.discrepancy ?? 0) < 0);
    const positive = discrepancies.filter((r) => (r.discrepancy ?? 0) > 0);
    const totalDiscrepancyValue = discrepancies.reduce(
      (sum, r) => sum + Math.abs(r.discrepancy ?? 0) * r.avg_cost, 0,
    );
    return {
      total, counted, notCounted: total - counted,
      discrepancyCount: discrepancies.length,
      negativeCount: negative.length, positiveCount: positive.length,
      totalDiscrepancyValue,
    };
  }, [reconRows]);

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
          <h2 className="text-xl font-bold">Daily Reconciliation</h2>
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
          <div className="text-xl font-bold mt-1">{stats.counted}/{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Discrepancies</div>
          <div className={`text-xl font-bold mt-1 ${stats.discrepancyCount > 0 ? "text-warning" : "text-success"}`}>
            {stats.discrepancyCount}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Shortages</div>
          <div className="text-xl font-bold mt-1 text-destructive">{stats.negativeCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Overages</div>
          <div className="text-xl font-bold mt-1 text-success">{stats.positiveCount}</div>
        </Card>
      </div>

      {stats.totalDiscrepancyValue > 0 && (
        <Card className="p-3 border-warning">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="text-sm">
              Total discrepancy value: <span className="font-bold">{MWK(stats.totalDiscrepancyValue)}</span>
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

          <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px_60px] gap-2 px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <div>Item</div>
            <div className="text-right">System</div>
            <div className="text-right">Physical</div>
            <div className="text-right">Variance</div>
            <div className="text-right">Movements</div>
            <div className="text-right">Value</div>
            <div className="text-center">Status</div>
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center">No items to display.</p>
          )}

          {filtered.map((row) => {
            const hasDiscrepancy = row.discrepancy !== null && Math.abs(row.discrepancy) > 0.001;
            const noCount = row.physical_qty === null;
            const isShortage = (row.discrepancy ?? 0) < 0;
            const movementTotal =
              row.movements_today.purchase_in + row.movements_today.sale +
              row.movements_today.production_in + row.movements_today.production_out +
              row.movements_today.wastage + row.movements_today.adjustment + row.movements_today.other;
            const discrepancyValue = hasDiscrepancy ? Math.abs(row.discrepancy!) * row.avg_cost : 0;

            return (
              <div
                key={row.item_id}
                className={`grid grid-cols-[1fr_80px_80px_80px_80px_80px_60px] gap-2 items-center px-3 py-2 border-b border-border/50 cursor-pointer transition-colors hover:bg-secondary/30 ${
                  hasDiscrepancy
                    ? isShortage ? "bg-destructive/5" : "bg-success/5"
                    : noCount ? "bg-warning/5" : ""
                }`}
                onClick={() => setSelectedItem(row)}
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium truncate block">{row.name}</span>
                  <span className="text-[10px] text-muted-foreground">{row.unit} · {row.category}</span>
                </div>
                <div className="text-right text-sm tabular-nums">{fmtQty(row.system_qty)}</div>
                <div className={`text-right text-sm tabular-nums font-medium ${noCount ? "text-muted-foreground italic" : ""}`}>
                  {noCount ? "—" : fmtQty(row.physical_qty!)}
                </div>
                <div className={`text-right text-sm tabular-nums font-semibold ${
                  hasDiscrepancy ? (isShortage ? "text-destructive" : "text-success") : "text-muted-foreground"
                }`}>
                  {noCount ? "—" : hasDiscrepancy ? `${row.discrepancy! > 0 ? "+" : ""}${fmtQty(row.discrepancy!)}` : "0"}
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
                    <AlertTriangle className={`h-4 w-4 mx-auto ${isShortage ? "text-destructive" : "text-success"}`} />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-success mx-auto" />
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {selectedItem && (
        <Dialog open onOpenChange={() => setSelectedItem(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{selectedItem.name}</DialogTitle>
              <DialogDescription>Reconciliation details for {selectedDate}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-auto space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">System Qty</div>
                  <div className="text-lg font-bold mt-1">{fmtQty(selectedItem.system_qty)} {selectedItem.unit}</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Physical Count</div>
                  <div className="text-lg font-bold mt-1">
                    {selectedItem.physical_qty !== null ? `${fmtQty(selectedItem.physical_qty)} ${selectedItem.unit}` : "Not counted"}
                  </div>
                </Card>
                <Card className={`p-3 ${
                  selectedItem.discrepancy !== null && Math.abs(selectedItem.discrepancy) > 0.001
                    ? selectedItem.discrepancy! < 0 ? "border-destructive" : "border-success" : ""
                }`}>
                  <div className="text-xs text-muted-foreground">Variance</div>
                  <div className={`text-lg font-bold mt-1 ${
                    selectedItem.discrepancy !== null && Math.abs(selectedItem.discrepancy) > 0.001
                      ? selectedItem.discrepancy! < 0 ? "text-destructive" : "text-success" : ""
                  }`}>
                    {selectedItem.physical_qty !== null
                      ? `${selectedItem.discrepancy! > 0 ? "+" : ""}${fmtQty(selectedItem.discrepancy!)} ${selectedItem.unit}`
                      : "—"}
                  </div>
                </Card>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2">Movements Today</h3>
                <div className="grid grid-cols-4 gap-2">
                  <MovementStat label="Purchases" value={selectedItem.movements_today.purchase_in} unit={selectedItem.unit} icon={<ArrowUp className="h-3 w-3 text-success" />} />
                  <MovementStat label="Sales" value={selectedItem.movements_today.sale} unit={selectedItem.unit} icon={<ArrowDown className="h-3 w-3 text-destructive" />} />
                  <MovementStat label="Production In" value={selectedItem.movements_today.production_in} unit={selectedItem.unit} icon={<ArrowUp className="h-3 w-3 text-success" />} />
                  <MovementStat label="Production Out" value={selectedItem.movements_today.production_out} unit={selectedItem.unit} icon={<ArrowDown className="h-3 w-3 text-destructive" />} />
                  <MovementStat label="Wastage" value={selectedItem.movements_today.wastage} unit={selectedItem.unit} icon={<Minus className="h-3 w-3 text-warning" />} />
                  <MovementStat label="Adjustments" value={selectedItem.movements_today.adjustment} unit={selectedItem.unit} icon={<Minus className="h-3 w-3 text-muted-foreground" />} />
                </div>
              </div>
              {selectedItem.movement_details.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-2">Movement Details ({selectedItem.movement_details.length})</h3>
                  <div className="space-y-1 max-h-60 overflow-auto">
                    {selectedItem.movement_details.map((mov, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-secondary/30">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${Number(mov.qty) > 0 ? "bg-success" : "bg-destructive"}`} />
                          <span className="font-medium">{mov.type}</span>
                          {mov.note && <span className="text-muted-foreground truncate max-w-[200px]">{mov.note}</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`tabular-nums ${Number(mov.qty) > 0 ? "text-success" : "text-destructive"}`}>
                            {Number(mov.qty) > 0 ? "+" : ""}{fmtQty(mov.qty)} {selectedItem.unit}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
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

function MovementStat({ label, value, unit, icon }: { label: string; value: number; unit: string; icon: React.ReactNode }) {
  return (
    <div className="p-2 rounded border border-border bg-secondary/20">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">{icon}{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">
        {value !== 0 ? `${fmtQty(value)} ${unit}` : "—"}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED DIALOGS (Movement, New Item, Edit Item, Bin Card)
// ═══════════════════════════════════════════════════════════════
function NewItemDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [stockType, setStockType] = useState("raw");
  const [categoryId, setCategoryId] = useState<string>("");
  const [unitId, setUnitId] = useState<string>("");
  const [reorder, setReorder] = useState(0);
  const [bottleMl, setBottleMl] = useState<number>(0);
  const [shotMl, setShotMl] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const servingPreview = { name, bottle_ml: bottleMl, shot_ml: shotMl };
  const servingsPerContainer = fullServingsPerContainer(servingPreview);
  const cats = useQuery({
    queryKey: ["new-item-cats"],
    queryFn: () => inventoryService.listCategories(),
  });
  const units = useQuery({
    queryKey: ["new-item-units"],
    queryFn: () => inventoryService.listUnits(),
  });
  const submit = async () => {
    if (!name.trim() || !categoryId || !unitId) {
      toast.error("Name, category and unit are required");
      return;
    }
    setBusy(true);
    await inventoryService.createItem({
      name: name.trim(),
      stock_type: stockType as any,
      category_id: categoryId,
      unit_id: unitId,
      reorder_level: reorder,
      bottle_ml: stockType === "beverage" && bottleMl > 0 ? bottleMl : null,
      shot_ml: stockType === "beverage" && shotMl > 0 ? shotMl : null,
    });
    setBusy(false);
    toast.success("Item created");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New inventory item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tomato Fresh" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={stockType} onValueChange={setStockType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="raw">Raw</SelectItem>
                <SelectItem value="production">Production (made in-house)</SelectItem>
                <SelectItem value="consumable">Consumable</SelectItem>
                <SelectItem value="beverage">Beverage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Pick category" /></SelectTrigger>
              <SelectContent>
                {cats.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Pick unit" /></SelectTrigger>
              <SelectContent>
                {units.data?.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reorder level</Label>
            <Input type="number" step="0.001" value={reorder} onChange={(e) => setReorder(Number(e.target.value))} />
          </div>
          {stockType === "beverage" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Bottle/container volume (ml)</Label>
                <Input type="number" step="1" value={bottleMl || ""} placeholder="750 or 5000" onChange={(e) => setBottleMl(Number(e.target.value))} />
              </div>
              <div>
                <Label>Serving size (ml)</Label>
                <Input type="number" step="1" value={shotMl || ""} placeholder="50 or 175" onChange={(e) => setShotMl(Number(e.target.value))} />
              </div>
              {servingsPerContainer !== null && (
                <div className="col-span-2 rounded border border-border bg-secondary/30 px-3 py-2 text-sm">
                  {servingsPerContainer} {servingLabel(servingPreview, servingsPerContainer)} per container
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditItemDialog({ item, onClose, onSaved }: { item: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item.name ?? "");
  const [stockType, setStockType] = useState(item.stock_type ?? "raw");
  const [categoryId, setCategoryId] = useState<string>(item.category_id ?? "");
  const [unitId, setUnitId] = useState<string>(item.unit_id ?? "");
  const [reorder, setReorder] = useState(Number(item.reorder_level) || 0);
  const [bottleMl, setBottleMl] = useState<number>(Number(item.bottle_ml) || 0);
  const [shotMl, setShotMl] = useState<number>(Number(item.shot_ml) || 0);
  const [busy, setBusy] = useState(false);
  const servingPreview = { name, bottle_ml: bottleMl, shot_ml: shotMl };
  const servingsPerContainer = fullServingsPerContainer(servingPreview);
  const cats = useQuery({ queryKey: ["edit-item-cats"], queryFn: () => inventoryService.listCategories() });
  const units = useQuery({ queryKey: ["edit-item-units"], queryFn: () => inventoryService.listUnits() });

  const submit = async () => {
    if (!name.trim() || !categoryId || !unitId) {
      toast.error("Name, category and unit are required");
      return;
    }
    setBusy(true);
    try {
      await inventoryService.updateItem(item.id, {
        name: name.trim(), stock_type: stockType as any, category_id: categoryId,
        unit_id: unitId, reorder_level: reorder,
        bottle_ml: stockType === "beverage" && bottleMl > 0 ? bottleMl : null,
        shot_ml: stockType === "beverage" && shotMl > 0 ? shotMl : null,
      });
      toast.success("Item updated");
      onSaved();
    } catch (error: any) {
      toast.error(error.message ?? "Could not update item");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit inventory item</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Type</Label>
            <Select value={stockType} onValueChange={setStockType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="raw">Raw</SelectItem>
                <SelectItem value="production">Production (made in-house)</SelectItem>
                <SelectItem value="consumable">Consumable</SelectItem>
                <SelectItem value="beverage">Beverage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Pick category" /></SelectTrigger>
              <SelectContent>
                {cats.data?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger><SelectValue placeholder="Pick unit" /></SelectTrigger>
              <SelectContent>
                {units.data?.map((u: any) => (<SelectItem key={u.id} value={u.id}>{u.code} - {u.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Reorder level</Label><Input type="number" step="0.001" value={reorder} onChange={(e) => setReorder(Number(e.target.value))} /></div>
          {stockType === "beverage" && (
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Bottle/container volume (ml)</Label><Input type="number" step="1" value={bottleMl || ""} placeholder="750 or 5000" onChange={(e) => setBottleMl(Number(e.target.value))} /></div>
              <div><Label>Serving size (ml)</Label><Input type="number" step="1" value={shotMl || ""} placeholder="50 or 175" onChange={(e) => setShotMl(Number(e.target.value))} /></div>
              {servingsPerContainer !== null && (
                <div className="col-span-2 rounded border border-border bg-secondary/30 px-3 py-2 text-sm">
                  {servingsPerContainer} {servingLabel(servingPreview, servingsPerContainer)} per container
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({ item, type, title, requireCost, allowNegative, forceNegative, notePlaceholder, onClose, onDone }: {
  item: any; type: string; title: string; requireCost?: boolean; allowNegative?: boolean;
  forceNegative?: boolean; notePlaceholder?: string; onClose: () => void; onDone: () => void;
}) {
  const [qty, setQty] = useState<number>(0);
  const [cost, setCost] = useState<number>(Number(item.avg_cost) || 0);
  const [note, setNote] = useState("");
  const [createdAt, setCreatedAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (qty === 0 || (forceNegative && qty < 0) || (!forceNegative && !allowNegative && qty < 0)) {
      toast.error(forceNegative ? "Enter a positive quantity to remove" : "Enter a quantity");
      return;
    }
    if (requireCost && cost <= 0) {
      toast.error("Cost is required");
      return;
    }
    setBusy(true);
    try {
      await inventoryService.applyStockMovementWithDate({
        itemId: item.id, type: type as any,
        qty: forceNegative ? -Math.abs(qty) : qty,
        unitCost: cost, note: note || "", createdAt: createdAt,
      });
      toast.success("Saved");
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Could not save stock movement");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title} — {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{forceNegative ? "Quantity to remove" : "Quantity"} ({item.units?.code}){" "}
              {allowNegative && <span className="text-xs text-muted-foreground">— use negative to reduce</span>}
            </Label>
            <Input type="number" step="0.001" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          <div>
            <Label>Unit cost (MWK){requireCost && " *"}</Label>
            <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={createdAt} onChange={(e) => setCreatedAt(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={notePlaceholder ?? "Reason / supplier / reference"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BinCardDialog({ item, onClose }: { item: any; onClose: () => void }) {
  const moves = useQuery({
    queryKey: ["bin", item.id],
    queryFn: () => inventoryService.listStockMovements(item.id),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>Bin card — {item.name}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left">
                <th className="p-2">Date</th>
                <th className="p-2">Source</th>
                <th className="p-2">Dish / destination</th>
                <th className="p-2">Type</th>
                <th className="p-2 text-right">In</th>
                <th className="p-2 text-right">Out</th>
                <th className="p-2 text-right">Balance</th>
                <th className="p-2 text-right">Unit cost</th>
                <th className="p-2">User</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {moves.data?.map((m: any) => {
                const qty = Number(m.qty);
                const movementItem = m.items ?? item;
                const unit = movementItem?.units?.code ?? item.units?.code ?? "";
                const movementQty = (value: number) => {
                  const raw = Math.abs(value);
                  const servings = servingQty(raw, movementItem);
                  if (servings === null) return `${fmtQty(raw)} ${unit}`;
                  return `${fmtServingQty(servings)} ${servingLabel(movementItem, servings)} (${fmtQty(raw)} ${unit})`;
                };
                const balanceServings = servingQty(m.qty_after, movementItem);
                return (
                  <tr key={m.id} className="border-t border-border align-top">
                    <td className="p-2 whitespace-nowrap">{fmtDate(m.created_at)}</td>
                    <td className="p-2 font-medium">{m.source_label ?? m.ref_type ?? m.type}</td>
                    <td className="p-2 min-w-56">
                      <div>{m.destination || m.menu_item_names || m.source_detail || "-"}</div>
                      {m.invoice_no && <div className="text-xs text-muted-foreground">Invoice {m.invoice_no}</div>}
                    </td>
                    <td className="p-2 text-xs uppercase">{m.type}</td>
                    <td className="p-2 text-right text-success">{qty > 0 ? movementQty(qty) : ""}</td>
                    <td className="p-2 text-right text-destructive">{qty < 0 ? movementQty(qty) : ""}</td>
                    <td className="p-2 text-right">
                      {m.qty_after === null || m.qty_after === undefined
                        ? ""
                        : balanceServings === null
                          ? `${fmtQty(m.qty_after)} ${unit}`
                          : `${fmtServingQty(balanceServings)} ${servingLabel(movementItem, balanceServings)} (${fmtQty(m.qty_after)} ${unit})`}
                    </td>
                    <td className="p-2 text-right">{MWK(m.unit_cost)}</td>
                    <td className="p-2">{staffDisplay(m.profiles)}</td>
                    <td className="p-2 text-muted-foreground">{m.source_detail || m.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
