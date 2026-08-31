import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MWK, fmtDate, fmtDateTime, fmtQty, paymentMethodLabel } from "@/lib/format";
import {
  fmtServingQty,
  fullServingsPerContainer,
  servingLabel,
  servingQty,
  stockQtyMl,
  wholeServingQty,
} from "@/lib/beverage";
import { staffDisplay } from "@/lib/staffDisplay";
import { VAT_RATE } from "@/lib/vat";
import { exportRowsCsv, exportRowsPdf, printRows } from "@/lib/reportExport";
import {
  buildStockMatrixPreviewRows,
  buildStockMatrixWorkbook,
  stockMatrixFilename,
  buildStockSalesWorkbook,
  stockSalesFilename,
} from "@/lib/stockMatrixReport";
import {
  appendMatrixReportSheet,
  appendReportSheet,
  createReportWorkbook,
  writeReportWorkbook,
  type ReportMatrix,
  type ReportRow,
} from "@/lib/xlsxReport";
import { buildFlashReport, buildFlashReportRows } from "@/lib/flashReport";
import { missingOrderNumbersSummary } from "@/lib/orderSequence";
import { reportService } from "@/services/reportService";
import { stockCountsService } from "@/services/stockCountsService";
import type { FlashStockCount } from "@/lib/flashReport";
import { Download, FileText, Printer, Search } from "lucide-react";

export const Route = createFileRoute("/_app/reports")({ component: ReportsPage });

type Movement = Awaited<ReturnType<typeof reportService.listStockMovements>>[number];

function sumBy<T>(rows: T[], pick: (row: T) => number) {
  return rows.reduce((sum, row) => sum + pick(row), 0);
}

function reportDateRange(from: string, to: string) {
  return `${from}_to_${to}`;
}

function moneyValue(value: unknown) {
  return Number(value) || 0;
}

