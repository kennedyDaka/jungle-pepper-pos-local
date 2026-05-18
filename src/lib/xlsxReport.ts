import * as XLSX from "xlsx";

export type ReportCell = string | number | boolean | null | undefined;
export type ReportRow = Record<string, ReportCell>;
export type ReportMatrix = ReportCell[][];

type AppendReportSheetOptions = {
  title?: string;
  rangeLabel?: string;
  summary?: ReportRow[];
  generatedAt?: Date;
};

const MAX_SHEET_NAME = 31;

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

function columnWidths(columns: string[], rows: ReportRow[]) {
  return columns.map((column) => {
    const longest = rows.reduce(
      (max, row) => Math.max(max, String(valueForSheet(row[column])).length),
      column.length,
    );
    return { wch: Math.min(Math.max(longest + 2, 12), 48) };
  });
}

function matrixColumnWidths(matrix: ReportMatrix) {
  const cols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: cols }, (_, index) => {
    const longest = matrix.reduce(
      (max, row) => Math.max(max, String(valueForSheet(row[index])).length),
      0,
    );
    return { wch: Math.min(Math.max(longest + 2, 10), 36) };
  });
}

function applySheetLook(
  ws: XLSX.WorkSheet,
  headerRowIndex: number,
  rowCount: number,
  colCount: number,
) {
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRowIndex, c: 0 },
      e: { r: Math.max(headerRowIndex, rowCount - 1), c: Math.max(0, colCount - 1) },
    }),
  };
  (ws as XLSX.WorkSheet & { "!freeze"?: unknown })["!freeze"] = {
    xSplit: 0,
    ySplit: headerRowIndex + 1,
  };
}

export function createReportWorkbook(title: string) {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: title,
    Subject: "Jungle Pepper POS report",
    Author: "Jungle Pepper POS",
    Company: "Jungle Pepper",
    CreatedDate: new Date(),
  };
  return wb;
}

export function appendReportSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  rows: ReportRow[],
  options: AppendReportSheetOptions = {},
) {
  const generatedAt = options.generatedAt ?? new Date();
  const aoa: (string | number | boolean)[][] = [];

  aoa.push([options.title ?? sheetName]);
  aoa.push(["Generated", generatedAt.toLocaleString()]);
  if (options.rangeLabel) aoa.push(["Period", options.rangeLabel]);
  aoa.push([]);

  if (options.summary?.length) {
    const summary = rowsToTable(options.summary);
    aoa.push(["Summary"]);
    aoa.push(summary.columns);
    aoa.push(...summary.body);
    aoa.push([]);
  }

  const table = rowsToTable(rows);
  const headerRowIndex = aoa.length;
  aoa.push(table.columns);
  aoa.push(...table.body);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columnWidths(table.columns, rows.length ? rows : [{ Message: "" }]);
  applySheetLook(ws, headerRowIndex, aoa.length, table.columns.length);

  XLSX.utils.book_append_sheet(wb, ws, cleanSheetName(sheetName));
}

export function appendMatrixReportSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  matrix: ReportMatrix,
  options: AppendReportSheetOptions = {},
) {
  const generatedAt = options.generatedAt ?? new Date();
  const tableRows = matrix.length ? matrix : [["No records for this period"]];
  const aoa: (string | number | boolean)[][] = [];

  aoa.push([options.title ?? sheetName]);
  aoa.push(["Generated", generatedAt.toLocaleString()]);
  if (options.rangeLabel) aoa.push(["Period", options.rangeLabel]);
  aoa.push([]);

  if (options.summary?.length) {
    const summary = rowsToTable(options.summary);
    aoa.push(["Summary"]);
    aoa.push(summary.columns);
    aoa.push(...summary.body);
    aoa.push([]);
  }

  const headerRowIndex = aoa.length;
  aoa.push(...tableRows.map((row) => row.map(valueForSheet)));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = matrixColumnWidths(tableRows);
  applySheetLook(
    ws,
    headerRowIndex,
    aoa.length,
    tableRows.reduce((max, row) => Math.max(max, row.length), 0),
  );
  XLSX.utils.book_append_sheet(wb, ws, cleanSheetName(sheetName));
}

export function writeReportWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}
