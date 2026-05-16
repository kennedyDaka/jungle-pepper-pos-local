import * as XLSX from "xlsx";

export type ReportCell = string | number | boolean | null | undefined;
export type ReportRow = Record<string, ReportCell>;

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
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRowIndex, c: 0 },
      e: { r: aoa.length - 1, c: table.columns.length - 1 },
    }),
  };

  XLSX.utils.book_append_sheet(wb, ws, cleanSheetName(sheetName));
}

export function writeReportWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}
