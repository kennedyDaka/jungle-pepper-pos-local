import ExcelJS from "exceljs";
import { servingQty, wholeServingQty, isMeasuredBeverage } from "@/lib/beverage";
import {
  normalizeName,
  itemIndex,
  resolveItem,
  summarizeStock,
  type MatrixItem,
  type MatrixMovement,
  type MatrixOrder,
} from "@/lib/stockMatrixReport";
import { analyzeDailyOrderNumbers } from "@/lib/orderSequence";
import type { ReportRow } from "@/lib/xlsxReport";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F5132" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11, underline: "single" };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 16, color: { argb: "FF1F5132" } };
const SUBTITLE_FONT: Partial<ExcelJS.Font> = {
  italic: true,
  size: 10,
  color: { argb: "FF647067" },
};
const TOTALS_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };
const TOTALS_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFEAF4EE" },
};
const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

export type FlashReportInput = {
  reportDate: string;
  rangeLabel?: string;
  preparedBy: string;
  paymentTotals: Record<string, number>;
  items: MatrixItem[];
  movements: MatrixMovement[];
  ledgerMovements: MatrixMovement[];
  sales: MatrixOrder[];
  expenses?: ReportRow[];
};

type FlashStockItem = {
  label: string;
  aliases: string[];
  isMenu?: true;
  menuAliases?: string[];
};

