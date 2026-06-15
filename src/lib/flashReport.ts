import ExcelJS from "exceljs";
import {
  normalizeName,
  itemIndex,
  resolveItem,
  summarizeStock,
  metricCell,
  type MatrixItem,
  type MatrixMovement,
  type MatrixOrder,
} from "@/lib/stockMatrixReport";

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
    { label: "PREGOS/BITOQUES (120g)", aliases: ["PREGOS/BITOQUES (80G)", "PREGOS/BITOQUES (120G)"] },
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
    { label: "BREAD BURGER (6 each pkt)", aliases: ["BREAD BURGER PKTS", "BURGER (6 EACH PKT)", "BURGER BUNS"] },
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
    { label: "CAPUCCINO", aliases: [] },
    { label: "LATTE (GALAO)", aliases: [] },
    { label: "HOT CHOCOLATE", aliases: [] },
    { label: "SUBMARINE", aliases: [] },
    { label: "CHOCACHINO", aliases: [] },
    { label: "MILKSHAKES", aliases: [] },
    { label: "DECAFF", aliases: [] },
  ]],
  ["SOFT DRINKS", [
    { label: "WATER", aliases: ["WATER BOTTLE"] },
    { label: "COKE", aliases: ["COKE BOTTLE/CAN"] },
    { label: "FANTA ORANGE", aliases: ["FANTA ORANGE BOTTLE/CAN"] },
    { label: "FANTA PINEAPPLE", aliases: ["FANTA PINEAPPLE BOTTLE/CAN"] },
    { label: "FANTA PASSION", aliases: ["FANTA PASSION BOTTLE/CAN"] },
    { label: "SPRITE", aliases: ["SPRITE BOTTLE/CAN"] },
    { label: "CHERRY PLUM", aliases: ["CHERRY PLUM BOTTLE/CAN"] },
    { label: "COCOPINA", aliases: ["COCOPINA BOTTLE/CAN"] },
    { label: "GINGER SOBO", aliases: ["GINGER SOBO BOTTLE/CAN"] },
    { label: "GINGER ALE CAN", aliases: ["GINGER ALE BOTTLE/CAN"] },
  ]],
  ["BEERS", [
    { label: "CHILL", aliases: ["CHILL BEER"] },
    { label: "GREEN", aliases: ["GREEN BEER"] },
    { label: "CASTEL", aliases: ["CASTEL BEER"] },
    { label: "SPECIAL", aliases: ["SPECIAL BEER"] },
    { label: "KUCHE KUCHE", aliases: ["KUCHE KUCHE BEER"] },
    { label: "SAPITWA", aliases: ["SAPITWA BEER"] },
    { label: "POMME BREEZE (CIDER)", aliases: ["POME BREEZE CIDER"] },
  ]],
  ["WINES - GLASS", [
    { label: "WINE RED DRY (DRODSTY)", aliases: ["DROSTDY WINE BOTTLE", "DRODSTY WINE BOTTLE"] },
    { label: "WINE RED DRY (OVERMEER)", aliases: ["OVERMEER WINE BOTTLE"] },
    { label: "WINE RED SWEET", aliases: ["RED SWEET WINE BOTTLE"] },
    { label: "WINE WHITE DRY", aliases: ["WHITE WINE BOTTLE"] },
  ]],
  ["LIQUORS + MORE", []],
  ["BRANDY", [
    { label: "CAPE STARS", aliases: ["CAPE STARS BRANDY BOTTLE"] },
    { label: "PREMIER", aliases: ["PREMIER BRANDY BOTTLE"] },
    { label: "KLIPDRIFT", aliases: ["KLIPDRIFT BRANDY BOTTLE"] },
    { label: "KWV 3 YRS", aliases: ["KWV 3 YEARS BRANDY BOTTLE"] },
    { label: "KWV 5 YRS", aliases: ["KWV 5 YEARS BRANDY BOTTLE"] },
  ]],
  ["GIN", [
    { label: "CAPE STARS", aliases: ["CAPE STARS GIN BOTTLE"] },
    { label: "MALAWI GIN", aliases: ["MALAWI GIN BOTTLE"] },
  ]],
  ["WHISKEY", [
    { label: "CAPE STARS", aliases: ["CAPE STARS WHISKEY BOTTLE"] },
    { label: "J & B", aliases: ["J&B WHISKEY BOTTLE"] },
    { label: "JAMESON", aliases: ["JAMESON BOTTLE"] },
    { label: "JACK DANIELS", aliases: ["JACK DANIELS BOTTLE"] },
  ]],
  ["VODKA", [
    { label: "CAPE STARS", aliases: ["CAPE STARS VODKA BOTTLE"] },
    { label: "MALAWI VODKA", aliases: ["MALAWI VODKA BOTTLE"] },
    { label: "ABSOLUT", aliases: ["ABSOLUT VODKA BOTTLE"] },
    { label: "SMIRNOFF", aliases: ["SMIRNOFF VODKA BOTTLE"] },
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

    stockItems.forEach(({ label, aliases }) => {
      const item = resolveItem(input.items, exact, label, aliases);
      let opening: ExcelJS.CellValue = null;
      let purchases: ExcelJS.CellValue = null;
      let usage: ExcelJS.CellValue = null;

      if (item) {
        const summary = summarizeStock(item, input.movements, input.ledgerMovements);
        opening = metricCell(summary.opening);
        purchases = metricCell(summary.purchase);
        usage = metricCell(summary.usage);
      } else {
        const menuQty = countMenuSales(label, input.sales);
        if (menuQty > 0) {
          usage = menuQty;
        }
      }

      const r = ws.addRow([label, opening, purchases, usage, null, null, null]);

      for (let c = 1; c <= 7; c++) {
        r.getCell(c).border = BORDER_THIN;
      }

      const rowNum = r.number;
      r.getCell(5).value = {
        formula: `=IF(AND(B${rowNum}="",C${rowNum}="",D${rowNum}=""),"",B${rowNum}+C${rowNum}-D${rowNum})`,
      };
      r.getCell(5).numFmt = "#,##0.00";
      r.getCell(7).value = {
        formula: `=IF(OR(F${rowNum}="",E${rowNum}=""),"",F${rowNum}-E${rowNum})`,
      };
      r.getCell(7).numFmt = "#,##0.00";

      [2, 3, 4, 6].forEach((c) => {
        r.getCell(c).numFmt = "#,##0.00";
      });
    });
  });

  return wb;
}
