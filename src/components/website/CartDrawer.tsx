import { useState } from "react";
import { z } from "zod";
import { useWebsiteCart } from "@/lib/website-cart";
import { orderService } from "@/services/orderService";
import { supabase } from "@/services/repositories/supabaseClient";
import { toast } from "sonner";
import { X } from "lucide-react";

const schema = z.object({
  customer_name: z.string().trim().min(2, "Enter your name").max(80),
  phone: z.string().trim().min(7, "Enter a valid phone").max(20),
  order_type: z.enum(["pickup", "dine_in"]),
  pickup_time: z.string().trim().min(1, "When are you arriving?"),
  notes: z.string().trim().max(500).optional(),
});

const formatMK = (n: number) => `MK ${n.toLocaleString("en-US")}`;

export function OrderBar() {
  const { count, subtotal, open, isOpen } = useWebsiteCart();
  if (count === 0 || isOpen) return null;
  return (
    <button
      onClick={open}
      className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-full bg-[color:var(--brand-red)] px-5 py-3.5 text-white shadow-2xl shadow-black/30 active:scale-[0.98] transition-transform"
      aria-label="View your order"
    >
      <span className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-sm font-bold">
          {count}
        </span>
        <span className="font-semibold">View Order</span>
      </span>
      <span className="font-display text-lg">{formatMK(subtotal)}</span>
    </button>
  );
}

export function CartButton() {
  const { count, open } = useWebsiteCart();
  return (
    <button
      onClick={open}
      aria-label="Open order"
      className="relative inline-flex items-center gap-1.5 rounded-full bg-[color:var(--brand-red)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      <span className="hidden xs:inline">Order</span>
      {count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--brand-yellow)] px-1.5 text-[11px] font-bold text-[color:var(--brand-ink)]">
          {count}
        </span>
      )}
    </button>
  );
}

type SuccessData = {
  orderNumber: string;
  customerName: string;
  phone: string;
  estimatedTime: string;
  items: Array<{ name: string; quantity: number; modifiers?: Array<{ name: string }> }>;
};

