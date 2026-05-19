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
import { Plus, Minus, X, Printer, Download, Package } from "lucide-react";
import { MWK } from "@/lib/format";
import { menuService } from "@/services/menuService";
import { packagingService, type PackagingOptionView } from "@/services/packagingService";
import { posService } from "@/services/posService";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import logo from "@/assets/jungle-pepper-logo.png";

export const Route = createFileRoute("/_app/pos")({
  component: PosPage,
});

type CartLine = {
  key: string;
  menu_item_id: string;
  name: string;
  price: number;
  qty: number;
  takeaway: boolean;
  note?: string;
  modifiers: { id: string; name: string; price_delta: number }[];
  packaging?: {
    option_id: string;
    name: string;
    item_id: string;
    unit_price: number;
  } | null;
};

function PosPage() {
  const qc = useQueryClient();
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [modOpen, setModOpen] = useState<{ menuId: string; lineKey: string } | null>(null);
  const [packOpen, setPackOpen] = useState<{ lineKey: string } | null>(null);
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

  const filtered = useMemo(() => {
    let list = items.data ?? [];
    if (activeCat) list = list.filter((i: any) => i.category_id === activeCat);
    if (search.trim())
      list = list.filter((i: any) => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [items.data, activeCat, search]);
  const dataError = cats.error || items.error || mods.error || packaging.error;
  const menuOptionsLoading =
    cats.isLoading || items.isLoading || mods.isLoading || packaging.isLoading;

  const requiresCrust = (line: CartLine) =>
    (mods.data ?? []).some(
      (modifier: any) =>
        modifier.menu_item_id === line.menu_item_id &&
        (modifier.name === "Thin Crust" || modifier.name === "Thick Crust"),
    );

  const hasSelectedCrust = (line: CartLine) =>
    line.modifiers.some(
      (modifier) => modifier.name === "Thin Crust" || modifier.name === "Thick Crust",
    );

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
        menu_item_id: mi.id,
        name: mi.name,
        price: Number(mi.price),
        qty: 1,
        takeaway: false,
        modifiers: [],
      },
    ]);
    if (itemMods.length) setModOpen({ menuId: mi.id, lineKey: key });
  };

  const lineTotal = (l: CartLine) =>
    (l.price + l.modifiers.reduce((s, m) => s + Number(m.price_delta), 0)) * l.qty +
    (l.takeaway && l.packaging ? Number(l.packaging.unit_price) * l.qty : 0);
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(subtotal - discount, 0);
  const hasMissingPackaging = cart.some((line) => line.takeaway && !line.packaging);
  const hasMissingCrust = cart.some((line) => requiresCrust(line) && !hasSelectedCrust(line));

  const finalize = useMutation({
    mutationFn: async (payments: { method: string; amount: number }[]) => {
      const payload = {
        discount,
        note: note || null,
        items: cart.map((l) => ({
          menu_item_id: l.menu_item_id,
          qty: l.qty,
          takeaway: l.takeaway,
          note: l.note ?? null,
          modifiers: l.modifiers.map((m) => ({ modifier_id: m.id })),
          packaging:
            l.takeaway && l.packaging
              ? { option_id: l.packaging.option_id, unit_price: Number(l.packaging.unit_price) }
              : null,
        })),
        payments,
      };
      return posService.finalizeOrder(payload);
    },
    onSuccess: async (orderId) => {
      const receipt = {
        id: orderId,
        lines: cart.map((l) => ({ ...l, total: lineTotal(l) })),
        subtotal,
        discount,
        total,
        note,
        at: new Date(),
      };
      setLastReceipt(receipt);
      setCart([]);
      setDiscount(0);
      setNote("");
      setPayOpen(false);
      toast.success("Order completed");
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
        </div>
        <Tabs
          value={activeCat ?? "all"}
          onValueChange={(v) => setActiveCat(v === "all" ? null : v)}
        >
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            {cats.data?.map((c: any) => (
              <TabsTrigger key={c.id} value={c.id}>
                {c.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 overflow-auto pb-2">
          {filtered.map((mi: any) => (
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
                        x.key === l.key ? { ...x, takeaway: false, packaging: null } : x,
                      ),
                    );
                  }}
                />
              </div>
              {l.takeaway && (
                <div className="mt-2 rounded border border-dashed border-border p-2 text-xs">
                  {l.packaging ? (
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <Package className="h-3.5 w-3.5 inline mr-1" />
                        {l.packaging.name} x {l.qty}
                      </span>
                      <button
                        className="font-medium text-primary"
                        onClick={() => setPackOpen({ lineKey: l.key })}
                      >
                        {MWK(l.packaging.unit_price)} each
                      </button>
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
              {(mods.data ?? []).some(
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
          <Button
            className="w-full"
            disabled={cart.length === 0 || hasMissingPackaging || hasMissingCrust}
            onClick={() => setPayOpen(true)}
          >
            Pay {MWK(total)}
          </Button>
        </div>
      </Card>

      {modOpen && (
        <ModifierDialog
          menuId={modOpen.menuId}
          mods={(mods.data ?? []).filter((m: any) => m.menu_item_id === modOpen.menuId)}
          onClose={() => setModOpen(null)}
          onCancel={() => {
            setCart((c) => c.filter((x) => x.key !== modOpen.lineKey));
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
          current={cart.find((line) => line.key === packOpen.lineKey)?.packaging ?? null}
          onCancel={() => {
            setCart((c) =>
              c.map((x) =>
                x.key === packOpen.lineKey && !x.packaging ? { ...x, takeaway: false } : x,
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
                      packaging: {
                        option_id: selected.option.id,
                        name: selected.option.name,
                        item_id: selected.option.item_id,
                        unit_price: selected.unit_price,
                      },
                    }
                  : x,
              ),
            );
            setPackOpen(null);
            void packagingService
              .updatePrice(selected.option.id, selected.unit_price)
              .then(() => qc.invalidateQueries({ queryKey: ["pos", "packaging"] }))
              .catch((error: any) => toast.error(error.message));
          }}
        />
      )}

      {payOpen && (
        <PaymentDialog
          total={total}
          onClose={() => setPayOpen(false)}
          onPay={(pmts) => finalize.mutate(pmts)}
          busy={finalize.isPending}
        />
      )}

      {lastReceipt && <ReceiptDialog receipt={lastReceipt} onClose={() => setLastReceipt(null)} />}
    </div>
  );
}

function PackagingDialog({
  options,
  current,
  onCancel,
  onSave,
}: {
  options: PackagingOptionView[];
  current: CartLine["packaging"];
  onCancel: () => void;
  onSave: (selection: { option: PackagingOptionView; unit_price: number }) => void;
}) {
  const initialOption =
    options.find((option) => option.id === current?.option_id) ?? options[0] ?? null;
  const [selectedId, setSelectedId] = useState(initialOption?.id ?? "");
  const selected = options.find((option) => option.id === selectedId) ?? initialOption;
  const [unitPrice, setUnitPrice] = useState(
    current?.unit_price ?? Number(initialOption?.price ?? 0),
  );

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Takeaway packaging</DialogTitle>
          <DialogDescription>
            Select the charged packaging item for this takeaway line.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Packaging</Label>
            <Select
              value={selectedId}
              onValueChange={(value) => {
                const option = options.find((item) => item.id === value);
                setSelectedId(value);
                setUnitPrice(Number(option?.price ?? 0));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose packaging" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} {option.items?.units?.code ? `(${option.items.units.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Charge per item</Label>
            <Input
              type="number"
              min={0}
              value={unitPrice}
              onChange={(event) => setUnitPrice(Math.max(0, Number(event.target.value)))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The charge is saved as the new default for this packaging option.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!selected}
            onClick={() => selected && onSave({ option: selected, unit_price: unitPrice })}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModifierDialog({
  mods,
  onClose,
  onCancel,
  onSave,
}: {
  menuId: string;
  mods: any[];
  onClose: () => void;
  onCancel: () => void;
  onSave: (s: any[]) => void;
}) {
  const crustMods = mods.filter((m) => m.name === "Thin Crust" || m.name === "Thick Crust");
  const extraMods = mods.filter((m) => m.name !== "Thin Crust" && m.name !== "Thick Crust");
  const [crust, setCrust] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
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
  onPay: (p: { method: string; amount: number }[]) => void;
  busy: boolean;
}) {
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(total);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment - {MWK(total)}</DialogTitle>
          <DialogDescription>Confirm the payment method and amount received.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
            onClick={() => onPay([{ method, amount: Math.min(amount, total) }])}
            disabled={busy || amount < total}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ receipt, onClose }: { receipt: any; onClose: () => void }) {
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
    doc.text("Order: " + receipt.id.slice(0, 8), 40, y, { align: "center" });
    y += 4;
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
      if (l.takeaway && l.packaging) {
        doc.text(`  Packaging: ${l.packaging.name}`, 4, y);
        doc.text(`MK${(l.packaging.unit_price * l.qty).toLocaleString()}`, 76, y, {
          align: "right",
        });
        y += 4;
      }
    });
    doc.line(4, y, 76, y);
    y += 4;
    doc.text("Subtotal", 4, y);
    doc.text(`MK${receipt.subtotal.toLocaleString()}`, 76, y, { align: "right" });
    y += 4;
    if (receipt.discount > 0) {
      doc.text("Discount", 4, y);
      doc.text(`-MK${receipt.discount.toLocaleString()}`, 76, y, { align: "right" });
      y += 4;
    }
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL", 4, y);
    doc.text(`MK${receipt.total.toLocaleString()}`, 76, y, { align: "right" });
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Obrigado! Thank you.", 40, y, { align: "center" });
    doc.save(`receipt-${receipt.id.slice(0, 8)}.pdf`);
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
            <div>Order: {receipt.id.slice(0, 8)}</div>
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
              {l.takeaway && l.packaging && (
                <div className="flex justify-between pl-2 text-[10px]">
                  <span>Packaging: {l.packaging.name}</span>
                  <span>MK{(l.packaging.unit_price * l.qty).toLocaleString()}</span>
                </div>
              )}
            </div>
          ))}
          <hr className="my-2 border-black" />
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>MK{receipt.subtotal.toLocaleString()}</span>
          </div>
          {receipt.discount > 0 && (
            <div className="flex justify-between">
              <span>Discount</span>
              <span>-MK{receipt.discount.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-sm">
            <span>TOTAL</span>
            <span>MK{receipt.total.toLocaleString()}</span>
          </div>
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
