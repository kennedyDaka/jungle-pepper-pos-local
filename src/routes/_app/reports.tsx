import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MWK, fmtDate, fmtQty } from "@/lib/format";
import {
  appendMatrixReportSheet,
  appendReportSheet,
  createReportWorkbook,
  writeReportWorkbook,
  type ReportMatrix,
  type ReportRow,
} from "@/lib/xlsxReport";
import { reportService } from "@/services/reportService";
import { Download } from "lucide-react";

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

  const fromIso = new Date(from + "T00:00:00").toISOString();
  const toIso = new Date(to + "T23:59:59").toISOString();

  const sales = useQuery({
    queryKey: ["rep", "sales", from, to],
    queryFn: () => reportService.listSales(fromIso, toIso),
  });

  const items = useQuery({
    queryKey: ["rep", "items"],
    queryFn: () => reportService.listItems(),
  });

  const stockMovements = useQuery({
    queryKey: ["rep", "stock-movements", from, to],
    queryFn: () => reportService.listStockMovements(fromIso, toIso),
  });

  const production = useQuery({
    queryKey: ["rep", "production", from, to],
    queryFn: () => reportService.listProduction(fromIso, toIso),
  });

  const expenses = useQuery({
    queryKey: ["rep", "exp", from, to],
    queryFn: () => reportService.listExpenses(from, to),
  });

  const totalSales = sumBy(sales.data ?? [], (order: any) => Number(order.total));
  const totalExpenses = sumBy(expenses.data ?? [], (expense: any) => Number(expense.amount));
  const movements = stockMovements.data ?? [];
  const productionRows = production.data ?? [];

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

  const stockMovementRows = (): ReportRow[] =>
    movements.map((movement) => ({
      Date: new Date(movement.created_at).toLocaleString(),
      Type: movement.type,
      Item: movement.items?.name ?? "",
      "Stock Type": movement.items?.stock_type ?? "",
      Unit: movement.items?.units?.code ?? "",
      Qty: Number(movement.qty),
      "Unit Cost": Number(movement.unit_cost),
      Value: Math.abs(Number(movement.qty) * Number(movement.unit_cost)),
      Before: movement.qty_before ?? "",
      After: movement.qty_after ?? "",
      "Reference Type": movement.ref_type ?? "",
      "Reference ID": movement.ref_id ?? "",
      Note: movement.note ?? "",
    }));

  const inventoryRows = (): ReportRow[] =>
    (items.data ?? []).map((item: any) => ({
      Item: item.name,
      Category: item.categories?.name ?? "-",
      Type: item.stock_type,
      Unit: item.units?.code ?? "",
      "Unit Name": item.units?.name ?? "",
      "Qty On Hand": Number(item.qty_on_hand),
      "Average Cost": Number(item.avg_cost),
      "Stock Value": Number(item.qty_on_hand) * Number(item.avg_cost),
      "Reorder Level": Number(item.reorder_level),
      "Below Reorder": Number(item.qty_on_hand) <= Number(item.reorder_level) ? "Yes" : "No",
      "Bottle ML": item.bottle_ml ?? "",
      "Serving ML": item.shot_ml ?? "",
      Supplier: item.suppliers?.name ?? "",
    }));

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
            const itemMoves = movements.filter((movement) => movement.item_id === item.id);
            const opening = itemMoves.length
              ? moneyValue(itemMoves[0].qty_before)
              : moneyValue(item.qty_on_hand);
            const closing = itemMoves.length
              ? moneyValue(itemMoves[itemMoves.length - 1].qty_after)
              : moneyValue(item.qty_on_hand);
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
              itemMoves.filter((movement) => movement.type === "production_in"),
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
              opening,
              purchases ? purchases * moneyValue(item.avg_cost) : "",
              purchases,
              outQty,
              "",
              item.units?.code === "kg" ? produced : "",
              produced,
              waste,
              closing,
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
      Method: expense.payment_method,
      Supplier: expense.suppliers?.name ?? "",
      Description: expense.description ?? "",
      "Stock Item Lines": expense.expense_stock_lines?.length ?? 0,
      "Recorded At": new Date(expense.created_at).toLocaleString(),
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
          Method: expense.payment_method,
          Description: expense.description ?? "",
          Item: "",
          Qty: "",
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
          Method: expense.payment_method,
          Description: expense.description ?? "",
          Item: line.items?.name ?? "",
          Qty: Number(line.qty),
          Unit: line.items?.units?.code ?? "",
          "Unit Cost": Number(line.unit_cost),
          "Line Total": Number(line.line_total),
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
      "Qty",
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
      row.Qty,
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
          new Date(order.created_at).toLocaleString(),
          thin,
          thick,
        ];
        itemNames.forEach((name) => {
          const value = lineAgg.get(name);
          row.push(value?.total ?? "", value?.qty ?? "");
        });
        row.push(
          (order.payments ?? [])
            .map((payment: any) => `${payment.method}: ${payment.amount}`)
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
        const bottleMl = Number(item.bottle_ml);
        const openingUnits = itemMoves.length
          ? Number(itemMoves[0].qty_before ?? 0)
          : Number(item.qty_on_hand);
        const closingUnits = itemMoves.length
          ? Number(itemMoves[itemMoves.length - 1].qty_after ?? item.qty_on_hand)
          : Number(item.qty_on_hand);
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
        return {
          Bottle: item.name,
          "Bottle ML": bottleMl,
          "Serving ML": Number(item.shot_ml) || 0,
          "Opening Bottles": openingUnits,
          "Opening ML": openingUnits * bottleMl,
          "Purchases ML": purchasesUnits * bottleMl,
          "Sales ML": salesUnits * bottleMl,
          "Wastage/Comp/Breakage ML": wastageUnits * bottleMl,
          "Closing Bottles": closingUnits,
          "Closing ML": closingUnits * bottleMl,
          "Expected Closing ML": expectedClosingUnits * bottleMl,
          "System Variance ML": (closingUnits - expectedClosingUnits) * bottleMl,
        };
      });

  const exportSalesXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Sales Report");
    const orderRows: ReportRow[] = [];
    const lineRows: ReportRow[] = [];
    const paymentRows: ReportRow[] = [];
    sales.data?.forEach((order: any) => {
      const payMethods = (order.payments ?? [])
        .map((payment: any) => `${payment.method}:${payment.amount}`)
        .join(" | ");
      orderRows.push({
        Date: new Date(order.created_at).toLocaleString(),
        OrderID: order.id,
        Subtotal: Number(order.subtotal),
        Discount: Number(order.discount),
        Total: Number(order.total),
        Payments: payMethods,
        Note: order.note ?? "",
      });
      order.payments?.forEach((payment: any) =>
        paymentRows.push({
          Date: new Date(order.created_at).toLocaleString(),
          OrderID: order.id,
          Method: payment.method,
          Amount: Number(payment.amount),
        }),
      );
      order.order_items?.forEach((line: any) => {
        const options = modifierNames(line);
        const crust = options.find((name) => name === "Thin Crust" || name === "Thick Crust");
        lineRows.push({
          Date: new Date(order.created_at).toLocaleString(),
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
    writeReportWorkbook(wb, `sales-${reportDateRange(from, to)}.xlsx`);
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
          Value: rows.filter((row) => row["Below Reorder"] === "Yes").length,
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
    appendReportSheet(
      wb,
      "Reorder And Negative",
      rows.filter((row) => row["Below Reorder"] === "Yes" || Number(row["Qty On Hand"]) < 0),
      { title: "Inventory Exceptions", rangeLabel },
    );
    writeReportWorkbook(wb, `inventory-${reportDateRange(from, to)}.xlsx`);
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
    appendMatrixReportSheet(wb, "Stock Count Sheet", stockCountMatrixRows(), {
      title: "Stock Count Sheet",
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
    writeReportWorkbook(wb, `stock-ledger-${reportDateRange(from, to)}.xlsx`);
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
        { Metric: "Sales ML", Value: sumBy(rows, (row) => Number(row["Sales ML"])) },
        {
          Metric: "Wastage/comp/breakage ML",
          Value: sumBy(rows, (row) => Number(row["Wastage/Comp/Breakage ML"])),
        },
        { Metric: "Beverage movement lines", Value: beverageMovements.length },
      ],
      { title: "Bar Control Summary", rangeLabel },
    );
    appendReportSheet(wb, "Bar Count", rows, { title: "Bottle ML Count Sheet", rangeLabel });
    appendReportSheet(wb, "Beverage Movements", beverageMovements, {
      title: "Beverage Movement Detail",
      rangeLabel,
    });
    writeReportWorkbook(wb, `bar-control-${reportDateRange(from, to)}.xlsx`);
  };

  const exportProductionXlsx = () => {
    const wb = createReportWorkbook("Jungle Pepper Production Report");
    const inputRows: ReportRow[] = [];
    const outputRows: ReportRow[] = [];
    const wasteProductionRows: ReportRow[] = [];
    productionRows.forEach((batch: any) => {
      batch.production_inputs?.forEach((line: any) =>
        inputRows.push({
          Date: new Date(batch.created_at).toLocaleString(),
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
          Date: new Date(batch.created_at).toLocaleString(),
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
          Date: new Date(batch.created_at).toLocaleString(),
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
        Date: new Date(batch.created_at).toLocaleString(),
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
    writeReportWorkbook(wb, `production-${reportDateRange(from, to)}.xlsx`);
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
    writeReportWorkbook(wb, `expenses-${reportDateRange(from, to)}.xlsx`);
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
    sales.error || items.error || stockMovements.error || production.error || expenses.error;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>
      {(sales.isLoading ||
        items.isLoading ||
        stockMovements.isLoading ||
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
        <div className="ml-auto flex gap-2 flex-wrap">
          <Button onClick={exportSalesXlsx}>
            <Download className="h-4 w-4 mr-1" />
            Sales
          </Button>
          <Button onClick={exportInventoryXlsx} variant="secondary">
            <Download className="h-4 w-4 mr-1" />
            Inventory
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
        </div>
      </Card>

      <div className="grid md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Sales</div>
          <div className="text-2xl font-bold">{MWK(totalSales)}</div>
          <div className="text-xs text-muted-foreground">{sales.data?.length ?? 0} orders</div>
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
