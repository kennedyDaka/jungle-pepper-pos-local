type BeverageLike = {
  name?: string | null;
  bottle_ml?: number | string | null;
  shot_ml?: number | string | null;
  units?: { code?: string | null } | null;
};

const numberValue = (value: number | string | null | undefined) =>
  typeof value === "string" ? Number(value) : Number(value ?? 0);

const unitCode = (item?: BeverageLike | null) => String(item?.units?.code ?? "").toLowerCase();

export function wholeServingQty(value: number | string | null | undefined) {
  const num = numberValue(value);
  const sign = num < 0 ? -1 : 1;
  const abs = Math.abs(num);
  const rounded = Math.round(abs);
  const whole = Math.abs(abs - rounded) <= 0.02 ? rounded : Math.floor(abs);
  return sign * whole;
}

export function servingLabel(item?: BeverageLike | null, qty?: number | string | null) {
  const servingMl = numberValue(item?.shot_ml);
  const name = String(item?.name ?? "").toLowerCase();
  const wholeQty = qty === undefined ? null : Math.abs(wholeServingQty(qty));

  if (servingMl >= 150 || name.includes("wine")) return wholeQty === 1 ? "glass" : "glasses";
  if (servingMl > 0) return wholeQty === 1 ? "shot" : "shots";
  return item?.units?.code ?? "units";
}

export function servingQty(qty: number | string | null | undefined, item?: BeverageLike | null) {
  const bottleMl = numberValue(item?.bottle_ml);
  const servingMl = numberValue(item?.shot_ml);
  const rawQty = numberValue(qty);
  const unit = unitCode(item);

  if (servingMl <= 0) return null;
  if (unit === "ml") return rawQty / servingMl;
  if (unit === "l") return (rawQty * 1000) / servingMl;
  if (bottleMl <= 0) return null;
  return rawQty * (bottleMl / servingMl);
}

export function stockQtyMl(qty: number | string | null | undefined, item?: BeverageLike | null) {
  const bottleMl = numberValue(item?.bottle_ml);
  const rawQty = numberValue(qty);
  const unit = unitCode(item);

  if (unit === "ml") return rawQty;
  if (unit === "l") return rawQty * 1000;
  if (bottleMl > 0) return rawQty * bottleMl;
  return null;
}

export function isMeasuredBeverage(item?: BeverageLike | null) {
  return servingQty(1, item) !== null;
}

export function fullServingsPerContainer(item?: BeverageLike | null) {
  const bottleMl = numberValue(item?.bottle_ml);
  const servingMl = numberValue(item?.shot_ml);

  if (bottleMl <= 0 || servingMl <= 0) return null;
  return Math.floor(bottleMl / servingMl);
}

export function fmtServingQty(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    wholeServingQty(value),
  );
}
