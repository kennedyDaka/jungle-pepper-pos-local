import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "@/assets/jungle-pepper-logo.png";
import type { ReportCell, ReportRow } from "@/lib/xlsxReport";

type ExportMeta = {
  title: string;
  filename: string;
  rangeLabel?: string;
  branchLabel?: string;
  filters?: Record<string, ReportCell>;
};

function valueForExport(value: ReportCell) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
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

function normalizedRows(rows: ReportRow[]) {
  return rows.length ? rows : [{ Message: "No records for this period" }];
}

export function exportRowsCsv(meta: ExportMeta, rows: ReportRow[]) {
  const sourceRows = normalizedRows(rows);
  const columns = collectColumns(sourceRows);
  const metadata = [
    ["Jungle Pepper"],
    [meta.title],
    ["Generated", new Date().toLocaleString()],
    meta.branchLabel ? ["Branch", meta.branchLabel] : [],
    meta.rangeLabel ? ["Period", meta.rangeLabel] : [],
    ...Object.entries(meta.filters ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, valueForExport(value)]),
    [],
  ].filter((row) => row.length);
  const table = [
    columns,
    ...sourceRows.map((row) => columns.map((column) => valueForExport(row[column]))),
  ];
  const csv = [...metadata, ...table]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = meta.filename.endsWith(".csv") ? meta.filename : `${meta.filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function exportRowsPdf(meta: ExportMeta, rows: ReportRow[]) {
  const sourceRows = normalizedRows(rows);
  const columns = collectColumns(sourceRows);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  let y = 34;

  try {
    const response = await fetch(logoUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    doc.addImage(dataUrl, "PNG", 34, 20, 42, 42);
  } catch {
    // A missing logo should not block an operational report export.
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Jungle Pepper", 86, y);
  y += 18;
  doc.setFontSize(11);
  doc.text(meta.title, 86, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const details = [
    `Generated: ${new Date().toLocaleString()}`,
    meta.rangeLabel ? `Period: ${meta.rangeLabel}` : "",
    meta.branchLabel ? `Branch: ${meta.branchLabel}` : "",
    ...Object.entries(meta.filters ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}: ${valueForExport(value)}`),
  ].filter(Boolean);
  doc.text(details.join("   |   "), 86, y, { maxWidth: 720 });

  autoTable(doc, {
    startY: 82,
    head: [columns],
    body: sourceRows.map((row) => columns.map((column) => valueForExport(row[column]))),
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [31, 81, 50], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 250, 248] },
    margin: { left: 28, right: 28 },
  });

  doc.save(meta.filename.endsWith(".pdf") ? meta.filename : `${meta.filename}.pdf`);
}

export function printRows(meta: ExportMeta, rows: ReportRow[]) {
  const sourceRows = normalizedRows(rows);
  const columns = collectColumns(sourceRows);
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=800");
  if (!printWindow) return;
  const details = [
    `<strong>Generated:</strong> ${new Date().toLocaleString()}`,
    meta.rangeLabel ? `<strong>Period:</strong> ${meta.rangeLabel}` : "",
    meta.branchLabel ? `<strong>Branch:</strong> ${meta.branchLabel}` : "",
    ...Object.entries(meta.filters ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `<strong>${key}:</strong> ${valueForExport(value)}`),
  ].filter(Boolean);
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>${meta.title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #172118; }
          h1 { margin: 0 0 4px; color: #1f5132; }
          .meta { font-size: 12px; margin-bottom: 16px; color: #4c5a50; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th { background: #1f5132; color: #fff; text-align: left; }
          th, td { border: 1px solid #d8e0da; padding: 6px; vertical-align: top; }
          tr:nth-child(even) td { background: #f7faf8; }
          @media print { body { padding: 8px; } }
        </style>
      </head>
      <body>
        <h1>Jungle Pepper</h1>
        <h2>${meta.title}</h2>
        <div class="meta">${details.join(" &nbsp; | &nbsp; ")}</div>
        <table>
          <thead><tr>${columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead>
          <tbody>
            ${sourceRows
              .map(
                (row) =>
                  `<tr>${columns
                    .map((column) => `<td>${valueForExport(row[column])}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
