import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("C:/Users/Dell/Desktop/sunday flash-report-2026-08-23_to_2026-08-23.xlsx");

console.log("=== SHEETS ===");
wb.eachSheet((ws, id) => {
  console.log(`Sheet ${id}: "${ws.name}" (${ws.rowCount} rows, ${ws.columnCount} cols)`);
});

const ws = wb.getWorksheet("Flash Report");
console.log("\n=== FLASH REPORT SHEET ===");
console.log("Column widths:");
ws.columns.forEach((col, i) => {
  console.log(`  Col ${i + 1} (${col.letter}): width=${col.width}`);
});

console.log("\n=== ALL ROWS (with formatting) ===");
ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
  console.log(`\n--- Row ${rowNumber} (height: ${row.height}) ---`);
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    let v = cell.value;
    if (v && typeof v === "object" && v.formula) v = `FORMULA:${v.formula}`;
    if (v && typeof v === "object" && v.result !== undefined) v = `RESULT:${v.result}`;
    const font = cell.font;
    const fill = cell.fill;
    const align = cell.alignment;
    const border = cell.border;
    const numFmt = cell.numFmt;
    const fontInfo = font ? `font:{bold:${font.bold},italic:${font.italic},size:${font.size},color:${font.color?.argb}}` : "";
    const fillInfo = fill?.type === "pattern" ? `fill:{fgColor:${fill.fgColor?.argb}}` : "";
    const alignInfo = align ? `align:{h:${align.horizontal},v:${align.vertical},wrap:${align.wrapText}}` : "";
    const borderInfo = border ? `border:{t:${border.top?.style},b:${border.bottom?.style},l:${border.left?.style},r:${border.right?.style}}` : "";
    console.log(`  ${cell.address}: value=${v} | ${fontInfo} | ${fillInfo} | ${alignInfo} | ${borderInfo} | numFmt=${numFmt}`);
  });
});
