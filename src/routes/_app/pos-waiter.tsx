import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Plus, Minus, X, Printer } from "lucide-react";
import { MWK } from "@/lib/format";
import { menuService } from "@/services/menuService";
import { orderService } from "@/services/orderService";
import { supabase } from "@/services/repositories/supabaseClient";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pos-waiter")({
  component: WaiterPage,
});

type CartLine = {
  key: string;
  menu_item_id: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
  modifiers: { id: string; name: string; price_delta: number }[];
};

const POS_CATEGORY_GROUPS = [
  { id: "starters",          label: "STARTERS" },
  { id: "pastas",            label: "PASTAS" },
  { id: "pizza",             label: "PIZZA" },
  { id: "burgers",           label: "BURGERS" },
  { id: "chips",             label: "CHIPS" },
  { id: "pregos-bitoque",    label: "PREGOS/ BITOQUE" },
  { id: "frango",            label: "FRANGO" },
  { id: "camarao-marisco",   label: "CAMARAO / MARISCO" },
  { id: "sweets",            label: "SWEETS" },
  { id: "hot-drinks",        label: "HOT DRINKS" },
  { id: "beers",             label: "BEERS" },
  { id: "soft-drinks",       label: "SOFT DRINKS" },
  { id: "juices-mocktails",  label: "JUICES / MOCKTAILS" },
  { id: "liquor",            label: "LIQUOR" },
];

function normalizeCategoryText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " AND ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isJuiceOrMocktailItem(item: any) {
  const category = normalizeCategoryText(item.categories?.name);
  const name = normalizeCategoryText(item.name);
  return (
    category === "MOCKTAILS" ||
    name.includes("JUICE") ||
    name.includes("CHAPMAN") ||
    name.includes("ROCKSHANDY") ||
    name.includes("LIME CORDIAL") ||
    name.includes("LEMONADE")
  );
}

function itemMatchesPosGroup(item: any, groupId: string) {
  const category = normalizeCategoryText(item.categories?.name);

  if (groupId === "starters") return ["STARTERS", "SALADS"].includes(category);
  if (groupId === "pastas") return category === "PASTAS";
  if (groupId === "pizza") return category === "PIZZA";
  if (groupId === "burgers") return category === "BURGERS";
  if (groupId === "chips") return category === "CHIPS";
  if (groupId === "pregos-bitoque") return category === "PREGOS AND BITOQUES";
  if (groupId === "frango") return category === "FRANGO";
  if (groupId === "camarao-marisco") return category === "SEAFOOD";
  if (groupId === "sweets") return category === "DESSERTS";
  if (groupId === "hot-drinks") return category === "COFFEE AND TEA";
  if (groupId === "beers") return category === "BEERS AND CIDERS";
  if (groupId === "soft-drinks") return category === "SOFT DRINKS" && !isJuiceOrMocktailItem(item);
  if (groupId === "juices-mocktails") return isJuiceOrMocktailItem(item);
  if (groupId === "liquor") {
    return ["BRANDY", "GIN", "LIQUEURS", "RUM", "TEQUILA", "VODKA", "WHISKEY", "WINE"].includes(category);
  }

  return false;
}

