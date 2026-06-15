import ExcelJS from "exceljs";

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

export interface FlashReportInput {
  reportDate: string;
  preparedBy: string;
}

function applyBorder(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).border = BORDER_THIN;
  }
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

  // ─── Title block ───
  ws.addRow(["JUNGLE PEPPER — DAILY FLASH REPORT"]).getCell(1).font = TITLE_FONT;
  ws.addRow([]);
  ws.addRow([`Date: ${input.reportDate}`]).getCell(1).font = SUBTITLE_FONT;
  ws.addRow([`Prepared By: ${input.preparedBy}`]).getCell(1).font = SUBTITLE_FONT;
  ws.addRow([]);

  // ─── Section 1: CASH & BANK FLOW SUMMARY ───
  const s1Title = ws.addRow(["1. CASH & BANK FLOW SUMMARY"]);
  s1Title.getCell(1).font = { bold: true, size: 12, underline: "single" };
  ws.addRow([]);

  const headerRow = ws.addRow([
    "Payment Method / Account",
    "Expected Deposits (POS)",
    "Statement (Deposited)",
    "Delayed Deposits",
  ]);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle" };
    cell.border = BORDER_THIN;
  });
  headerRow.height = 22;

  const paymentMethods = [
    "NB (NATIONAL BANK)",
    "STANDARD BANK",
    "CAPITAL BANK",
    "ECO BANK",
    "Airtel Money",
    "Physical Cash (Till)",
  ];

  const bankDataStartRow = ws.rowCount + 1;
  paymentMethods.forEach((method) => {
    const r = ws.addRow([method, 0, 0, null]);
    applyBorder(r, 4);
    r.getCell(2).numFmt = "#,##0";
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).value = { formula: `=C${r.number}-D${r.number}` };
    r.getCell(4).numFmt = "#,##0";
  });

  const totalsRow = ws.addRow([
    "TOTAL REVENUE",
    { formula: `=SUM(B${bankDataStartRow}:B${bankDataStartRow + 5})` },
    { formula: `=SUM(C${bankDataStartRow}:C${bankDataStartRow + 5})` },
    { formula: `=SUM(D${bankDataStartRow}:D${bankDataStartRow + 5})` },
  ]);
  totalsRow.eachCell((cell) => {
    cell.font = TOTALS_FONT;
    cell.fill = TOTALS_FILL;
    cell.border = BORDER_THIN;
    cell.numFmt = "#,##0";
  });

  // ─── Blank separator ───
  ws.addRow([]);
  ws.addRow([]);

  // ─── Section 2: HIGH-VALUE PHYSICAL STOCK COUNT ───
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
  stockHeader.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });
  stockHeader.height = 30;

  const sections: [string, string[]][] = [
    ["CHICKEN", [
      "FRANGO HALF (600g)",
      "FILLET TRAYS (400/500g)",
      "CHICK PIZZA PKTS (80g)",
      "CHICK BURGERS/BITOQUES (120g)",
    ]],
    ["RUMP", [
      "RUMP SLICED BULK (1Kg)",
      "PREGOS/BITOQUES (120g)",
    ]],
    ["MINCE", [
      "MINCE BULK (1Kg)",
      "MINCE BURGERS (120g)",
      "MINCE PIZZA PKTS & BOLOG (80g)",
    ]],
    ["CAMARAO", [
      "CAMARAO HALF (pkt 6)",
      "CAMARAO PASTA PKTS (80g)",
    ]],
    ["CHEESE", [
      "BLOCK (Qty)",
      "BLOCK (Kg)",
      "PIZZA CHEESE PKTS (120g)",
      "CHEESE BURGER/LOAF (40g)",
      "MILK (500g)",
      "MARGARINE",
    ]],
    ["FLOUR / DOUGH", [
      "FLOUR BAG (Kg)",
      "DOUGH PIZZA BASES (Thin)",
      "DOUGH PIZZA BASES (Thick)",
    ]],
    ["BREAD", [
      "BREAD BURGER (6 each pkt)",
    ]],
    ["RICE", [
      "BULK (Kg)",
      "RICE MARISCO PKTS (200g)",
      "RICE COOKED (Cont=3.200g) (1Kg)",
      "SALT (Kg)",
      "SUGAR (Kg)",
    ]],
    ["OILS / SAUCES", [
      "COOKING OIL BULK (L)",
      "SAUCE FRANGO",
      "SAUCE CAMARAO",
    ]],
    ["VEGETABLES", [
      "POTATOES BULK (Kg)",
      "GARLIC FULL (Kg)",
      "ONION (Kg)",
    ]],
    ["PACKAGING", [
      "PIZZA BOX (Qty)",
      "WHITE SMALL BOX",
      "WHITE LARGE BOX",
      "FOIL BOX",
    ]],
    ["CHARCOAL / FIREWOOD", [
      "CHARCOAL (Kg)",
      "FIREWOOD (Tonnes)",
    ]],
    ["HOT DRINKS", [
      "CAPUCCINO",
      "LATTE (GALAO)",
      "HOT CHOCOLATE",
      "SUBMARINE",
      "CHOCACHINO",
      "MILKSHAKES",
      "DECAFF",
    ]],
    ["PACKAGING", [
      "PIZZA BOX",
      "WHITE BOX (S)",
      "WHITE BOX (L)",
      "FOIL",
    ]],
    ["SOFT DRINKS", [
      "WATER",
      "COKE",
      "FANTA ORANGE",
      "FANTA PINEAPPLE",
      "FANTA PASSION",
      "SPRITE",
      "CHERRY PLUM",
      "COCOPINA",
      "GINGER SOBO",
      "GINGER ALE CAN",
    ]],
    ["BEERS", [
      "CHILL",
      "GREEN",
      "CASTEL",
      "SPECIAL",
      "KUCHE KUCHE",
      "SAPITWA",
      "POMME BREEZE (CIDER)",
    ]],
    ["WINES - GLASS", [
      "WINE RED DRY (DRODSTY)",
      "WINE RED DRY (OVERMEER)",
      "WINE RED SWEET",
      "WINE WHITE DRY",
    ]],
    ["LIQUORS + MORE", []],
    ["BRANDY", [
      "CAPE STARS",
      "PREMIER",
      "KLIPDRIFT",
      "KWV 3 YRS",
      "KWV 5 YRS",
    ]],
    ["GIN", [
      "CAPE STARS",
      "MALAWI GIN",
    ]],
    ["WHISKEY", [
      "CAPE STARS",
      "J & B",
      "JAMESON",
      "JACK DANIELS",
    ]],
    ["VODKA", [
      "CAPE STARS",
      "MALAWI VODKA",
      "ABSOLUT",
      "SMIRNOFF",
    ]],
  ];

  sections.forEach(([sectionName, items]) => {
    const sectionRow = ws.addRow([sectionName]);
    sectionRow.getCell(1).font = SECTION_FONT;
    sectionRow.height = 20;

    items.forEach((item) => {
      const r = ws.addRow([item, null, null, null, null, null, null]);
      applyBorder(r, 7);
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

export async function writeFlashReport(
  workbook: ExcelJS.Workbook,
  reportDate: string,
) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `flash-report-${reportDate}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
