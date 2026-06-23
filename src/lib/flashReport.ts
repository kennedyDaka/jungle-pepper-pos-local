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
import { findMissingOrderNumbers } from "@/lib/orderSequence";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F5132" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11, underline: "single" };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 16, color: { argb: "FF1F5132" } };
const SUBTITLE_FONT: Partial<ExcelJS.Font> = { italic: true, size: 10, color: { argb: "FF647067" } };
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
  preparedBy: string;
  paymentTotals: Record<string, number>;
  items: MatrixItem[];
  movements: MatrixMovement[];
  ledgerMovements: MatrixMovement[];
  sales: MatrixOrder[];
};

type FlashStockItem = {
  label: string;
  aliases: string[];
  isMenu?: true;
  menuAliases?: string[];
};

const STOCK_SECTIONS: [string, FlashStockItem[]][] = [
  ["CHICKEN", [
    { label: "FRANGO HALF (600g)", aliases: ["FRANGO HALF (600G)"] },
    { label: "FILLET TRAYS (400/500g)", aliases: ["FILLET TRAYS (500G)"] },
    { label: "CHICK PIZZA PKTS (80g)", aliases: ["PIZZA PKTS (80G)"] },
    { label: "CHICK BURGERS/BITOQUES (120g)", aliases: ["BURGER (120G)"] },
  ]],
  ["RUMP", [
    { label: "RUMP SLICED BULK (1Kg)", aliases: ["RUMP SLICED (1KG)", "SLICED (1KG)"] },
    { label: "PREGOS/BITOQUES (120g)", aliases: ["SLICED 120G"] },
  ]],
  ["MINCE", [
    { label: "MINCE BULK (1Kg)", aliases: ["MINCE BULK (1KG)", "BULK (1KG)"] },
    { label: "MINCE BURGERS (120g)", aliases: ["MINCE BURGERS (120G)", "BURGERS (120G)"] },
    { label: "MINCE PIZZA PKTS & BOLOG (80g)", aliases: ["MINCE PIZZA PKTS & BOLOG (80G)", "PIZZA PKTS & BOLOG (80G)"] },
  ]],
  ["CAMARAO", [
    { label: "CAMARAO HALF (pkt 6)", aliases: ["CAMARAO HALF (PKT6)"] },
    { label: "CAMARAO PASTA PKTS (80g)", aliases: ["CAMARAO PASTA PKTS (80G)"] },
  ]],
  ["CHEESE", [
    { label: "BLOCK (Qty)", aliases: ["CHEESE BLOCK QTY", "BLOCK (QTY)"] },
    { label: "BLOCK (Kg)", aliases: ["CHEESE BLOCK"] },
    { label: "PIZZA CHEESE PKTS (120g)", aliases: ["CHEESE PIZZA PKTS (120G)"] },
    { label: "CHEESE BURGER/LOAF (40g)", aliases: ["CHEESE BURGER PKTS (40G)"] },
    { label: "MILK (500g)", aliases: ["MILK"] },
    { label: "MARGARINE", aliases: [] },
  ]],
  ["FLOUR / DOUGH", [
    { label: "FLOUR BAG (Kg)", aliases: ["FLOUR BAG"] },
    { label: "DOUGH PIZZA BASES (Thin)", aliases: ["DOUGH PIZZA BASES THIN"] },
    { label: "DOUGH PIZZA BASES (Thick)", aliases: ["DOUGH PIZZA BASES THICK"] },
  ]],
  ["BREAD", [
    { label: "BREAD BURGER (6 each pkt)", aliases: ["BURGER (6 EACH PKT)", "BURGER BUNS"] },
  ]],
  ["RICE", [
    { label: "BULK (Kg)", aliases: ["RICE BULK"] },
    { label: "RICE MARISCO PKTS (200g)", aliases: ["MARISCO PKTS"] },
    { label: "RICE COOKED (Cont=3.200g) (1Kg)", aliases: ["RICE COOKED(CONT=3.200G) (1KG)", "RICE COOKER"] },
    { label: "SALT (Kg)", aliases: ["SALT"] },
    { label: "SUGAR (Kg)", aliases: ["SUGAR"] },
  ]],
  ["OILS / SAUCES", [
    { label: "COOKING OIL BULK (L)", aliases: ["COOKING OIL BULK"] },
    { label: "SAUCE FRANGO", aliases: [] },
    { label: "SAUCE CAMARAO", aliases: [] },
  ]],
  ["VEGETABLES", [
    { label: "POTATOES BULK (Kg)", aliases: ["POTATOES BULK"] },
    { label: "GARLIC FULL (Kg)", aliases: ["GARLIC FULL"] },
    { label: "ONION (Kg)", aliases: ["ONIONS (KG)", "ONIONS"] },
  ]],
  ["PACKAGING", [
    { label: "PIZZA BOX (Qty)", aliases: ["PIZZA BOX"] },
    { label: "WHITE SMALL BOX", aliases: ["WHITE SMALL BOX"] },
    { label: "WHITE LARGE BOX", aliases: ["WHITE LARGE BOX"] },
    { label: "FOIL BOX", aliases: ["FOIL", "FOIL CUPS"] },
  ]],
  ["CHARCOAL / FIREWOOD", [
    { label: "CHARCOAL (Kg)", aliases: ["CHARCOAL"] },
    { label: "FIREWOOD (Tonnes)", aliases: ["FIREWOOD"] },
  ]],
  ["HOT DRINKS", [
    { label: "CAPUCCINO", aliases: [], isMenu: true },
    { label: "LATTE (GALAO)", aliases: [], isMenu: true },
    { label: "HOT CHOCOLATE", aliases: [], isMenu: true },
    { label: "SUBMARINE", aliases: [], isMenu: true },
    { label: "CHOCACHINO", aliases: [], isMenu: true },
    { label: "MILKSHAKES", aliases: [], isMenu: true },
    { label: "DECAFF", aliases: [], isMenu: true },
  ]],
  ["SOFT DRINKS", [
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
  ]],
  ["BEERS", [
    { label: "CHILL", aliases: ["CHILL BEER"], menuAliases: [] },
    { label: "GREEN", aliases: ["GREEN BEER"], menuAliases: [] },
    { label: "CASTEL", aliases: ["CASTEL BEER"], menuAliases: [] },
    { label: "SPECIAL", aliases: ["SPECIAL BEER"], menuAliases: [] },
    { label: "KUCHE KUCHE", aliases: ["KUCHE KUCHE BEER"], menuAliases: [] },
    { label: "SAPITWA", aliases: ["SAPITWA BEER"], menuAliases: [] },
    { label: "POMME BREEZE (CIDER)", aliases: ["POME BREEZE CIDER"], menuAliases: ["POME BREEZE"] },
  ]],
  ["WINES - GLASS", [
    { label: "WINE RED DRY (DRODSTY)", aliases: ["RED DRY DROSTDY"], menuAliases: ["RED DRY (DROSTDY)"] },
    { label: "WINE RED DRY (OVERMEER)", aliases: ["RED DRY OVERMEER WINE"], menuAliases: ["RED DRY (OVERMEER)"] },
    { label: "WINE RED SWEET", aliases: ["RED SWEET WINE BOTTLE"], menuAliases: ["RED SWEET"] },
    { label: "WINE WHITE DRY", aliases: ["WHITE WINE DRY"], menuAliases: ["WHITE WINE GLASS"] },
  ]],
  ["LIQUORS + MORE", []],
  ["BRANDY", [
    { label: "CAPE STARS", aliases: ["CAPE STARS BRANDY BOTTLE"], menuAliases: ["CAPE STARS BRANDY"] },
    { label: "PREMIER", aliases: ["PREMIER BRANDY BOTTLE"], menuAliases: ["PREMIER BRANDY"] },
    { label: "KLIPDRIFT", aliases: ["KLIPDRIFT BRANDY BOTTLE"], menuAliases: [] },
    { label: "KWV 3 YRS", aliases: ["KWV 3 YEARS BRANDY BOTTLE"], menuAliases: [] },
    { label: "KWV 5 YRS", aliases: ["KWV 5 YEARS BRANDY BOTTLE"], menuAliases: [] },
  ]],
  ["GIN", [
    { label: "CAPE STARS", aliases: ["CAPE STARS GIN BOTTLE"], menuAliases: ["CAPE STARS GIN"] },
    { label: "MALAWI GIN", aliases: ["MALAWI GIN BOTTLE"], menuAliases: [] },
  ]],
  ["WHISKEY", [
    { label: "CAPE STARS", aliases: ["CAPE STARS WHISKEY BOTTLE"], menuAliases: ["CAPE STARS WHISKEY"] },
    { label: "J & B", aliases: ["J&B WHISKEY BOTTLE"], menuAliases: [] },
    { label: "JAMESON", aliases: ["JAMESON BOTTLE"], menuAliases: [] },
    { label: "JACK DANIELS", aliases: ["JACK DANIELS BOTTLE"], menuAliases: [] },
  ]],
  ["VODKA", [
    { label: "CAPE STARS", aliases: ["CAPE STARS VODKA BOTTLE"] },
    { label: "MALAWI VODKA", aliases: ["MALAWI VODKA BOTTLE"], menuAliases: [] },
    { label: "ABSOLUT", aliases: ["ABSOLUT VODKA BOTTLE"], menuAliases: ["ABSOLUTE"] },
    { label: "SMIRNOFF", aliases: ["SMIRNOFF VODKA BOTTLE"], menuAliases: [] },
  ]],
];