function WaiterPage() {
  const qc = useQueryClient();
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const [modOpen, setModOpen] = useState<{ menuId: string; lineKey: string; removeOnCancel?: boolean } | null>(null);
  const [kitchenReceipt, setKitchenReceipt] = useState<any>(null);

  const membership = useQuery({
    queryKey: ["auth", "branch-membership"],
    queryFn: async () => {
      const { data: membershipData, error: membershipError } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (membershipData) return membershipData;
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

  const cats = useQuery({
    queryKey: ["waiter", "cats"],
    queryFn: () => menuService.listCategories(),
  });

  const items = useQuery({
    queryKey: ["waiter", "items"],
    queryFn: () => menuService.listMenuItems({ activeOnly: true }),
  });

  const mods = useQuery({
    queryKey: ["waiter", "mods"],
    queryFn: () => menuService.listModifiers(),
  });

  const tables = useQuery({
    queryKey: ["waiter", "tables", branchId],
    queryFn: () => orderService.getActiveTables(branchId!),
    enabled: !!branchId,
  });

  const loading = cats.isLoading || items.isLoading || mods.isLoading || tables.isLoading;
  const dataError = cats.error || items.error || mods.error;

  const filtered = useMemo(() => {
    let list = items.data ?? [];
    if (activeCat) list = list.filter((item: any) => itemMatchesPosGroup(item, activeCat));
    if (search.trim()) list = list.filter((i: any) => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [items.data, activeCat, search]);

  const addItem = (mi: any) => {
    const key = crypto.randomUUID();
    setCart((c) => [...c, { key, menu_item_id: mi.id, name: mi.name, price: Number(mi.price), qty: 1, modifiers: [] }]);
    const itemMods = (mods.data ?? []).filter((m: any) => m.menu_item_id === mi.id);
    const crustMods = itemMods.filter((m: any) => m.name === "Thin Crust" || m.name === "Thick Crust");
    if (crustMods.length) setModOpen({ menuId: mi.id, lineKey: key, removeOnCancel: true });
  };

  const lineTotal = (l: CartLine) => (l.price + l.modifiers.reduce((s, m) => s + Number(m.price_delta), 0)) * l.qty;
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);

  const requiresCrust = (line: CartLine) =>
    (mods.data ?? []).some((m: any) => m.menu_item_id === line.menu_item_id && (m.name === "Thin Crust" || m.name === "Thick Crust"));

  const hasSelectedCrust = (line: CartLine) =>
    line.modifiers.some((m) => m.name === "Thin Crust" || m.name === "Thick Crust");

  const hasMissingCrust = cart.some((line) => requiresCrust(line) && !hasSelectedCrust(line));

  const submit = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("No branch found");
      return orderService.createWaiterOrder(
        {
          discount: 0,
          note: orderNote || null,
          items: cart.map((l) => ({
            menu_item_id: l.menu_item_id,
            qty: l.qty,
            note: l.note ?? null,
            modifiers: l.modifiers.map((m) => ({ modifier_id: m.id })),
          })),
        },
        branchId,
        selectedTableId ?? undefined,
      );
    },
    onSuccess: async (orderId) => {
      const tableLabel = (tables.data ?? []).find((t) => t.id === selectedTableId)?.label ?? "";
      setKitchenReceipt({ orderId, tableLabel, items: [...cart], note: orderNote });
      setCart([]);
      setOrderNote("");
      qc.invalidateQueries({ queryKey: ["waiter"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!branchId) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        {membership.isLoading ? "Loading branch..." : "No branch found for your account."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-9rem)]">
      <div className="lg:col-span-2 flex flex-col gap-3 min-h-0">
        {loading && <LoadingState label="Loading menu..." />}
        {dataError && <ErrorState error={dataError} label="Could not load menu" />}

        <div className="flex flex-wrap gap-2 items-center">
          <div className="min-w-44">
            <Select value={selectedTableId ?? ""} onValueChange={(v) => setSelectedTableId(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Select table..." />
              </SelectTrigger>
              <SelectContent>
                {(tables.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Search menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-48 flex-1"
          />
        </div>

        <Tabs value={activeCat ?? "all"} onValueChange={(v) => setActiveCat(v === "all" ? null : v)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">ALL</TabsTrigger>
            {POS_CATEGORY_GROUPS.map((cat) => (
              <TabsTrigger key={cat.id} value={cat.id}>{cat.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 overflow-auto pb-2">
          {filtered.map((mi: any) => (
            <button
              key={mi.id}
              onClick={() => addItem(mi)}
              disabled={loading}
              className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors disabled:cursor-wait disabled:opacity-60"
            >
              <div className="font-medium text-sm leading-tight">{mi.name}</div>
              <div className="text-primary font-semibold text-sm mt-1">{MWK(mi.price)}</div>
            </button>
          ))}
        </div>
      </div>

      <Card className="p-3 flex flex-col min-h-0">
        <h2 className="font-semibold mb-2">
          Order {selectedTableId ? `- ${(tables.data ?? []).find((t) => t.id === selectedTableId)?.label ?? ""}` : ""}
        </h2>
        <div className="flex-1 overflow-auto space-y-2">
          {cart.length === 0 && (
            <p className="text-sm text-muted-foreground">Tap items to add to order.</p>
          )}
          {cart.map((l) => (
            <div key={l.key} className="border border-border rounded-md p-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium flex-1">{l.name}</span>
                <button onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              {l.modifiers.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {l.modifiers.map((m) => m.name + (Number(m.price_delta) > 0 ? ` +${MWK(m.price_delta)}` : "")).join(", ")}
                </div>
              )}
              {requiresCrust(l) && !hasSelectedCrust(l) && (
                <p className="text-xs text-destructive mt-1">Choose thin or thick crust.</p>
              )}
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center">{l.qty}</span>
                  <Button size="sm" variant="ghost" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="font-semibold">{MWK(lineTotal(l))}</div>
              </div>
              <div className="mt-2">
                <Label className="text-xs">Note</Label>
                <Input
                  placeholder="Special instructions..."
                  value={l.note ?? ""}
                  onChange={(e) => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))}
                  className="h-8"
                />
              </div>
              {requiresCrust(l) && (
                <Button type="button" variant="secondary" size="sm" className="mt-2 h-7 w-full text-xs"
                  onClick={() => setModOpen({ menuId: l.menu_item_id, lineKey: l.key })}>
                  Change crust
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-3 mt-2 space-y-2 text-sm">
          <Input
            placeholder="Order note..."
            value={orderNote}
            onChange={(e) => setOrderNote(e.target.value)}
            className="h-8"
          />
          <div className="flex justify-between text-base font-bold border-t border-border pt-2">
            <span>Subtotal</span>
            <span className="text-primary">{MWK(subtotal)}</span>
          </div>
          {hasMissingCrust && <p className="text-xs text-destructive">Choose thin or thick crust for every pizza.</p>}
          <Button
            className="w-full"
            disabled={cart.length === 0 || !selectedTableId || hasMissingCrust || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Submitting..." : "Send to kitchen"}
          </Button>
        </div>
      </Card>

      {modOpen && (
        <ModifierDialog
          mods={(mods.data ?? []).filter((m: any) => m.menu_item_id === modOpen.menuId)}
          current={cart.find((l) => l.key === modOpen.lineKey)?.modifiers ?? []}
          onClose={() => setModOpen(null)}
          onCancel={() => {
            if (modOpen.removeOnCancel) setCart((c) => c.filter((x) => x.key !== modOpen.lineKey));
            setModOpen(null);
          }}
          onSave={(selected) => {
            setCart((c) => c.map((x) => (x.key === modOpen.lineKey ? { ...x, modifiers: selected } : x)));
            setModOpen(null);
          }}
        />
      )}

      {kitchenReceipt && (
        <KitchenReceiptDialog receipt={kitchenReceipt} onClose={() => setKitchenReceipt(null)} />
      )}
    </div>
  );
}

function ModifierDialog({
  mods, current, onClose, onCancel, onSave,
}: {
  menuId: string;
  mods: any[];
  current: { id: string; name: string; price_delta: number }[];
  onClose: () => void;
  onCancel: () => void;
  onSave: (s: any[]) => void;
}) {
  const crustMods = mods.filter((m) => m.name === "Thin Crust" || m.name === "Thick Crust");
  const [crust, setCrust] = useState<string | null>(
    current.find((m) => m.name === "Thin Crust" || m.name === "Thick Crust")?.id ?? null,
  );
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose pizza base</DialogTitle>
          <DialogDescription>Choose thick or thin dough base.</DialogDescription>
        </DialogHeader>
        {crustMods.length > 0 && (
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Base (required)</div>
            <div className="grid grid-cols-2 gap-2">
              {crustMods.map((m) => (
                <button key={m.id} onClick={() => setCrust(m.id)}
                  className={`p-3 rounded border font-medium ${crust === m.id ? "border-primary bg-primary/10" : "border-border"}`}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={crustMods.length > 0 && !crust}
            onClick={() => onSave(mods.filter((m) => m.id === crust))}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KitchenReceiptDialog({ receipt, onClose }: { receipt: any; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kitchen Order</DialogTitle>
          <DialogDescription>Show this to the kitchen staff.</DialogDescription>
        </DialogHeader>
        <div className="bg-white text-black p-4 rounded text-xs font-mono print-area" id="kitchen-receipt">
          <div className="text-center mb-2">
            <div className="font-bold text-sm">JUNGLE PEPPER</div>
            <div>Kidney Crescent, Blantyre</div>
            <div className="mt-1 font-bold text-base">{receipt.tableLabel}</div>
            <div className="mt-1">Order: {receipt.orderId.slice(0, 8).toUpperCase()}</div>
            <div>{new Date().toLocaleString()}</div>
          </div>
          <hr className="my-1 border-black" />
          {receipt.items.map((l: any) => (
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
          {receipt.note && (
            <>
              <hr className="my-1 border-black" />
              <div className="italic">{receipt.note}</div>
            </>
          )}
          <hr className="my-1 border-black" />
          <div className="text-center font-bold">Obrigado!</div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
