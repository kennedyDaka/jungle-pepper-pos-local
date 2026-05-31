import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
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
import { Plus, Minus, X, Printer, Download, Package, UserCheck, Trash2 } from "lucide-react";
import { MWK, fmtQty } from "@/lib/format";
import { VAT_RATE, vatBreakdownFromInclusive } from "@/lib/vat";
import { authService } from "@/services/authService";
import { menuService } from "@/services/menuService";
import {
  packagingService,
  type PackagingOptionView,
  type PackagingStockItemView,
} from "@/services/packagingService";
import { posService } from "@/services/posService";
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
  packaging: PackagingSelection[];
};

type PackagingSelection = {
  option_id: string;
  name: string;
  item_id: string;
  unit_price: number;
  qty_per_item: number;
};

const BOXES_CATEGORY = "__takeaway_boxes";
const EXTRAS_CATEGORY = "__extras";

function receiptPackagingQty(line: any, pack: PackagingSelection) {
  return Number(line.qty ?? 0) * Math.max(1, Number(pack.qty_per_item) || 1);
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
  const [packOpen, setPackOpen] = useState<{ lineKey: string } | null>(null);
  const [packManagerOpen, setPackManagerOpen] = useState(false);
  const [extraAttachOpen, setExtraAttachOpen] = useState<{
    extraName: string;
    candidateKeys: string[];
  } | null>(null);
  const [lastReceipt, setLastReceipt] = useState<any>(null);

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

  const packaging = useQuery({
    queryKey: ["pos", "packaging"],
    queryFn: () => packagingService.listOptions(),
  });

  const packagingItems = useQuery({
    queryKey: ["pos", "packaging-items"],
    queryFn: () => packagingService.listPackagingItems(),
  });

  const filtered = useMemo(() => {
    let list = items.data ?? [];
    if (activeCat && activeCat !== BOXES_CATEGORY && activeCat !== EXTRAS_CATEGORY) {
      list = list.filter((i: any) => i.category_id === activeCat);
    }
    if (search.trim())
      list = list.filter((i: any) => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [items.data, activeCat, search]);

  const extraCards = useMemo(() => {
    const options = new Map<string, { name: string; price_delta: number }>();
    (mods.data ?? [])
      .filter((modifier: any) => modifier.name !== "Thin Crust" && modifier.name !== "Thick Crust")
      .forEach((modifier: any) => {
        if (!options.has(modifier.name)) {
          options.set(modifier.name, {
            name: modifier.name,
            price_delta: Number(modifier.price_delta),
          });
        }
      });
    const list = Array.from(options.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (!search.trim()) return list;
    const needle = search.toLowerCase();
    return list.filter((option) => option.name.toLowerCase().includes(needle));
  }, [mods.data, search]);

  const packagingCards = useMemo(() => {
    const list = packaging.data ?? [];
    if (!search.trim()) return list;
    const needle = search.toLowerCase();
    return list.filter((option) => option.name.toLowerCase().includes(needle));
  }, [packaging.data, search]);
  const dataError =
    cats.error || items.error || mods.error || packaging.error || packagingItems.error;
  const menuOptionsLoading =
    cats.isLoading ||
    items.isLoading ||
    mods.isLoading ||
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
    const key = crypto.randomUUID();
    setCart((c) => [
      ...c,
      {
        key,
        kind: "menu",
        menu_item_id: mi.id,
        name: mi.name,
        price: Number(mi.price),
        qty: 1,
        takeaway: false,
        modifiers: [],
        packaging: [],
      },
    ]);
    if (itemMods.length) setModOpen({ menuId: mi.id, lineKey: key, removeOnCancel: true });
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
        packaging: [],
      },
    ]);
  };

  const attachExtraToLine = (lineKey: string, extraName: string) => {
    const line = cart.find((row) => row.key === lineKey);
    if (!line || !isMenuLine(line)) return;
    const modifier = (mods.data ?? []).find(
      (item: any) => item.menu_item_id === line.menu_item_id && item.name === extraName,
    );
    if (!modifier) return;
    setCart((rows) =>
      rows.map((row) =>
        row.key === lineKey
          ? {
              ...row,
              modifiers: row.modifiers.some((selected) => selected.id === modifier.id)
                ? row.modifiers
                : [
                    ...row.modifiers,
                    {
                      id: modifier.id,
                      name: modifier.name,
                      price_delta: Number(modifier.price_delta),
                    },
                  ],
            }
          : row,
      ),
    );
  };

  const addExtraByName = (extraName: string) => {
    const candidateKeys = cart
      .filter(isMenuLine)
      .filter((line) =>
        (mods.data ?? []).some(
          (modifier: any) =>
            modifier.menu_item_id === line.menu_item_id &&
            modifier.name === extraName &&
            !line.modifiers.some((selected) => selected.id === modifier.id),
        ),
      )
      .map((line) => line.key);

    if (candidateKeys.length === 0) {
      toast.info("Add a dish that supports this extra first.");
      return;
    }

    if (candidateKeys.length === 1) {
      attachExtraToLine(candidateKeys[0], extraName);
      return;
    }

    setExtraAttachOpen({ extraName, candidateKeys });
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

  const finalize = useMutation({
    mutationFn: async (request: {
      payments: { method: string; amount: number }[];
      physicalOrderNo: string;
      staffMealReason?: string;
    }) => {
      const isStaffMeal = Boolean(request.staffMealReason);
      const menuLines = cart.filter(isMenuLine);
      const packagingLines = cart.filter(isPackagingSaleLine);
      const payload = {
        discount: isStaffMeal ? subtotal : discount,
        note: note || null,
        physical_order_no: request.physicalOrderNo.trim(),
        staff_meal: isStaffMeal,
        staff_meal_reason: request.staffMealReason ?? null,
        items: menuLines.map((l) => ({
          menu_item_id: l.menu_item_id,
          qty: l.qty,
          takeaway: l.takeaway,
          note: l.note ?? null,
          modifiers: l.modifiers.map((m) => ({ modifier_id: m.id })),
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
        payments: request.payments,
      };
      return posService.finalizeOrder(payload);
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
        at: new Date(),
      };
      setLastReceipt(receipt);
      setCart([]);
      setDiscount(0);
      setNote("");
      setPayOpen(false);
      setStaffMealOpen(false);
      toast.success(isStaffMeal ? "Staff meal recorded" : "Order completed");
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-9rem)]">
      <div className="lg:col-span-2 flex flex-col gap-3 min-h-0">
        {(cats.isLoading || items.isLoading || mods.isLoading || packaging.isLoading) && (
          <LoadingState label="Loading live menu..." />
        )}
        {dataError && <ErrorState error={dataError} label="Could not load POS data" />}
        <div className="flex gap-2">
          <Input
            placeholder="Search menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="secondary" onClick={() => setPackManagerOpen(true)}>
            <Package className="h-4 w-4 mr-1" />
            Takeaway boxes
          </Button>
        </div>
        <Tabs
          value={activeCat ?? "all"}
          onValueChange={(v) => setActiveCat(v === "all" ? null : v)}
        >
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value={BOXES_CATEGORY}>Takeaway Boxes</TabsTrigger>
            <TabsTrigger value={EXTRAS_CATEGORY}>Extras</TabsTrigger>
            {cats.data?.map((c: any) => (
              <TabsTrigger key={c.id} value={c.id}>
                {c.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 overflow-auto pb-2">
          {activeCat === BOXES_CATEGORY
            ? packagingCards.map((option) => (
                <button
                  key={option.id}
                  onClick={() => addPackagingSale(option)}
                  disabled={menuOptionsLoading}
                  className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors disabled:cursor-wait disabled:opacity-60"
                >
                  <div className="font-medium text-sm leading-tight">{option.name}</div>
                  <div className="text-primary font-semibold text-sm mt-1">{MWK(option.price)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {option.items?.name ?? "Packaging stock"}
                  </div>
                </button>
              ))
            : activeCat === EXTRAS_CATEGORY
              ? extraCards.map((extra) => (
                  <button
                    key={extra.name}
                    onClick={() => addExtraByName(extra.name)}
                    disabled={menuOptionsLoading}
                    className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors disabled:cursor-wait disabled:opacity-60"
                  >
                    <div className="font-medium text-sm leading-tight">{extra.name}</div>
                    <div className="text-primary font-semibold text-sm mt-1">
                      {extra.price_delta > 0 ? `+${MWK(extra.price_delta)}` : MWK(0)}
                    </div>
                  </button>
                ))
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
                    onChange={(event) =>
                      setCart((rows) =>
                        rows.map((row) =>
                          row.key === l.key
                            ? { ...row, price: Math.max(0, Number(event.target.value) || 0) }
                            : row,
                        ),
                      )
                    }
                    className="h-8 text-right"
                  />
                </div>
              ) : (
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
                          x.key === l.key ? { ...x, takeaway: false, packaging: [] } : x,
                        ),
                      );
                    }}
                  />
                </div>
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
              {isMenuLine(l) &&
                (mods.data ?? []).some(
                  (modifier: any) => modifier.menu_item_id === l.menu_item_id,
                ) && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2 h-7 w-full text-xs"
                    onClick={() => setModOpen({ menuId: l.menu_item_id, lineKey: l.key })}
                  >
                    Edit options / toppings
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
              disabled={cart.length === 0 || hasMissingPackaging || hasMissingCrust}
              onClick={() => setPayOpen(true)}
            >
              Pay {MWK(total)}
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              disabled={cart.length === 0 || hasMissingPackaging || hasMissingCrust}
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

      {extraAttachOpen && (
        <ExtraAttachDialog
          extraName={extraAttachOpen.extraName}
          lines={cart.filter((line) => extraAttachOpen.candidateKeys.includes(line.key))}
          onClose={() => setExtraAttachOpen(null)}
          onSelect={(lineKey) => {
            attachExtraToLine(lineKey, extraAttachOpen.extraName);
            setExtraAttachOpen(null);
          }}
        />
      )}

      {payOpen && (
        <PaymentDialog
          total={total}
          onClose={() => setPayOpen(false)}
          onPay={(physicalOrderNo, pmts) => finalize.mutate({ physicalOrderNo, payments: pmts })}
          busy={finalize.isPending}
        />
      )}

      {staffMealOpen && (
        <StaffMealDialog
          subtotal={subtotal}
          onClose={() => setStaffMealOpen(false)}
          onApprove={async ({ reason, password, physicalOrderNo }) => {
            await authService.verifyCurrentCredential(password);
            finalize.mutate({ payments: [], physicalOrderNo, staffMealReason: reason });
          }}
          busy={finalize.isPending}
        />
      )}

      {lastReceipt && <ReceiptDialog receipt={lastReceipt} onClose={() => setLastReceipt(null)} />}
    </div>
  );
}

function ExtraAttachDialog({
  extraName,
  lines,
  onClose,
  onSelect,
}: {
  extraName: string;
  lines: CartLine[];
  onClose: () => void;
  onSelect: (lineKey: string) => void;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {extraName}</DialogTitle>
          <DialogDescription>Choose the dish this extra belongs to.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {lines.filter(isMenuLine).map((line) => (
            <button
              key={line.key}
              type="button"
              onClick={() => onSelect(line.key)}
              className="w-full rounded border border-border p-3 text-left hover:border-primary hover:bg-secondary"
            >
              <div className="font-medium">{line.name}</div>
              <div className="text-xs text-muted-foreground">Qty {fmtQty(line.qty)}</div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
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
  const extraMods = mods.filter((m) => m.name !== "Thin Crust" && m.name !== "Thick Crust");
  const [crust, setCrust] = useState<string | null>(
    current.find((modifier) => modifier.name === "Thin Crust" || modifier.name === "Thick Crust")
      ?.id ?? null,
  );
  const [sel, setSel] = useState<Set<string>>(
    () =>
      new Set(
        current
          .filter((modifier) => modifier.name !== "Thin Crust" && modifier.name !== "Thick Crust")
          .map((modifier) => modifier.id),
      ),
  );
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  };
  const requiresCrust = crustMods.length > 0;
  const canSave = !requiresCrust || !!crust;
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{requiresCrust ? "Choose crust & extras" : "Extras / options"}</DialogTitle>
          <DialogDescription>
            Choose required pizza base options and any paid extra toppings.
          </DialogDescription>
        </DialogHeader>
        {requiresCrust && (
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Crust (required)</div>
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
        {extraMods.length > 0 && (
          <div className="space-y-2">
            {requiresCrust && <div className="text-xs uppercase text-muted-foreground">Extras</div>}
            {extraMods.map((m) => (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                className={`w-full flex justify-between p-2 rounded border ${sel.has(m.id) ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <span>{m.name}</span>
                <span className="text-muted-foreground">
                  {Number(m.price_delta) > 0 ? "+" + MWK(m.price_delta) : "-"}
                </span>
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              const chosen = mods.filter((m) => sel.has(m.id) || m.id === crust);
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
  onPay: (physicalOrderNo: string, p: { method: string; amount: number }[]) => void;
  busy: boolean;
}) {
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(total);
  const [physicalOrderNo, setPhysicalOrderNo] = useState("");
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
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="airtel_money">Airtel Money</SelectItem>
                <SelectItem value="mpamba">Mpamba</SelectItem>
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
            onClick={() => onPay(cleanedOrderNo, [{ method, amount: Math.min(amount, total) }])}
            disabled={busy || amount < total || cleanedOrderNo.length === 0}
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
  }) => Promise<void> | void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [physicalOrderNo, setPhysicalOrderNo] = useState("");
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
              cleanedOrderNo.length === 0
            }
            onClick={async () => {
              setVerifying(true);
              try {
                await onApprove({
                  reason: cleaned,
                  password: cleanedPassword,
                  physicalOrderNo: cleanedOrderNo,
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
