import { paymentMethodLabel } from "@/lib/format";
import {
  syncProductsToMra,
  submitSaleToMra,
  type MraEisLineItem,
  type MraEisSalePayload,
  type MraEisSubmitResult,
} from "@/lib/mraEis";

export interface EisCartLineInput {
  key: string;
  kind: "menu" | "packaging";
  menu_item_id?: string;
  packaging_option_id?: string;
  name: string;
  price: number;
  qty: number;
  modifiers: { price_delta: number }[];
  packaging: Array<{
    option_id: string;
    name: string;
    unit_price: number;
    qty_per_item: number;
    total_qty?: number;
  }>;
}

export interface EisPendingOrderInput {
  id: string;
  physical_order_no?: string | null;
  discount?: number;
  order_items?: Array<{
    menu_item_id: string;
    qty: number;
    unit_price: number;
    menu_items?: { name?: string | null } | null;
    order_item_packaging?: Array<{
      packaging_option_id?: string | null;
      item_id?: string | null;
      qty: number;
      unit_price: number;
      packaging_options?: { name?: string | null } | null;
    }>;
  }>;
  order_packaging?: Array<{
    packaging_option_id?: string | null;
    item_id?: string | null;
    qty: number;
    unit_price: number;
    packaging_options?: { name?: string | null } | null;
  }>;
}

export interface EisSubmitOptions {
  physicalOrderNo: string;
  saleAt: string;
  payments: { method: string; amount: number }[];
  discount: number;
  isStaffMeal?: boolean;
  cashierId?: string | null;
}

