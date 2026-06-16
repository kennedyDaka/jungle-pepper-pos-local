import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { LoadingState, ErrorState } from "@/components/DataState";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Plus,
  Minus,
  X,
  Printer,
  Utensils,
  ShoppingBag,
  Wine,
  Receipt,
  ChefHat,
  User,
  Lock,
} from "lucide-react";
import { MWK } from "@/lib/format";
import { menuService } from "@/services/menuService";
import { orderService } from "@/services/orderService";
import { supabase } from "@/services/repositories/supabaseClient";
import { toast } from "sonner";
import {
  MENU,
  EXTRA_MENU,
  EXTRA_INDEX,
  TOTAL_PAGES,
  PDF_W,
  PDF_H,
  PASTA_OPTIONS,
  resolveDbName,
  formatMK,
} from "@/lib/waiter-menu-data";
import type { WaiterOrderItem } from "@/services/orderService";
import logo from "@/assets/jungle-pepper-logo.png";

export const Route = createFileRoute("/waiter")({
  component: WaiterPage,
  head: () => ({
    meta: [
      { title: "Waiter Ordering - Jungle Pepper" },
      { name: "description", content: "Place orders for customers." },
    ],
  }),
});

type CartItem = {
  key: string;
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
  modifiers: { id: string; name: string; price_delta: number }[];
};

type ServiceType = "dine-in" | "takeaway";

type PastaSelection = {
  shape: string;
  dbName: string;
};

function WaiterPage() {
  const [verified, setVerified] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");

  const branch = useQuery({
    queryKey: ["waiter", "branch"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("active", true)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string } | null;
    },
  });

  if (!verified) {
    return (
      <PinGate
        branch={branch.data ?? null}
        loading={branch.isLoading}
        error={branch.error}
        onVerified={(id, name) => {
          setVerified(true);
          setBranchId(id);
          setBranchName(name);
        }}
      />
    );
  }

  return <OrderPage branchId={branchId!} branchName={branchName} />;
}