export function CartDrawer({ branchId }: { branchId: string | null }) {
  const { items, isOpen, close, setQty, remove, subtotal, count, clear } = useWebsiteCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [orderType, setOrderType] = useState<"pickup" | "dine_in">("pickup");

  if (!isOpen) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      customer_name: fd.get("customer_name"),
      phone: fd.get("phone"),
      order_type: fd.get("order_type"),
      pickup_time: fd.get("pickup_time"),
      notes: fd.get("notes") || "",
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }

    if (!branchId) {
      setError("No branch available. Please try again later.");
      return;
    }

    setSubmitting(true);
    try {
      const composedNotes = `Arrival: ${parsed.data.pickup_time}${parsed.data.notes ? ` · ${parsed.data.notes}` : ""}`;
      const orderId = await orderService.createWebsiteOrder(
        {
          discount: 0,
          note: composedNotes || null,
          items: items.map((it) => ({
            menu_item_id: it.id,
            qty: it.quantity,
            modifiers: it.modifiers.map((m) => ({ modifier_id: m.modifier_id })),
            takeaway: orderType === "pickup",
          })),
        },
        branchId,
        { customerName: parsed.data.customer_name, customerPhone: parsed.data.phone },
      );
      const orderRef = orderId.slice(0, 8).toUpperCase();
      setSuccess({
        orderNumber: orderRef,
        customerName: parsed.data.customer_name,
        phone: parsed.data.phone,
        estimatedTime: parsed.data.pickup_time,
        items: items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          modifiers: it.modifiers.length > 0 ? it.modifiers : undefined,
        })),
      });
      clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place order. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <aside className="absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-3xl bg-[color:var(--brand-paper)] shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-md sm:rounded-l-3xl sm:rounded-tr-none">
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-[color:var(--brand-ink)]/15 sm:hidden" />
        <header className="flex items-center justify-between px-5 pt-3 pb-3 sm:pt-5">
          <h2 className="font-display text-2xl text-[color:var(--brand-red)]">Your Order</h2>
          <button
            onClick={close}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </header>

        {success ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="text-5xl">🌶️</div>
            <h3 className="font-display text-3xl text-[color:var(--brand-red)]">Order placed!</h3>
            <p className="font-mono text-lg font-semibold">#{success.orderNumber}</p>
            <div className="text-sm space-y-1">
              <p>
                {success.customerName} · {success.phone}
              </p>
              <p>Estimated arrival: {success.estimatedTime}</p>
            </div>
            <div className="w-full max-w-xs border-t border-[color:var(--brand-ink)]/10 pt-3 mt-1">
              {success.items.map((it, i) => (
                <p key={i} className="text-xs text-left">
                  {it.quantity}x {it.name}
                  {it.modifiers && (
                    <span className="text-[color:var(--brand-muted)]">
                      {" "}
                      ({it.modifiers.map((m) => m.name).join(", ")})
                    </span>
                  )}
                </p>
              ))}
            </div>
            <p className="text-xs text-[color:var(--brand-muted)]">
              We'll call you shortly to confirm.
            </p>
            <button
              onClick={() => {
                setSuccess(null);
                close();
              }}
              className="mt-4 rounded-full bg-[color:var(--brand-red)] px-6 py-3 font-semibold text-white"
            >
              Done
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="font-display text-xl">No items yet</p>
            <p className="text-sm text-[color:var(--brand-muted)]">
              Tap any dish on the menu to add it.
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto">
            <ul className="divide-y divide-[color:var(--border)] px-5">
              {items.map((it) => (
                <li
                  key={it.id + it.modifiers.map((m) => m.modifier_id).join(",")}
                  className="flex items-start gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base uppercase leading-tight">{it.name}</p>
                    {it.modifiers.length > 0 && (
                      <p className="text-[10px] text-[color:var(--brand-muted)]">
                        {it.modifiers.map((m) => m.name).join(", ")}
                      </p>
                    )}
                    <p className="text-xs text-[color:var(--brand-muted)]">
                      {formatMK(it.price_mwk)} each
                    </p>
                    <div className="mt-2 inline-flex items-center rounded-full border border-[color:var(--border)] bg-white">
                      <button
                        onClick={() => setQty(it.id, it.quantity - 1)}
                        className="px-3 py-1 text-lg active:bg-black/5"
                        aria-label="Decrease"
                      >
                        −
                      </button>
                      <span className="min-w-7 text-center text-sm font-semibold">
                        {it.quantity}
                      </span>
                      <button
                        onClick={() => setQty(it.id, it.quantity + 1)}
                        className="px-3 py-1 text-lg active:bg-black/5"
                        aria-label="Increase"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-[color:var(--brand-red)]">
                      {formatMK(
                        (it.price_mwk + it.modifiers.reduce((s, m) => s + m.price_delta, 0)) *
                          it.quantity,
                      )}
                    </p>
                    <button
                      onClick={() => remove(it.id)}
                      className="mt-1 text-[10px] uppercase tracking-wider text-[color:var(--brand-muted)]"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <form
              onSubmit={onSubmit}
              className="mt-2 space-y-3 border-t border-[color:var(--border)] bg-[color:var(--brand-paper)] px-5 py-4"
            >
              <div className="grid grid-cols-2 gap-2">
                {(["pickup", "dine_in"] as const).map((t) => (
                  <label
                    key={t}
                    className={`cursor-pointer rounded-xl border-2 px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wider transition ${orderType === t ? "border-[color:var(--brand-red)] bg-[color:var(--brand-red)] text-white" : "border-[color:var(--border)] bg-white"}`}
                  >
                    <input
                      type="radio"
                      name="order_type"
                      value={t}
                      checked={orderType === t}
                      onChange={() => setOrderType(t)}
                      className="sr-only"
                    />
                    {t === "pickup" ? "Take Away" : "Dine In"}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field name="customer_name" placeholder="Your name *" required maxLength={80} />
                <Field name="phone" type="tel" placeholder="Phone *" required maxLength={20} />
              </div>
              <Field
                name="pickup_time"
                type="time"
                required
                defaultValue="18:30"
                label={orderType === "pickup" ? "Pickup time" : "Arrival time"}
              />
              <textarea
                name="notes"
                rows={2}
                maxLength={500}
                placeholder="Notes (allergies, table preference…)"
                className="w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2.5 text-sm"
              />
              {error && (
                <p className="rounded-lg bg-[color:var(--brand-red)]/10 px-3 py-2 text-xs text-[color:var(--brand-red)]">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-[color:var(--brand-muted)]">Total ({count})</span>
                <span className="font-display text-2xl text-[color:var(--brand-red)]">
                  {formatMK(subtotal)}
                </span>
              </div>
              <button
                disabled={submitting}
                className="w-full rounded-full bg-[color:var(--brand-red)] py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-[color:var(--brand-red)]/30 active:scale-[0.99] disabled:opacity-50"
              >
                {submitting ? "Sending order…" : "Send Order"}
              </button>
              <p className="pb-2 text-center text-[10px] text-[color:var(--brand-muted)]">
                By placing the order you agree we may contact you to confirm.
              </p>
            </form>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  if (label) {
    return (
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[color:var(--brand-muted)]">
          {label}
        </span>
        <input
          {...props}
          className="w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2.5 text-sm"
        />
      </label>
    );
  }
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2.5 text-sm"
    />
  );
}

export function AddToCartButton({
  item,
  className,
  onAdd,
}: {
  item: { id: string; slug: string; name: string; price_mwk: number; kind?: string };
  className?: string;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAdd();
      }}
      className={
        className ??
        "rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white"
      }
    >
      Add
    </button>
  );
}