function money(v: unknown): number {
  const n = Number(v) || 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function absMoney(v: number): number {
  return Math.max(money(v), 0);
}

interface EisLine extends MraEisLineItem {
  key: string;
  amount: number;
}

function buildLines(
  lines: Array<{
    key: string;
    sku: string;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>,
  orderDiscount: number,
): MraEisLineItem[] {
  if (lines.length === 0) return [];
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const discount = Math.min(absMoney(orderDiscount), total);
  if (discount <= 0) {
    return lines.map((l) => ({
      erp_sku: l.sku,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
    }));
  }
  const sorted = [...lines].sort((a, b) => b.amount - a.amount);
  const alloc = new Map<string, number>();
  let remaining = discount;
  sorted.forEach((l, i) => {
    if (i === sorted.length - 1) {
      alloc.set(l.key, remaining);
      return;
    }
    const share = Math.round((l.amount * discount * 100) / total) / 100;
    alloc.set(l.key, share);
    remaining = Math.round((remaining - share) * 100) / 100;
  });
  return lines.map((l) => ({
    erp_sku: l.sku,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    discount: alloc.get(l.key) ?? 0,
  }));
}

function primaryPaymentMethod(payments: { method: string; amount: number }[]): string {
  const sorted = [...payments].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  return paymentMethodLabel(sorted[0]?.method ?? "cash");
}

function buildPayload(
  opts: EisSubmitOptions,
  lines: MraEisLineItem[],
  total: number,
): MraEisSalePayload | null {
  if (opts.isStaffMeal || total <= 0 || lines.length === 0) return null;
  const invoiceNumber = opts.physicalOrderNo.trim();
  if (!invoiceNumber) return null;
  return {
    erp_invoice_number: invoiceNumber,
    payment_method: primaryPaymentMethod(opts.payments),
    cashier_id: opts.cashierId ?? undefined,
    invoice_timestamp: new Date(opts.saleAt).toISOString(),
    line_items: lines,
  };
}

export function cartLinesToMra(cart: EisCartLineInput[]): Array<{
  key: string;
  sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}> {
  const out: Array<{
    key: string;
    sku: string;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }> = [];
  for (const l of cart) {
    if (l.kind === "packaging") {
      const sku = `PKG-${l.packaging_option_id ?? l.menu_item_id ?? ""}`;
      const amount = absMoney(l.price) * Number(l.qty);
      out.push({
        key: `pkg:${l.key}`,
        sku,
        description: l.name,
        quantity: Number(l.qty),
        unit_price: absMoney(l.price),
        amount,
      });
      continue;
    }
    const unitPrice =
      absMoney(l.price) + l.modifiers.reduce((s, m) => s + absMoney(m.price_delta), 0);
    const amount = unitPrice * Number(l.qty);
    out.push({
      key: `menu:${l.key}`,
      sku: l.menu_item_id ?? "",
      description: l.name,
      quantity: Number(l.qty),
      unit_price: unitPrice,
      amount,
    });
    for (const pack of l.packaging ?? []) {
      const packQty = Number(pack.total_qty ?? pack.qty_per_item) * Number(l.qty);
      const packAmount = absMoney(pack.unit_price) * packQty;
      out.push({
        key: `pkg:${l.key}:${pack.option_id}`,
        sku: `PKG-${pack.option_id}`,
        description: pack.name,
        quantity: packQty,
        unit_price: absMoney(pack.unit_price),
        amount: packAmount,
      });
    }
  }
  return out;
}

export function pendingOrderToMraLines(order: EisPendingOrderInput): Array<{
  key: string;
  sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}> {
  const out: Array<{
    key: string;
    sku: string;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }> = [];
  for (const item of order.order_items ?? []) {
    const sku = item.menu_item_id ?? "";
    const description = item.menu_items?.name ?? sku;
    const qty = Number(item.qty);
    const unitPrice = absMoney(item.unit_price);
    out.push({
      key: `oi:${item.menu_item_id}:${out.length}`,
      sku,
      description,
      quantity: qty,
      unit_price: unitPrice,
      amount: unitPrice * qty,
    });
    for (const pack of item.order_item_packaging ?? []) {
      const packQty = Number(pack.qty);
      const packPrice = absMoney(pack.unit_price);
      out.push({
        key: `oi-pack:${item.menu_item_id}:${pack.packaging_option_id ?? pack.item_id}:${out.length}`,
        sku: `PKG-${pack.packaging_option_id ?? pack.item_id ?? ""}`,
        description: pack.packaging_options?.name ?? pack.item_id ?? "Packaging",
        quantity: packQty,
        unit_price: packPrice,
        amount: packQty * packPrice,
      });
    }
  }
  for (const pack of order.order_packaging ?? []) {
    const packQty = Number(pack.qty);
    const packPrice = absMoney(pack.unit_price);
    out.push({
      key: `op:${pack.packaging_option_id ?? pack.item_id}:${out.length}`,
      sku: `PKG-${pack.packaging_option_id ?? pack.item_id ?? ""}`,
      description: pack.packaging_options?.name ?? pack.item_id ?? "Packaging",
      quantity: packQty,
      unit_price: packPrice,
      amount: packQty * packPrice,
    });
  }
  return out;
}

export async function submitPaidCartToMra(
  cart: EisCartLineInput[],
  opts: EisSubmitOptions,
): Promise<MraEisSubmitResult> {
  const lines = cartLinesToMra(cart);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const payload = buildPayload(opts, buildLines(lines, opts.discount), total);
  if (!payload)
    return { ok: false, errorCode: "skipped", message: "Sale skipped (staff meal or empty bill)" };
  return submitSaleToMra(payload);
}

export async function submitPaidPendingOrderToMra(
  order: EisPendingOrderInput,
  opts: EisSubmitOptions,
): Promise<MraEisSubmitResult> {
  const lines = pendingOrderToMraLines(order);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const payload = buildPayload(opts, buildLines(lines, order.discount ?? opts.discount), total);
  if (!payload)
    return { ok: false, errorCode: "skipped", message: "Sale skipped (staff meal or empty bill)" };
  return submitSaleToMra(payload);
}

export async function syncMenuToMra(
  menuItems: Array<{ id: string; name: string; active: boolean; price?: number }>,
): Promise<Awaited<ReturnType<typeof syncProductsToMra>>> {
  const items = menuItems
    .filter((m) => m.active)
    .map((m) => ({
      local_sku: m.id,
      description: m.name,
      product_type: "product" as const,
      unit_of_measure: "Unit",
    }));
  if (items.length === 0) return { ok: true, synced: 0, unmapped: [] };
  return syncProductsToMra(items);
}
