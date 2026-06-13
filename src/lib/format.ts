export const MWK = (n: number | string | null | undefined) => {
  const num = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return "MK" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(num || 0);
};

export const fmtQty = (n: number | string | null | undefined) => {
  const num = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(num || 0);
};

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  airtel_money: "Airtel Money",
  mpamba: "Mpamba",
  bank_card: "Bank Card",
  national_bank: "National Bank",
  standard_bank: "Standard Bank",
  capital_bank: "Capital Bank",
  eco_bank: "Eco Bank",
};

export function paymentMethodLabel(method: string): string {
  return (
    PAYMENT_METHOD_LABELS[method] ??
    method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
