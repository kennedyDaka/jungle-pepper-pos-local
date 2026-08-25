import { env } from "@/lib/env";

export interface MraEisLineItem {
  erp_sku: string;
  description?: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  tax_rate_id?: string;
  is_product?: boolean;
}

export interface MraEisSalePayload {
  erp_invoice_number: string;
  payment_method: string;
  cashier_id?: string;
  invoice_timestamp: string;
  is_offline?: boolean;
  line_items: MraEisLineItem[];
}

export type MraEisSubmitResult =
  | {
      ok: true;
      queued: boolean;
      duplicate?: boolean;
      invoice_id?: string;
      mra_invoice_number?: string;
      validation_url?: string;
      qr_payload?: string;
      reason?: string;
    }
  | {
      ok: false;
      errorCode: string;
      message: string;
      details?: unknown;
    };

export interface MraEisInventoryItem {
  local_sku: string;
  mra_product_id?: string | null;
  description?: string;
  product_type?: "product" | "service";
  tax_rate_id?: string;
  unit_of_measure?: string;
  quantity_on_hand?: number;
  informal_purchase?: boolean;
}

export function mraEisConfigured(): boolean {
  return env.mraEisEnabled && !!env.mraEisUrl && !!env.mraEisToken;
}

export function mraEisBaseUrl(): string {
  return env.mraEisUrl.replace(/\/+$/, "");
}

async function postJson(path: string, payload: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${mraEisBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.mraEisToken}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

export async function submitSaleToMra(payload: MraEisSalePayload): Promise<MraEisSubmitResult> {
  if (!mraEisConfigured()) {
    return { ok: false, errorCode: "not_configured", message: "MRA EIS sync is not configured" };
  }
  const { status, json } = await postJson("/api/public/v1/ingest/sales", payload);
  if (status === 200) {
    return {
      ok: true,
      queued: false,
      duplicate: json?.duplicate ?? false,
      invoice_id: json?.invoice_id ?? undefined,
      mra_invoice_number: json?.mra_invoice_number ?? undefined,
      validation_url: json?.validation_url ?? undefined,
      qr_payload: json?.qr_payload ?? undefined,
    };
  }
  if (status === 202) {
    return {
      ok: true,
      queued: true,
      duplicate: json?.duplicate ?? false,
      invoice_id: json?.invoice_id ?? undefined,
      mra_invoice_number: json?.mra_invoice_number ?? undefined,
      validation_url: json?.validation_url ?? undefined,
      qr_payload: json?.qr_payload ?? undefined,
      reason: json?.reason ?? undefined,
    };
  }
  return {
    ok: false,
    errorCode: json?.error ?? `http_${status}`,
    message: json?.message ?? `MRA middleware responded with status ${status}`,
    details: json?.details ?? json,
  };
}

export async function syncProductsToMra(
  items: MraEisInventoryItem[],
): Promise<
  | { ok: true; synced: number; unmapped: string[] }
  | { ok: false; errorCode: string; message: string; details?: unknown }
> {
  if (!mraEisConfigured()) {
    return { ok: false, errorCode: "not_configured", message: "MRA EIS sync is not configured" };
  }
  const synced: number[] = [];
  const unmapped: string[] = [];
  for (let i = 0; i < items.length; i += 2000) {
    const chunk = items.slice(i, i + 2000);
    const { status, json } = await postJson("/api/public/v1/ingest/inventory", { items: chunk });
    if (status === 200) {
      synced.push(Number(json?.synced ?? 0));
      unmapped.push(...(Array.isArray(json?.unmapped) ? json.unmapped : []));
    } else {
      return {
        ok: false,
        errorCode: json?.error ?? `http_${status}`,
        message: json?.message ?? `MRA middleware responded with status ${status}`,
        details: json?.details ?? json,
      };
    }
  }
  return { ok: true, synced: synced.reduce((s, n) => s + n, 0), unmapped };
}

export async function fetchMraHealth(): Promise<
  { ok: true; data: any } | { ok: false; errorCode: string; message: string }
> {
  try {
    const res = await fetch(`${mraEisBaseUrl()}/api/public/v1/health`);
    const json = await res.json();
    if (res.ok) return { ok: true, data: json };
    return {
      ok: false,
      errorCode: json?.error ?? `http_${res.status}`,
      message: json?.message ?? `Health check failed (${res.status})`,
    };
  } catch (e) {
    return { ok: false, errorCode: "network", message: e instanceof Error ? e.message : String(e) };
  }
}