const STOCK_SECTIONS: [string, FlashStockItem[]][] = [
  [
    "CHICKEN",
    [
      { label: "FRANGO HALF (600g)", aliases: ["FRANGO HALF (600G)"] },
      { label: "FILLET TRAYS (400/500g)", aliases: ["FILLET TRAYS (500G)"] },
      { label: "CHICK PIZZA PKTS (80g)", aliases: ["PIZZA PKTS (80G)"] },
      { label: "CHICK BURGERS/BITOQUES (120g)", aliases: ["BURGER (120G)"] },
    ],
  ],
  [
    "RUMP",
    [
      { label: "RUMP SLICED BULK (1Kg)", aliases: ["RUMP SLICED (1KG)", "SLICED (1KG)"] },
      { label: "PREGOS/BITOQUES (120g)", aliases: ["SLICED 120G"] },
    ],
  ],
  [
    "MINCE",
    [
      { label: "MINCE BULK (1Kg)", aliases: ["MINCE BULK (1KG)", "BULK (1KG)"] },
      { label: "MINCE BURGERS (120g)", aliases: ["MINCE BURGERS (120G)", "BURGERS (120G)"] },
      {
        label: "MINCE PIZZA PKTS & BOLOG (80g)",
        aliases: ["MINCE PIZZA PKTS & BOLOG (80G)", "PIZZA PKTS & BOLOG (80G)"],
      },
    ],
  ],
  [
    "CAMARAO",
    [
      { label: "CAMARAO HALF (pkt 6)", aliases: ["CAMARAO HALF (PKT6)"] },
      { label: "CAMARAO PASTA PKTS (80g)", aliases: ["CAMARAO PASTA PKTS (80G)"] },
    ],
  ],
  [
    "CHEESE",
    [
      { label: "BLOCK (Qty)", aliases: ["CHEESE BLOCK QTY", "BLOCK (QTY)"] },
      { label: "BLOCK (Kg)", aliases: ["CHEESE BLOCK"] },
      { label: "PIZZA CHEESE PKTS (120g)", aliases: ["CHEESE PIZZA PKTS (120G)"] },
      { label: "CHEESE BURGER/LOAF (40g)", aliases: ["CHEESE BURGER PKTS (40G)"] },
      { label: "MILK (500g)", aliases: ["MILK"] },
      { label: "MARGARINE", aliases: [] },
    ],
  ],
  [
    "FLOUR / DOUGH",
    [
      { label: "FLOUR BAG (Kg)", aliases: ["FLOUR BAG"] },
      { label: "DOUGH PIZZA BASES (Thin)", aliases: ["DOUGH PIZZA BASES THIN"] },
      { label: "DOUGH PIZZA BASES (Thick)", aliases: ["DOUGH PIZZA BASES THICK"] },
    ],
  ],
  [
    "BREAD",
    [{ label: "BREAD BURGER (6 each pkt)", aliases: ["BURGER (6 EACH PKT)", "BURGER BUNS"] }],
  ],
  [
    "RICE",
    [
      { label: "BULK (Kg)", aliases: ["RICE BULK"] },
      { label: "RICE MARISCO PKTS (200g)", aliases: ["MARISCO PKTS"] },
      {
        label: "RICE COOKED (Cont=3.200g) (1Kg)",
        aliases: ["RICE COOKED(CONT=3.200G) (1KG)", "RICE COOKER"],
      },
      { label: "SALT (Kg)", aliases: ["SALT"] },
      { label: "SUGAR (Kg)", aliases: ["SUGAR"] },
    ],
  ],
  [
    "OILS / SAUCES",
    [
      { label: "COOKING OIL BULK (L)", aliases: ["COOKING OIL BULK"] },
      { label: "SAUCE FRANGO", aliases: [] },
      { label: "SAUCE CAMARAO", aliases: [] },
    ],
  ],
  [
    "VEGETABLES",
    [
      { label: "POTATOES BULK (Kg)", aliases: ["POTATOES BULK"] },
      { label: "GARLIC FULL (Kg)", aliases: ["GARLIC FULL"] },
      { label: "ONION (Kg)", aliases: ["ONIONS (KG)", "ONIONS"] },
    ],
  ],
  [
    "PACKAGING",
    [
      { label: "PIZZA BOX (Qty)", aliases: ["PIZZA BOX"] },
      { label: "WHITE SMALL BOX", aliases: ["WHITE SMALL BOX"] },
      { label: "WHITE LARGE BOX", aliases: ["WHITE LARGE BOX"] },
      { label: "FOIL BOX", aliases: ["FOIL", "FOIL CUPS"] },
    ],
  ],
  [
    "CHARCOAL / FIREWOOD",
    [
      { label: "CHARCOAL (Kg)", aliases: ["CHARCOAL"] },
      { label: "FIREWOOD (Tonnes)", aliases: ["FIREWOOD"] },
    ],
  ],
  [
    "HOT DRINKS",
    [
      { label: "CAPUCCINO", aliases: [], isMenu: true },
      { label: "LATTE (GALAO)", aliases: [], isMenu: true },
      { label: "HOT CHOCOLATE", aliases: [], isMenu: true },
      { label: "SUBMARINE", aliases: [], isMenu: true },
      { label: "CHOCACHINO", aliases: [], isMenu: true },
      { label: "MILKSHAKES", aliases: [], isMenu: true },
      { label: "DECAFF", aliases: [], isMenu: true },
    ],
  ],
  [
    "SOFT DRINKS",
    [
      { label: "WATER", aliases: ["WATER BOTTLE"], menuAliases: [] },
      { label: "COKE", aliases: ["COKE BOTTLE/CAN"], menuAliases: [] },
      { label: "FANTA ORANGE", aliases: ["FANTA ORANGE BOTTLE/CAN"], menuAliases: [] },
      { label: "FANTA PINEAPPLE", aliases: ["FANTA PINEAPPLE BOTTLE/CAN"], menuAliases: [] },
      { label: "FANTA PASSION", aliases: ["FANTA PASSION BOTTLE/CAN"], menuAliases: [] },
      { label: "SPRITE", aliases: ["SPRITE BOTTLE/CAN"], menuAliases: [] },
      { label: "CHERRY PLUM", aliases: ["CHERRY PLUM BOTTLE/CAN"], menuAliases: [] },
      { label: "COCOPINA", aliases: ["COCOPINA BOTTLE/CAN"], menuAliases: [] },
      { label: "GINGER SOBO", aliases: ["GINGER SOBO BOTTLE/CAN"], menuAliases: [] },
      { label: "GINGER ALE CAN", aliases: ["GINGER ALE BOTTLE/CAN"], menuAliases: ["GINGER ALE"] },
    ],
  ],
  [
    "BEERS",
    [
      { label: "CHILL", aliases: ["CHILL BEER"], menuAliases: [] },
      { label: "GREEN", aliases: ["GREEN BEER"], menuAliases: [] },
      { label: "CASTEL", aliases: ["CASTEL BEER"], menuAliases: [] },
      { label: "SPECIAL", aliases: ["SPECIAL BEER"], menuAliases: [] },
      { label: "KUCHE KUCHE", aliases: ["KUCHE KUCHE BEER"], menuAliases: [] },
      { label: "SAPITWA", aliases: ["SAPITWA BEER"], menuAliases: [] },
      {
        label: "POMME BREEZE (CIDER)",
        aliases: ["POME BREEZE CIDER"],
        menuAliases: ["POME BREEZE"],
      },
    ],
  ],
  [
    "WINES - GLASS",
    [
      {
        label: "WINE RED DRY (DRODSTY)",
        aliases: ["RED DRY DROSTDY"],
        menuAliases: ["RED DRY (DROSTDY)"],
      },
      {
        label: "WINE RED DRY (OVERMEER)",
        aliases: ["RED DRY OVERMEER WINE"],
        menuAliases: ["RED DRY (OVERMEER)"],
      },
      { label: "WINE RED SWEET", aliases: ["RED SWEET WINE BOTTLE"], menuAliases: ["RED SWEET"] },
      { label: "WINE WHITE DRY", aliases: ["WHITE WINE DRY"], menuAliases: ["WHITE WINE GLASS"] },
    ],
  ],
  ["LIQUORS + MORE", []],
  [
    "BRANDY",
    [
      {
        label: "CAPE STARS",
        aliases: ["CAPE STARS BRANDY BOTTLE"],
        menuAliases: ["CAPE STARS BRANDY"],
      },
      { label: "PREMIER", aliases: ["PREMIER BRANDY BOTTLE"], menuAliases: ["PREMIER BRANDY"] },
      { label: "KLIPDRIFT", aliases: ["KLIPDRIFT BRANDY BOTTLE"], menuAliases: [] },
      { label: "KWV 3 YRS", aliases: ["KWV 3 YEARS BRANDY BOTTLE"], menuAliases: [] },
      { label: "KWV 5 YRS", aliases: ["KWV 5 YEARS BRANDY BOTTLE"], menuAliases: [] },
    ],
  ],
  [
    "GIN",
    [
      { label: "CAPE STARS", aliases: ["CAPE STARS GIN BOTTLE"], menuAliases: ["CAPE STARS GIN"] },
      { label: "MALAWI GIN", aliases: ["MALAWI GIN BOTTLE"], menuAliases: [] },
    ],
  ],
  [
    "WHISKEY",
    [
      {
        label: "CAPE STARS",
        aliases: ["CAPE STARS WHISKEY BOTTLE"],
        menuAliases: ["CAPE STARS WHISKEY"],
      },
      { label: "J & B", aliases: ["J&B WHISKEY BOTTLE"], menuAliases: [] },
      { label: "JAMESON", aliases: ["JAMESON BOTTLE"], menuAliases: [] },
      { label: "JACK DANIELS", aliases: ["JACK DANIELS BOTTLE"], menuAliases: [] },
    ],
  ],
  [
    "VODKA",
    [
      { label: "CAPE STARS", aliases: ["CAPE STARS VODKA BOTTLE"] },
      { label: "MALAWI VODKA", aliases: ["MALAWI VODKA BOTTLE"], menuAliases: [] },
      { label: "ABSOLUT", aliases: ["ABSOLUT VODKA BOTTLE"], menuAliases: ["ABSOLUTE"] },
      { label: "SMIRNOFF", aliases: ["SMIRNOFF VODKA BOTTLE"], menuAliases: [] },
    ],
  ],
];