const PAYMENT_METHOD_MAP: [string, string][] = [
  ["NB (NATIONAL BANK)", "national_bank"],
  ["STANDARD BANK", "standard_bank"],
  ["CAPITAL BANK", "capital_bank"],
  ["ECO BANK", "eco_bank"],
  ["Airtel Money", "airtel_money"],
  ["Physical Cash (Till)", "cash"],
];

function stockCell(value: number) {
  return Math.abs(value) <= 0.000001 ? null : Number(value.toFixed(3));
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

function buildSoldAs(itemId: string, movements: MatrixMovement[]): string {
  const agg = new Map<string, number>();
  for (const movement of movements) {
    if (movement.item_id !== itemId) continue;
    if ((movement.qty ?? 0) >= 0) continue;
    const names = (movement.menu_item_names ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      agg.set(name, (agg.get(name) ?? 0) + 1);
    }
  }
  if (agg.size === 0) return "";
  return [...agg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, qty]) => `${name} x${qty}`)
    .join(", ");
}

export function buildFlashReport(input: FlashReportInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jungle Pepper POS";
  wb.title = "Jungle Pepper — Daily Flash Report";

  const ws = wb.addWorksheet("Flash Report");

  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 20;
  ws.getColumn(6).width = 22;
  ws.getColumn(7).width = 16;
  ws.getColumn(8).width = 48;

  const titleRow = ws.addRow(["JUNGLE PEPPER — DAILY FLASH REPORT"]);
  titleRow.getCell(1).font = TITLE_FONT;

  ws.addRow([]);

  const dateRow = ws.addRow([`Date: ${input.reportDate}`]);
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

  PAYMENT_METHOD_MAP.forEach(([displayName, dbMethod]) => {
    const expected = input.paymentTotals[dbMethod] ?? 0;
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
    { formula: `=SUM(B${bankDataStartRow}:B${bankDataStartRow + 5})` },
    { formula: `=SUM(C${bankDataStartRow}:C${bankDataStartRow + 5})` },
    { formula: `=SUM(D${bankDataStartRow}:D${bankDataStartRow + 5})` },
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
    "Morning Opening Stock",
    "Purchases",
    "System Sales (POS)",
    "Expected Closing Stock",
    "Tonight's Actual Count",
    "Variance",
    "Sold As",
  ]);
  stockHeader.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });
  stockHeader.height = 30;

  const exact = itemIndex(input.items);

  STOCK_SECTIONS.forEach(([sectionName, stockItems]) => {
    const sectionRow = ws.addRow([sectionName]);
    sectionRow.getCell(1).font = SECTION_FONT;
    sectionRow.height = 20;

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

      const soldAs = itemId ? buildSoldAs(itemId, input.movements) : "";

      const r = ws.addRow([
        label,
        stockCell(rawOpening),
        stockCell(rawPurchases),
        stockCell(rawUsage),
        isMenu ? null : stockCell(rawExpected),
        isMenu ? null : stockCell(rawClosing),
        isMenu ? null : stockCell(rawVariance),
        soldAs || null,
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
  });

  ws.addRow([]);
  ws.addRow([]);

  const s3Title = ws.addRow(["3. MISSING ORDER NUMBERS"]);
  s3Title.getCell(1).font = { bold: true, size: 12, underline: "single" };
  ws.addRow([]);

  const missingNos = findMissingOrderNumbers(input.sales);
  if (missingNos.length === 0) {
    ws.addRow(["No missing order numbers detected."]);
  } else {
    const chunkSize = 20;
    for (let i = 0; i < missingNos.length; i += chunkSize) {
      const chunk = missingNos.slice(i, i + chunkSize);
      ws.addRow([`Missing: ${chunk.join(", ")}`]);
    }
    ws.addRow([]);
    ws.addRow([`Total missing order numbers: ${missingNos.length}`]);
  }

  return wb;
}
