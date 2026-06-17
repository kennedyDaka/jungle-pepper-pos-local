import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/services/repositories/supabaseClient";
import { WebsiteCartProvider } from "@/lib/website-cart";
import { CartButton, CartDrawer, OrderBar } from "@/components/website/CartDrawer";
import { IMAGES } from "@/lib/website-images";
import { useState } from "react";
import { Menu, X } from "lucide-react";

export const Route = createFileRoute("/website")({
  component: WebsiteLayout,
});

function WebsiteLayout() {
  const { data: branch } = useQuery({
    queryKey: ["website-branch"],
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

  const branchId = branch?.id ?? null;

  return (
    <WebsiteCartProvider>
      <div className="website-layout min-h-screen">
        <SiteHeader />
        <main className="min-h-[60vh] pb-24">
          <Outlet />
        </main>
        <SiteFooter />
        <OrderBar />
        <CartDrawer branchId={branchId} />
      </div>
    </WebsiteCartProvider>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--border)] bg-[color:var(--brand-paper)]/95 backdrop-blur">
      <div className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2.5 sm:px-4">
        <Link to="/website" className="flex min-w-0 items-center gap-2">
          <img src={IMAGES.logo} alt="Jungle Pepper" className="h-9 w-9 shrink-0 object-contain sm:h-11 sm:w-11" />
          <span className="font-display text-lg leading-none tracking-wide text-[color:var(--brand-red)] sm:text-2xl">JUNGLE PEPPER</span>
        </Link>
        <nav className="hidden md:flex items-center justify-end gap-5 text-sm font-semibold uppercase tracking-wider">
          <Link to="/website" className="hover:text-[color:var(--brand-red)]" activeProps={{ className: "text-[color:var(--brand-red)]" }}>Home</Link>
          <Link to="/website/menu" className="hover:text-[color:var(--brand-red)]" activeProps={{ className: "text-[color:var(--brand-red)]" }}>Menu</Link>
          <Link to="/website/reservations" className="hover:text-[color:var(--brand-red)]" activeProps={{ className: "text-[color:var(--brand-red)]" }}>Reserve</Link>
          <Link to="/website/about" className="hover:text-[color:var(--brand-red)]" activeProps={{ className: "text-[color:var(--brand-red)]" }}>About</Link>
          <Link to="/website/contact" className="hover:text-[color:var(--brand-red)]" activeProps={{ className: "text-[color:var(--brand-red)]" }}>Contact</Link>
        </nav>
        <div className="flex items-center gap-1.5 justify-self-end">
          <CartButton />
          <button onClick={() => setOpen((v) => !v)} aria-label="Menu" className="grid h-9 w-9 place-items-center rounded-full md:hidden hover:bg-black/5">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="md:hidden border-t border-[color:var(--border)] bg-[color:var(--brand-paper)]">
          <div className="mx-auto grid max-w-6xl gap-1 px-3 py-2 text-sm font-semibold uppercase tracking-wider">
            {[["/website","Home"],["/website/menu","Menu"],["/website/reservations","Reserve"],["/website/about","About"],["/website/contact","Contact"]].map(([to,label]) => (
              <Link key={to} to={to} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 hover:bg-[color:var(--brand-yellow)]/30" activeProps={{ className: "text-[color:var(--brand-red)] bg-[color:var(--brand-yellow)]/40" }}>{label}</Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-12 bg-[color:var(--brand-ink)] text-[color:var(--brand-paper)]">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <img src={IMAGES.logo} alt="" className="h-12 w-12" />
            <span className="font-display text-xl">JUNGLE PEPPER</span>
          </div>
          <p className="mt-3 text-sm opacity-80">Malawi's own pizza & authentic Portuguese cuisine.</p>
        </div>
        <div className="text-sm">
          <h4 className="font-display text-base text-[color:var(--brand-yellow)]">Visit</h4>
          <p className="mt-2 opacity-90">Kidney Crescent Road,<br/>Opposite O. Jussabs, Next to OMG.<br/>Blantyre, Malawi.</p>
          <p className="mt-3 opacity-90">Wed – Sun · 11:30 – 21:00<br/>Mon & Tue · Closed</p>
        </div>
        <div className="text-sm">
          <h4 className="font-display text-base text-[color:var(--brand-yellow)]">Contact</h4>
          <p className="mt-2"><a href="tel:+265999826229" className="hover:underline">0999 826 229</a></p>
          <p><a href="tel:+265888826229" className="hover:underline">0888 826 229</a></p>
        </div>
      </div>
      <div className="border-t border-white/10 py-5">
        <a href="https://operonsystems.com" target="_blank" rel="noreferrer" className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-1 px-4 text-center opacity-80 transition hover:opacity-100">
          <span className="text-[10px] uppercase tracking-[0.25em] opacity-70">Powered by</span>
          <img src={IMAGES.operon} alt="Operon Systems" className="h-10 w-auto brightness-0 invert" />
        </a>
        <p className="mt-4 text-center text-[11px] opacity-60">© {new Date().getFullYear()} Jungle Pepper. All rights reserved.</p>
      </div>
    </footer>
  );
}

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