const PAYMENT_METHOD_MAP: Array<[string, string[]]> = [
  ["Physical Cash (Till)", ["cash"]],
  ["NB (NATIONAL BANK)", ["national_bank"]],
  ["STANDARD BANK", ["standard_bank"]],
  ["CAPITAL BANK", ["capital_bank"]],
  ["ECO BANK", ["eco_bank"]],
  ["BANK CARD / OTHER BANK", ["bank_card"]],
  ["Airtel Money", ["airtel_money"]],
  ["Mpamba", ["mpamba"]],
];

function paymentTotal(paymentTotals: Record<string, number>, methods: string[]) {
  return methods.reduce((sum, method) => sum + (Number(paymentTotals[method]) || 0), 0);
}

function stockCell(value: number) {
  return Math.abs(value) <= 0.000001 ? null : Number(value.toFixed(3));
}

function formatReportQty(value: number) {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(3)).toString();
}

function countMenuSales(label: string, sales: MatrixOrder[]) {
  const normalized = normalizeName(label);
  let qty = 0;
  sales.forEach((order) => {
    order.order_items?.forEach((line) => {
      const itemName = line.menu_items?.name ?? "";
      if (normalizeName(itemName) === normalized) {
        qty += Number(line.qty) || 0;
      }
    });
  });
  return qty;
}

