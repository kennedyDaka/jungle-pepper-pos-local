import ExcelJS from "exceljs";
import logoUrl from "@/assets/jungle-pepper-logo.png";

export type ReportCell = string | number | boolean | null | undefined;
export type ReportRow = Record<string, ReportCell>;
export type ReportMatrix = ReportCell[][];
export type ReportWorkbook = ExcelJS.Workbook;

type AppendReportSheetOptions = {
  title?: string;
  rangeLabel?: string;
  branchLabel?: string;
  filters?: Record<string, ReportCell>;
  summary?: ReportRow[];
  generatedAt?: Date;
  totals?: boolean;
};

const MAX_SHEET_NAME = 31;
const MONEY_COLUMNS = new Set([
  "Amount",
  "Avg Cost",
  "Average Cost",
  "Cost",
  "Discount",
  "Gross Sales",
  "Line Total",
  "Loss Value",
  "Net Sales",
  "Net Excl VAT",
  "Profit",
  "Recipe Cost",
  "Revenue",
  "Stock Value",
  "Subtotal",
  "Total",
  "Total Value",
  "Unit Cost",
  "Value",
  "VAT 17.5%",
]);

function cleanSheetName(name: string) {
  return (
    name
      .replace(/[\\/?*[\]:]/g, " ")
      .slice(0, MAX_SHEET_NAME)
      .trim() || "Report"
  );
}

function valueForSheet(value: ReportCell) {
  if (value === null || value === undefined) return "";
  return value;
}

function collectColumns(rows: ReportRow[]) {
  const columns: string[] = [];
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!columns.includes(key)) columns.push(key);
    });
  });
  return columns.length ? columns : ["Message"];
}

function rowsToTable(rows: ReportRow[]) {
  const sourceRows = rows.length ? rows : [{ Message: "No records for this period" }];
  const columns = collectColumns(sourceRows);
  return {
    columns,
    body: sourceRows.map((row) => columns.map((column) => valueForSheet(row[column]))),
  };
}

function buildTotalsRow(columns: string[], rows: ReportRow[]) {
  if (!rows.length) return null;
  const totals = columns.map((column, index) => {
    if (index === 0) return "TOTAL";
    const values = rows.map((row) => row[column]).filter((value) => typeof value === "number");
    if (!values.length) return "";
    return values.reduce((sum, value) => sum + Number(value), 0);
  });
  return totals.some((value, index) => index > 0 && value !== "") ? totals : null;
}

function formatDataRange(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  rowCount: number,
  colCount: number,
) {
  worksheet.views = [{ state: "frozen", ySplit: startRow }];
  worksheet.autoFilter = {
    from: { row: startRow, column: 1 },
    to: { row: Math.max(startRow, rowCount), column: Math.max(1, colCount) },
  };
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5132" } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
}

function styleSheet(
  worksheet: ExcelJS.Worksheet,
  columns: string[],
  headerRow: number,
  totalsRow?: number,
) {
  worksheet.properties.defaultRowHeight = 18;
  worksheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF1F5132" } };
  worksheet.getRow(2).font = { italic: true, color: { argb: "FF647067" } };
  styleHeaderRow(worksheet.getRow(headerRow));

  if (totalsRow) {
    const row = worksheet.getRow(totalsRow);
    row.font = { bold: true };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF4EE" } };
  }

  columns.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);
    let longest = column.length;
    excelColumn.eachCell({ includeEmpty: true }, (cell) => {
      longest = Math.max(longest, String(cell.value ?? "").length);
    });
    excelColumn.width = Math.min(Math.max(longest + 2, 12), 44);
    if (MONEY_COLUMNS.has(column)) excelColumn.numFmt = "#,##0.00";
  });
}

