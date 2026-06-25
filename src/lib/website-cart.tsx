import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartItemModifier = {
  modifier_id: string;
  name: string;
  price_delta: number;
};

export type CartItem = {
  id: string;
  slug: string;
  name: string;
  price_mwk: number;
  quantity: number;
  kind: string;
  modifiers: CartItemModifier[];
};

type CartCtx = {
  items: CartItem[];
  count: number;
  subtotal: number;
  add: (
    item: Omit<CartItem, "quantity" | "modifiers"> & { modifiers?: CartItemModifier[] },
    qty?: number,
  ) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "jp_cart_v2";

function itemKey(item: { id: string; modifiers?: CartItemModifier[] }): string {
  return (
    item.id +
    ":" +
    (item.modifiers ?? [])
      .map((m) => m.modifier_id)
      .sort()
      .join(",")
  );
}

export function WebsiteCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      localStorage.removeItem(KEY);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      return;
    }
  }, [items, hydrated]);

  const value = useMemo<CartCtx>(
    () => ({
      items,
      count: items.reduce((a, b) => a + b.quantity, 0),
      subtotal: items.reduce(
        (a, b) =>
          a +
          b.quantity * b.price_mwk +
          b.modifiers.reduce((s, m) => s + m.price_delta * b.quantity, 0),
        0,
      ),
      add: (it, qty = 1) => {
        setItems((cur) => {
          const key = itemKey(it);
          const ex = cur.find((c) => itemKey(c) === key);
          if (ex)
            return cur.map((c) => (itemKey(c) === key ? { ...c, quantity: c.quantity + qty } : c));
          return [...cur, { ...it, quantity: qty, modifiers: it.modifiers ?? [] }];
        });
      },
      setQty: (id, qty) =>
        setItems((cur) =>
          qty <= 0
            ? cur.filter((c) => c.id !== id)
            : cur.map((c) => (c.id === id ? { ...c, quantity: qty } : c)),
        ),
      remove: (id) => setItems((cur) => cur.filter((c) => c.id !== id)),
      clear: () => setItems([]),
      isOpen,
      open: () => setOpen(true),
      close: () => setOpen(false),
    }),
    [items, isOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWebsiteCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWebsiteCart must be used inside WebsiteCartProvider");
  return c;
}
