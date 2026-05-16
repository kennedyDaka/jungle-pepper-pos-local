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
