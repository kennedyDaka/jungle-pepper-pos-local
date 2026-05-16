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
import { Trash2, Plus, Minus, X, Printer, Download } from "lucide-react";
import { MWK } from "@/lib/format";
import { menuService } from "@/services/menuService";
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

  const filtered = useMemo(() => {
    let list = items.data ?? [];
    if (activeCat) list = list.filter((i: any) => i.category_id === activeCat);
    if (search.trim())
      list = list.filter((i: any) => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [items.data, activeCat, search]);
  const dataError = cats.error || items.error || mods.error;

  const addItem = (mi: any) => {
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
    (l.price + l.modifiers.reduce((s, m) => s + Number(m.price_delta), 0)) * l.qty;
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(subtotal - discount, 0);

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
        {(cats.isLoading || items.isLoading || mods.isLoading) && (
          <LoadingState label="Loading live menu..." />
        )}
        {dataError && <ErrorState error={dataError} label="Could not load POS data" />}
        <div className="flex gap-2">
          <Input
            placeholder="Search menu…"
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
              className="text-left p-3 rounded-lg bg-card border border-border hover:border-primary hover:bg-secondary transition-colors"
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
                  onCheckedChange={(checked) =>
                    setCart((c) =>
                      c.map((x) => (x.key === l.key ? { ...x, takeaway: checked } : x)),
                    )
                  }
                />
              </div>
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
            placeholder="Order note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8"
          />
          <div className="flex justify-between text-base font-bold border-t border-border pt-2">
            <span>Total</span>
            <span className="text-primary">{MWK(total)}</span>
          </div>
          <Button className="w-full" disabled={cart.length === 0} onClick={() => setPayOpen(true)}>
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
                  {Number(m.price_delta) > 0 ? "+" + MWK(m.price_delta) : "—"}
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
          <DialogTitle>Payment — {MWK(total)}</DialogTitle>
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
