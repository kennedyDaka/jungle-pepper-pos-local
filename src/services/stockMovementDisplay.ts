import type { StockMovementView } from "@/types/domain";

const POS_SOURCE = new Set(["order", "order_item"]);

function uniqText(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (value ?? "").split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).join(", ");
}

function movementGroupKey(movement: StockMovementView) {
  if (movement.type !== "sale" || !POS_SOURCE.has(movement.ref_type ?? "")) return null;
  const invoice = movement.invoice_no ?? movement.ref_id;
  if (!invoice || !movement.item_id) return null;
  return [invoice, movement.item_id, movement.type, movement.created_at].join("|");
}

function collapseGroup(group: StockMovementView[]): StockMovementView {
  if (group.length === 1) return group[0];

  const first = group[0];
  const qty = group.reduce((total, movement) => total + movement.qty, 0);
  const absoluteQty = group.reduce((total, movement) => total + Math.abs(movement.qty), 0);
  const weightedCost =
    absoluteQty > 0
      ? group.reduce((total, movement) => total + Math.abs(movement.qty) * movement.unit_cost, 0) /
        absoluteQty
      : first.unit_cost;
  const qtyBeforeValues = group
    .map((movement) => movement.qty_before)
    .filter((value): value is number => value !== null && value !== undefined);
  const qtyAfterValues = group
    .map((movement) => movement.qty_after)
    .filter((value): value is number => value !== null && value !== undefined);
  const isOutflow = qty < 0;
  const destination = uniqText(
    group.map((movement) => movement.destination || movement.menu_item_names),
  );
  const sourceDetail =
    first.invoice_no || first.order_type || destination
      ? ["MW POS", first.invoice_no, first.order_type, destination].filter(Boolean).join(" - ")
      : first.source_detail;

  return {
    ...first,
    id: `group:${first.invoice_no ?? first.ref_id}:${first.item_id}:${first.created_at}`,
    qty,
    unit_cost: Number(weightedCost.toFixed(2)),
    qty_before:
      qtyBeforeValues.length === 0
        ? first.qty_before
        : isOutflow
          ? Math.max(...qtyBeforeValues)
          : Math.min(...qtyBeforeValues),
    qty_after:
      qtyAfterValues.length === 0
        ? first.qty_after
        : isOutflow
          ? Math.min(...qtyAfterValues)
          : Math.max(...qtyAfterValues),
    destination: destination || first.destination,
    menu_item_names: destination || first.menu_item_names,
    source_detail: sourceDetail,
  };
}

export function groupPosSaleMovements(
  movements: StockMovementView[],
  order: "asc" | "desc" = "desc",
) {
  const groups = new Map<string, StockMovementView[]>();
  const ungrouped: StockMovementView[] = [];

  movements.forEach((movement) => {
    const key = movementGroupKey(movement);
    if (!key) {
      ungrouped.push(movement);
      return;
    }
    groups.set(key, [...(groups.get(key) ?? []), movement]);
  });

  return [...ungrouped, ...Array.from(groups.values()).map(collapseGroup)].sort((a, b) => {
    const dateCompare =
      order === "asc"
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (dateCompare !== 0) return dateCompare;

    const afterA = a.qty_after ?? 0;
    const afterB = b.qty_after ?? 0;
    return order === "asc" ? afterB - afterA : afterA - afterB;
  });
}