function parseDishQty(value: string, fallbackQty = 1) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)(?:\s+x\s*([0-9]+(?:\.[0-9]+)?))?$/i);
  const name = (match?.[1] ?? trimmed).trim();
  const qty = match?.[2] ? Number(match[2]) : fallbackQty;
  return {
    name,
    qty: Number.isFinite(qty) && qty > 0 ? qty : fallbackQty,
  };
}

function soldAsLabel(name: string, movement: MatrixMovement) {
  const normalizedName = normalizeName(name);
  const normalizedCategories = normalizeName(movement.menu_categories ?? "");
  if (normalizedName.includes("PIZZA") || normalizedCategories.includes("PIZZA")) return "Pizza";
  return name;
}

function buildSoldAs(itemId: string, movements: MatrixMovement[]): string {
  const agg = new Map<string, number>();
  for (const movement of movements) {
    if (movement.item_id !== itemId) continue;
    if ((movement.qty ?? 0) >= 0) continue;
    const names = (movement.menu_item_names ?? movement.destination ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const rawName of names) {
      const parsed = parseDishQty(rawName, Number(movement.order_item_qty ?? 1) || 1);
      if (!parsed.name) continue;
      const label = soldAsLabel(parsed.name, movement);
      agg.set(label, (agg.get(label) ?? 0) + parsed.qty);
    }
  }
  if (agg.size === 0) return "";
  return [...agg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, qty]) => `${name} x${formatReportQty(qty)}`)
    .join(", ");
}

type FlashStockRow = {
  section: string;
  label: string;
  opening: number;
  purchases: number;
  usage: number;
  expected: number;
  closing: number;
  variance: number;
  soldAs: string;
  isMenu?: boolean;
};

