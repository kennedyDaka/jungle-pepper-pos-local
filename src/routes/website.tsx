import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Minus, X, ShoppingCart, Printer } from "lucide-react";
import { MWK } from "@/lib/format";
import { menuService } from "@/services/menuService";
import { orderService } from "@/services/orderService";
import { supabase } from "@/services/repositories/supabaseClient";
import { toast } from "sonner";
import logo from "@/assets/jungle-pepper-logo.png";

export const Route = createFileRoute("/website")({
  component: WebsitePage,
});

type CartLine = {
  key: string;
  menu_item_id: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
  /** For takeaway items - optional packaging (charged at pickup) */
  packaging: string[];
};

const MENU_CATEGORIES = [
  "starters", "pastas", "pizza", "burgers", "chips",
  "pregos-bitoque", "frango", "camarao-marisco",
  "sweets", "hot-drinks", "beers", "soft-drinks",
  "juices-mocktails", "liquor",
];

const CATEGORY_LABELS: Record<string, string> = {
  starters: "STARTERS",
  pastas: "PASTAS",
  pizza: "PIZZA",
  burgers: "BURGERS",
  chips: "CHIPS",
  "pregos-bitoque": "PREGOS / BITOQUE",
  frango: "FRANGO",
  "camarao-marisco": "CAMARAO / MARISCO",
  sweets: "SWEETS",
  "hot-drinks": "HOT DRINKS",
  beers: "BEERS",
  "soft-drinks": "SOFT DRINKS",
  "juices-mocktails": "JUICES / MOCKTAILS",
  liquor: "LIQUOR",
};

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

function itemMatchesGroup(item: any, groupId: string) {
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

function WebsitePage() {
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [orderType, setOrderType] = useState<"dine-in" | "takeaway">("dine-in");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<any>(null);

  const items = useQuery({
    queryKey: ["website", "items"],
    queryFn: () => menuService.listMenuItems({ activeOnly: true }),
  });

  const branch = useQuery({
    queryKey: ["website", "branch"],
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

  const tables = useQuery({
    queryKey: ["website", "tables", branch.data?.id],
    queryFn: () => orderService.getActiveTables(branch.data!.id),
    enabled: orderType === "dine-in" && !!branch.data?.id,
  });

  const branchId = branch.data?.id ?? null;

  const filtered = useMemo(() => {
    let list = items.data ?? [];
    if (activeCat) list = list.filter((item: any) => itemMatchesGroup(item, activeCat));
    if (search.trim()) list = list.filter((i: any) => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [items.data, activeCat, search]);

  const addItem = (mi: any) => {
    const existing = cart.find((l) => l.menu_item_id === mi.id);
    if (existing) {
      setCart((c) => c.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + 1 } : l)));
      return;
    }
    setCart((c) => [
      ...c,
      { key: crypto.randomUUID(), menu_item_id: mi.id, name: mi.name, price: Number(mi.price), qty: 1, packaging: [] },
    ]);
  };

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);

  const submit = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("No branch available");
      return orderService.createWebsiteOrder(
        {
          discount: 0,
          note: note || null,
          items: cart.map((l) => ({
            menu_item_id: l.menu_item_id,
            qty: l.qty,
            note: l.note ?? null,
            modifiers: [],
            packaging: orderType === "takeaway" ? l.packaging : null,
          })),
        },
        branchId,
        { tableId: orderType === "dine-in" ? selectedTableId ?? undefined : undefined, customerName: name.trim() || undefined, customerPhone: phone.trim() || undefined },
      );
    },
    onSuccess: (orderId) => {
      setOrderResult(orderId);
      setCart([]);
      setName("");
      setPhone("");
      setNote("");
      setOrderType("dine-in");
      setSelectedTableId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (orderResult) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <img src={logo} alt="Jungle Pepper" width={72} height={72} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Order placed!</h1>
          <p className="text-muted-foreground mb-6">
            Your order has been sent to the kitchen. We will start preparing it shortly.
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            A cashier will assist with payment when you are ready.
          </p>
          <Button onClick={() => setOrderResult(null)}>Place another order</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src={logo} alt="Jungle Pepper" width={36} height={36} className="rounded" />
          <div className="leading-tight">
            <div className="font-bold text-base">Jungle Pepper</div>
            <div className="text-[10px] text-muted-foreground">Kidney Crescent - Blantyre</div>
          </div>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}>
            <ShoppingCart className="h-4 w-4 mr-1" />
            Cart ({cart.length})
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {items.isLoading && <LoadingState label="Loading menu..." />}

            <div className="flex flex-wrap gap-2 items-center">
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
                {MENU_CATEGORIES.map((cat) => (
                  <TabsTrigger key={cat} value={cat}>{CATEGORY_LABELS[cat]}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {filtered.map((mi: any) => (
                <button
                  key={mi.id}
                  onClick={() => addItem(mi)}
                  className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors"
                >
                  <div className="font-medium text-sm leading-tight">{mi.name}</div>
                  <div className="text-primary font-semibold text-sm mt-1">{MWK(mi.price)}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Card className="p-4 sticky top-24">
              <h2 className="font-semibold mb-3">Your order</h2>

              <RadioGroup
                value={orderType}
                onValueChange={(v) => setOrderType(v as "dine-in" | "takeaway")}
                className="flex gap-4 mb-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="dine-in" id="dine-in" />
                  <Label htmlFor="dine-in">Dine-in</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="takeaway" id="takeaway" />
                  <Label htmlFor="takeaway">Takeaway</Label>
                </div>
              </RadioGroup>

              {orderType === "dine-in" && (
                <div className="mb-4">
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
              )}

              {cart.length === 0 && (
                <p className="text-sm text-muted-foreground">Tap items to add to your order.</p>
              )}
              <div className="space-y-2 max-h-80 overflow-auto">
                {cart.map((l) => (
                  <div key={l.key} className="flex items-center justify-between gap-2 text-sm border-b border-border pb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{MWK(l.price)} each</div>
                      <div className="mt-1">
                        <Input
                          placeholder="Note..."
                          value={l.note ?? ""}
                          onChange={(e) => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-5 text-center text-xs">{l.qty}</span>
                      <Button size="sm" variant="ghost" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <button onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
                        <X className="h-3.5 w-3.5 text-muted-foreground ml-1" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {cart.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex justify-between font-bold">
                    <span>Total</span>
                    <span className="text-primary">{MWK(subtotal)}</span>
                  </div>
                  <div>
                    <Label>Your name <span className="text-destructive">*</span></Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
                    {!name.trim() && <p className="text-xs text-destructive mt-0.5">Name is required</p>}
                  </div>
                  <div>
                    <Label>Phone <span className="text-destructive">*</span></Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0999 000 000" />
                    {!phone.trim() && <p className="text-xs text-destructive mt-0.5">Phone is required</p>}
                  </div>
                  <div>
                    <Label>Note</Label>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Special instructions..." />
                  </div>
                  <Button
                    className="w-full"
                    disabled={
                      cart.length === 0 ||
                      !branchId ||
                      !name.trim() ||
                      !phone.trim() ||
                      (orderType === "dine-in" && !selectedTableId) ||
                      submit.isPending
                    }
                    onClick={() => submit.mutate()}
                  >
                    {submit.isPending ? "Sending..." : "Place order"}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
