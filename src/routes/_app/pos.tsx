import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import {
  Plus,
  Minus,
  X,
  Printer,
  Download,
  Package,
  UserCheck,
  Trash2,
  History,
  Ban,
  CalendarClock,
  ClipboardList,
} from "lucide-react";
import { MWK, fmtQty, paymentMethodLabel } from "@/lib/format";
import { missingOrderNumbersSummary } from "@/lib/orderSequence";
import { VAT_RATE, vatBreakdownFromInclusive } from "@/lib/vat";
import { authService } from "@/services/authService";
import { menuService } from "@/services/menuService";
import {
  packagingService,
  type PackagingOptionView,
  type PackagingStockItemView,
} from "@/services/packagingService";
import { posService } from "@/services/posService";
import { orderService } from "@/services/orderService";
import { reportService } from "@/services/reportService";
import { supabase } from "@/services/repositories/supabaseClient";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import logo from "@/assets/jungle-pepper-logo.png";

export const Route = createFileRoute("/_app/pos")({
  component: PosPage,
});

type CartLine = {
  key: string;
  kind: "menu" | "packaging";
  menu_item_id?: string;
  packaging_option_id?: string;
  item_id?: string;
  name: string;
  price: number;
  qty: number;
  takeaway: boolean;
  note?: string;
  modifiers: { id: string; name: string; price_delta: number }[];
  omissions: OmissionSelection[];
  packaging: PackagingSelection[];
};

type OmissionSelection = {
  recipe_id: string;
  item_id: string;
  name: string;
  qty: number;
  unit?: string;
  takeaway_only?: boolean;
};

type PackagingSelection = {
  option_id: string;
  name: string;
  item_id: string;
  unit_price: number;
  qty_per_item: number;
  total_qty?: number;
};

const EXTRAS_CATEGORY = "__extras";
const PACKAGING_CATEGORY = "__packaging";
const PRICE_OVERRIDES_KEY = "pos_price_overrides";

const POS_CATEGORY_GROUPS = [
  { id: "starters",          label: "STARTERS" },
  { id: "pastas",            label: "PASTAS" },
  { id: "pizza",             label: "PIZZA" },
  { id: "burgers",           label: "BURGERS" },
  { id: "chips",             label: "CHIPS" },
  { id: "pregos-bitoque",    label: "PREGOS/ BITOQUE" },
  { id: "frango",            label: "FRANGO" },
  { id: "camarao-marisco",   label: "CAMARAO / MARISCO" },
  { id: EXTRAS_CATEGORY,     label: "EXTRAS" },
  { id: "sweets",            label: "SWEETS" },
  { id: "hot-drinks",        label: "HOT DRINKS" },
  { id: "beers",             label: "BEERS" },
  { id: "soft-drinks",       label: "SOFT DRINKS" },
  { id: "juices-mocktails",  label: "JUICES / MOCKTAILS" },
  { id: "liquor",            label: "LIQUOR" },
  { id: PACKAGING_CATEGORY,  label: "PACKAGING" },
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
  if (groupId === EXTRAS_CATEGORY) return ["DAIRY", "MEATS", "VEGGIE", "SAUCES"].includes(category);
  if (groupId === "sweets") return category === "DESSERTS";
  if (groupId === "hot-drinks") return category === "COFFEE AND TEA";
  if (groupId === "beers") return category === "BEERS AND CIDERS";
  if (groupId === "soft-drinks") return category === "SOFT DRINKS" && !isJuiceOrMocktailItem(item);
  if (groupId === "juices-mocktails") return isJuiceOrMocktailItem(item);
  if (groupId === "liquor") {
    return ["BRANDY", "GIN", "LIQUEURS", "RUM", "TEQUILA", "VODKA", "WHISKEY", "WINE"].includes(
      category,
    );
  }
  if (groupId === PACKAGING_CATEGORY) return false;

  return false;
}

function receiptPackagingQty(line: any, pack: PackagingSelection) {
  if (pack.total_qty !== undefined) return Number(pack.total_qty);
  return Number(line.qty ?? 0) * Math.max(1, Number(pack.qty_per_item) || 1);
}

function isoDateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function orderReference(order: any) {
  return order.physical_order_no || order.id.slice(0, 8).toUpperCase();
}

function orderSummary(order: any) {
  return [
    ...(order.order_items ?? []).map(
      (line: any) =>
        `${line.menu_items?.name ?? "Item"} x${fmtQty(line.qty)}${omissionLabel(line.order_item_omissions)}`,
    ),
    ...(order.order_packaging ?? []).map(
      (pack: any) =>
        `${pack.packaging_options?.name ?? pack.items?.name ?? "Packaging"} x${fmtQty(pack.qty)}`,
    ),
  ].join(" | ");
}

function omissionLabel(omissions: any[] = []) {
  const names = omissions.map((omission) => omission.items?.name).filter(Boolean);
  return names.length ? ` (no ${names.join(", ")})` : "";
}

function dateTimeLocalValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function dateTimeLocalToIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function getPriceOverrides(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PRICE_OVERRIDES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function setPriceOverride(itemId: string, price: number) {
  try {
    const overrides = getPriceOverrides();
    overrides[itemId] = price;
    localStorage.setItem(PRICE_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {}
}

function orderCashier(order: any) {
  return order.profiles?.full_name || order.profiles?.username || "Staff";
}

function PendingOrdersDialog({
  onClose,
  onSelectOrder,
}: {
  onClose: () => void;
  onSelectOrder: (order: any) => void;
}) {
  const qc = useQueryClient();
  const branchMemberships = useQuery({
    queryKey: ["auth", "branch-memberships"],
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

  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [printOrder, setPrintOrder] = useState<any>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; reason: string } | null>(null);
  const [pendingPayOrder, setPendingPayOrder] = useState<any>(null);

  const branchId = branchMemberships.data?.branch_id ?? null;

  const pendingOrders = useQuery({
    queryKey: ["pos", "pending-orders", branchId],
    queryFn: () => orderService.getPendingOrders(branchId!),
    enabled: !!branchId,
    refetchInterval: 15_000,
  });

  const prevOrdersRef = useRef<any[]>([]);

  const orders = useMemo(() => (pendingOrders.data ?? []), [pendingOrders.data]);

  useEffect(() => {
    if (!pendingOrders.data) return;
    const prev = prevOrdersRef.current;
    const curr = pendingOrders.data;
    for (const order of curr) {
      if (order.source === "website" && !prev.some((p: any) => p.id === order.id)) {
        const tableLabel = order.table_label ?? "Takeaway";
        toast.info(`New website order: ${tableLabel}`, { duration: 8_000 });
      }
    }
    prevOrdersRef.current = curr;
  }, [pendingOrders.data]);

  const processPayment = useMutation({
    mutationFn: async ({
      order,
      physicalOrderNo,
      saleAt,
      payments,
    }: {
      order: any;
      physicalOrderNo: string;
      saleAt: string;
      payments: { method: string; amount: number }[];
    }) => {
      return orderService.processPayment(order.id, payments, { physicalOrderNo, saleAt });
    },
    onSuccess: (_, { order }) => {
      toast.success(`Order ${order.physical_order_no || order.id.slice(0, 8).toUpperCase()} paid`);
      onSelectOrder(order);
      setPendingPayOrder(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelOrder = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return orderService.updateOrderStatus(id, "cancelled", reason || undefined);
    },
    onSuccess: () => {
      toast.success("Order cancelled");
      qc.invalidateQueries({ queryKey: ["pos", "pending-orders"] });
      setCancelTarget(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Pending orders</DialogTitle>
            <DialogDescription>
              Orders from waiters and website that need payment.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-2">
            {pendingOrders.isLoading && <LoadingState label="Loading pending orders..." />}
            {pendingOrders.error && <ErrorState error={pendingOrders.error} label="Could not load orders" />}
            {orders.length === 0 && !pendingOrders.isLoading && (
              <p className="text-sm text-muted-foreground p-4 text-center">No pending orders.</p>
            )}
            {orders.map((order: any) => {
              const tableLabel = order.tables?.label ?? order.table_label ?? "Takeaway";
              const cashier = order.cashier_name ?? order.profiles?.full_name ?? order.profiles?.username ?? "Waiter";
              const total = Number(order.total);
              const isWebsite = order.source === "website";
              return (
                <div key={order.id} className={`border rounded-lg p-3 ${isWebsite ? "border-yellow-400 bg-yellow-50/30 dark:bg-yellow-950/10" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{tableLabel}</span>
                        {isWebsite && (
                          <span className="text-[10px] bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded uppercase font-bold">Web</span>
                        )}
                        <span className="text-xs bg-secondary px-2 py-0.5 rounded-full uppercase">
                          {order.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {(order.order_items ?? []).map((line: any) => (
                          <div key={line.id} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">x{line.qty}</span>
                            <span>{line.menu_items?.name ?? "Item"}</span>
                            {(line.order_item_modifiers ?? []).length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                ({line.order_item_modifiers.map((m: any) => m.modifiers?.name).join(", ")})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      {order.customer_name && (
                        <p className="text-xs text-foreground mt-1">
                          {order.customer_name}{order.customer_phone ? ` · ${order.customer_phone}` : ""}
                        </p>
                      )}
                      {order.note && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{order.note}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-primary">{MWK(total)}</div>
                      <div className="text-[10px] text-muted-foreground">{cashier}</div>
                      <div className="flex gap-1 mt-2">
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setPrintOrder(order)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8"
                          onClick={() => setCancelTarget({ id: order.id, reason: "" })}
                          disabled={cancelOrder.isPending || order.status === "cancelled" || order.status === "paid"}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => setPendingPayOrder(order)}
                          disabled={processPayment.isPending}
                        >
                          Pay
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingPayOrder && (
        <PaymentDialog
          total={Number(pendingPayOrder.total)}
          onClose={() => setPendingPayOrder(null)}
          onPay={(physicalOrderNo, saleAt, payments) =>
            processPayment.mutate({ order: pendingPayOrder, physicalOrderNo, saleAt, payments })
          }
          busy={processPayment.isPending}
        />
      )}

      {printOrder && (
        <KitchenOrderPrintDialog
          order={printOrder}
          onClose={() => setPrintOrder(null)}
        />
      )}

      {cancelTarget && (
        <Dialog open onOpenChange={() => setCancelTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Cancel order</DialogTitle>
              <DialogDescription>
                Enter a reason for cancelling this order.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label>Reason</Label>
              <Input
                value={cancelTarget.reason}
                onChange={(e) => setCancelTarget({ ...cancelTarget, reason: e.target.value })}
                placeholder="e.g. Customer cancelled..."
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setCancelTarget(null)}>Back</Button>
              <Button
                variant="destructive"
                disabled={cancelOrder.isPending || !cancelTarget.reason.trim()}
                onClick={() => cancelOrder.mutate(cancelTarget)}
              >
                {cancelOrder.isPending ? "Cancelling..." : "Cancel order"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function KitchenOrderPrintDialog({ order, onClose }: { order: any; onClose: () => void }) {
  const tableLabel = order.tables?.label ?? order.table_label ?? "Takeaway";
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kitchen Order</DialogTitle>
          <DialogDescription>Show this to the kitchen staff.</DialogDescription>
        </DialogHeader>
        <div className="bg-white text-black p-4 rounded text-xs font-mono" id="kitchen-receipt">
          <div className="text-center mb-2">
            <div className="font-bold text-sm">JUNGLE PEPPER</div>
            <div>Kidney Crescent, Blantyre</div>
            <div className="mt-1 font-bold text-base">{tableLabel}</div>
            <div className="mt-1">Order: {order.physical_order_no || order.id.slice(0, 8).toUpperCase()}</div>
            <div>{new Date(order.created_at).toLocaleString()}</div>
            {order.source === "website" && <div className="text-yellow-600 font-bold mt-1">WEBSITE ORDER</div>}
          </div>
          <hr className="my-1 border-black" />
          {(order.order_items ?? []).map((line: any) => (
            <div key={line.id} className="mb-1">
              <div className="flex justify-between font-bold">
                <span>{line.qty}x {line.menu_items?.name ?? "Item"}</span>
              </div>
              {(line.order_item_modifiers ?? []).length > 0 && (
                <div className="pl-2">{line.order_item_modifiers.map((m: any) => m.modifiers?.name).join(", ")}</div>
              )}
              {line.takeaway && <div className="pl-2 text-blue-600">TAKEAWAY</div>}
              {line.note && <div className="pl-2 text-orange-600">Note: {line.note}</div>}
            </div>
          ))}
          {order.note && (
            <>
              <hr className="my-1 border-black" />
              <div className="italic">{order.note}</div>
            </>
          )}
          <hr className="my-1 border-black" />
          <div className="text-center font-bold">Obrigado!</div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function receiptFromOrder(order: any) {
  const menuLines = (order.order_items ?? []).map((line: any) => {
    const qty = Number(line.qty);
    const packaging = (line.order_item_packaging ?? []).map((pack: any) => ({
      option_id: pack.id,
      name: pack.packaging_options?.name ?? pack.items?.name ?? "Packaging",
      item_id: pack.item_id,
      unit_price: Number(pack.unit_price),
      qty_per_item: qty > 0 ? Number(pack.qty) / qty : Number(pack.qty),
      total_qty: Number(pack.qty),
    }));
    const packagingTotal = packaging.reduce(
      (sum: number, pack: PackagingSelection) =>
        sum + Number(pack.unit_price) * receiptPackagingQty(line, pack),
      0,
    );

    return {
      key: line.id,
      kind: "menu",
      menu_item_id: line.menu_item_id,
      name: line.menu_items?.name ?? "Item",
      price: Number(line.unit_price),
      qty,
      takeaway: Boolean(line.takeaway),
      note: line.note,
      modifiers: (line.order_item_modifiers ?? []).map((modifier: any) => ({
        id: modifier.modifier_id,
        name: modifier.modifiers?.name ?? "Extra",
        price_delta: Number(modifier.modifiers?.price_delta ?? 0),
      })),
      omissions: (line.order_item_omissions ?? []).map((omission: any) => ({
        recipe_id: omission.recipe_id,
        item_id: omission.item_id,
        name: omission.items?.name ?? "Removed item",
        qty: Number(omission.qty),
        unit: omission.items?.units?.code,
      })),
      packaging,
      total: qty * Number(line.unit_price) + packagingTotal,
    };
  });

  const packagingLines = (order.order_packaging ?? []).map((pack: any) => ({
    key: `packaging-${pack.id}`,
    kind: "packaging",
    packaging_option_id: pack.id,
    item_id: pack.item_id,
    name: pack.packaging_options?.name ?? pack.items?.name ?? "Packaging",
    price: Number(pack.unit_price),
    qty: Number(pack.qty),
    takeaway: false,
    modifiers: [],
    omissions: [],
    packaging: [],
    total: Number(pack.qty) * Number(pack.unit_price),
  }));

  return {
    id: order.id,
    lines: [...menuLines, ...packagingLines],
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    total: Number(order.total),
    note: order.note,
    saleType: order.sale_type ?? "regular",
    physicalOrderNo: order.physical_order_no ?? null,
    staffMealReason: order.staff_meal_reason ?? null,
    at: new Date(order.created_at),
  };
}

function isMenuLine(line: CartLine): line is CartLine & { menu_item_id: string } {
  return line.kind === "menu" && Boolean(line.menu_item_id);
}

function isPackagingSaleLine(
  line: CartLine,
): line is CartLine & { packaging_option_id: string; item_id: string } {
  return line.kind === "packaging" && Boolean(line.packaging_option_id) && Boolean(line.item_id);
}

function PosPage() {
  const qc = useQueryClient();
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [staffMealOpen, setStaffMealOpen] = useState(false);
  const [modOpen, setModOpen] = useState<{
    menuId: string;
    lineKey: string;
    removeOnCancel?: boolean;
  } | null>(null);
  const [omitOpen, setOmitOpen] = useState<{ lineKey: string } | null>(null);
  const [packOpen, setPackOpen] = useState<{ lineKey: string } | null>(null);
  const [packManagerOpen, setPackManagerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFrom, setHistoryFrom] = useState(() => isoDateDaysAgo(30));
  const [historyTo, setHistoryTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [pendingOpen, setPendingOpen] = useState(false);

  const branch = useQuery({
    queryKey: ["auth", "branch-memberships"],
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

  const branchId = branch.data?.branch_id ?? null;

  const cats = useQuery({
    queryKey: ["pos", "cats"],
    queryFn: () => menuService.listCategories(),
  });

  const items = useQuery({
    queryKey: ["pos", "items"],
    queryFn: () => menuService.listMenuItems({ activeOnly: true }),
  });

  const mods = useQuery({
    queryKey: ["pos", "mods"],
    queryFn: () => menuService.listModifiers(),
  });

  const recipeOptions = useQuery({
    queryKey: ["pos", "recipe-options"],
    queryFn: () => menuService.listRecipeOptions(),
  });

  const packaging = useQuery({
    queryKey: ["pos", "packaging"],
    queryFn: () => packagingService.listOptions(),
  });

  const packagingItems = useQuery({
    queryKey: ["pos", "packaging-items"],
    queryFn: () => packagingService.listPackagingItems(),
  });

  const salesHistory = useQuery({
    queryKey: ["pos", "sales-history", historyFrom, historyTo],
    queryFn: () =>
      reportService.listSales(
        new Date(`${historyFrom}T00:00:00`).toISOString(),
        new Date(`${historyTo}T23:59:59`).toISOString(),
      ),
    enabled: historyOpen,
  });

  const filtered = useMemo(() => {
    let list = items.data ?? [];
    if (activeCat) {
      list = list.filter((item: any) => itemMatchesPosGroup(item, activeCat));
    }
    if (search.trim())
      list = list.filter((i: any) => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [items.data, activeCat, search]);

  const packagingCards = useMemo(() => {
    const list = packaging.data ?? [];
    if (!search.trim()) return list;
    const needle = search.toLowerCase();
    return list.filter((option) => option.name.toLowerCase().includes(needle));
  }, [packaging.data, search]);
  const dataError =
    cats.error ||
    items.error ||
    mods.error ||
    recipeOptions.error ||
    packaging.error ||
    packagingItems.error;
  const menuOptionsLoading =
    cats.isLoading ||
    items.isLoading ||
    mods.isLoading ||
    recipeOptions.isLoading ||
    packaging.isLoading ||
    packagingItems.isLoading;

  const requiresCrust = (line: CartLine) =>
    isMenuLine(line) &&
    (mods.data ?? []).some(
      (modifier: any) =>
        modifier.menu_item_id === line.menu_item_id &&
        (modifier.name === "Thin Crust" || modifier.name === "Thick Crust"),
    );

  const hasSelectedCrust = (line: CartLine) =>
    line.modifiers.some(
      (modifier) => modifier.name === "Thin Crust" || modifier.name === "Thick Crust",
    );

  const recipeOptionsForLine = (line: CartLine): OmissionSelection[] =>
    isMenuLine(line)
      ? (recipeOptions.data ?? [])
          .filter(
            (recipe: any) =>
              recipe.menu_item_id === line.menu_item_id && (!recipe.takeaway_only || line.takeaway),
          )
          .map((recipe: any) => ({
            recipe_id: recipe.id,
            item_id: recipe.item_id,
            name: recipe.items?.name ?? "Recipe item",
            qty: Number(recipe.qty),
            unit: recipe.items?.units?.code,
            takeaway_only: Boolean(recipe.takeaway_only),
          }))
      : [];

  const linePackagingQty = (line: CartLine, pack: PackagingSelection) =>
    line.takeaway ? line.qty * Math.max(1, Number(pack.qty_per_item) || 1) : 0;

  const linePackagingTotal = (line: CartLine) =>
    line.takeaway
      ? line.packaging.reduce(
          (sum, pack) => sum + Number(pack.unit_price) * linePackagingQty(line, pack),
          0,
        )
      : 0;

  const addItem = (mi: any) => {
    if (menuOptionsLoading) {
      toast.info("Menu options are still loading. Try again in a moment.");
      return;
    }

    const itemMods = (mods.data ?? []).filter((m: any) => m.menu_item_id === mi.id);
    const crustMods = itemMods.filter(
      (modifier: any) => modifier.name === "Thin Crust" || modifier.name === "Thick Crust",
    );
    const key = crypto.randomUUID();
    const overrides = getPriceOverrides();
    const savedPrice = mi.id ? overrides[mi.id] : undefined;
    setCart((c) => [
      ...c,
      {
        key,
        kind: "menu",
        menu_item_id: mi.id,
        name: mi.name,
        price: savedPrice ?? Number(mi.price),
        qty: 1,
        takeaway: false,
        modifiers: [],
        omissions: [],
        packaging: [],
      },
    ]);
    if (crustMods.length) setModOpen({ menuId: mi.id, lineKey: key, removeOnCancel: true });
  };

  const addPackagingSale = (option: PackagingOptionView) => {
    const key = crypto.randomUUID();
    setCart((c) => [
      ...c,
      {
        key,
        kind: "packaging",
        packaging_option_id: option.id,
        item_id: option.item_id,
        name: option.name,
        price: Number(option.price),
        qty: 1,
        takeaway: false,
        modifiers: [],
        omissions: [],
        packaging: [],
      },
    ]);
  };

  const lineTotal = (l: CartLine) =>
    isPackagingSaleLine(l)
      ? Number(l.price) * Number(l.qty)
      : (l.price + l.modifiers.reduce((s, m) => s + Number(m.price_delta), 0)) * l.qty +
        linePackagingTotal(l);
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(subtotal - discount, 0);
  const hasMissingPackaging = cart.some(
    (line) => isMenuLine(line) && line.takeaway && line.packaging.length === 0,
  );
  const hasMissingCrust = cart.some((line) => requiresCrust(line) && !hasSelectedCrust(line));

  const processPay = useMutation({
    mutationFn: async (request: {
      payments: { method: string; amount: number }[];
      physicalOrderNo: string;
      saleAt: string;
      staffMealReason?: string;
    }) => {
      if (!branchId) throw new Error("No branch assigned");
      const isStaffMeal = Boolean(request.staffMealReason);
      const menuLines = cart.filter(isMenuLine);
      const packagingLines = cart.filter(isPackagingSaleLine);
      const posPayload = {
        discount: isStaffMeal ? subtotal : discount,
        note: note || null,
        items: menuLines.map((l) => ({
          menu_item_id: l.menu_item_id,
          qty: l.qty,
          takeaway: l.takeaway,
          note: l.note ?? null,
          unit_price: l.price,
          modifiers: l.modifiers.map((m) => ({ modifier_id: m.id })),
          omissions: l.omissions.map((omission) => ({
            recipe_id: omission.recipe_id,
            item_id: omission.item_id,
          })),
          packaging: l.takeaway
            ? l.packaging.map((pack) => ({
                option_id: pack.option_id,
                unit_price: Number(pack.unit_price),
                qty_per_item: Math.max(1, Number(pack.qty_per_item) || 1),
              }))
            : null,
        })),
        packaging_sales: packagingLines.map((line) => ({
          option_id: line.packaging_option_id,
          qty: line.qty,
          unit_price: Number(line.price),
        })),
      };
      return orderService.createPosOrder(posPayload, branchId, request.payments, {
        physicalOrderNo: request.physicalOrderNo.trim(),
        saleAt: request.saleAt,
        saleType: isStaffMeal ? "staff_meal" : "regular",
        staffMealReason: request.staffMealReason,
      });
    },
    onSuccess: async (orderId, request) => {
      const isStaffMeal = Boolean(request.staffMealReason);
      const receiptDiscount = isStaffMeal ? subtotal : discount;
      const receiptTotal = isStaffMeal ? 0 : Math.max(subtotal - discount, 0);
      const receipt = {
        id: orderId,
        lines: cart.map((l) => ({ ...l, total: lineTotal(l) })),
        subtotal,
        discount: receiptDiscount,
        total: receiptTotal,
        note,
        saleType: isStaffMeal ? "staff_meal" : "regular",
        physicalOrderNo: request.physicalOrderNo.trim(),
        staffMealReason: request.staffMealReason ?? null,
        at: new Date(request.saleAt),
      };
      setLastReceipt(receipt);
      setCart([]);
      setDiscount(0);
      setNote("");
      setPayOpen(false);
      setStaffMealOpen(false);
      toast.success(isStaffMeal ? "Staff meal recorded" : "Order completed");
      qc.invalidateQueries({ queryKey: ["dash"] });
      qc.invalidateQueries({ queryKey: ["pos", "sales-history"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const omitLine = omitOpen ? cart.find((line) => line.key === omitOpen.lineKey) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-9rem)]">
      <div className="lg:col-span-2 flex flex-col gap-3 min-h-0">
        {(cats.isLoading ||
          items.isLoading ||
          mods.isLoading ||
          recipeOptions.isLoading ||
          packaging.isLoading) && <LoadingState label="Loading live menu..." />}
        {dataError && <ErrorState error={dataError} label="Could not load POS data" />}
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Search menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-48 flex-1"
          />
          <Button variant="secondary" onClick={() => setPackManagerOpen(true)}>
            <Package className="h-4 w-4 mr-1" />
            Takeaway boxes
          </Button>
          <Button variant="secondary" onClick={() => setPendingOpen(true)}>
            <ClipboardList className="h-4 w-4 mr-1" />
            Pending orders
          </Button>
          <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4 mr-1" />
            Sales history
          </Button>
        </div>
        <Tabs
          value={activeCat ?? "all"}
          onValueChange={(v) => setActiveCat(v === "all" ? null : v)}
        >
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">ALL</TabsTrigger>
            {POS_CATEGORY_GROUPS.map((category) => (
              <TabsTrigger key={category.id} value={category.id}>
                {category.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 overflow-auto pb-2">
          {activeCat === PACKAGING_CATEGORY
            ? packagingCards.map((option) => (
                <button
                  key={`packaging-${option.id}`}
                  onClick={() => addPackagingSale(option)}
                  disabled={menuOptionsLoading}
                  className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors disabled:cursor-wait disabled:opacity-60"
                >
                  <div className="font-medium text-sm leading-tight">{option.name}</div>
                  <div className="text-primary font-semibold text-sm mt-1">
                    {MWK(option.price)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Takeaway box</div>
                </button>
              ))
            : activeCat === EXTRAS_CATEGORY
            ? (() => {
                const sectionOrder = ["DAIRY", "MEATS", "VEGGIE", "SAUCES"];
                const groups: Record<string, any[]> = {};
                for (const item of filtered) {
                  const cat = normalizeCategoryText(item.categories?.name);
                  if (!groups[cat]) groups[cat] = [];
                  groups[cat].push(item);
                }
                return sectionOrder.flatMap((section) => {
                  const items = groups[section];
                  if (!items || items.length === 0) return [];
                  return [
                    <div key={`hdr-${section}`} className="col-span-full font-bold text-xs text-muted-foreground uppercase tracking-wider mt-3 first:mt-0">{section}</div>,
                    ...items.map((mi: any) => (
                      <button
                        key={mi.id}
                        onClick={() => addItem(mi)}
                        disabled={menuOptionsLoading}
                        className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors disabled:cursor-wait disabled:opacity-60"
                      >
                        <div className="font-medium text-sm leading-tight">{mi.name}</div>
                        <div className="text-primary font-semibold text-sm mt-1">{MWK(mi.price)}</div>
                      </button>
                    )),
                  ];
                });
              })()
            : filtered.map((mi: any) => (
                <button
                  key={mi.id}
                  onClick={() => addItem(mi)}
                  disabled={menuOptionsLoading}
                  className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors disabled:cursor-wait disabled:opacity-60"
                >
                  <div className="font-medium text-sm leading-tight">{mi.name}</div>
                  <div className="text-primary font-semibold text-sm mt-1">{MWK(mi.price)}</div>
                </button>
              ))}
        </div>
      </div>

      <Card className="p-3 flex flex-col min-h-0">
        <h2 className="font-semibold mb-2">Order</h2>
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
                  {l.modifiers
                    .map(
                      (m) => m.name + (Number(m.price_delta) > 0 ? ` +${MWK(m.price_delta)}` : ""),
                    )
                    .join(", ")}
                </div>
              )}
              {isMenuLine(l) && l.omissions.length > 0 && (
                <div className="text-xs text-destructive">
                  No{" "}
                  {l.omissions
                    .map((omission) => `${omission.name} x${fmtQty(omission.qty * l.qty)}`)
                    .join(", ")}
                </div>
              )}
              {requiresCrust(l) && !hasSelectedCrust(l) && (
                <p className="text-xs text-destructive mt-1">Choose thin or thick crust.</p>
              )}
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setCart((c) =>
                        c.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)),
                      )
                    }
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center">{l.qty}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))
                    }
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="font-semibold">{MWK(lineTotal(l))}</div>
              </div>
              {isPackagingSaleLine(l) ? (
                <div className="mt-2">
                  <Label className="text-xs">Price each</Label>
                  <Input
                    type="number"
                    min={0}
                    value={l.price}
                    onChange={(event) => {
                      const newPrice = Math.max(0, Number(event.target.value) || 0);
                      setCart((rows) =>
                        rows.map((row) =>
                          row.key === l.key
                            ? { ...row, price: newPrice }
                            : row,
                        ),
                      );
                      if (l.item_id) setPriceOverride(l.item_id, newPrice);
                    }}
                    className="h-8 text-right"
                  />
                </div>
              ) : (
                <>
                  <div className="mt-2">
                    <Label className="text-xs">Price each</Label>
                    <Input
                      type="number"
                      min={0}
                      value={l.price}
                      onChange={(event) => {
                        const newPrice = Math.max(0, Number(event.target.value) || 0);
                        setCart((rows) =>
                          rows.map((row) =>
                            row.key === l.key
                              ? { ...row, price: newPrice }
                              : row,
                          ),
                        );
                        if (isMenuLine(l) && l.menu_item_id) setPriceOverride(l.menu_item_id, newPrice);
                      }}
                      className="h-8 text-right"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <Label htmlFor={`takeaway-${l.key}`} className="text-xs">
                      Takeaway
                    </Label>
                    <Switch
                      id={`takeaway-${l.key}`}
                      checked={l.takeaway}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setCart((c) =>
                            c.map((x) => (x.key === l.key ? { ...x, takeaway: true } : x)),
                          );
                          setPackOpen({ lineKey: l.key });
                          return;
                        }
                        setCart((c) =>
                          c.map((x) =>
                            x.key === l.key
                              ? {
                                  ...x,
                                  takeaway: false,
                                  packaging: [],
                                  omissions: x.omissions.filter(
                                    (omission) => !omission.takeaway_only,
                                  ),
                                }
                              : x,
                          ),
                        );
                      }}
                    />
                  </div>
                </>
              )}
              {isMenuLine(l) && l.takeaway && (
                <div className="mt-2 rounded border border-dashed border-border p-2 text-xs">
                  {l.packaging.length ? (
                    <div className="space-y-1">
                      {l.packaging.map((pack) => (
                        <div
                          key={pack.option_id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>
                            <Package className="h-3.5 w-3.5 inline mr-1" />
                            {pack.name} x {fmtQty(linePackagingQty(l, pack))}
                          </span>
                          <button
                            className="font-medium text-primary"
                            onClick={() => setPackOpen({ lineKey: l.key })}
                          >
                            {MWK(pack.unit_price)} each
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="text-primary font-medium"
                      onClick={() => setPackOpen({ lineKey: l.key })}
                    >
                      Choose takeaway packaging
                    </button>
                  )}
                </div>
              )}
              {isMenuLine(l) && requiresCrust(l) && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2 h-7 w-full text-xs"
                  onClick={() => setModOpen({ menuId: l.menu_item_id, lineKey: l.key })}
                >
                  Change crust
                </Button>
              )}
              {isMenuLine(l) && recipeOptionsForLine(l).length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 w-full text-xs"
                  onClick={() => setOmitOpen({ lineKey: l.key })}
                >
                  <Ban className="h-3.5 w-3.5 mr-1" />
                  Remove recipe items
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-3 mt-2 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{MWK(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Discount</span>
            <Input
              type="number"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
              className="h-8 w-28 text-right"
            />
          </div>
          <Input
            placeholder="Order note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8"
          />
          <div className="flex justify-between text-base font-bold border-t border-border pt-2">
            <span>Total</span>
            <span className="text-primary">{MWK(total)}</span>
          </div>
          {hasMissingPackaging && (
            <p className="text-xs text-destructive">
              Choose packaging for every takeaway line before payment.
            </p>
          )}
          {hasMissingCrust && (
            <p className="text-xs text-destructive">Choose thin or thick crust for every pizza.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="w-full"
              disabled={branch.isLoading || cart.length === 0 || hasMissingPackaging || hasMissingCrust}
              onClick={() => setPayOpen(true)}
            >
              Pay {MWK(total)}
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              disabled={branch.isLoading || cart.length === 0 || hasMissingPackaging || hasMissingCrust}
              onClick={() => setStaffMealOpen(true)}
            >
              <UserCheck className="h-4 w-4 mr-1" />
              Staff meal
            </Button>
          </div>
        </div>
      </Card>

      {modOpen && (
        <ModifierDialog
          menuId={modOpen.menuId}
          mods={(mods.data ?? []).filter((m: any) => m.menu_item_id === modOpen.menuId)}
          current={cart.find((line) => line.key === modOpen.lineKey)?.modifiers ?? []}
          onClose={() => setModOpen(null)}
          onCancel={() => {
            if (modOpen.removeOnCancel) {
              setCart((c) => c.filter((x) => x.key !== modOpen.lineKey));
            }
            setModOpen(null);
          }}
          onSave={(selected) => {
            setCart((c) =>
              c.map((x) => (x.key === modOpen.lineKey ? { ...x, modifiers: selected } : x)),
            );
            setModOpen(null);
          }}
        />
      )}

      {omitOpen && omitLine && (
        <OmissionDialog
          options={recipeOptionsForLine(omitLine)}
          current={omitLine.omissions}
          onClose={() => setOmitOpen(null)}
          onSave={(selected) => {
            setCart((rows) =>
              rows.map((line) =>
                line.key === omitOpen.lineKey ? { ...line, omissions: selected } : line,
              ),
            );
            setOmitOpen(null);
          }}
        />
      )}

      {packOpen && (
        <PackagingDialog
          options={packaging.data ?? []}
          current={cart.find((line) => line.key === packOpen.lineKey)?.packaging ?? []}
          onCancel={() => {
            setCart((c) =>
              c.map((x) =>
                x.key === packOpen.lineKey && x.packaging.length === 0
                  ? { ...x, takeaway: false }
                  : x,
              ),
            );
            setPackOpen(null);
          }}
          onSave={(selected) => {
            setCart((c) =>
              c.map((x) =>
                x.key === packOpen.lineKey
                  ? {
                      ...x,
                      takeaway: true,
                      packaging: selected,
                    }
                  : x,
              ),
            );
            setPackOpen(null);
            void Promise.all(
              selected.map((pack) => packagingService.updatePrice(pack.option_id, pack.unit_price)),
            )
              .then(() => qc.invalidateQueries({ queryKey: ["pos", "packaging"] }))
              .catch((error: any) => toast.error(error.message));
          }}
        />
      )}

      {packManagerOpen && (
        <PackagingManagerDialog
          options={packaging.data ?? []}
          stockItems={packagingItems.data ?? []}
          onClose={() => setPackManagerOpen(false)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ["pos", "packaging"] });
            void qc.invalidateQueries({ queryKey: ["pos", "packaging-items"] });
          }}
        />
      )}

      {historyOpen && (
        <SalesHistoryDialog
          orders={salesHistory.data ?? []}
          loading={salesHistory.isLoading || salesHistory.isFetching}
          error={salesHistory.error}
          from={historyFrom}
          to={historyTo}
          search={historySearch}
          onFromChange={setHistoryFrom}
          onToChange={setHistoryTo}
          onSearchChange={setHistorySearch}
          onClose={() => setHistoryOpen(false)}
          onReprint={(order) => {
            setLastReceipt(receiptFromOrder(order));
            setHistoryOpen(false);
          }}
        />
      )}

      {payOpen && (
        <PaymentDialog
          total={total}
          onClose={() => setPayOpen(false)}
          onPay={(physicalOrderNo, saleAt, pmts) =>
            processPay.mutate({ physicalOrderNo, saleAt, payments: pmts })
          }
          busy={processPay.isPending}
        />
      )}

      {staffMealOpen && (
        <StaffMealDialog
          subtotal={subtotal}
          onClose={() => setStaffMealOpen(false)}
          onApprove={async ({ reason, password, physicalOrderNo, saleAt }) => {
            await authService.verifyCurrentCredential(password);
            processPay.mutate({ payments: [], physicalOrderNo, saleAt, staffMealReason: reason });
          }}
          busy={processPay.isPending}
        />
      )}

      {pendingOpen && (
        <PendingOrdersDialog
          onClose={() => setPendingOpen(false)}
          onSelectOrder={(order) => {
            setPendingOpen(false);
            setLastReceipt(receiptFromOrder(order));
          }}
        />
      )}

      {lastReceipt && <ReceiptDialog receipt={lastReceipt} onClose={() => setLastReceipt(null)} />}
    </div>
  );
}

function SalesHistoryDialog({
  orders,
  loading,
  error,
  from,
  to,
  search,
  onFromChange,
  onToChange,
  onSearchChange,
  onClose,
  onReprint,
}: {
  orders: any[];
  loading: boolean;
  error: unknown;
  from: string;
  to: string;
  search: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onReprint: (order: any) => void;
}) {
  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      [
        orderReference(order),
        orderSummary(order),
        orderCashier(order),
        order.sale_type === "staff_meal" ? "staff meal" : "regular",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [orders, search]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Sales history</DialogTitle>
          <DialogDescription>Find a completed sale and reprint its receipt.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[140px_140px_1fr] gap-2">
            <div>
              <Label>From</Label>
              <Input
                type="date"
                value={from}
                onChange={(event) => onFromChange(event.target.value)}
              />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(event) => onToChange(event.target.value)} />
            </div>
            <div>
              <Label>Search</Label>
              <Input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Order number, item, cashier..."
              />
            </div>
          </div>

          {(() => {
            const dayOrders = orders.filter((o: any) =>
              o.created_at?.startsWith(to),
            );
            const missingSummary = missingOrderNumbersSummary(dayOrders);
            return missingSummary ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {missingSummary}
              </div>
            ) : null;
          })()}

          {loading && <LoadingState label="Loading sales history..." />}
          {error ? <ErrorState error={error} label="Could not load sales history" /> : null}

          <div className="max-h-[60vh] overflow-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Date</th>
                  <th className="p-2">Order #</th>
                  <th className="p-2">Items</th>
                  <th className="p-2">Cashier</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filteredOrders.length === 0 && (
                  <tr>
                    <td className="p-4 text-center text-muted-foreground" colSpan={6}>
                      No sales found for this range.
                    </td>
                  </tr>
                )}
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="border-t border-border align-top">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(order.created_at).toLocaleString()}
                    </td>
                    <td className="p-2 font-medium">{orderReference(order)}</td>
                    <td className="p-2 min-w-72">{orderSummary(order)}</td>
                    <td className="p-2">{orderCashier(order)}</td>
                    <td className="p-2 text-right font-medium">{MWK(order.total)}</td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => onReprint(order)}>
                        <Printer className="h-4 w-4 mr-1" />
                        Reprint
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OmissionDialog({
  options,
  current,
  onClose,
  onSave,
}: {
  options: OmissionSelection[];
  current: OmissionSelection[];
  onClose: () => void;
  onSave: (selection: OmissionSelection[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(current.map((item) => item.recipe_id)),
  );
  const toggle = (recipeId: string) => {
    const next = new Set(selected);
    if (next.has(recipeId)) next.delete(recipeId);
    else next.add(recipeId);
    setSelected(next);
  };
  const chosen = options.filter((option) => selected.has(option.recipe_id));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove recipe items</DialogTitle>
          <DialogDescription>
            Select ingredients or sides that should not be served or deducted for this line.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto space-y-2">
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground">No removable recipe items found.</p>
          )}
          {options.map((option) => (
            <button
              key={option.recipe_id}
              type="button"
              onClick={() => toggle(option.recipe_id)}
              className={`w-full flex justify-between gap-3 rounded border p-2 text-left ${
                selected.has(option.recipe_id)
                  ? "border-destructive bg-destructive/10"
                  : "border-border"
              }`}
            >
              <span className="font-medium">{option.name}</span>
              <span className="text-muted-foreground">
                {fmtQty(option.qty)} {option.unit ?? ""}
              </span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(chosen)}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackagingDialog({
  options,
  current,
  onCancel,
  onSave,
}: {
  options: PackagingOptionView[];
  current: PackagingSelection[];
  onCancel: () => void;
  onSave: (selection: PackagingSelection[]) => void;
}) {
  const firstOption = options[0];
  const [selected, setSelected] = useState<PackagingSelection[]>(
    current.length || !firstOption
      ? current
      : [
          {
            option_id: firstOption.id,
            name: firstOption.name,
            item_id: firstOption.item_id,
            unit_price: Number(firstOption.price),
            qty_per_item: 1,
          },
        ],
  );
  const addPackaging = () => {
    const option = options.find((item) => !selected.some((pack) => pack.option_id === item.id));
    if (!option) return;
    setSelected((rows) => [
      ...rows,
      {
        option_id: option.id,
        name: option.name,
        item_id: option.item_id,
        unit_price: Number(option.price),
        qty_per_item: 1,
      },
    ]);
  };
  const updatePackaging = (index: number, patch: Partial<PackagingSelection>) => {
    setSelected((rows) => rows.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Takeaway packaging</DialogTitle>
          <DialogDescription>
            Add every charged packaging item for this takeaway line.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {selected.map((row, index) => (
            <div key={`${row.option_id}-${index}`} className="rounded border border-border p-3">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_110px_110px_36px] gap-2 items-end">
                <div>
                  <Label>Packaging</Label>
                  <Select
                    value={row.option_id}
                    onValueChange={(value) => {
                      const option = options.find((item) => item.id === value);
                      if (!option) return;
                      updatePackaging(index, {
                        option_id: option.id,
                        name: option.name,
                        item_id: option.item_id,
                        unit_price: Number(option.price),
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose packaging" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                          {option.items?.units?.code ? ` (${option.items.units.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Price each</Label>
                  <Input
                    type="number"
                    min={0}
                    value={row.unit_price}
                    onChange={(event) =>
                      updatePackaging(index, {
                        unit_price: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Qty / dish</Label>
                  <Input
                    type="number"
                    min={1}
                    step="1"
                    value={row.qty_per_item}
                    onChange={(event) =>
                      updatePackaging(index, {
                        qty_per_item: Math.max(1, Number(event.target.value) || 1),
                      })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected((rows) => rows.filter((_, idx) => idx !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={addPackaging}
            disabled={options.length === 0}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add box
          </Button>
          <p className="text-xs text-muted-foreground">
            Use multiple rows when one meal needs two different boxes. Edited prices become the new
            default.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() =>
              onSave(
                selected.map((pack) => ({
                  ...pack,
                  unit_price: Math.max(0, Number(pack.unit_price) || 0),
                  qty_per_item: Math.max(1, Number(pack.qty_per_item) || 1),
                })),
              )
            }
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackagingManagerDialog({
  options,
  stockItems,
  onClose,
  onChanged,
}: {
  options: PackagingOptionView[];
  stockItems: PackagingStockItemView[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const firstStockItem = stockItems[0];
  const [name, setName] = useState("");
  const [itemId, setItemId] = useState(firstStockItem?.id ?? "");
  const [price, setPrice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { name: string; price: number }>>(() =>
    Object.fromEntries(
      options.map((option) => [option.id, { name: option.name, price: Number(option.price) }]),
    ),
  );

  const saveNew = async () => {
    const cleaned = name.trim();
    if (!cleaned || !itemId) {
      toast.error("Choose a name and stock item for the box");
      return;
    }
    setBusy(true);
    try {
      await packagingService.createOption({ name: cleaned, item_id: itemId, price });
      setName("");
      setPrice(0);
      onChanged();
      toast.success("Takeaway box added");
    } catch (error: any) {
      toast.error(error.message ?? "Could not add takeaway box");
    } finally {
      setBusy(false);
    }
  };

  const saveExisting = async (option: PackagingOptionView) => {
    const draft = drafts[option.id];
    if (!draft?.name.trim()) {
      toast.error("Box name cannot be empty");
      return;
    }
    setBusy(true);
    try {
      await packagingService.updateOption(option.id, draft);
      onChanged();
      toast.success("Takeaway box updated");
    } catch (error: any) {
      toast.error(error.message ?? "Could not update takeaway box");
    } finally {
      setBusy(false);
    }
  };

  const deleteExisting = async (option: PackagingOptionView) => {
    setBusy(true);
    try {
      await packagingService.deactivateOption(option.id);
      onChanged();
      toast.success("Takeaway box deleted");
    } catch (error: any) {
      toast.error(error.message ?? "Could not delete takeaway box");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Takeaway boxes</DialogTitle>
          <DialogDescription>
            Add, price, or delete the packaging choices used on POS takeaway orders.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2 items-end">
            <div>
              <Label>Box name</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="White small box"
              />
            </div>
            <div>
              <Label>Stock item</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose stock item" />
                </SelectTrigger>
                <SelectContent>
                  {stockItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({fmtQty(item.qty_on_hand)} {item.units?.code ?? ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Price</Label>
              <Input
                type="number"
                min={0}
                value={price}
                onChange={(event) => setPrice(Math.max(0, Number(event.target.value) || 0))}
              />
            </div>
            <Button disabled={busy || !name.trim() || !itemId} onClick={saveNew}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>

          <div className="max-h-80 overflow-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Box</th>
                  <th className="p-2">Stock item</th>
                  <th className="p-2 text-right">Price</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {options.map((option) => {
                  const draft = drafts[option.id] ?? {
                    name: option.name,
                    price: Number(option.price),
                  };
                  return (
                    <tr key={option.id} className="border-t border-border">
                      <td className="p-2">
                        <Input
                          value={draft.name}
                          onChange={(event) =>
                            setDrafts((rows) => ({
                              ...rows,
                              [option.id]: { ...draft, name: event.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {option.items?.name ?? "Stock item"}
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          className="text-right"
                          value={draft.price}
                          onChange={(event) =>
                            setDrafts((rows) => ({
                              ...rows,
                              [option.id]: {
                                ...draft,
                                price: Math.max(0, Number(event.target.value) || 0),
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => saveExisting(option)}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => deleteExisting(option)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModifierDialog({
  mods,
  current,
  onClose,
  onCancel,
  onSave,
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
    current.find((modifier) => modifier.name === "Thin Crust" || modifier.name === "Thick Crust")
      ?.id ?? null,
  );
  const requiresCrust = crustMods.length > 0;
  const canSave = !requiresCrust || !!crust;
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose pizza base</DialogTitle>
          <DialogDescription>Choose thick or thin dough base.</DialogDescription>
        </DialogHeader>
        {requiresCrust && (
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Base (required)</div>
            <div className="grid grid-cols-2 gap-2">
              {crustMods.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setCrust(m.id)}
                  className={`p-3 rounded border font-medium ${crust === m.id ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              const chosen = mods.filter((m) => m.id === crust);
              onSave(chosen);
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  total,
  onClose,
  onPay,
  busy,
}: {
  total: number;
  onClose: () => void;
  onPay: (physicalOrderNo: string, saleAt: string, p: { method: string; amount: number }[]) => void;
  busy: boolean;
}) {
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(total);
  const [physicalOrderNo, setPhysicalOrderNo] = useState("");
  const [saleAt, setSaleAt] = useState(() => dateTimeLocalValue());
  const cleanedOrderNo = physicalOrderNo.trim();
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment - {MWK(total)}</DialogTitle>
          <DialogDescription>
            Enter the physical order number, then confirm payment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Physical receipt / order no.</Label>
            <Input
              value={physicalOrderNo}
              onChange={(e) => setPhysicalOrderNo(e.target.value)}
              placeholder="Receipt book number"
              autoFocus
            />
          </div>
          <div>
            <Label>
              <CalendarClock className="h-3.5 w-3.5 inline mr-1" />
              Sale date / time
            </Label>
            <Input
              type="datetime-local"
              value={saleAt}
              max={dateTimeLocalValue()}
              onChange={(e) => setSaleAt(e.target.value)}
            />
          </div>
          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="airtel_money">Airtel Money</SelectItem>
                <SelectItem value="mpamba">Mpamba</SelectItem>
                <SelectItem value="national_bank">National Bank</SelectItem>
                <SelectItem value="standard_bank">Standard Bank</SelectItem>
                <SelectItem value="capital_bank">Capital Bank</SelectItem>
                <SelectItem value="eco_bank">Eco Bank</SelectItem>
                <SelectItem value="bank_card">Bank Card</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          {method === "cash" && amount > total && (
            <div className="text-sm">
              Change due: <span className="font-semibold text-success">{MWK(amount - total)}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onPay(cleanedOrderNo, dateTimeLocalToIso(saleAt), [
                { method, amount: Math.min(amount, total) },
              ])
            }
            disabled={busy || amount < total || cleanedOrderNo.length === 0 || saleAt.length === 0}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StaffMealDialog({
  subtotal,
  onClose,
  onApprove,
  busy,
}: {
  subtotal: number;
  onClose: () => void;
  onApprove: (approval: {
    reason: string;
    password: string;
    physicalOrderNo: string;
    saleAt: string;
  }) => Promise<void> | void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [physicalOrderNo, setPhysicalOrderNo] = useState("");
  const [saleAt, setSaleAt] = useState(() => dateTimeLocalValue());
  const [verifying, setVerifying] = useState(false);
  const cleaned = reason.trim();
  const cleanedPassword = password.trim();
  const cleanedOrderNo = physicalOrderNo.trim();
  const locked = busy || verifying;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Staff meal approval</DialogTitle>
          <DialogDescription>Record the staff member or approval note.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Physical receipt / order no.</Label>
            <Input
              value={physicalOrderNo}
              onChange={(e) => setPhysicalOrderNo(e.target.value)}
              placeholder="Receipt book number"
              autoFocus
            />
          </div>
          <div>
            <Label>
              <CalendarClock className="h-3.5 w-3.5 inline mr-1" />
              Sale date / time
            </Label>
            <Input
              type="datetime-local"
              value={saleAt}
              max={dateTimeLocalValue()}
              onChange={(e) => setSaleAt(e.target.value)}
            />
          </div>
          <div>
            <Label>Approval note</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Staff name / approved by"
            />
          </div>
          <div>
            <Label>Approval password / PIN</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="rounded border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span>Food value</span>
              <span>{MWK(subtotal)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Amount due</span>
              <span>{MWK(0)}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              locked ||
              cleaned.length < 2 ||
              cleanedPassword.length < 4 ||
              cleanedOrderNo.length === 0 ||
              saleAt.length === 0
            }
            onClick={async () => {
              setVerifying(true);
              try {
                await onApprove({
                  reason: cleaned,
                  password: cleanedPassword,
                  physicalOrderNo: cleanedOrderNo,
                  saleAt: dateTimeLocalToIso(saleAt),
                });
              } catch (error: any) {
                toast.error(error.message ?? "Could not approve staff meal");
              } finally {
                setVerifying(false);
              }
            }}
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ receipt, onClose }: { receipt: any; onClose: () => void }) {
  const tax = vatBreakdownFromInclusive(receipt.total);
  const receiptRef = receipt.physicalOrderNo || receipt.id.slice(0, 8).toUpperCase();
  const receiptFileRef = String(receiptRef).replace(/[^a-z0-9_-]+/gi, "-");
  const downloadPdf = () => {
    const doc = new jsPDF({ unit: "mm", format: [80, 200] });
    let y = 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("JUNGLE PEPPER", 40, y, { align: "center" });
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Kidney Crescent, Blantyre", 40, y, { align: "center" });
    y += 4;
    doc.text(new Date(receipt.at).toLocaleString(), 40, y, { align: "center" });
    y += 4;
    doc.text("Order: " + receiptRef, 40, y, { align: "center" });
    y += 4;
    if (receipt.saleType === "staff_meal") {
      doc.text("Staff meal", 40, y, { align: "center" });
      y += 4;
    }
    doc.line(4, y, 76, y);
    y += 4;
    receipt.lines.forEach((l: any) => {
      doc.text(`${l.qty}x ${l.name}${l.takeaway ? " (takeaway)" : ""}`, 4, y);
      doc.text(`MK${l.total.toLocaleString()}`, 76, y, { align: "right" });
      y += 4;
      if (l.modifiers?.length) {
        doc.text("  " + l.modifiers.map((m: any) => m.name).join(", "), 4, y);
        y += 4;
      }
      if (l.omissions?.length) {
        doc.text("  No " + l.omissions.map((omission: any) => omission.name).join(", "), 4, y);
        y += 4;
      }
      if (l.takeaway && l.packaging?.length) {
        l.packaging.forEach((pack: PackagingSelection) => {
          const packQty = receiptPackagingQty(l, pack);
          doc.text(`  Packaging: ${pack.name} x${fmtQty(packQty)}`, 4, y);
          doc.text(`MK${(pack.unit_price * packQty).toLocaleString()}`, 76, y, {
            align: "right",
          });
          y += 4;
        });
      }
    });
    doc.line(4, y, 76, y);
    y += 4;
    doc.text("Subtotal", 4, y);
    doc.text(`MK${receipt.subtotal.toLocaleString()}`, 76, y, { align: "right" });
    y += 4;
    if (receipt.discount > 0) {
      doc.text(receipt.saleType === "staff_meal" ? "Staff meal discount" : "Discount", 4, y);
      doc.text(`-MK${receipt.discount.toLocaleString()}`, 76, y, { align: "right" });
      y += 4;
    }
    doc.text("Net excl. VAT", 4, y);
    doc.text(`MK${tax.net.toLocaleString()}`, 76, y, { align: "right" });
    y += 4;
    doc.text(`VAT ${(VAT_RATE * 100).toFixed(1)}% included`, 4, y);
    doc.text(`MK${tax.vat.toLocaleString()}`, 76, y, { align: "right" });
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL INCL. VAT", 4, y);
    doc.text(`MK${receipt.total.toLocaleString()}`, 76, y, { align: "right" });
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Obrigado! Thank you.", 40, y, { align: "center" });
    doc.save(`receipt-${receiptFileRef}.pdf`);
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receipt</DialogTitle>
          <DialogDescription>Print or download the completed order receipt.</DialogDescription>
        </DialogHeader>
        <div className="receipt-print bg-white text-black p-4 rounded text-xs font-mono">
          <div className="text-center">
            <img src={logo} alt="" width={50} height={50} className="mx-auto" />
            <div className="font-bold">JUNGLE PEPPER</div>
            <div>Kidney Crescent, Blantyre</div>
            <div>{new Date(receipt.at).toLocaleString()}</div>
            <div>Order: {receiptRef}</div>
            {receipt.saleType === "staff_meal" && <div className="font-bold">STAFF MEAL</div>}
          </div>
          <hr className="my-2 border-black" />
          {receipt.lines.map((l: any) => (
            <div key={l.key}>
              <div className="flex justify-between">
                <span>
                  {l.qty}x {l.name}
                  {l.takeaway ? " (takeaway)" : ""}
                </span>
                <span>MK{l.total.toLocaleString()}</span>
              </div>
              {l.modifiers?.length > 0 && (
                <div className="pl-2 text-[10px]">
                  {l.modifiers.map((m: any) => m.name).join(", ")}
                </div>
              )}
              {l.omissions?.length > 0 && (
                <div className="pl-2 text-[10px]">
                  No {l.omissions.map((omission: any) => omission.name).join(", ")}
                </div>
              )}
              {l.takeaway &&
                l.packaging?.map((pack: PackagingSelection, index: number) => {
                  const packQty = receiptPackagingQty(l, pack);
                  return (
                    <div
                      key={`${pack.option_id}-${index}`}
                      className="flex justify-between pl-2 text-[10px]"
                    >
                      <span>
                        Packaging: {pack.name} x{fmtQty(packQty)}
                      </span>
                      <span>MK{(pack.unit_price * packQty).toLocaleString()}</span>
                    </div>
                  );
                })}
            </div>
          ))}
          <hr className="my-2 border-black" />
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>MK{receipt.subtotal.toLocaleString()}</span>
          </div>
          {receipt.discount > 0 && (
            <div className="flex justify-between">
              <span>{receipt.saleType === "staff_meal" ? "Staff meal discount" : "Discount"}</span>
              <span>-MK{receipt.discount.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Net excl. VAT</span>
            <span>MK{tax.net.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT {(VAT_RATE * 100).toFixed(1)}% included</span>
            <span>MK{tax.vat.toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-bold text-sm">
            <span>TOTAL INCL. VAT</span>
            <span>MK{receipt.total.toLocaleString()}</span>
          </div>
          {receipt.staffMealReason && (
            <div className="mt-2 text-[10px]">Approval: {receipt.staffMealReason}</div>
          )}
          <div className="text-center mt-3">Obrigado!</div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
          <Button variant="secondary" onClick={downloadPdf}>
            <Download className="h-4 w-4 mr-1" />
            PDF
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