function flashStockRows(input: FlashReportInput): FlashStockRow[] {
  const exact = itemIndex(input.items);
  const rows: FlashStockRow[] = [];

  STOCK_SECTIONS.forEach(([sectionName, stockItems]) => {
    stockItems.forEach(({ label, aliases, isMenu, menuAliases }) => {
      let rawOpening = 0;
      let rawPurchases = 0;
      let rawUsage = 0;
      let rawClosing = 0;
      let hasStock = false;
      let item: MatrixItem | undefined;
      let itemId: string | undefined;

      if (isMenu) {
        rawUsage = countMenuSales(label, input.sales);
      } else if (menuAliases !== undefined) {
        item = resolveItem(input.items, exact, label, aliases);
        if (item) {
          itemId = item.id;
          const summary = summarizeStock(item, input.movements, input.ledgerMovements);
          rawOpening = summary.opening;
          rawPurchases = summary.purchase;
          rawClosing = summary.closing;
          hasStock = true;
        }
        const allCandidates = [label, ...aliases, ...menuAliases].filter(Boolean);
        for (const candidate of allCandidates) {
          const qty = countMenuSales(candidate, input.sales);
          if (qty > 0) {
            rawUsage = qty;
            break;
          }
        }
        if (rawUsage === 0 && item) {
          const summary = summarizeStock(item, input.movements, input.ledgerMovements);
          rawUsage = summary.usage;
          if (isMeasuredBeverage(item)) {
            rawUsage = wholeServingQty(servingQty(rawUsage, item) ?? 0);
          }
        }
        if (item && isMeasuredBeverage(item)) {
          rawOpening = wholeServingQty(servingQty(rawOpening, item) ?? 0);
          rawPurchases = wholeServingQty(servingQty(rawPurchases, item) ?? 0);
          rawClosing = wholeServingQty(servingQty(rawClosing, item) ?? 0);
        }
      } else {
        item = resolveItem(input.items, exact, label, aliases);
        if (item) {
          itemId = item.id;
          const summary = summarizeStock(item, input.movements, input.ledgerMovements);
          rawOpening = summary.opening;
          rawPurchases = summary.purchase;
          rawUsage = summary.usage;
          rawClosing = summary.closing;
          hasStock = true;
        }
        if (item && isMeasuredBeverage(item)) {
          rawOpening = wholeServingQty(servingQty(rawOpening, item) ?? 0);
          rawPurchases = wholeServingQty(servingQty(rawPurchases, item) ?? 0);
          rawUsage = wholeServingQty(servingQty(rawUsage, item) ?? 0);
          rawClosing = wholeServingQty(servingQty(rawClosing, item) ?? 0);
        }
      }

      const rawExpected = hasStock ? rawOpening + rawPurchases - rawUsage : 0;
      const rawVariance = hasStock ? rawClosing - rawExpected : 0;

      rows.push({
        section: sectionName,
        label,
        opening: rawOpening,
        purchases: rawPurchases,
        usage: rawUsage,
        expected: rawExpected,
        closing: rawClosing,
        variance: rawVariance,
        soldAs: itemId ? buildSoldAs(itemId, input.movements) : "",
        isMenu,
      });
    });
  });

  return rows;
}

export function buildFlashReportRows(input: FlashReportInput): ReportRow[] {
  const rows: ReportRow[] = [];

  PAYMENT_METHOD_MAP.forEach(([displayName, dbMethods]) => {
    rows.push({
      Section: "Cash & Bank",
      Item: displayName,
      "Expected Deposits": paymentTotal(input.paymentTotals, dbMethods),
      "Statement Deposited": 0,
      "Delayed Deposits": 0,
    });
  });

  flashStockRows(input).forEach((row) => {
    rows.push({
      Section: row.section,
      Item: row.label,
      opening: stockCell(row.opening),
      purchases: stockCell(row.purchases),
      sales: stockCell(row.usage),
      closing: row.isMenu ? null : stockCell(row.expected),
      actual: row.isMenu ? null : stockCell(row.closing),
      difference: row.isMenu ? null : stockCell(row.variance),
      "sold as": row.soldAs,
    });
  });

  const audits = analyzeDailyOrderNumbers(input.sales);
  const missingByDate = audits
    .map((audit) => ({
      date: audit.date,
      missing: audit.sequences.flatMap((sequence) => sequence.missing),
    }))
    .filter((audit) => audit.missing.length > 0);

  if (missingByDate.length === 0) {
    rows.push({
      Section: "Missing Order Numbers",
      Item: "No missing order numbers",
    });
  }

  missingByDate.forEach((audit) => {
    rows.push({
      Section: "Missing Order Numbers",
      Date: audit.date,
      "Missing Order Numbers": audit.missing.join(", "),
    });
  });

  (input.expenses ?? []).forEach((expense) => {
    rows.push({ Section: "Expenses", ...expense });
  });

  return rows;
}

function columnLetter(index: number) {
  let column = "";
  let value = index;
  while (value > 0) {
    const modulo = (value - 1) % 26;
    column = String.fromCharCode(65 + modulo) + column;
    value = Math.floor((value - modulo) / 26);
  }
  return column;
}