function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setDate(1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedReport, setSelectedReport] = useState("stock-ledger");

  const fromIso = from + "T00:00:00Z";
  const toIso = to + "T23:59:59Z";
  const reportPeriodLabel = from === to ? from : `${from} to ${to}`;

  const branches = useQuery({
    queryKey: ["rep", "branches"],
    queryFn: () => reportService.listBranches(),
  });

  const sales = useQuery({
    queryKey: ["rep", "sales", from, to, branchId],
    queryFn: () => reportService.listSales(fromIso, toIso, branchId),
  });

  const items = useQuery({
    queryKey: ["rep", "items"],
    queryFn: () => reportService.listItems(),
  });

  const stockMovements = useQuery({
    queryKey: ["rep", "stock-movements", from, to, branchId],
    queryFn: () => reportService.listStockMovements(fromIso, toIso, branchId),
  });

  const stockMatrixMovements = stockMovements;
  const stockMatrixLedgerMovements = stockMovements;

  const deductionAudit = useQuery({
    queryKey: ["rep", "deduction-audit", from, to, branchId],
    queryFn: () => reportService.listDeductionAudit(fromIso, toIso, branchId),
    enabled: selectedReport === "deduction-audit",
  });

  const production = useQuery({
    queryKey: ["rep", "production", from, to, branchId],
    queryFn: () => reportService.listProduction(fromIso, toIso, branchId),
  });

  const expenses = useQuery({
    queryKey: ["rep", "exp", from, to, branchId],
    queryFn: () => reportService.listExpenses(from, to, branchId),
  });

  // Stock counts for flash report OPEN/CLOSE accuracy
  const stockCountsRaw = useQuery({
    queryKey: ["rep", "stock-counts", from, to, branchId],
    queryFn: async () => {
      // For stock counts we need a specific branch - use first active if "all"
      let bid = branchId;
      if (bid === "all") {
        const branchList = await reportService.listBranches();
        bid = branchList[0]?.id ?? "";
      }
      if (!bid) return [];
      // Query one day before 'from' to capture opening count
      const prevDate = new Date(from + "T00:00:00Z");
      prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      const fromDate = prevDate.toISOString().slice(0, 10);
      const counts = await stockCountsService.listCountsRange(bid, fromDate, to);
      return counts;
    },
    enabled: !!branchId,
  });

  // Transform stock counts into flash report format: opening and closing per item
  // Opening = most recent count BEFORE the range start (day before 'from')
  // Closing = count on the range end date ('to')
  const stockCountsForFlash = (() => {
    const counts = stockCountsRaw.data ?? [];
    if (counts.length === 0) return undefined;

    const byItem = new Map<string, { opening: number; closing: number; openingSet: boolean; closingSet: boolean }>();
    // Counts are ordered by count_date DESC (most recent first)
    for (const count of counts) {
      let entry = byItem.get(count.item_id);
      if (!entry) {
        entry = { opening: 0, closing: 0, openingSet: false, closingSet: false };
        byItem.set(count.item_id, entry);
      }
      // Opening = count from BEFORE the range start
      if (!entry.openingSet && count.count_date < from) {
        entry.opening = Number(count.qty);
        entry.openingSet = true;
      }
      // Closing = count ON the range end date
      if (!entry.closingSet && count.count_date === to) {
        entry.closing = Number(count.qty);
        entry.closingSet = true;
      }
    }

    return Array.from(byItem.entries())
      .filter(([, vals]) => vals.closingSet) // only include items with a closing count
      .map(([item_id, vals]) => ({
        item_id,
        opening: vals.opening, // 0 if no count before range
        closing: vals.closing,
      }));
  })();

  const totalSales = sumBy(sales.data ?? [], (order: any) => Number(order.total));
  const totalExpenses = sumBy(expenses.data ?? [], (expense: any) => Number(expense.amount));
  const movements = stockMovements.data ?? [];
  const deductionAuditData = deductionAudit.data ?? [];
  const productionRows = production.data ?? [];
  const branchLabel =
    branchId === "all"
      ? "All branches"
      : (branches.data?.find((branch: any) => branch.id === branchId)?.name ?? "Selected branch");
  const stockMatrixInput = {
    date: reportPeriodLabel,
    branchLabel,
    items: items.data ?? [],
    movements: stockMatrixMovements.data ?? [],
    ledgerMovements: stockMatrixLedgerMovements.data ?? [],
    sales: sales.data ?? [],
    stockCounts: stockCountsForFlash,
  };

  const itemAgg = new Map<string, { qty: number; revenue: number }>();
  const payAgg = new Map<string, number>();
  const catAgg = new Map<string, number>();
  sales.data?.forEach((order: any) => {
    order.payments?.forEach((payment: any) =>
      payAgg.set(payment.method, (payAgg.get(payment.method) ?? 0) + Number(payment.amount)),
    );
    order.order_items?.forEach((line: any) => {
      const itemName = line.menu_items?.name ?? "-";
      const lineRevenue = Number(line.qty) * Number(line.unit_price);
      const current = itemAgg.get(itemName) ?? { qty: 0, revenue: 0 };
      itemAgg.set(itemName, {
        qty: current.qty + Number(line.qty),
        revenue: current.revenue + lineRevenue,
      });
      const category = line.menu_items?.categories?.name ?? "-";
      catAgg.set(category, (catAgg.get(category) ?? 0) + lineRevenue);
    });
    order.order_packaging?.forEach((pack: any) => {
      const itemName = pack.packaging_options?.name ?? pack.items?.name ?? "Packaging";
      const lineRevenue = Number(pack.qty) * Number(pack.unit_price);
      const current = itemAgg.get(itemName) ?? { qty: 0, revenue: 0 };
      itemAgg.set(itemName, {
        qty: current.qty + Number(pack.qty),
        revenue: current.revenue + lineRevenue,
      });
      catAgg.set("Packaging", (catAgg.get("Packaging") ?? 0) + lineRevenue);
    });
  });

  const top = [...itemAgg.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 15);
  const valuation = sumBy(
    items.data ?? [],
    (item: any) => Number(item.qty_on_hand) * Number(item.avg_cost),
  );
  const negativeStock = (items.data ?? []).filter((item: any) => Number(item.qty_on_hand) < 0);
  const wasteRows = movements.filter((movement) => movement.type === "wastage");
  const issueRows = movements.filter((movement) =>
    ["issue_out", "complimentary", "breakage"].includes(movement.type),
  );
  const movementValue = sumBy(movements, (movement) =>
    Math.abs(Number(movement.qty) * Number(movement.unit_cost)),
  );

  const expByCat = new Map<string, number>();
  (expenses.data ?? []).forEach((expense: any) => {
    const category = expense.expense_categories?.name ?? "-";
    expByCat.set(category, (expByCat.get(category) ?? 0) + Number(expense.amount));
  });

  const rangeLabel = `${from} to ${to}`;

  const modifierNames = (line: any): string[] =>
    (line.order_item_modifiers ?? [])
      .map((orderModifier: any) => String(orderModifier.modifiers?.name ?? ""))
      .filter((name: string) => name.length > 0);

  const omittedNames = (line: any): string[] =>
    (line.order_item_omissions ?? [])
      .map((omission: any) => String(omission.items?.name ?? ""))
      .filter((name: string) => name.length > 0);

  const orderReference = (order: any) =>
    order.physical_order_no || order.id.slice(0, 8).toUpperCase();

  const movementsForItem = (itemId: string) =>
    movements.filter((movement) => movement.item_id === itemId);

  const ledgerMovementsForItem = (itemId: string) =>
    (stockMatrixLedgerMovements.data ?? []).filter((movement) => movement.item_id === itemId);

  const quantityDisplay = (
    qty: number | string | null | undefined,
    item?: {
      name?: string | null;
      bottle_ml?: number | string | null;
      shot_ml?: number | string | null;
      units?: { code?: string | null } | null;
    } | null,
  ) => {
    const rawQty = Number(qty ?? 0);
    const servings = servingQty(rawQty, item);
    const unit = item?.units?.code ?? "";

    if (servings === null) return `${fmtQty(rawQty)} ${unit}`.trim();
    return `${fmtServingQty(servings)} ${servingLabel(item, servings)} (${fmtQty(rawQty)} ${unit})`;
  };

  const movementSummaryForItem = (item: any) => {
    const itemMoves = movementsForItem(item.id);
    const ledgerMoves = ledgerMovementsForItem(item.id);
    const qtyIn = sumBy(itemMoves, (movement) => Math.max(0, moneyValue(movement.qty)));
    const qtyOut = Math.abs(sumBy(itemMoves, (movement) => Math.min(0, moneyValue(movement.qty))));
    const netMovement = sumBy(itemMoves, (movement) => moneyValue(movement.qty));
    const ledgerNet = sumBy(ledgerMoves, (movement) => moneyValue(movement.qty));
    const currentQty = moneyValue(item.qty_on_hand);
    const openingQty = currentQty - ledgerNet;
    const closingQty = openingQty + netMovement;
    return { itemMoves, qtyIn, qtyOut, netMovement, openingQty, closingQty };
  };

  const stockMovementRows = (): ReportRow[] =>
    movements.map((movement) => {
      const qty = Number(movement.qty);
      return {
        Date: fmtDateTime(movement.created_at),
        Source: movement.source_label ?? movement.ref_type ?? movement.type,
        Reference:
          movement.invoice_no ??
          movement.production_ref ??
          movement.expense_ref ??
          (movement.ref_id ? movement.ref_id.slice(0, 8).toUpperCase() : ""),
        Item: movement.items?.name ?? "",
        "Dish / Destination": movement.destination ?? movement.menu_item_names ?? "",
        Type: movement.type,
        In: qty > 0 ? Math.abs(qty) : "",
        Out: qty < 0 ? Math.abs(qty) : "",
        Unit: movement.items?.units?.code ?? "",
        Balance: movement.qty_after ?? "",
        "Balance Display":
          movement.qty_after === null || movement.qty_after === undefined
            ? ""
            : quantityDisplay(movement.qty_after, movement.items),
        "Unit Cost": Number(movement.unit_cost),
        Value: Math.abs(qty * Number(movement.unit_cost)),
        Branch: movement.branches?.name ?? "Main Branch",
        Staff: staffDisplay(movement.profiles),
        Note: movement.source_detail || movement.note || "",
        "Stock Type": movement.items?.stock_type ?? "",
        "Qty Display": quantityDisplay(movement.qty, movement.items),
        Before: movement.qty_before ?? "",
        After: movement.qty_after ?? "",
        "Reference Type": movement.ref_type ?? "",
        "Reference ID": movement.ref_id ?? "",
        "Menu Categories": movement.menu_categories ?? "",
      };
    });

  const inventoryRows = (): ReportRow[] =>
    (items.data ?? []).map((item: any) => {
      const summary = movementSummaryForItem(item);
      return {
        Item: item.name,
        Branch: item.branches?.name ?? "Main Branch",
        Category: item.categories?.name ?? "-",
        Type: item.stock_type,
        Unit: item.units?.code ?? "",
        "Opening Qty": summary.openingQty,
        "Qty In": summary.qtyIn,
        "Qty Out": summary.qtyOut,
        "Closing Qty": summary.closingQty,
        "Closing Display": quantityDisplay(summary.closingQty, item),
        "Avg Cost": Number(item.avg_cost),
        "Stock Value": summary.closingQty * Number(item.avg_cost),
        "Reorder Level": Number(item.reorder_level),
        Status:
          summary.closingQty < 0
            ? "Negative"
            : summary.closingQty <= Number(item.reorder_level)
              ? "Low"
              : "OK",
      };
    });

  const stockCountMatrixRows = (): ReportMatrix => {
    const header = [
      `DATE ${to}`,
      "OPEN",
      "IN/PURCHASE",
      "IN QTY",
      "OUT QTY",
      "UNCOOK",
      "COOK KG",
      "PRODUCED",
      "WASTE",
      "CLOSE",
      "UNIT",
    ];
    const rows: ReportMatrix = [header];
    const grouped = new Map<string, any[]>();

    (items.data ?? []).forEach((item: any) => {
      const category = item.categories?.name ?? "UNCATEGORIZED";
      grouped.set(category, [...(grouped.get(category) ?? []), item]);
    });

    [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([category, group]) => {
        rows.push([category.toUpperCase()]);
        group
          .slice()
          .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
          .forEach((item: any) => {
            const { itemMoves, openingQty, closingQty } = movementSummaryForItem(item);
            const purchases = sumBy(
              itemMoves.filter((movement) => movement.type === "purchase_in"),
              (movement) => Math.max(0, moneyValue(movement.qty)),
            );
            const outQty = Math.abs(
              sumBy(
                itemMoves.filter((movement) =>
                  ["sale", "issue_out", "complimentary", "breakage"].includes(movement.type),
                ),
                (movement) => Math.min(0, moneyValue(movement.qty)),
              ),
            );
            const produced = sumBy(
              itemMoves.filter((movement) => movement.type === "production_out"),
              (movement) => Math.max(0, moneyValue(movement.qty)),
            );
            const waste = Math.abs(
              sumBy(
                itemMoves.filter((movement) => movement.type === "wastage"),
                (movement) => Math.min(0, moneyValue(movement.qty)),
              ),
            );
            rows.push([
              item.name,
              openingQty,
              purchases ? purchases * moneyValue(item.avg_cost) : "",
              purchases,
              outQty,
              "",
              item.units?.code === "kg" ? produced : "",
              produced,
              waste,
              closingQty,
              item.units?.code ?? "",
            ]);
          });
      });

    return rows;
  };

  const expenseRecordRows = (): ReportRow[] =>
    (expenses.data ?? []).map((expense: any) => ({
      Ref: expense.ref_no,
      Date: expense.expense_date,
      Category: expense.expense_categories?.name ?? "",
      Amount: Number(expense.amount),
      Method: paymentMethodLabel(expense.payment_method),
      Supplier: expense.suppliers?.name ?? "",
      Description: expense.description ?? "",
      "Stock Item Lines": expense.expense_stock_lines?.length ?? 0,
      "Recorded At": fmtDateTime(expense.created_at),
    }));

  const expenseLineRows = (): ReportRow[] => {
    const rows: ReportRow[] = [];
    (expenses.data ?? []).forEach((expense: any) => {
      const stockLines = expense.expense_stock_lines ?? [];
      if (!stockLines.length) {
        rows.push({
          Ref: expense.ref_no,
          Date: expense.expense_date,
          Category: expense.expense_categories?.name ?? "",
          Supplier: expense.suppliers?.name ?? "",
          Method: paymentMethodLabel(expense.payment_method),
          Description: expense.description ?? "",
          Item: "",
          "Purchase Count": "",
          "Size Each": "",
          "Stock Qty": "",
          Unit: "",
          "Unit Cost": "",
          "Line Total": Number(expense.amount),
          "Affects Stock": "No",
          "Movement Type": "",
          "Qty Before": "",
          "Qty After": "",
          "Movement Note": "",
        });
        return;
      }

      stockLines.forEach((line: any) => {
        rows.push({
          Ref: expense.ref_no,
          Date: expense.expense_date,
          Category: expense.expense_categories?.name ?? "",
          Supplier: expense.suppliers?.name ?? "",
          Method: paymentMethodLabel(expense.payment_method),
          Description: expense.description ?? "",
          Item: line.items?.name ?? "",
          "Purchase Count": line.qty_count ?? "",
          "Size Each":
            line.package_size && line.package_unit
              ? `${fmtQty(line.package_size)} ${line.package_unit}`
              : "",
          "Stock Qty": Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          "Unit Cost": Number(line.unit_cost),
          "Line Total": Number(line.total_cost ?? line.line_total),
          "Affects Stock": line.stock_movement_id ? "Yes" : "No",
          "Movement Type": line.stock_movements?.type ?? "",
          "Qty Before": line.stock_movements?.qty_before ?? "",
          "Qty After": line.stock_movements?.qty_after ?? "",
          "Movement Note": line.stock_movements?.note ?? "",
        });
      });
    });
    return rows;
  };

  const expenseRegisterMatrixRows = (): ReportMatrix => [
    [
      "Ref",
      "Date",
      "Category",
      "Supplier",
      "Payment",
      "Expense Detail",
      "Item Paid For",
      "Purchase Count",
      "Size Each",
      "Stock Qty",
      "Unit",
      "Unit Cost",
      "Line Total",
      "Stock Updated",
      "Before",
      "After",
    ],
    ...expenseLineRows().map((row) => [
      row.Ref,
      row.Date,
      row.Category,
      row.Supplier,
      row.Method,
      row.Description,
      row.Item || row.Description,
      row["Purchase Count"],
      row["Size Each"],
      row["Stock Qty"],
      row.Unit,
      row["Unit Cost"],
      row["Line Total"],
      row["Affects Stock"],
      row["Qty Before"],
      row["Qty After"],
    ]),
  ];

  const salesMatrixRows = (): ReportMatrix => {
    const itemNames = [...itemAgg.keys()].sort((a, b) => a.localeCompare(b));
    const header: ReportMatrix[number] = ["Order", "Date", "Thin", "Thick"];
    itemNames.forEach((name) => header.push(name, "QTY"));
    header.push("Payments", "Total", "Takeaway Lines", "Note");

    const rows: ReportMatrix = [header];
    (sales.data ?? [])
      .slice()
      .reverse()
      .forEach((order: any, index: number) => {
        const lineAgg = new Map<string, { qty: number; total: number }>();
        let thin = 0;
        let thick = 0;
        let takeawayLines = 0;

        order.order_items?.forEach((line: any) => {
          const itemName = line.menu_items?.name ?? "-";
          const qty = moneyValue(line.qty);
          const total = qty * moneyValue(line.unit_price);
          const current = lineAgg.get(itemName) ?? { qty: 0, total: 0 };
          lineAgg.set(itemName, { qty: current.qty + qty, total: current.total + total });
          const options = modifierNames(line);
          if (options.includes("Thin Crust")) thin += qty;
          if (options.includes("Thick Crust")) thick += qty;
          if (line.takeaway) takeawayLines += 1;
        });

        const row: ReportMatrix[number] = [
          index + 1,
          fmtDateTime(order.created_at),
          thin,
          thick,
        ];
        itemNames.forEach((name) => {
          const value = lineAgg.get(name);
          row.push(value?.total ?? "", value?.qty ?? "");
        });
        row.push(
          (order.payments ?? [])
            .map((payment: any) => `${paymentMethodLabel(payment.method)}: ${payment.amount}`)
            .join(" | "),
          moneyValue(order.total),
          takeawayLines,
          order.note ?? "",
        );
        rows.push(row);
      });

    return rows;
  };

  const barControlRows = () =>
    (items.data ?? [])
      .filter((item: any) => item.stock_type === "beverage" && Number(item.bottle_ml) > 0)
      .map((item: any) => {
        const itemMoves = movements.filter((movement) => movement.item_id === item.id);
        const summary = movementSummaryForItem(item);
        const bottleMl = Number(item.bottle_ml);
        const servingMl = Number(item.shot_ml) || 0;
        const servingsPerBottle = fullServingsPerContainer(item) ?? 0;
        const openingUnits = summary.openingQty;
        const closingUnits = summary.closingQty;
        const salesUnits = Math.abs(
          sumBy(
            itemMoves.filter((movement) => movement.type === "sale"),
            (movement) => Math.min(0, Number(movement.qty)),
          ),
        );
        const wastageUnits = Math.abs(
          sumBy(
            itemMoves.filter((movement) =>
              ["wastage", "breakage", "complimentary"].includes(movement.type),
            ),
            (movement) => Math.min(0, Number(movement.qty)),
          ),
        );
        const purchasesUnits = sumBy(
          itemMoves.filter((movement) => Number(movement.qty) > 0),
          (movement) => Number(movement.qty),
        );
        const expectedClosingUnits = openingUnits + sumBy(itemMoves, (movement) => movement.qty);
        const openingServings = wholeServingQty(servingQty(openingUnits, item) ?? 0);
        const purchaseServings = wholeServingQty(servingQty(purchasesUnits, item) ?? 0);
        const salesServings = wholeServingQty(servingQty(salesUnits, item) ?? 0);
        const wastageServings = wholeServingQty(servingQty(wastageUnits, item) ?? 0);
        const closingServings = wholeServingQty(servingQty(closingUnits, item) ?? 0);
        const expectedClosingServings = wholeServingQty(
          servingQty(expectedClosingUnits, item) ?? 0,
        );
        const openingMl = stockQtyMl(openingUnits, item) ?? 0;
        const purchasesMl = stockQtyMl(purchasesUnits, item) ?? 0;
        const salesMl = stockQtyMl(salesUnits, item) ?? 0;
        const wastageMl = stockQtyMl(wastageUnits, item) ?? 0;
        const closingMl = stockQtyMl(closingUnits, item) ?? 0;
        const expectedClosingMl = stockQtyMl(expectedClosingUnits, item) ?? 0;
        return {
          Bottle: item.name,
          "Bottle ML": bottleMl,
          "Serving ML": servingMl,
          "Serving Type": servingMl > 0 ? servingLabel(item, 2) : "",
          "Servings / Bottle": servingsPerBottle,
          "Opening Bottles": openingUnits,
          "Opening Servings": openingServings,
          "Opening ML": openingMl,
          "Purchases Bottles": purchasesUnits,
          "Purchases Servings": purchaseServings,
          "Purchases ML": purchasesMl,
          "Sales Servings": salesServings,
          "Sales ML": salesMl,
          "Wastage/Comp/Breakage Servings": wastageServings,
          "Wastage/Comp/Breakage ML": wastageMl,
          "Closing Bottles": closingUnits,
          "Closing Servings": closingServings,
          "Closing ML": closingMl,
          "Expected Closing Servings": expectedClosingServings,
          "Expected Closing ML": expectedClosingMl,
          "System Variance Servings": closingServings - expectedClosingServings,
          "System Variance ML": closingMl - expectedClosingMl,
        };
      });

  const salesSummaryRows = (): ReportRow[] =>
    (sales.data ?? []).map((order: any) => {
      const standalonePackagingQty = sumBy(order.order_packaging ?? [], (pack: any) =>
        Number(pack.qty),
      );
      const qty =
        sumBy(order.order_items ?? [], (line: any) => Number(line.qty)) + standalonePackagingQty;
      const itemNames = [
        ...(order.order_items ?? []).map(
          (line: any) => `${line.menu_items?.name ?? "Item"} x${fmtQty(line.qty)}`,
        ),
        ...(order.order_packaging ?? []).map(
          (pack: any) =>
            `${pack.packaging_options?.name ?? pack.items?.name ?? "Packaging"} x${fmtQty(pack.qty)}`,
        ),
      ].join(" | ");
      const packagingTotal =
        sumBy(order.order_items ?? [], (line: any) =>
          sumBy(
            line.order_item_packaging ?? [],
            (pack: any) => Number(pack.qty) * Number(pack.unit_price),
          ),
        ) +
        sumBy(
          order.order_packaging ?? [],
          (pack: any) => Number(pack.qty) * Number(pack.unit_price),
        );
      const hasTakeaway =
        (order.order_items ?? []).some((line: any) => line.takeaway) ||
        (order.order_packaging ?? []).length > 0;
      return {
        Date: fmtDateTime(order.created_at),
        "Invoice #": orderReference(order),
        Cashier: staffDisplay(order.profiles),
        Branch: order.branches?.name ?? "Main Branch",
        "Sale Type": order.sale_type === "staff_meal" ? "Staff Meal" : "Regular",
        "Order Type": hasTakeaway ? "Takeaway" : "Table",
        "Items Sold": itemNames,
        Qty: qty,
        "Gross Sales": Number(order.subtotal),
        Discount: Number(order.discount),
        "Packaging Sales": packagingTotal,
        "Net Excl VAT": Number(order.net_amount ?? 0),
        "VAT 17.5%": Number(order.vat_amount ?? 0),
        "Net Sales": Number(order.total),
        "Payment Method": (order.payments ?? [])
          .map((payment: any) => `${paymentMethodLabel(payment.method)}: ${MWK(payment.amount)}`)
          .join(" | "),
      };
    });

  const salesItemDetailRows = (): ReportRow[] => {
    const rows: ReportRow[] = [];
    (sales.data ?? []).forEach((order: any) => {
      (order.order_items ?? []).forEach((line: any) => {
        const lineTotal = Number(line.qty) * Number(line.unit_price);
        rows.push({
          Date: fmtDateTime(order.created_at),
          "Invoice #": orderReference(order),
          Branch: order.branches?.name ?? "Main Branch",
          "Menu Item": line.menu_items?.name ?? "-",
          Category: line.menu_items?.categories?.name ?? "-",
          "Qty Sold": Number(line.qty),
          "Unit Price": Number(line.unit_price),
          Total: lineTotal,
          "Sale Type": order.sale_type === "staff_meal" ? "Staff Meal" : "Regular",
          "Recipe Cost": 0,
          Profit: lineTotal,
          Cashier: staffDisplay(order.profiles),
          Modifiers: modifierNames(line).join(", "),
          "Removed Items": omittedNames(line).join(", "),
          Takeaway: line.takeaway ? "Yes" : "No",
        });
        (line.order_item_packaging ?? []).forEach((pack: any) => {
          const packTotal = Number(pack.qty) * Number(pack.unit_price);
          rows.push({
            Date: fmtDateTime(order.created_at),
            "Invoice #": orderReference(order),
            Branch: order.branches?.name ?? "Main Branch",
            "Menu Item": pack.packaging_options?.name ?? pack.items?.name ?? "Packaging",
            Category: "Packaging",
            "Qty Sold": Number(pack.qty),
            "Unit Price": Number(pack.unit_price),
            Total: packTotal,
            "Recipe Cost": 0,
            Profit: packTotal,
            Cashier: staffDisplay(order.profiles),
            Modifiers: "",
            Takeaway: "Yes",
          });
        });
      });
      (order.order_packaging ?? []).forEach((pack: any) => {
        const packTotal = Number(pack.qty) * Number(pack.unit_price);
        rows.push({
          Date: fmtDateTime(order.created_at),
          "Invoice #": orderReference(order),
          Branch: order.branches?.name ?? "Main Branch",
          "Menu Item": pack.packaging_options?.name ?? pack.items?.name ?? "Packaging",
          Category: "Packaging",
          "Qty Sold": Number(pack.qty),
          "Unit Price": Number(pack.unit_price),
          Total: packTotal,
          "Sale Type": order.sale_type === "staff_meal" ? "Staff Meal" : "Regular",
          "Recipe Cost": 0,
          Profit: packTotal,
          Cashier: staffDisplay(order.profiles),
          Modifiers: "",
          Takeaway: "Standalone",
        });
      });
    });
    return rows;
  };

  const salesRecipeConsumptionRows = (): ReportRow[] =>
    movements
      .filter((movement) => movement.type === "sale")
      .map((movement) => {
        const rawQty = Math.abs(Number(movement.qty));
        const servings = servingQty(rawQty, movement.items);
        const servingCount = servings === null ? null : wholeServingQty(servings);
        return {
          Date: fmtDateTime(movement.created_at),
          "Linked Sale":
            movement.invoice_no ??
            (movement.ref_id ? movement.ref_id.slice(0, 8).toUpperCase() : ""),
          Branch: movement.branches?.name ?? "Main Branch",
          Source: movement.source_label ?? "MW POS",
          "Menu Item": movement.menu_item_names ?? movement.destination ?? "POS Sale",
          Category: movement.menu_categories ?? "",
          "Ingredient Deducted": movement.items?.name ?? "",
          "Qty Used": servingCount ?? rawQty,
          Unit:
            servings === null
              ? (movement.items?.units?.code ?? "")
              : servingLabel(movement.items, servings),
          "Stock Unit Qty": rawQty,
          "Stock Unit": movement.items?.units?.code ?? "",
          "Total Deducted":
            servings === null
              ? `${fmtQty(rawQty)} ${movement.items?.units?.code ?? ""}`
              : `${fmtServingQty(servings)} ${servingLabel(movement.items, servings)} (${fmtQty(rawQty)} ${movement.items?.units?.code ?? ""})`,
          "Source Detail": movement.source_detail ?? "",
          Note: movement.note ?? "",
        };
      });

  const takeawayPackagingRows = (): ReportRow[] => {
    const rows: ReportRow[] = [];
    (sales.data ?? []).forEach((order: any) => {
      (order.order_items ?? []).forEach((line: any) => {
        (line.order_item_packaging ?? []).forEach((pack: any) =>
          rows.push({
            Date: fmtDateTime(order.created_at),
            Branch: order.branches?.name ?? "Main Branch",
            "Menu Item": line.menu_items?.name ?? "",
            "Meal Qty": Number(line.qty),
            "Packaging Item": pack.packaging_options?.name ?? pack.items?.name ?? "",
            Item: pack.items?.name ?? pack.packaging_options?.name ?? "",
            "Qty Used": Number(pack.qty),
            Unit: pack.items?.units?.code ?? "",
            "Unit Price": Number(pack.unit_price),
            Total: Number(pack.qty) * Number(pack.unit_price),
            "Linked Sale": orderReference(order),
            Cashier: staffDisplay(order.profiles),
          }),
        );
      });
      (order.order_packaging ?? []).forEach((pack: any) =>
        rows.push({
          Date: fmtDateTime(order.created_at),
          Branch: order.branches?.name ?? "Main Branch",
          "Menu Item": "Standalone packaging sale",
          "Meal Qty": "",
          "Packaging Item": pack.packaging_options?.name ?? pack.items?.name ?? "",
          Item: pack.items?.name ?? pack.packaging_options?.name ?? "",
          "Qty Used": Number(pack.qty),
          Unit: pack.items?.units?.code ?? "",
          "Unit Price": Number(pack.unit_price),
          Total: Number(pack.qty) * Number(pack.unit_price),
          "Linked Sale": orderReference(order),
          Cashier: staffDisplay(order.profiles),
        }),
      );
    });
    return rows;
  };

  const lowStockRows = (): ReportRow[] =>
    inventoryRows()
      .filter((row) => Number(row["Closing Qty"]) <= Number(row["Reorder Level"]))
      .map((row) => ({
        Item: row.Item,
        Category: row.Category,
        "Current Qty": row["Closing Qty"],
        "Reorder Level": row["Reorder Level"],
        Difference: Number(row["Closing Qty"]) - Number(row["Reorder Level"]),
        Unit: row.Unit,
      }));

  const productionInputRows = (): ReportRow[] => {
    const rows: ReportRow[] = [];
    productionRows.forEach((batch: any) => {
      batch.production_inputs?.forEach((line: any) =>
        rows.push({
          Date: fmtDateTime(batch.created_at),
          Branch: batch.branches?.name ?? "Main Branch",
          "Production Ref": batch.id.slice(0, 8).toUpperCase(),
          "Raw Material": line.items?.name ?? "",
          Item: line.items?.name ?? "",
          "Qty Used": Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          Cost: line.unit_cost ?? 0,
          "Produced By": staffDisplay(batch.profiles),
          Note: batch.note ?? "",
        }),
      );
    });
    return rows;
  };

  const productionOutputRows = (): ReportRow[] => {
    const rows: ReportRow[] = [];
    productionRows.forEach((batch: any) => {
      batch.production_outputs?.forEach((line: any) =>
        rows.push({
          Date: fmtDateTime(batch.created_at),
          Branch: batch.branches?.name ?? "Main Branch",
          "Production Ref": batch.id.slice(0, 8).toUpperCase(),
          "Output Item": line.items?.name ?? "",
          Item: line.items?.name ?? "",
          "Qty Produced": Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          "Unit Cost": line.unit_cost ?? 0,
          "Produced By": staffDisplay(batch.profiles),
          Note: batch.note ?? "",
        }),
      );
    });
    return rows;
  };

  const keyIngredientTerms = [
    "FLOUR",
    "DOUGH PIZZA BASES",
    "BURGER BUNS",
    "LOAF",
    "MINCE",
    "BURGERS (120G)",
    "PIZZA PKTS & BOLOG",
    "SLICED 120G",
    "PREGOS",
    "CHEESE",
    "FETA",
    "CAMARAO",
    "FRANGO",
    "FILLET",
    "PIZZA PKTS (80G)",
    "BURGER (120G)",
    "CHIPS PEELED",
    "POTATOES",
    "RICE",
    "EGGS",
    "MILK",
    "SPAGHETTI",
    "PENNE",
    "FETTUCCINE",
  ];

  const ingredientLifecycleRows = (): ReportRow[] => {
    const itemIndex = new Map((items.data ?? []).map((item: any) => [item.id, item]));

    return (items.data ?? [])
      .filter((item: any) => {
        const name = String(item.name ?? "").toUpperCase();
        return keyIngredientTerms.some((term) => name.includes(term));
      })
      .map((item: any) => {
        const summary = movementSummaryForItem(item);
        const itemMoves = summary.itemMoves;
        const purchases = itemMoves.filter(
          (movement) => movement.type === "purchase_in" && Number(movement.qty) > 0,
        );
        const purchasedQty = sumBy(purchases, (movement) => Math.max(0, Number(movement.qty)));
        const usedInProduction = Math.abs(
          sumBy(
            itemMoves.filter((movement) => movement.type === "production_in"),
            (movement) => Math.min(0, Number(movement.qty)),
          ),
        );
        const producedQty = sumBy(
          itemMoves.filter((movement) => movement.type === "production_out"),
          (movement) => Math.max(0, Number(movement.qty)),
        );
        const soldQty = Math.abs(
          sumBy(
            itemMoves.filter((movement) => movement.type === "sale"),
            (movement) => Math.min(0, Number(movement.qty)),
          ),
        );
        const wasteOrIssueQty = Math.abs(
          sumBy(
            itemMoves.filter((movement) =>
              ["wastage", "issue_out", "complimentary", "breakage"].includes(movement.type),
            ),
            (movement) => Math.min(0, Number(movement.qty)),
          ),
        );
        const outputMap = new Map<string, { itemId: string; qty: number }>();

        productionRows.forEach((batch: any) => {
          const usedThisItem = (batch.production_inputs ?? []).some(
            (line: any) => line.item_id === item.id,
          );
          if (!usedThisItem) return;

          (batch.production_outputs ?? []).forEach((output: any) => {
            const outputItem = itemIndex.get(output.item_id);
            const outputName = outputItem?.name ?? output.items?.name ?? "Output";
            const current = outputMap.get(outputName) ?? { itemId: output.item_id, qty: 0 };
            current.qty += Number(output.qty) || 0;
            outputMap.set(outputName, current);
          });
        });

        return {
          Item: item.name,
          Category: item.categories?.name ?? "-",
          Unit: item.units?.code ?? "",
          Opening: summary.openingQty,
          "Times Bought": purchases.length,
          "Bought Qty": purchasedQty,
          "Produced Qty": producedQty,
          "Used In Production": usedInProduction,
          "Sold / Recipe Used": soldQty,
          "Waste / Issue": wasteOrIssueQty,
          Closing: summary.closingQty,
          "Made Into / Outputs": [...outputMap.entries()]
            .map(([name, values]) => {
              const sold = Math.abs(
                sumBy(
                  movements.filter(
                    (movement) => movement.item_id === values.itemId && movement.type === "sale",
                  ),
                  (movement) => Math.min(0, Number(movement.qty)),
                ),
              );
              return `${name}: made ${fmtQty(values.qty)}, sold ${fmtQty(sold)}`;
            })
            .join(" | "),
        };
      });
  };

  // Item Contribution Report: for each inventory item, show which menu items used it with order details
  const itemContributionRows = (): ReportRow[] => {
    const rows: ReportRow[] = [];
    const allSaleMovements = movements.filter((m: any) => m.type === "sale");

    // Group sale movements by inventory item
    const byItem = new Map<string, { itemName: string; unit: string; category: string; usages: Array<{ menuItem: string; qty: number; orderId: string; orderRef: string; date: string; category: string }> }>();

    for (const movement of allSaleMovements) {
      const itemId = movement.item_id;
      const itemName = movement.items?.name ?? "Unknown";
      const unit = movement.items?.units?.code ?? "";
      const category = movement.items?.stock_type ?? "";
      const menuItem = movement.menu_item_names ?? movement.destination ?? "POS Sale";
      const menuCategory = movement.menu_categories ?? "";
      const qty = Math.abs(Number(movement.qty));
      const orderId = movement.ref_id ?? "";
      const orderRef = movement.invoice_no ?? (orderId ? orderId.slice(0, 8).toUpperCase() : "");
      const date = fmtDateTime(movement.created_at);

      if (!byItem.has(itemId)) {
        byItem.set(itemId, { itemName, unit, category, usages: [] });
      }
      byItem.get(itemId)!.usages.push({ menuItem, qty, orderId, orderRef, date, category: menuCategory });
    }

    // Also include inventory items with no sales
    for (const item of (items.data ?? [])) {
      if (!byItem.has(item.id)) {
        byItem.set(item.id, {
          itemName: item.name ?? "Unknown",
          unit: item.units?.code ?? "",
          category: item.stock_type ?? "",
          usages: [],
        });
      }
    }

    // Sort items by total usage descending
    const sortedItems = [...byItem.entries()].sort((a, b) => b[1].usages.length - a[1].usages.length);

    for (const [itemId, data] of sortedItems) {
      // Aggregate by menu item
      const menuItemMap = new Map<string, { totalQty: number; orderRefs: string[]; dates: string[]; category: string }>();
      for (const usage of data.usages) {
        const existing = menuItemMap.get(usage.menuItem);
        if (existing) {
          existing.totalQty += usage.qty;
          if (usage.orderRef && !existing.orderRefs.includes(usage.orderRef)) {
            existing.orderRefs.push(usage.orderRef);
          }
          if (!existing.dates.includes(usage.date)) {
            existing.dates.push(usage.date);
          }
        } else {
          menuItemMap.set(usage.menuItem, {
            totalQty: usage.qty,
            orderRefs: usage.orderRef ? [usage.orderRef] : [],
            dates: [usage.date],
            category: usage.category,
          });
        }
      }

      if (menuItemMap.size === 0) {
        // Item with no sales in this period
        rows.push({
          "Inventory Item": data.itemName,
          Unit: data.unit,
          "Menu Item": "(No sales in period)",
          "Menu Category": "",
          "Qty Used": 0,
          "Times Sold": 0,
          "Order Numbers": "",
          "Order Dates": "",
        });
      } else {
        // Sort menu items by qty descending
        const sortedMenuItems = [...menuItemMap.entries()].sort((a, b) => b[1].totalQty - a[1].totalQty);
        let first = true;
        for (const [menuItem, agg] of sortedMenuItems) {
          rows.push({
            "Inventory Item": first ? data.itemName : "",
            Unit: first ? data.unit : "",
            "Menu Item": menuItem,
            "Menu Category": agg.category,
            "Qty Used": agg.totalQty,
            "Times Sold": agg.orderRefs.length,
            "Order Numbers": agg.orderRefs.join(", "),
            "Order Dates": agg.dates.join(", "),
          });
          first = false;
        }
        // Total row for this inventory item
        rows.push({
          "Inventory Item": "",
          Unit: "",
          "Menu Item": `TOTAL ${data.itemName}`,
          "Menu Category": "",
          "Qty Used": data.usages.reduce((sum, u) => sum + u.qty, 0),
          "Times Sold": data.usages.length,
          "Order Numbers": "",
          "Order Dates": "",
        });
      }
    }

    return rows;
  };

  const deductionAuditRows = (): ReportRow[] =>
    deductionAuditData.map((row: any) => ({
      Date: fmtDateTime(row.created_at),
      "Invoice #": row.invoice_no,
      Branch: row.branch_name ?? "Main Branch",
      Item: row.item_name,
      Unit: row.unit_code ?? "",
      Expected: Number(row.expected_qty),
      Actual: Number(row.actual_qty),
      Difference: Number(row.difference_qty),
      "Movement Lines": Number(row.movement_lines),
      Status: row.audit_status,
    }));

  const expenseCategoryRows = (): ReportRow[] =>
    [...expByCat.entries()].map(([category, amount]) => ({
      Category: category,
      "Total Amount": amount,
    }));

  const categoryOptions = [
    ...new Set([
      ...(items.data ?? []).map((item: any) => item.categories?.name).filter(Boolean),
      ...[...catAgg.keys()],
      ...[...expByCat.keys()],
      "Packaging",
    ]),
  ].sort((a, b) => String(a).localeCompare(String(b)));

  const itemOptions = [
    ...new Set([...(items.data ?? []).map((item: any) => item.name), ...[...itemAgg.keys()]]),
  ].sort((a, b) => String(a).localeCompare(String(b)));

  const reportFilters = {
    Category: categoryFilter === "all" ? "" : categoryFilter,
    Item: itemFilter === "all" ? "" : itemFilter,
    Search: search,
  };

  const reportCatalog = [
    {
      id: "flash-report",
      title: "Flash Report",
      rows: buildFlashReportRows({
        reportDate: reportPeriodLabel,
        rangeLabel,
        preparedBy: "Kennedy Daka",
        paymentTotals: Object.fromEntries(payAgg),
        items: items.data ?? [],
        movements: stockMatrixMovements.data ?? [],
        ledgerMovements: stockMatrixLedgerMovements.data ?? [],
        sales: sales.data ?? [],
        expenses: expenseLineRows(),
        stockCounts: stockCountsForFlash,
        productionBatches: productionRows,
      }),
    },
    {
      id: "stock-matrix",
      title: "Stock Matrix",
      rows: buildStockMatrixPreviewRows(stockMatrixInput),
    },
    { id: "stock-ledger", title: "Stock Ledger", rows: stockMovementRows() },
    { id: "ingredient-lifecycle", title: "Ingredient Lifecycle", rows: ingredientLifecycleRows() },
    { id: "sales-detail", title: "Sales Item Detail", rows: salesItemDetailRows() },
    { id: "sales-summary", title: "Sales Summary", rows: salesSummaryRows() },
    {
      id: "sales-consumption",
      title: "Sales Recipe Consumption",
      rows: salesRecipeConsumptionRows(),
    },
    {
      id: "item-contribution",
      title: "Item Contribution",
      rows: itemContributionRows(),
    },
    { id: "takeaway-packaging", title: "Takeaway Packaging", rows: takeawayPackagingRows() },
    { id: "inventory-master", title: "Inventory Master", rows: inventoryRows() },
    { id: "low-stock", title: "Low Stock", rows: lowStockRows() },
    { id: "bar-variance", title: "Bar Variance", rows: barControlRows() },
    { id: "production-input", title: "Production Input", rows: productionInputRows() },
    { id: "production-output", title: "Production Output", rows: productionOutputRows() },
    { id: "deduction-audit", title: "Inventory Deduction Audit", rows: deductionAuditRows() },
    { id: "expenses-detail", title: "Expense Detail", rows: expenseLineRows() },
    { id: "expenses-category", title: "Expense Category", rows: expenseCategoryRows() },
  ];

  const currentReport =
    reportCatalog.find((report) => report.id === selectedReport) ?? reportCatalog[0];

  const rowMatchesFilters = (row: ReportRow) => {
    const values = Object.values(row).map((value) => String(value ?? "").toLowerCase());
    const categoryValue = String(
      row.Category ?? row["Stock Type"] ?? row["Menu Categories"] ?? "",
    ).toLowerCase();
    const itemValue = String(
      row.Item ??
        row["Menu Item"] ??
        row["Ingredient Deducted"] ??
        row["Dish / Destination"] ??
        row.Destination ??
        row.Bottle ??
        row["Packaging Item"] ??
        "",
    ).toLowerCase();
    if (categoryFilter !== "all" && categoryValue !== categoryFilter.toLowerCase()) return false;
    if (itemFilter !== "all" && itemValue !== itemFilter.toLowerCase()) return false;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      if (!values.some((value) => value.includes(needle))) return false;
    }
    return true;
  };

  const currentRows = currentReport.rows.filter(rowMatchesFilters);
  const exportMeta = {
    title: currentReport.title,
    filename: `${currentReport.id}-${reportDateRange(from, to)}`,
    rangeLabel,
    branchLabel,
    filters: reportFilters,
  };

  const exportCurrentXlsx = () => {
    const wb = createReportWorkbook(`Jungle Pepper ${currentReport.title}`);
    appendReportSheet(wb, currentReport.title, currentRows, {
      title: currentReport.title,
      rangeLabel,
      branchLabel,
      filters: reportFilters,
    });
    void writeReportWorkbook(wb, `${currentReport.id}-${reportDateRange(from, to)}.xlsx`);
  };

  const exportSalesXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Sales Report");
    const orderRows: ReportRow[] = [];
    const lineRows: ReportRow[] = [];
    const paymentRows: ReportRow[] = [];
    sales.data?.forEach((order: any) => {
      const payMethods = (order.payments ?? [])
        .map((payment: any) => `${paymentMethodLabel(payment.method)}:${payment.amount}`)
        .join(" | ");
      orderRows.push({
        Date: fmtDateTime(order.created_at),
        OrderID: order.id,
        "Sale Type": order.sale_type === "staff_meal" ? "Staff Meal" : "Regular",
        Subtotal: Number(order.subtotal),
        Discount: Number(order.discount),
        "Net Excl VAT": Number(order.net_amount ?? 0),
        [`VAT ${(VAT_RATE * 100).toFixed(1)}%`]: Number(order.vat_amount ?? 0),
        Total: Number(order.total),
        Payments: payMethods,
        Note: order.note ?? "",
      });
      order.payments?.forEach((payment: any) =>
        paymentRows.push({
          Date: fmtDateTime(order.created_at),
          OrderID: order.id,
          Method: paymentMethodLabel(payment.method),
          Amount: Number(payment.amount),
        }),
      );
      order.order_items?.forEach((line: any) => {
        const options = modifierNames(line);
        const crust = options.find((name) => name === "Thin Crust" || name === "Thick Crust");
        lineRows.push({
          Date: fmtDateTime(order.created_at),
          OrderID: order.id,
          Item: line.menu_items?.name ?? "-",
          Category: line.menu_items?.categories?.name ?? "-",
          Qty: Number(line.qty),
          "Unit Price": Number(line.unit_price),
          "Line Total": Number(line.qty) * Number(line.unit_price),
          Crust: crust ?? "",
          Options: options.join(", "),
          Takeaway: line.takeaway ? "Yes" : "No",
          Note: line.note ?? "",
        });
      });
    });
    appendReportSheet(
      wb,
      "Summary",
      [
        { Metric: "Total sales", Value: totalSales },
        { Metric: "Orders", Value: sales.data?.length ?? 0 },
        { Metric: "Line items", Value: lineRows.length },
        ...[...payAgg.entries()].map(([method, amount]) => ({
          Metric: `Payment: ${method}`,
          Value: amount,
        })),
        ...[...catAgg.entries()].map(([category, amount]) => ({
          Metric: `Category: ${category}`,
          Value: amount,
        })),
      ],
      { title: "Sales Summary", rangeLabel },
    );
    appendReportSheet(wb, "Orders", orderRows, { title: "Order Detail", rangeLabel });
    appendReportSheet(wb, "Line Items", lineRows, { title: "Line Item Detail", rangeLabel });
    appendReportSheet(wb, "Payments", paymentRows, { title: "Payment Detail", rangeLabel });
    appendMatrixReportSheet(wb, "Sales Matrix", salesMatrixRows(), {
      title: "Sales Register",
      rangeLabel,
    });
    appendReportSheet(
      wb,
      "Top Items",
      top.map(([name, value]) => ({ Item: name, Qty: value.qty, Revenue: value.revenue })),
      { title: "Top Selling Items", rangeLabel },
    );
    appendReportSheet(
      wb,
      "Category Mix",
      [...catAgg.entries()].map(([category, amount]) => ({ Category: category, Revenue: amount })),
      { title: "Category Mix", rangeLabel },
    );
    appendReportSheet(
      wb,
      "Item Totals",
      [...itemAgg.entries()]
        .sort((a, b) => b[1].qty - a[1].qty)
        .map(([name, value]) => ({ Item: name, "Qty Sold": value.qty, Revenue: value.revenue })),
      { title: "Item Totals (All Items)", rangeLabel },
    );
    void writeReportWorkbook(wb, `sales-${reportDateRange(from, to)}.xlsx`);
  };

  const exportInventoryXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Inventory Report");
    const rows = inventoryRows();
    appendReportSheet(
      wb,
      "Summary",
      [
        { Metric: "Total stock value", Value: valuation },
        { Metric: "Active items", Value: rows.length },
        { Metric: "Negative stock items", Value: negativeStock.length },
        {
          Metric: "Below reorder items",
          Value: rows.filter((row) => row.Status === "Low" || row.Status === "Negative").length,
        },
      ],
      { title: "Inventory Summary", rangeLabel },
    );
    appendReportSheet(wb, "All Items", rows, { title: "Inventory Item Detail", rangeLabel });
    appendMatrixReportSheet(wb, "Stock Count Sheet", stockCountMatrixRows(), {
      title: "Stock Count Sheet",
      rangeLabel,
    });
    appendReportSheet(wb, "Movements", stockMovementRows(), {
      title: "Inventory Movement Detail",
      rangeLabel,
    });
    appendReportSheet(wb, "Ingredient Lifecycle", ingredientLifecycleRows(), {
      title: "Monthly Key Ingredient Lifecycle",
      rangeLabel,
    });
    appendReportSheet(wb, "Deduction Audit", deductionAuditRows(), {
      title: "Expected Vs Actual POS Deductions",
      rangeLabel,
    });
    appendReportSheet(
      wb,
      "Reorder And Negative",
      rows.filter((row) => row.Status === "Low" || row.Status === "Negative"),
      { title: "Inventory Exceptions", rangeLabel },
    );
    void writeReportWorkbook(wb, `inventory-${reportDateRange(from, to)}.xlsx`);
  };

  const exportStockMatrixXlsx = () => {
    const wb = buildStockMatrixWorkbook({
      ...stockMatrixInput,
      generatedAt: new Date(),
    });
    void writeReportWorkbook(wb, stockMatrixFilename(from, to), { logo: false });
  };

  const exportStockSalesXlsx = () => {
    const wb = buildStockSalesWorkbook({
      ...stockMatrixInput,
      generatedAt: new Date(),
    });
    void writeReportWorkbook(wb, stockSalesFilename(from, to), { logo: false });
  };

  const exportStockLedgerXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Stock Ledger");
    const ledgerRows = stockMovementRows();
    appendReportSheet(
      wb,
      "Summary",
      [
        { Metric: "Movements", Value: movements.length },
        { Metric: "Movement value", Value: movementValue },
        { Metric: "Issue/comp/breakage records", Value: issueRows.length },
        { Metric: "Wastage records", Value: wasteRows.length },
      ],
      { title: "Stock Ledger Summary", rangeLabel },
    );
    appendReportSheet(wb, "Stock Ledger", ledgerRows, {
      title: "Full Stock Movement Ledger",
      rangeLabel,
    });
    appendReportSheet(wb, "Ingredient Lifecycle", ingredientLifecycleRows(), {
      title: "Monthly Key Ingredient Lifecycle",
      rangeLabel,
    });
    appendMatrixReportSheet(wb, "Stock Count Sheet", stockCountMatrixRows(), {
      title: "Stock Count Sheet",
      rangeLabel,
    });
    appendReportSheet(wb, "Deduction Audit", deductionAuditRows(), {
      title: "Expected Vs Actual POS Deductions",
      rangeLabel,
    });
    appendReportSheet(
      wb,
      "Issue Outs",
      ledgerRows.filter((row) => row.Type === "issue_out"),
      { title: "Consumable Issue Outs", rangeLabel },
    );
    appendReportSheet(
      wb,
      "Waste Comp Break",
      ledgerRows.filter((row) =>
        ["wastage", "breakage", "complimentary"].includes(String(row.Type)),
      ),
      { title: "Wastage, Complimentary, And Breakage", rangeLabel },
    );
    void writeReportWorkbook(wb, `stock-ledger-${reportDateRange(from, to)}.xlsx`);
  };

  const exportBarControlXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Bar Control");
    const rows = barControlRows();
    const beverageMovements = stockMovementRows().filter((row) => row["Stock Type"] === "beverage");
    appendReportSheet(
      wb,
      "Summary",
      [
        { Metric: "Tracked liquor/wine bottles", Value: rows.length },
        { Metric: "Sales servings", Value: sumBy(rows, (row) => Number(row["Sales Servings"])) },
        { Metric: "Sales ML", Value: sumBy(rows, (row) => Number(row["Sales ML"])) },
        {
          Metric: "Wastage/comp/breakage ML",
          Value: sumBy(rows, (row) => Number(row["Wastage/Comp/Breakage ML"])),
        },
        { Metric: "Beverage movement lines", Value: beverageMovements.length },
      ],
      { title: "Bar Control Summary", rangeLabel },
    );
    appendReportSheet(wb, "Bar Count", rows, { title: "Bar Serving Count Sheet", rangeLabel });
    appendReportSheet(wb, "Beverage Movements", beverageMovements, {
      title: "Beverage Movement Detail",
      rangeLabel,
    });
    void writeReportWorkbook(wb, `bar-control-${reportDateRange(from, to)}.xlsx`);
  };

  const exportProductionXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Production Report");
    const inputRows: ReportRow[] = [];
    const outputRows: ReportRow[] = [];
    const wasteProductionRows: ReportRow[] = [];
    productionRows.forEach((batch: any) => {
      batch.production_inputs?.forEach((line: any) =>
        inputRows.push({
          Date: fmtDateTime(batch.created_at),
          BatchID: batch.id,
          Item: line.items?.name ?? "",
          Qty: Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          "Unit Cost": line.unit_cost ?? "",
          "Batch Note": batch.note ?? "",
        }),
      );
      batch.production_outputs?.forEach((line: any) =>
        outputRows.push({
          Date: fmtDateTime(batch.created_at),
          BatchID: batch.id,
          Item: line.items?.name ?? "",
          Qty: Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          "Unit Cost": line.unit_cost ?? "",
          "Batch Note": batch.note ?? "",
        }),
      );
      batch.production_wastage?.forEach((line: any) =>
        wasteProductionRows.push({
          Date: fmtDateTime(batch.created_at),
          BatchID: batch.id,
          Item: line.items?.name ?? "",
          Qty: Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          Reason: line.reason,
        }),
      );
    });
    appendReportSheet(
      wb,
      "Summary",
      [
        { Metric: "Production batches", Value: productionRows.length },
        { Metric: "Input lines", Value: inputRows.length },
        { Metric: "Output lines", Value: outputRows.length },
        { Metric: "Wastage lines", Value: wasteProductionRows.length },
      ],
      { title: "Production Summary", rangeLabel },
    );
    appendReportSheet(
      wb,
      "Batches",
      productionRows.map((batch: any) => ({
        Date: fmtDateTime(batch.created_at),
        BatchID: batch.id,
        Inputs: batch.production_inputs?.length ?? 0,
        Outputs: batch.production_outputs?.length ?? 0,
        Wastage: batch.production_wastage?.length ?? 0,
        Note: batch.note ?? "",
      })),
      { title: "Production Batches", rangeLabel },
    );
    appendReportSheet(wb, "Inputs", inputRows, { title: "Production Input Detail", rangeLabel });
    appendReportSheet(wb, "Outputs", outputRows, {
      title: "Production Output Detail",
      rangeLabel,
    });
    appendReportSheet(wb, "Wastage", wasteProductionRows, {
      title: "Production Wastage Detail",
      rangeLabel,
    });
    void writeReportWorkbook(wb, `production-${reportDateRange(from, to)}.xlsx`);
  };

  const exportExpensesXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Expense Report");
    const lineRows = expenseLineRows();
    appendReportSheet(
      wb,
      "Summary",
      [
        { Metric: "Total expenses", Value: totalExpenses },
        { Metric: "Records", Value: expenses.data?.length ?? 0 },
        { Metric: "Expense item lines", Value: lineRows.length },
        ...[...expByCat.entries()].map(([category, amount]) => ({
          Metric: `Category: ${category}`,
          Value: amount,
        })),
      ],
      { title: "Expense Summary", rangeLabel },
    );
    appendReportSheet(wb, "Expenses", expenseRecordRows(), {
      title: "Expense Record Detail",
      rangeLabel,
    });
    appendReportSheet(wb, "Expense Item Lines", lineRows, {
      title: "Expense Item And Stock Detail",
      rangeLabel,
    });
    appendMatrixReportSheet(wb, "Expense Register", expenseRegisterMatrixRows(), {
      title: "Detailed Expense Register",
      rangeLabel,
    });
    appendReportSheet(
      wb,
      "Stock Purchase Lines",
      lineRows.filter((row) => row.Item),
      { title: "Stock Purchase Line Detail", rangeLabel },
    );
    void writeReportWorkbook(wb, `expenses-${reportDateRange(from, to)}.xlsx`);
  };

  const exportFlashXlsx = () => {
    const wb = buildFlashReport({
      reportDate: reportPeriodLabel,
      rangeLabel,
      preparedBy: "Kennedy Daka",
      paymentTotals: Object.fromEntries(payAgg),
      items: items.data ?? [],
      movements: stockMatrixMovements.data ?? [],
      ledgerMovements: stockMatrixLedgerMovements.data ?? [],
      sales: sales.data ?? [],
      expenses: expenseLineRows(),
      stockCounts: stockCountsForFlash,
      productionBatches: productionRows,
    });
    void writeReportWorkbook(wb, `flash-report-${reportDateRange(from, to)}.xlsx`, { logo: false });
  };

  const exportCsv = (filename: string, rows: (string | number)[][]) => {
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  const dataError =
    branches.error ||
    sales.error ||
    items.error ||
    stockMovements.error ||
    (selectedReport === "deduction-audit" ? deductionAudit.error : null) ||
    production.error ||
    expenses.error;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>
      {(sales.isLoading ||
        branches.isLoading ||
        items.isLoading ||
        stockMovements.isLoading ||
        (selectedReport === "deduction-audit" && deductionAudit.isLoading) ||
        production.isLoading ||
        expenses.isLoading) && <LoadingState label="Loading live reports..." />}
      {dataError && <ErrorState error={dataError} label="Could not load reports" />}

      <Card className="p-3 flex gap-3 items-end flex-wrap">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="min-w-44">
          <Label>Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.data?.map((branch: any) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-44">
          <Label>Category</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categoryOptions.map((category) => (
                <SelectItem key={String(category)} value={String(category)}>
                  {String(category)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-52">
          <Label>Item</Label>
          <Select value={itemFilter} onValueChange={setItemFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All items</SelectItem>
              {itemOptions.map((item) => (
                <SelectItem key={String(item)} value={String(item)}>
                  {String(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-52">
          <Label>Search</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search reports"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <div className="min-w-56">
          <Label>Report</Label>
          <Select value={selectedReport} onValueChange={setSelectedReport}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {reportCatalog.map((report) => (
                <SelectItem key={report.id} value={report.id}>
                  {report.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={exportCurrentXlsx}>
            <Download className="h-4 w-4 mr-1" />
            Excel
          </Button>
          <Button variant="secondary" onClick={() => exportRowsPdf(exportMeta, currentRows)}>
            <FileText className="h-4 w-4 mr-1" />
            PDF
          </Button>
          <Button variant="secondary" onClick={() => exportRowsCsv(exportMeta, currentRows)}>
            CSV
          </Button>
          <Button variant="secondary" onClick={() => printRows(exportMeta, currentRows)}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Button onClick={exportSalesXlsx}>
            <Download className="h-4 w-4 mr-1" />
            Sales
          </Button>
          <Button onClick={exportInventoryXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Inventory
          </Button>
          <Button onClick={exportStockMatrixXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Stock Matrix
          </Button>
          <Button onClick={exportStockSalesXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Stock Sales
          </Button>
          <Button onClick={exportStockLedgerXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Stock Ledger
          </Button>
          <Button onClick={exportBarControlXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Bar Control
          </Button>
          <Button onClick={exportProductionXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Production
          </Button>
          <Button onClick={exportExpensesXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Expenses
          </Button>
          <Button onClick={exportFlashXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Flash Report
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold">{currentReport.title}</h2>
            <p className="text-xs text-muted-foreground">
              {currentRows.length} rows after filters, {branchLabel}, {rangeLabel}
            </p>
          </div>
          <div className="text-sm font-medium">
            Total rows: <span className="text-primary">{currentRows.length}</span>
          </div>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                {Object.keys(currentRows[0] ?? { Message: "No records" })
                  .slice(0, 15)
                  .map((column) => (
                    <th key={column} className="p-1">
                      {column}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {(currentRows.length
                ? currentRows
                : ([{ Message: "No records for this period" }] as ReportRow[])
              )
                .slice(0, 50)
                .map((row, rowIndex) => {
                  const reportRow = row as ReportRow;
                  return (
                    <tr key={rowIndex} className="border-t border-border">
                      {Object.keys(currentRows[0] ?? reportRow)
                        .slice(0, 15)
                        .map((column) => (
                          <td key={column} className="p-1.5">
                            {typeof reportRow[column] === "number"
                              ? fmtQty(Number(reportRow[column]))
                              : reportRow[column]}
                          </td>
                        ))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Sales</div>
          <div className="text-2xl font-bold">{MWK(totalSales)}</div>
          <div className="text-xs text-muted-foreground">{sales.data?.length ?? 0} orders</div>
          {(() => {
            const missingSummary = missingOrderNumbersSummary(sales.data ?? []);
            return missingSummary ? (
              <div className="text-xs text-destructive font-medium mt-1">{missingSummary}</div>
            ) : null;
          })()}
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Expenses</div>
          <div className="text-2xl font-bold text-destructive">{MWK(totalExpenses)}</div>
          <div className="text-xs text-muted-foreground">{expenses.data?.length ?? 0} records</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Net</div>
          <div
            className={
              "text-2xl font-bold " +
              (totalSales - totalExpenses >= 0 ? "text-primary" : "text-destructive")
            }
          >
            {MWK(totalSales - totalExpenses)}
          </div>
          <div className="text-xs text-muted-foreground">sales less expenses</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Stock value</div>
          <div className="text-2xl font-bold">{MWK(valuation)}</div>
          <div className="text-xs text-muted-foreground">{negativeStock.length} negative</div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex justify-between mb-2">
            <h2 className="font-semibold">Top items</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                exportCsv("top-items.csv", [
                  ["Item", "Qty", "Revenue"],
                  ...top.map(([name, value]) => [name, value.qty, value.revenue]),
                ])
              }
            >
              CSV
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="p-1">Item</th>
                <th className="p-1 text-right">Qty</th>
                <th className="p-1 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {top.map(([name, value]) => (
                <tr key={name} className="border-t border-border">
                  <td className="p-1.5">{name}</td>
                  <td className="p-1.5 text-right">{fmtQty(value.qty)}</td>
                  <td className="p-1.5 text-right">{MWK(value.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-2">Payment and menu mix</h2>
          <table className="w-full text-sm">
            <tbody>
              {[...payAgg.entries()].map(([method, amount]) => (
                <tr key={method} className="border-t border-border">
                  <td className="p-1.5 capitalize">{method.replace("_", " ")}</td>
                  <td className="p-1.5 text-right font-medium">{MWK(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="font-semibold mt-4 mb-2">By category</h2>
          <table className="w-full text-sm">
            <tbody>
              {[...catAgg.entries()].map(([category, amount]) => (
                <tr key={category} className="border-t border-border">
                  <td className="p-1.5">{category}</td>
                  <td className="p-1.5 text-right font-medium">{MWK(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex justify-between mb-2">
          <h2 className="font-semibold">Stock movement ledger</h2>
          <span className="text-sm text-muted-foreground">{movements.length} records</span>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="p-1">Date</th>
                <th className="p-1">Type</th>
                <th className="p-1">Item</th>
                <th className="p-1 text-right">Qty</th>
                <th className="p-1 text-right">Before</th>
                <th className="p-1 text-right">After</th>
                <th className="p-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {movements
                .slice()
                .reverse()
                .slice(0, 80)
                .map((movement: Movement) => (
                  <tr key={movement.id} className="border-t border-border">
                    <td className="p-1.5">{fmtDate(movement.created_at)}</td>
                    <td className="p-1.5 text-xs uppercase">{movement.type}</td>
                    <td className="p-1.5">{movement.items?.name}</td>
                    <td
                      className={`p-1.5 text-right ${Number(movement.qty) < 0 ? "text-destructive" : "text-success"}`}
                    >
                      {fmtQty(movement.qty)} {movement.items?.units?.code}
                    </td>
                    <td className="p-1.5 text-right">{movement.qty_before ?? ""}</td>
                    <td className="p-1.5 text-right">{movement.qty_after ?? ""}</td>
                    <td className="p-1.5 text-muted-foreground">{movement.note}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex justify-between mb-2">
            <h2 className="font-semibold">Production</h2>
            <span className="text-sm text-muted-foreground">{productionRows.length} batches</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="p-1">Date</th>
                <th className="p-1 text-right">Inputs</th>
                <th className="p-1 text-right">Outputs</th>
                <th className="p-1 text-right">Wastage</th>
                <th className="p-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {productionRows.slice(0, 20).map((batch: any) => (
                <tr key={batch.id} className="border-t border-border">
                  <td className="p-1.5">{fmtDate(batch.created_at)}</td>
                  <td className="p-1.5 text-right">{batch.production_inputs?.length ?? 0}</td>
                  <td className="p-1.5 text-right">{batch.production_outputs?.length ?? 0}</td>
                  <td className="p-1.5 text-right">{batch.production_wastage?.length ?? 0}</td>
                  <td className="p-1.5 text-muted-foreground">{batch.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <div className="flex justify-between mb-2">
            <h2 className="font-semibold">Issue outs and liquor events</h2>
            <span className="text-sm text-muted-foreground">{issueRows.length} records</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="p-1">Date</th>
                <th className="p-1">Type</th>
                <th className="p-1">Item</th>
                <th className="p-1 text-right">Qty</th>
                <th className="p-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {issueRows
                .slice()
                .reverse()
                .slice(0, 30)
                .map((movement) => (
                  <tr key={movement.id} className="border-t border-border">
                    <td className="p-1.5">{fmtDate(movement.created_at)}</td>
                    <td className="p-1.5 text-xs uppercase">{movement.type}</td>
                    <td className="p-1.5">{movement.items?.name}</td>
                    <td className="p-1.5 text-right">
                      {fmtQty(movement.qty)} {movement.items?.units?.code}
                    </td>
                    <td className="p-1.5 text-muted-foreground">{movement.note}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex justify-between mb-2">
          <h2 className="font-semibold">Stock valuation</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              exportCsv("valuation.csv", [
                ["Item", "Category", "Qty", "Unit", "Avg cost", "Value"],
                ...(items.data ?? []).map((item: any) => [
                  item.name,
                  item.categories?.name,
                  Number(item.qty_on_hand),
                  item.units?.code,
                  Number(item.avg_cost),
                  Number(item.qty_on_hand) * Number(item.avg_cost),
                ]),
              ])
            }
          >
            CSV
          </Button>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="p-1">Item</th>
                <th className="p-1 text-right">Qty</th>
                <th className="p-1 text-right">Avg cost</th>
                <th className="p-1 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {items.data?.map((item: any) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="p-1.5">{item.name}</td>
                  <td className="p-1.5 text-right">
                    {fmtQty(item.qty_on_hand)} {item.units?.code}
                  </td>
                  <td className="p-1.5 text-right">{MWK(item.avg_cost)}</td>
                  <td className="p-1.5 text-right font-medium">
                    {MWK(Number(item.qty_on_hand) * Number(item.avg_cost))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex justify-between mb-2">
            <h2 className="font-semibold">Expenses</h2>
            <span className="text-sm text-muted-foreground">
              Total <span className="font-bold text-foreground">{MWK(totalExpenses)}</span>
            </span>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="p-1">Ref</th>
                  <th className="p-1">Date</th>
                  <th className="p-1">Category</th>
                  <th className="p-1">Details</th>
                  <th className="p-1">Description</th>
                  <th className="p-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.data?.map((expense: any) => {
                  const detail =
                    expense.expense_stock_lines
                      ?.map(
                        (line: any) =>
                          `${line.items?.name ?? "Item"} ${fmtQty(line.qty)} ${line.items?.units?.code ?? ""}`,
                      )
                      .join(" | ") || "-";
                  return (
                    <tr key={expense.id} className="border-t border-border">
                      <td className="p-1.5 font-mono text-xs">{expense.ref_no}</td>
                      <td className="p-1.5">{expense.expense_date}</td>
                      <td className="p-1.5">{expense.expense_categories?.name}</td>
                      <td className="p-1.5 text-muted-foreground">{detail}</td>
                      <td className="p-1.5 text-muted-foreground">{expense.description}</td>
                      <td className="p-1.5 text-right font-medium">{MWK(expense.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-2">Wastage</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="p-1">Date</th>
                <th className="p-1">Item</th>
                <th className="p-1 text-right">Qty</th>
                <th className="p-1">Reason</th>
              </tr>
            </thead>
            <tbody>
              {wasteRows.map((movement) => (
                <tr key={movement.id} className="border-t border-border">
                  <td className="p-1.5">{fmtDate(movement.created_at)}</td>
                  <td className="p-1.5">{movement.items?.name}</td>
                  <td className="p-1.5 text-right">
                    {fmtQty(movement.qty)} {movement.items?.units?.code}
                  </td>
                  <td className="p-1.5 text-muted-foreground">{movement.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