function PinGate({
  branch,
  loading,
  error,
  onVerified,
}: {
  branch: { id: string; name: string } | null;
  loading: boolean;
  error: unknown;
  onVerified: (id: string, name: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    if (!branch || pin.length < 4) return;
    setVerifying(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("verify_branch_pin", {
        _branch_id: branch.id,
        _pin: pin,
      });
      if (rpcError) throw rpcError;
      if (!data) {
        toast.error("Invalid PIN");
        setPin("");
        return;
      }
      onVerified(branch.id, branch.name);
    } catch (e: any) {
      toast.error(e.message ?? "Verification failed");
      setPin("");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return <LoadingState label="Loading..." className="min-h-screen" />;
  if (error) return <ErrorState error={error} label="Could not load branch" className="min-h-screen" />;
  if (!branch) return <ErrorState error="No active branch found" label="Contact admin" className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-sm w-full p-8 text-center space-y-6">
        <img src={logo} alt="Jungle Pepper" width={72} height={72} className="mx-auto rounded" />
        <div>
          <h1 className="text-xl font-bold">Jungle Pepper</h1>
          <p className="text-sm text-muted-foreground mt-1">{branch.name}</p>
        </div>
        <div className="space-y-3">
          <Label className="text-sm text-muted-foreground">Enter waiter PIN</Label>
          <div className="flex justify-center">
            <InputOTP maxLength={4} value={pin} onChange={setPin} onComplete={handleVerify}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button
            className="w-full"
            disabled={pin.length < 4 || verifying}
            onClick={handleVerify}
          >
            {verifying ? "Verifying..." : "Unlock"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function OrderPage({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [service, setService] = useState<ServiceType>("dine-in");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [crustDialog, setCrustDialog] = useState<{ itemKey: string; name: string; dbName: string; price: number } | null>(null);
  const [shapeDialog, setShapeDialog] = useState<{ itemKey: string; name: string; sauce: string; price: number } | null>(null);
  const [submitResult, setSubmitResult] = useState<any>(null);

  const items = useQuery({
    queryKey: ["waiter", "items"],
    queryFn: () => menuService.listMenuItems({ activeOnly: true }),
  });

  const itemsByName = useMemo(() => {
    const map: Record<string, { id: string; price: number }> = {};
    for (const item of items.data ?? []) {
      map[item.name.toLowerCase()] = { id: item.id, price: item.price };
    }
    return map;
  }, [items.data]);

  const livePrice = useCallback(
    (dbName: string): number | undefined => {
      return itemsByName[dbName.toLowerCase()]?.price;
    },
    [itemsByName],
  );

  const tables = useQuery({
    queryKey: ["waiter", "tables", branchId],
    queryFn: () => orderService.getActiveTables(branchId),
    enabled: service === "dine-in",
  });

  const addItem = (item: { name: string; dbName: string; price: number; kind?: string }) => {
    const resolvedPrice = livePrice(item.dbName) ?? item.price;
    if (item.kind === "pizza") {
      setCrustDialog({ itemKey: crypto.randomUUID(), name: item.name, dbName: item.dbName, price: resolvedPrice });
      return;
    }
    if (item.kind === "pasta") {
      setShapeDialog({ itemKey: crypto.randomUUID(), name: item.name, sauce: item.dbName, price: resolvedPrice });
      return;
    }
    addToCart(item.dbName, item.name, resolvedPrice, []);
  };

  const addExtraItem = (extraId: string) => {
    const extra = EXTRA_INDEX[extraId];
    if (!extra) return;
    const resolvedPrice = livePrice(extra.dbName) ?? extra.price;
    addToCart(extra.dbName, extra.name, resolvedPrice, []);
  };

  const addToCart = (dbName: string, displayName: string, price: number, modifiers: { id: string; name: string; price_delta: number }[]) => {
    const dbItem = itemsByName[dbName.toLowerCase()];
    const menuItemId = dbItem?.id ?? "";
    setLines((prev) => {
      const existing = prev.find((l) => l.menuItemId === menuItemId && l.price === price && l.modifiers.length === modifiers.length && l.modifiers.every((m, i) => m.id === modifiers[i]?.id));
      if (existing && menuItemId) {
        return prev.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { key: crypto.randomUUID(), menuItemId, name: displayName, price, qty: 1, modifiers }];
    });
  };

  const incQty = (key: string) => setLines((p) => p.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)));
  const decQty = (key: string) => setLines((p) => p.flatMap((l) => (l.key === key ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l])));
  const removeLine = (key: string) => setLines((p) => p.filter((l) => l.key !== key));

  const subtotal = useMemo(() => lines.reduce((s, l) => s + (l.price + l.modifiers.reduce((m, mod) => m + mod.price_delta, 0)) * l.qty, 0), [lines]);
  const total = Math.max(subtotal - (Number.isFinite(discount) ? discount : 0), 0);

  const submit = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("Add at least one item");
      const waiterItems: WaiterOrderItem[] = lines.map((l) => ({
        menu_item_id: l.menuItemId,
        qty: l.qty,
        note: l.note ?? null,
        takeaway: service === "takeaway",
        modifiers: l.modifiers.map((m) => ({ modifier_id: m.id })),
      }));
      return orderService.createWaiterOrder(
        { discount, note: orderNote || null, items: waiterItems },
        branchId,
        service === "dine-in" ? selectedTableId ?? undefined : undefined,
      );
    },
    onSuccess: (orderId) => {
      setSubmitResult({ orderId, lines: [...lines], subtotal, discount, total, note: orderNote, service });
      setLines([]);
      setDiscount(0);
      setNote("");
      setOrderNote("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handlePizzaCrust = (crustId: string, crustName: string, priceDelta: number) => {
    if (!crustDialog) return;
    addToCart(crustDialog.dbName, crustDialog.name + ` (${crustName})`, crustDialog.price, [{ id: crustId, name: crustName, price_delta: priceDelta }]);
    setCrustDialog(null);
  };

  const handlePastaShape = (shape: string, dbName: string) => {
    if (!shapeDialog) return;
    const resolvedPrice = livePrice(dbName) ?? shapeDialog.price;
    addToCart(dbName, shape + " " + shapeDialog.name, resolvedPrice, []);
    setShapeDialog(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <img src={logo} alt="JP" width={32} height={32} className="rounded" />
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-tight">Jungle Pepper</h1>
            <p className="text-[10px] text-muted-foreground">{branchName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={service} onValueChange={(v) => v && setService(v as ServiceType)}>
            <TabsList className="h-9">
              <TabsTrigger value="dine-in" className="gap-1.5 text-xs">
                <Utensils className="h-3.5 w-3.5" /> Dine-in
              </TabsTrigger>
              <TabsTrigger value="takeaway" className="gap-1.5 text-xs">
                <ShoppingBag className="h-3.5 w-3.5" /> Takeaway
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px] gap-6 p-4 lg:p-6">
        <div className="flex-1 space-y-6">
          {items.isLoading && <LoadingState label="Loading menu..." />}
          <button
            type="button"
            onClick={() => setCrustDialog({ itemKey: "test", name: "", dbName: "", price: 0 })}
            style={{ display: "none" }}
          />
          <DrinksFolder onAdd={addExtraItem} itemsLoading={items.isLoading} />
          {Array.from({ length: TOTAL_PAGES }).map((_, page) => (
            <MenuPage key={page} page={page} onAdd={addItem} livePrice={livePrice} />
          ))}
        </div>

        <aside className="sticky top-[88px] hidden h-[calc(100vh-112px)] w-[420px] shrink-0 rounded-2xl border border-border bg-card p-5 shadow-elegant lg:flex lg:flex-col">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Order</h2>
            {service === "dine-in" && (
              <Select value={selectedTableId ?? ""} onValueChange={(v) => setSelectedTableId(v || null)}>
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue placeholder="Table..." />
                </SelectTrigger>
                <SelectContent>
                  {(tables.data ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="my-4 flex-1 overflow-y-auto pr-1 space-y-2">
            {lines.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground/60">
                Tap menu items to add
              </div>
            ) : (
              lines.map((l) => (
                <div key={l.key} className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">{MWK(l.price)} each</p>
                    {l.modifiers.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">{l.modifiers.map((m) => m.name).join(", ")}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 rounded-md border border-border bg-background">
                    <button onClick={() => decQty(l.key)} className="grid h-7 w-7 place-items-center text-muted-foreground hover:text-foreground" aria-label="Decrease">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm tabular-nums">{l.qty}</span>
                    <button onClick={() => incQty(l.key)} className="grid h-7 w-7 place-items-center text-muted-foreground hover:text-foreground" aria-label="Increase">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {MWK((l.price + l.modifiers.reduce((s, m) => s + m.price_delta, 0)) * l.qty)}
                  </p>
                  <button onClick={() => removeLine(l.key)} className="text-muted-foreground/60 hover:text-destructive" aria-label="Remove">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium tabular-nums">{MWK(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label htmlFor="discount" className="text-muted-foreground">Discount</label>
              <Input id="discount" type="number" min={0} value={discount || ""}
                onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                placeholder="0" className="h-9 w-32 text-right tabular-nums" />
            </div>
            <Textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)}
              placeholder="Order note..." rows={2} className="resize-none" />
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-base font-bold">Total</span>
              <span className="text-lg font-bold text-primary tabular-nums">{MWK(total)}</span>
            </div>
            <Button onClick={() => submit.mutate()} disabled={lines.length === 0 || submit.isPending || (service === "dine-in" && !selectedTableId)}
              className="w-full gap-2 bg-primary text-base font-semibold hover:bg-primary/90" size="lg">
              <Receipt className="h-4 w-4" /> Order {MWK(total)}
            </Button>
          </div>
        </aside>
      </div>

      <MobileCart
        lines={lines}
        subtotal={subtotal}
        discount={discount}
        total={total}
        orderNote={orderNote}
        service={service}
        selectedTableId={selectedTableId}
        tables={tables.data ?? []}
        onSetDiscount={setDiscount}
        onSetOrderNote={setOrderNote}
        onSetService={setService}
        onSetTable={setSelectedTableId}
        onInc={incQty}
        onDec={decQty}
        onRemove={removeLine}
        onSubmit={() => submit.mutate()}
        submitting={submit.isPending}
      />

      {crustDialog && (
        <CrustDialog
          open={!!crustDialog}
          onSelect={handlePizzaCrust}
          onClose={() => setCrustDialog(null)}
        />
      )}

      {shapeDialog && (
        <ShapeDialog
          open={!!shapeDialog}
          sauce={shapeDialog.sauce}
          onSelect={handlePastaShape}
          onClose={() => setShapeDialog(null)}
        />
      )}

      {submitResult && (
        <OrderReceiptDialog
          result={submitResult}
          onClose={() => setSubmitResult(null)}
        />
      )}
    </div>
  );
}

function MobileCart({
  lines, subtotal, discount, total, orderNote, service, selectedTableId, tables,
  onSetDiscount, onSetOrderNote, onSetService, onSetTable,
  onInc, onDec, onRemove, onSubmit, submitting,
}: {
  lines: CartItem[]; subtotal: number; discount: number; total: number; orderNote: string;
  service: ServiceType; selectedTableId: string | null; tables: any[];
  onSetDiscount: (v: number) => void; onSetOrderNote: (v: string) => void;
  onSetService: (v: ServiceType) => void; onSetTable: (v: string | null) => void;
  onInc: (k: string) => void; onDec: (k: string) => void; onRemove: (k: string) => void;
  onSubmit: () => void; submitting: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-primary-foreground shadow-lg lg:hidden">
        <Receipt className="h-5 w-5" />
        <span className="font-bold">{MWK(total)}</span>
        <span className="bg-primary-foreground/20 rounded-full px-2 py-0.5 text-xs">{lines.length}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Order</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-2">
            {lines.length === 0 && <p className="text-sm text-muted-foreground">No items</p>}
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-2 border-b border-border pb-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{MWK(l.price)} each</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => onDec(l.key)} className="h-7 w-7 grid place-items-center"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-5 text-center text-xs">{l.qty}</span>
                  <button onClick={() => onInc(l.key)} className="h-7 w-7 grid place-items-center"><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <button onClick={() => onRemove(l.key)}><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span>{MWK(subtotal)}</span></div>
            <div className="flex items-center gap-2 text-sm">
              <span>Discount</span>
              <Input type="number" min={0} value={discount || ""} onChange={(e) => onSetDiscount(Number(e.target.value) || 0)}
                className="h-8 w-24 text-right" />
            </div>
            <Textarea value={orderNote} onChange={(e) => onSetOrderNote(e.target.value)} placeholder="Note..." rows={2} className="resize-none text-sm" />
            <div className="flex justify-between font-bold text-base"><span>Total</span><span className="text-primary">{MWK(total)}</span></div>
            <Button className="w-full" disabled={lines.length === 0 || submitting} onClick={onSubmit}>
              {submitting ? "Placing..." : `Order ${MWK(total)}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DrinksFolder({ onAdd, itemsLoading }: { onAdd: (id: string) => void; itemsLoading: boolean }) {
  const count = EXTRA_MENU.reduce((s, c) => s + c.items.length, 0);
  return (
    <Dialog>
      <Dialog.Content asChild>
        <button type="button" className="group flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/60 hover:bg-primary/5 active:scale-[0.997]">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Wine className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight">Drinks & Liquor</h2>
            <p className="text-xs text-muted-foreground">{count} items</p>
          </div>
          <span className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground">Open</span>
        </button>
      </Dialog.Content>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wine className="h-5 w-5 text-primary" /> Drinks & Liquor</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          {EXTRA_MENU.map((cat) => (
            <section key={cat.id}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary/90">{cat.label}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {cat.items.map((it) => (
                  <button key={it.id} onClick={() => onAdd(it.id)}
                    disabled={itemsLoading}
                    className="flex flex-col items-start gap-0.5 rounded-md border border-border/60 bg-secondary/30 p-2 text-left transition hover:border-primary/60 hover:bg-primary/10 active:scale-[0.98]">
                    <span className="line-clamp-2 text-xs font-medium leading-tight">{it.name}</span>
                    <span className="text-[11px] font-semibold tabular-nums text-primary">{formatMK(it.price)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MenuPage({ page, onAdd, livePrice }: { page: number; onAdd: (item: any) => void; livePrice: (dbName: string) => number | undefined }) {
  const items = MENU.filter((m) => m.page === page);
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative w-full" style={{ aspectRatio: `${PDF_W} / ${PDF_H}` }}>
        <img src={`/menu/page_${page}.jpg`} alt={`Menu page ${page + 1}`}
          className="absolute inset-0 h-full w-full select-none object-cover" draggable={false} />
        {items.map((it) => {
          const price = livePrice(it.dbName) ?? it.price;
          return (
            <button key={it.id} onClick={() => onAdd({ name: it.name, dbName: it.dbName, price, kind: it.kind })}
              title={`${it.name} - ${formatMK(price)}`}
              className="group absolute rounded-md ring-0 ring-primary/0 transition hover:bg-primary/10 hover:ring-2 hover:ring-primary/70 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:bg-primary/20"
              style={{
                left: `${(it.x / PDF_W) * 100}%`,
                top: `${(it.y / PDF_H) * 100}%`,
                width: `${(it.w / PDF_W) * 100}%`,
                height: `${(it.h / PDF_H) * 100}%`,
              }}
              aria-label={`Add ${it.name}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function CrustDialog({ open, onSelect, onClose }: { open: boolean; onSelect: (id: string, name: string, priceDelta: number) => void; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose pizza base</DialogTitle>
          <DialogDescription>Thick or thin dough base.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-4">
          <button onClick={() => onSelect("thin-crust", "Thin Crust", 0)}
            className="rounded-lg border border-border p-4 text-center font-medium hover:border-primary hover:bg-primary/10 transition">
            Thin Crust
          </button>
          <button onClick={() => onSelect("thick-crust", "Thick Crust", 0)}
            className="rounded-lg border border-border p-4 text-center font-medium hover:border-primary hover:bg-primary/10 transition">
            Thick Crust
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShapeDialog({ open, sauce, onSelect, onClose }: { open: boolean; sauce: string; onSelect: (shape: string, dbName: string) => void; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose pasta shape</DialogTitle>
          <DialogDescription>Select the pasta type for {sauce}.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 py-4">
          {PASTA_OPTIONS.map((opt) => (
            <button key={opt.shape} onClick={() => onSelect(opt.shape, opt.dbName.replace("{name}", sauce))}
              className="rounded-lg border border-border p-4 text-center font-medium hover:border-primary hover:bg-primary/10 transition">
              {opt.shape}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrderReceiptDialog({ result, onClose }: { result: any; onClose: () => void }) {
  const orderRef = result.orderId.slice(0, 8).toUpperCase();
  const tableLabel = result.service === "dine-in" ? `Table ${result.selectedTableId ?? ""}` : "Takeaway";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Order Placed</DialogTitle>
          <DialogDescription>Order #{orderRef} — {tableLabel}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="kitchen" className="flex-1 overflow-auto">
          <TabsList className="w-full">
            <TabsTrigger value="kitchen" className="flex-1 gap-1.5"><ChefHat className="h-4 w-4" /> Kitchen</TabsTrigger>
            <TabsTrigger value="customer" className="flex-1 gap-1.5"><User className="h-4 w-4" /> Customer</TabsTrigger>
          </TabsList>

          <TabsContent value="kitchen" className="mt-3">
            <div className="bg-white text-black p-4 rounded text-xs font-mono" id="kitchen-receipt">
              <div className="text-center mb-2">
                <div className="font-bold text-sm">JUNGLE PEPPER</div>
                <div>Kidney Crescent, Blantyre</div>
                <div className="mt-1 font-bold text-base">{tableLabel}</div>
                <div className="mt-1">Order: {orderRef}</div>
                <div>{new Date().toLocaleString()}</div>
              </div>
              <hr className="my-1 border-black" />
              {result.lines.map((l: any) => (
                <div key={l.key} className="mb-1">
                  <div className="flex justify-between font-bold">
                    <span>{l.qty}x {l.name}</span>
                  </div>
                  {l.modifiers?.length > 0 && (
                    <div className="pl-2">{l.modifiers.map((m: any) => m.name).join(", ")}</div>
                  )}
                  {l.note && <div className="pl-2 text-orange-600">Note: {l.note}</div>}
                </div>
              ))}
              {result.note && <><hr className="my-1 border-black" /><div className="italic">{result.note}</div></>}
              <hr className="my-1 border-black" />
              <div className="text-center font-bold">Obrigado!</div>
            </div>
            <Button variant="secondary" className="w-full mt-3" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print Kitchen
            </Button>
          </TabsContent>

          <TabsContent value="customer" className="mt-3">
            <div className="bg-white text-black p-4 rounded text-xs font-mono" id="customer-receipt">
              <div className="text-center mb-2">
                <div className="font-bold text-sm">JUNGLE PEPPER</div>
                <div>Kidney Crescent, Blantyre</div>
                <div className="mt-1">{tableLabel}</div>
                <div className="mt-1">Order: {orderRef}</div>
                <div>{new Date().toLocaleString()}</div>
              </div>
              <hr className="my-1 border-black" />
              {result.lines.map((l: any) => (
                <div key={l.key} className="flex justify-between mb-1">
                  <span>{l.qty}x {l.name}</span>
                  <span>{MWK((l.price + l.modifiers.reduce((s: number, m: any) => s + m.price_delta, 0)) * l.qty)}</span>
                </div>
              ))}
              <hr className="my-1 border-black" />
              <div className="flex justify-between"><span>Subtotal</span><span>{MWK(result.subtotal)}</span></div>
              {result.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{MWK(result.discount)}</span></div>}
              <div className="flex justify-between font-bold text-sm"><span>Total</span><span>{MWK(result.total)}</span></div>
              <div className="text-center mt-3 text-[10px] text-gray-500">Payment to be settled at the counter</div>
            </div>
            <Button variant="secondary" className="w-full mt-3" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print Receipt
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-3">
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