function addExpensesWorksheet(wb: ExcelJS.Workbook, input: FlashReportInput) {
  const expenses = input.expenses ?? [];
  const ws = wb.addWorksheet("Expenses");
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 34;
  ws.getColumn(7).width = 28;
  ws.getColumn(8).width = 16;
  ws.getColumn(9).width = 16;
  ws.getColumn(10).width = 14;
  ws.getColumn(11).width = 12;
  ws.getColumn(12).width = 16;

  const titleRow = ws.addRow(["JUNGLE PEPPER - FLASH REPORT EXPENSES"]);
  titleRow.getCell(1).font = TITLE_FONT;
  ws.addRow([`Period: ${input.rangeLabel ?? input.reportDate}`]).getCell(1).font = SUBTITLE_FONT;
  ws.addRow([]);

  const preferredColumns = [
    "Ref",
    "Date",
    "Category",
    "Supplier",
    "Method",
    "Description",
    "Item",
    "Purchase Count",
    "Size Each",
    "Stock Qty",
    "Unit",
    "Line Total",
    "Affects Stock",
  ];
  const extraColumns = Array.from(
    new Set(
      expenses.flatMap((row) => Object.keys(row)).filter((key) => !preferredColumns.includes(key)),
    ),
  );
  const columns = [...preferredColumns, ...extraColumns].filter((column) =>
    expenses.length
      ? expenses.some((row) => row[column] !== undefined && row[column] !== "")
      : true,
  );

  const header = ws.addRow(columns);
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER_THIN;
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  if (expenses.length === 0) {
    ws.addRow(["No expenses recorded for this period"]);
    return;
  }

  const firstDataRow = ws.rowCount + 1;
  expenses.forEach((expense) => {
    const row = ws.addRow(columns.map((column) => expense[column] ?? ""));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  const totalColumnIndex =
    columns.findIndex((column) => column === "Line Total" || column === "Amount") + 1;
  if (totalColumnIndex > 0) {
    const totalRowValues: Array<string | { formula: string }> = columns.map(() => "");
    totalRowValues[0] = "TOTAL";
    totalRowValues[totalColumnIndex - 1] = {
      formula: `=SUM(${columnLetter(totalColumnIndex)}${firstDataRow}:${columnLetter(totalColumnIndex)}${ws.rowCount})`,
    };
    const totalRow = ws.addRow(totalRowValues);
    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = TOTALS_FONT;
      cell.fill = TOTALS_FILL;
      cell.border = BORDER_THIN;
      cell.numFmt = "#,##0";
    });
  }

  columns.forEach((column, index) => {
    if (["Line Total", "Amount", "Unit Cost", "Stock Qty", "Purchase Count"].includes(column)) {
      ws.getColumn(index + 1).numFmt = "#,##0.###";
    }
  });
}