function addMetadata(
  worksheet: ExcelJS.Worksheet,
  options: AppendReportSheetOptions,
  sheetName: string,
) {
  const generatedAt = options.generatedAt ?? new Date();
  worksheet.addRow([options.title ?? sheetName]);
  worksheet.addRow(["Generated", generatedAt.toLocaleString()]);
  if (options.branchLabel) worksheet.addRow(["Branch", options.branchLabel]);
  if (options.rangeLabel) worksheet.addRow(["Period", options.rangeLabel]);
  if (options.filters) {
    Object.entries(options.filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        worksheet.addRow([key, valueForSheet(value)]);
      }
    });
  }
  worksheet.addRow([]);
}

async function attachLogo(workbook: ExcelJS.Workbook) {
  try {
    const response = await fetch(logoUrl);
    const imageBuffer = await response.arrayBuffer();
    const imageId = workbook.addImage({ buffer: imageBuffer, extension: "png" });
    workbook.worksheets.forEach((worksheet) => {
      worksheet.addImage(imageId, {
        tl: { col: Math.max(0, Math.min(worksheet.columnCount, 7)), row: 0 },
        ext: { width: 64, height: 64 },
      });
    });
  } catch {
    // Reports still export correctly if the browser cannot fetch the bundled logo.
  }
}

export function createReportWorkbook(title: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jungle Pepper POS";
  workbook.company = "Jungle Pepper";
  workbook.subject = "Jungle Pepper POS report";
  workbook.title = title;
  workbook.created = new Date();
  return workbook;
}

export function appendReportSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  rows: ReportRow[],
  options: AppendReportSheetOptions = {},
) {
  const worksheet = workbook.addWorksheet(cleanSheetName(sheetName));
  addMetadata(worksheet, options, sheetName);

  if (options.summary?.length) {
    const summary = rowsToTable(options.summary);
    worksheet.addRow(["Summary"]);
    const summaryHeader = worksheet.addRow(summary.columns);
    styleHeaderRow(summaryHeader);
    summary.body.forEach((row) => worksheet.addRow(row));
    worksheet.addRow([]);
  }

  const table = rowsToTable(rows);
  const headerRowNumber = worksheet.rowCount + 1;
  worksheet.addRow(table.columns);
  table.body.forEach((row) => worksheet.addRow(row));

  let totalsRowNumber: number | undefined;
  const totalsRow = options.totals === false ? null : buildTotalsRow(table.columns, rows);
  if (totalsRow) {
    totalsRowNumber = worksheet.rowCount + 1;
    worksheet.addRow(totalsRow);
  }

  formatDataRange(worksheet, headerRowNumber, worksheet.rowCount, table.columns.length);
  styleSheet(worksheet, table.columns, headerRowNumber, totalsRowNumber);
}

export function appendMatrixReportSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  matrix: ReportMatrix,
  options: AppendReportSheetOptions = {},
) {
  const worksheet = workbook.addWorksheet(cleanSheetName(sheetName));
  addMetadata(worksheet, options, sheetName);

  const tableRows = matrix.length ? matrix : [["No records for this period"]];
  const headerRowNumber = worksheet.rowCount + 1;
  tableRows.forEach((row) => worksheet.addRow(row.map(valueForSheet)));
  const colCount = tableRows.reduce((max, row) => Math.max(max, row.length), 0);

  formatDataRange(worksheet, headerRowNumber, worksheet.rowCount, colCount);
  styleHeaderRow(worksheet.getRow(headerRowNumber));
  Array.from({ length: colCount }, (_, index) => worksheet.getColumn(index + 1)).forEach(
    (column) => {
      let longest = 10;
      column.eachCell({ includeEmpty: true }, (cell) => {
        longest = Math.max(longest, String(cell.value ?? "").length);
      });
      column.width = Math.min(Math.max(longest + 2, 10), 40);
    },
  );
}

export async function writeReportWorkbook(
  workbook: ExcelJS.Workbook,
  filename: string,
  options: { logo?: boolean } = {},
) {
  if (options.logo !== false) await attachLogo(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 100);
}
