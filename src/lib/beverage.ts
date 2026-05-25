type BeverageLike = {
  name?: string | null;
  bottle_ml?: number | string | null;
  shot_ml?: number | string | null;
  units?: { code?: string | null } | null;
};

const numberValue = (value: number | string | null | undefined) =>
  typeof value === "string" ? Number(value) : Number(value ?? 0);

export function servingLabel(item?: BeverageLike | null) {
  const servingMl = numberValue(item?.shot_ml);
  const name = String(item?.name ?? "").toLowerCase();

  if (servingMl >= 150 || name.includes("wine")) return "glasses";
  if (servingMl > 0) return "shots";
  return item?.units?.code ?? "units";
}

export function servingQty(qty: number | string | null | undefined, item?: BeverageLike | null) {
  const bottleMl = numberValue(item?.bottle_ml);
  const servingMl = numberValue(item?.shot_ml);
  const rawQty = numberValue(qty);

  if (bottleMl <= 0 || servingMl <= 0) return null;
  return rawQty * (bottleMl / servingMl);
}

export function isMeasuredBeverage(item?: BeverageLike | null) {
  return servingQty(1, item) !== null;
}

export function fmtServingQty(value: number | string | null | undefined) {
  const num = numberValue(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(num || 0);
}