export function buildFlashReport(input: FlashReportInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jungle Pepper POS";
  wb.title = "Jungle Pepper - Flash Report";

  const ws = wb.addWorksheet("Flash Report");

  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 20;
  ws.getColumn(6).width = 22;
  ws.getColumn(7).width = 16;
  ws.getColumn(8).width = 48;

  const titleRow = ws.addRow(["JUNGLE PEPPER - FLASH REPORT"]);
  titleRow.getCell(1).font = TITLE_FONT;

  ws.addRow([]);

  const dateRow = ws.addRow([`Period: ${input.rangeLabel ?? input.reportDate}`]);
  dateRow.getCell(1).font = SUBTITLE_FONT;

  const prepRow = ws.addRow([`Prepared By: ${input.preparedBy}`]);
  prepRow.getCell(1).font = SUBTITLE_FONT;

  ws.addRow([]);

  const s1Title = ws.addRow(["1. CASH & BANK FLOW SUMMARY"]);
  s1Title.getCell(1).font = { bold: true, size: 12, underline: "single" };
  ws.addRow([]);

  const headerRow = ws.addRow([
    "Payment Method / Account",
    "Expected Deposits (POS)",
    "Statement (Deposited)",
    "Delayed Deposits",
  ]);
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
    cell.border = BORDER_THIN;
  });
  headerRow.height = 22;

  const bankDataStartRow = ws.rowCount + 1;

  PAYMENT_METHOD_MAP.forEach(([displayName, dbMethods]) => {
    const expected = paymentTotal(input.paymentTotals, dbMethods);
    const r = ws.addRow([displayName, expected, 0, null]);

    for (let c = 1; c <= 4; c++) {
      r.getCell(c).border = BORDER_THIN;
    }

    r.getCell(2).numFmt = "#,##0";
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).value = { formula: `=C${r.number}-B${r.number}` };
    r.getCell(4).numFmt = "#,##0";
  });

  const totalsRow = ws.addRow([
    "TOTAL REVENUE",
    { formula: `=SUM(B${bankDataStartRow}:B${bankDataStartRow + PAYMENT_METHOD_MAP.length - 1})` },
    { formula: `=SUM(C${bankDataStartRow}:C${bankDataStartRow + PAYMENT_METHOD_MAP.length - 1})` },
    { formula: `=SUM(D${bankDataStartRow}:D${bankDataStartRow + PAYMENT_METHOD_MAP.length - 1})` },
  ]);
  totalsRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = TOTALS_FONT;
    cell.fill = TOTALS_FILL;
    cell.border = BORDER_THIN;
    cell.numFmt = "#,##0";
  });

  ws.addRow([]);
  ws.addRow([]);

  const s2Title = ws.addRow(["2. HIGH-VALUE PHYSICAL STOCK COUNT"]);
  s2Title.getCell(1).font = { bold: true, size: 12, underline: "single" };
  ws.addRow([]);

  const stockHeader = ws.addRow([
    "Key Item",
    "opening",
    "purchases",
    "sales",
    "closing",
    "actual",
    "difference",
    "sold as",
  ]);
  stockHeader.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });
  stockHeader.height = 30;

  let currentSection = "";
  flashStockRows(input).forEach((stockRow) => {
    if (stockRow.section !== currentSection) {
      currentSection = stockRow.section;
      const sectionRow = ws.addRow([currentSection]);
      sectionRow.getCell(1).font = SECTION_FONT;
      sectionRow.height = 20;
    }

    const r = ws.addRow([
      stockRow.label,
      stockCell(stockRow.opening),
      stockCell(stockRow.purchases),
      stockCell(stockRow.usage),
      stockRow.isMenu ? null : stockCell(stockRow.expected),
      stockRow.isMenu ? null : stockCell(stockRow.closing),
      stockRow.isMenu ? null : stockCell(stockRow.variance),
      stockRow.soldAs || null,
    ]);

    for (let c = 1; c <= 8; c++) {
      r.getCell(c).border = BORDER_THIN;
    }

    const FMT_INT = "#,##0";
    const FMT_DEC = "#,##0.###";

    [2, 3, 4, 5, 6, 7].forEach((c) => {
      const val = r.getCell(c).value;
      r.getCell(c).numFmt = typeof val === "number" && val % 1 !== 0 ? FMT_DEC : FMT_INT;
    });
  });

  ws.addRow([]);
  ws.addRow([]);

  const s3Title = ws.addRow(["3. MISSING ORDER NUMBERS"]);
  s3Title.getCell(1).font = { bold: true, size: 12, underline: "single" };
  ws.addRow([]);

  const missingHeader = ws.addRow(["Date", "Missing Order Numbers"]);
  missingHeader.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER_THIN;
  });

  const audits = analyzeDailyOrderNumbers(input.sales);
  const missingByDate = audits
    .map((audit) => ({
      date: audit.date,
      missing: audit.sequences.flatMap((sequence) => sequence.missing),
    }))
    .filter((audit) => audit.missing.length > 0);

  if (missingByDate.length === 0) ws.addRow(["", "No missing order numbers"]);
  missingByDate.forEach((audit) => ws.addRow([audit.date, audit.missing.join(", ")]));

  addExpensesWorksheet(wb, input);

  return wb;
}
