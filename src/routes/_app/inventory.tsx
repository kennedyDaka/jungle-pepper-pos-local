import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { staffDisplay } from "@/lib/staffDisplay";
import { inventoryService } from "@/services/inventoryService";
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
  DialogFooter,
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
import { Pencil, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_app/inventory")({
  component: InventoryPage,
});

function InventoryPage() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [stockOpen, setStockOpen] = useState<any | null>(null);
  const [binOpen, setBinOpen] = useState<any | null>(null);
  const [adjOpen, setAdjOpen] = useState<any | null>(null);
  const [removeOpen, setRemoveOpen] = useState<{
    item: any;
    type: "issue_out" | "wastage" | "breakage" | "complimentary";
    title: string;
    notePlaceholder: string;
  } | null>(null);
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
    i.name.toLowerCase().includes(search.toLowerCase()) &&
    (locationFilter === "all" || i.location === locationFilter),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <div className="flex gap-2">
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="kitchen">Kitchen</SelectItem>
              <SelectItem value="stores">Stores</SelectItem>
            </SelectContent>
          </Select>
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
              <th className="p-2">Location</th>
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
                  <td className="p-2 text-xs uppercase text-muted-foreground">{i.location ?? "—"}</td>
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
    queryFn: async () => {
      return inventoryService.listCategories();
    },
  });
  const units = useQuery({
    queryKey: ["new-item-units"],
    queryFn: async () => {
      return inventoryService.listUnits();
    },
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
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tomato Fresh"
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={stockType} onValueChange={setStockType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
              <SelectTrigger>
                <SelectValue placeholder="Pick category" />
              </SelectTrigger>
              <SelectContent>
                {cats.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick unit" />
              </SelectTrigger>
              <SelectContent>
                {units.data?.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reorder level</Label>
            <Input
              type="number"
              step="0.001"
              value={reorder}
              onChange={(e) => setReorder(Number(e.target.value))}
            />
          </div>
          {stockType === "beverage" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Bottle/container volume (ml)</Label>
                <Input
                  type="number"
                  step="1"
                  value={bottleMl || ""}
                  placeholder="750 or 5000"
                  onChange={(e) => setBottleMl(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Serving size (ml)</Label>
                <Input
                  type="number"
                  step="1"
                  value={shotMl || ""}
                  placeholder="50 or 175"
                  onChange={(e) => setShotMl(Number(e.target.value))}
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Set both for pour-controlled beverages: 50ml shots for spirits, 175ml glasses for
                wine. Leave blank for bottled drinks sold whole.
              </p>
              {servingsPerContainer !== null && (
                <div className="col-span-2 rounded border border-border bg-secondary/30 px-3 py-2 text-sm">
                  {servingsPerContainer} {servingLabel(servingPreview, servingsPerContainer)} per
                  container
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditItemDialog({
  item,
  onClose,
  onSaved,
}: {
  item: any;
  onClose: () => void;
  onSaved: () => void;
}) {
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
  const cats = useQuery({
    queryKey: ["edit-item-cats"],
    queryFn: () => inventoryService.listCategories(),
  });
  const units = useQuery({
    queryKey: ["edit-item-units"],
    queryFn: () => inventoryService.listUnits(),
  });

  const submit = async () => {
    if (!name.trim() || !categoryId || !unitId) {
      toast.error("Name, category and unit are required");
      return;
    }
    setBusy(true);
    try {
      await inventoryService.updateItem(item.id, {
        name: name.trim(),
        stock_type: stockType as any,
        category_id: categoryId,
        unit_id: unitId,
        reorder_level: reorder,
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
        <DialogHeader>
          <DialogTitle>Edit inventory item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={stockType} onValueChange={setStockType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
              <SelectTrigger>
                <SelectValue placeholder="Pick category" />
              </SelectTrigger>
              <SelectContent>
                {cats.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick unit" />
              </SelectTrigger>
              <SelectContent>
                {units.data?.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.code} - {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reorder level</Label>
            <Input
              type="number"
              step="0.001"
              value={reorder}
              onChange={(e) => setReorder(Number(e.target.value))}
            />
          </div>
          {stockType === "beverage" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Bottle/container volume (ml)</Label>
                <Input
                  type="number"
                  step="1"
                  value={bottleMl || ""}
                  placeholder="750 or 5000"
                  onChange={(e) => setBottleMl(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Serving size (ml)</Label>
                <Input
                  type="number"
                  step="1"
                  value={shotMl || ""}
                  placeholder="50 or 175"
                  onChange={(e) => setShotMl(Number(e.target.value))}
                />
              </div>
              {servingsPerContainer !== null && (
                <div className="col-span-2 rounded border border-border bg-secondary/30 px-3 py-2 text-sm">
                  {servingsPerContainer} {servingLabel(servingPreview, servingsPerContainer)} per
                  container
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  item,
  type,
  title,
  requireCost,
  allowNegative,
  forceNegative,
  notePlaceholder,
  onClose,
  onDone,
}: {
  item: any;
  type: string;
  title: string;
  requireCost?: boolean;
  allowNegative?: boolean;
  forceNegative?: boolean;
  notePlaceholder?: string;
  onClose: () => void;
  onDone: () => void;
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
        itemId: item.id,
        type: type as any,
        qty: forceNegative ? -Math.abs(qty) : qty,
        unitCost: cost,
        note: note || "",
        createdAt: createdAt,
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
        <DialogHeader>
          <DialogTitle>
            {title} — {item.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>
              {forceNegative ? "Quantity to remove" : "Quantity"} ({item.units?.code}){" "}
              {allowNegative && (
                <span className="text-xs text-muted-foreground">— use negative to reduce</span>
              )}
            </Label>
            <Input
              type="number"
              step="0.001"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Unit cost (MWK){requireCost && " *"}</Label>
            <Input
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={createdAt} onChange={(e) => setCreatedAt(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={notePlaceholder ?? "Reason / supplier / reference"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Save
          </Button>
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
        <DialogHeader>
          <DialogTitle>Bin card — {item.name}</DialogTitle>
        </DialogHeader>
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
                      {m.invoice_no && (
                        <div className="text-xs text-muted-foreground">Invoice {m.invoice_no}</div>
                      )}
                    </td>
                    <td className="p-2 text-xs uppercase">{m.type}</td>
                    <td className="p-2 text-right text-success">
                      {qty > 0 ? movementQty(qty) : ""}
                    </td>
                    <td className="p-2 text-right text-destructive">
                      {qty < 0 ? movementQty(qty) : ""}
                    </td>
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
