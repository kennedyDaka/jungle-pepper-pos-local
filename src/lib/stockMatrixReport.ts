import ExcelJS from "exceljs";
import { fmtQty } from "@/lib/format";
import { fmtServingQty, servingLabel, servingQty, wholeServingQty } from "@/lib/beverage";
import type { ReportRow } from "@/lib/xlsxReport";

export type MatrixItem = {
  id: string;
  name: string;
  qty_on_hand?: number | string | null;
  stock_type?: string | null;
  bottle_ml?: number | string | null;
  shot_ml?: number | string | null;
  units?: { code?: string | null } | null;
};

export type MatrixMovement = {
  item_id?: string | null;
  type?: string | null;
  qty: number;
  qty_before?: number | null;
  qty_after?: number | null;
  created_at: string;
  invoice_no?: string | null;
  menu_item_names?: string | null;
  destination?: string | null;
  source_detail?: string | null;
  source_label?: string | null;
  production_ref?: string | null;
  expense_ref?: string | null;
  expense_category?: string | null;
  supplier_name?: string | null;
  items?: {
    name?: string | null;
    bottle_ml?: number | string | null;
    shot_ml?: number | string | null;
    units?: { code?: string | null } | null;
  } | null;
};

export type MatrixOrder = {
  id: string;
  created_at: string;
  physical_order_no?: string | null;
  order_items?: Array<{
    qty: number;
    menu_items?: { name?: string | null } | null;
  }>;
};

type MatrixRowDef =
  | { kind: "section"; label: string; c?: string; d?: string }
  | { kind: "stock"; label: string; aliases?: string[]; highlight?: boolean }
  | { kind: "menu"; label: string; menuAliases: string[]; highlight?: boolean };

type DrinkRowDef =
  | { kind: "section"; label: string }
  | { kind: "stock"; label: string; aliases: string[] };

export type StockMatrixInput = {
  date: string;
  generatedAt?: Date;
  branchLabel?: string;
  items: MatrixItem[];
  movements: MatrixMovement[];
  ledgerMovements: MatrixMovement[];
  sales: MatrixOrder[];
};

export type StockSummary = {
  item?: MatrixItem;
  opening: number;
  purchase: number;
  usage: number;
  expected: number;
  closing: number;
  missing: number;
  details: string;
};

const FOOD_ROWS: MatrixRowDef[] = [
  { kind: "section", label: "C H I C K E N", c: "IN", d: "USE" },
  { kind: "stock", label: "FRANGO FULL 1.2 (Kg)", aliases: ["CHICKEN FRANGO FULL 1.2KG"] },
  { kind: "stock", label: "FRANGO HALF (600g)", aliases: ["FRANGO HALF (600G)"], highlight: true },
  {
    kind: "stock",
    label: "FILLET TRAYS (400/500g)",
    aliases: ["FILLET TRAYS (500G)"],
    highlight: true,
  },
  { kind: "stock", label: "PIZZA PKTS (80g)", aliases: ["PIZZA PKTS (80G)"], highlight: true },
  { kind: "stock", label: "BURGER (120g)", aliases: ["BURGER (120G)"], highlight: true },
  { kind: "section", label: "R U M P" },
  {
    kind: "stock",
    label: "SLICED (1Kg)",
    aliases: ["RUMP SLICED (1KG)", "SLICED 120G"],
    highlight: true,
  },
  {
    kind: "stock",
    label: "PREGOS/BITOQUES (120g)",
    aliases: ["PREGOS/BITOQUES (80G)", "PREGOS/BITOQUES (120G)"],
    highlight: true,
  },
  { kind: "section", label: "M I N C E " },
  { kind: "stock", label: "BULK (1Kg)", aliases: ["MINCE BULK (1KG)"], highlight: true },
  { kind: "stock", label: "BURGERS (120g)", aliases: ["BURGERS (120G)"], highlight: true },
  {
    kind: "stock",
    label: "PIZZA PKTS & BOLOG (80g)",
    aliases: ["PIZZA PKTS & BOLOG (80G)"],
    highlight: true,
  },
  { kind: "section", label: "C A M A R A O" },
  { kind: "stock", label: "CAMARAO BOX (Qty)", aliases: ["CAMARAO BOX PKTS"], highlight: true },
  {
    kind: "stock",
    label: "CAMARAO HALF (pkt 6)",
    aliases: ["CAMARAO HALF (PKT6)"],
    highlight: true,
  },
  {
    kind: "stock",
    label: "CAMARAO PASTA PKTS (80g)",
    aliases: ["CAMARAO PASTA PKTS (80G)"],
    highlight: true,
  },
  { kind: "section", label: "C H E E S E" },
  { kind: "stock", label: "BLOCK (Qty)", aliases: ["CHEESE BLOCK QTY"] },
  { kind: "stock", label: "BLOCK (Kg)", aliases: ["CHEESE BLOCK"], highlight: true },
  {
    kind: "stock",
    label: "PIZZA CHEESE PKTS (120g)",
    aliases: ["CHEESE PIZZA PKTS (120G)"],
    highlight: true,
  },
  {
    kind: "stock",
    label: "CHEESE BURGER/LOAF (40g)",
    aliases: ["CHEESE BURGER PKTS (40G)"],
    highlight: true,
  },
  { kind: "stock", label: "MILK (500g)", aliases: ["MILK"], highlight: true },
  { kind: "stock", label: "EGGS (single)", aliases: ["EGGS"], highlight: true },
  { kind: "section", label: "F L O U R  /  D O U G H" },
  {
    kind: "stock",
    label: "FLOUR BAG (Kg)",
    aliases: ["FLOUR BAG", "FLOUR / DOUGH FLOUR BAG"],
    highlight: true,
  },
  {
    kind: "stock",
    label: "DOUGH PIZZA BASES (Thin)",
    aliases: ["DOUGH PIZZA BASES THIN"],
    highlight: true,
  },
  {
    kind: "stock",
    label: "DOUGH PIZZA BASES (Thick)",
    aliases: ["DOUGH PIZZA BASES THICK"],
    highlight: true,
  },
  { kind: "stock", label: "MAIZE FLOUR (Kg)", aliases: ["MAIZE FLOUR"], highlight: true },
  { kind: "section", label: "B R E A D" },
  {
    kind: "stock",
    label: "BURGER (6 each pkt)",
    aliases: ["BURGER BUNS", "BREAD BURGER PKTS"],
    highlight: true,
  },
  { kind: "stock", label: "LOAF GARLIC", aliases: ["LOAF PKTS"], highlight: true },
  { kind: "section", label: "R I C E" },
  { kind: "stock", label: "BULK (Kg)", aliases: ["RICE BULK"] },
  { kind: "stock", label: "MARISCO PKTS (200g)", aliases: ["MARISCO PKTS"] },
  {
    kind: "stock",
    label: "RICE COOKED(Cont=3.200g) (1Kg)",
    aliases: ["RICE COOKER"],
  },
  { kind: "stock", label: "SALT (Kg)", aliases: ["SALT"] },
  { kind: "stock", label: "SUGAR (Kg)", aliases: ["SUGAR"] },
  { kind: "section", label: "O I L S  /  S A U C E S" },
  { kind: "stock", label: "COOKING OIL BULK (L)", aliases: ["COOKING OIL BULK"] },
  { kind: "stock", label: "BOTTLE KITCHEN (1L)", aliases: ["BOTTLE KITCHEN (1L)"] },
  { kind: "stock", label: "FRYER  (Full takes 4L)", aliases: ["FRYER OIL"] },
  { kind: "section", label: "V E G E T A B L E S" },
  { kind: "stock", label: "POTATOES BULK (Kg)", aliases: ["POTATOES BULK"], highlight: true },
  { kind: "stock", label: "CHIPS PEELED (Kg)", aliases: ["CHIPS PEELED"], highlight: true },
  { kind: "stock", label: "ONIONS (Kg)", aliases: ["ONIONS"] },
  { kind: "stock", label: "GARLIC FULL (Kg)", aliases: ["GARLIC FULL"] },
  { kind: "stock", label: "GARLIC GRATED (g)", aliases: ["GARLIC GRATED"] },
  { kind: "stock", label: "TOMATO FRESH (Kg)", aliases: ["TOMATO FRESH"] },
  { kind: "section", label: "P A C K A G I N G" },
  { kind: "stock", label: "PIZZA BOX (Qty)", aliases: ["PIZZA BOX"] },
  { kind: "stock", label: "WHITE SMALL BOX", aliases: ["WHITE SMALL BOX"] },
  { kind: "stock", label: "WHITE LARGE BOX", aliases: ["WHITE LARGE BOX"] },
  { kind: "stock", label: "FOIL", aliases: ["FOIL CUPS"] },
  { kind: "stock", label: "CUPS", aliases: ["FOIL CUPS"] },
  { kind: "stock", label: "BLACK JUMBOS", aliases: ["BLACK JUMBOS PKTS"] },
  { kind: "section", label: "C H A R C O A L / F I R E W O O D" },
  { kind: "stock", label: "CHARCOAL Kg", aliases: ["CHARCOAL"] },
  { kind: "stock", label: "FIREWOOD (pieces)", aliases: ["FIREWOOD"] },
  { kind: "section", label: "SWEET DESERTS" },
  { kind: "stock", label: "CHOCOLATE CAKE", aliases: ["CHOCOLATE CAKE"], highlight: true },
  { kind: "menu", label: "PANCAKES", menuAliases: ["Pancakes"] },
  { kind: "menu", label: "PANCAKES ICECREAM", menuAliases: ["Pancakes with Ice Cream"] },
  { kind: "stock", label: "ICE CREAM", aliases: ["ICE CREAM"], highlight: true },
  { kind: "stock", label: "OREO", aliases: ["OREO ICE CREAM BASE", "OREO"], highlight: true },
  { kind: "stock", label: "CARAMEL", aliases: ["CARAMEL"], highlight: true },
  { kind: "stock", label: "BELEM", aliases: ["PASTEL DE BELEM"], highlight: true },
  { kind: "section", label: "HOT DRINKS" },
  { kind: "menu", label: "CAPUCCINO", menuAliases: ["Italian Cappuccino"] },
  { kind: "menu", label: "CAPUCCINO BRAZIL", menuAliases: ["Brazilian Cappuccino"] },
  { kind: "menu", label: "KIDDOCCINO", menuAliases: ["Kiddoccino"] },
  { kind: "menu", label: "ESPRESSO (BICA)", menuAliases: ["Bica Espresso"] },
  { kind: "menu", label: "RAILWAY ", menuAliases: ["Railway Espresso Bombom"] },
  { kind: "menu", label: "MACCHIATO", menuAliases: ["Macchiato"] },
  { kind: "menu", label: "PINGO ", menuAliases: ["Pingo"] },
  { kind: "menu", label: "BABYCHINO", menuAliases: ["Babychino"] },
  { kind: "menu", label: "LATTE (GALAO)", menuAliases: ["Galao Caffe Latte"] },
  { kind: "menu", label: "HOT CHOCOLATE", menuAliases: ["Hot Chocolate"] },
  { kind: "menu", label: "SUBMARINE", menuAliases: ["Submarine"] },
  { kind: "menu", label: "CHOCACHINO", menuAliases: ["Chocachino"] },
  { kind: "menu", label: "MILKSHAKES", menuAliases: ["Milkshake"] },
  { kind: "menu", label: "DECAFF", menuAliases: ["Decaff"] },
  { kind: "menu", label: "FILTER COFFEE", menuAliases: ["Filter Coffee"] },
  { kind: "menu", label: "MALAWI TEA", menuAliases: ["Malawian Tea"] },
  { kind: "menu", label: "EARL GREY", menuAliases: ["Earl Grey Tea"] },
  { kind: "menu", label: "ROOIBOS", menuAliases: ["Rooibos Tea"] },
  { kind: "menu", label: "CARIOCA LIMAO", menuAliases: ["Carioca de Limao"] },
  { kind: "menu", label: "HERBAL TEAS", menuAliases: ["Herbal Teas"] },
  { kind: "menu", label: "ICE TEA / HIBISCUS", menuAliases: ["Ice Tea", "Hibiscus"] },
];

const DRINK_ROWS: DrinkRowDef[] = [
  { kind: "section", label: "W I N E S - G L A S S" },
  {
    kind: "stock",
    label: "WINE RED DRY (DRODSTY)",
    aliases: ["DROSTDY WINE BOTTLE", "DRODSTY WINE BOTTLE"],
  },
  { kind: "stock", label: "WINE RED DRY (OVERMEER)", aliases: ["OVERMEER WINE BOTTLE"] },
  { kind: "stock", label: "WINE RED SWEET", aliases: ["RED SWEET WINE BOTTLE"] },
  { kind: "stock", label: "WINE WHITE DRY", aliases: ["WHITE WINE BOTTLE"] },
  { kind: "section", label: "B E E R S" },
  { kind: "stock", label: "CHILL", aliases: ["CHILL BEER"] },
  { kind: "stock", label: "GREEN", aliases: ["GREEN BEER"] },
  { kind: "stock", label: "CASTEL", aliases: ["CASTEL BEER"] },
  { kind: "stock", label: "SPECIAL", aliases: ["SPECIAL BEER"] },
  { kind: "stock", label: "KUCHE KUCHE", aliases: ["KUCHE KUCHE BEER"] },
  { kind: "stock", label: "SAPITWA", aliases: ["SAPITWA BEER"] },
  { kind: "stock", label: "POMME BREEZE (CIDER)", aliases: ["POME BREEZE CIDER"] },
  { kind: "section", label: "L I Q U O R S   +   M O R E " },
  { kind: "section", label: "B R A N D Y" },
  { kind: "stock", label: "CAPE STARS", aliases: ["CAPE STARS BRANDY BOTTLE"] },
  { kind: "stock", label: "PREMIER", aliases: ["PREMIER BRANDY BOTTLE"] },
  { kind: "stock", label: "KLIPDRIFT", aliases: ["KLIPDRIFT BRANDY BOTTLE"] },
  { kind: "stock", label: "KWV 3 YRS", aliases: ["KWV 3 YEARS BRANDY BOTTLE"] },
  { kind: "stock", label: "KWV 5 YRS    ??", aliases: ["KWV 5 YEARS BRANDY BOTTLE"] },
  { kind: "section", label: "G I N" },
  { kind: "stock", label: "CAPE STARS", aliases: ["CAPE STARS GIN BOTTLE"] },
  { kind: "stock", label: "MALAWI GIN", aliases: ["MALAWI GIN BOTTLE"] },
  { kind: "section", label: "R U M " },
  { kind: "stock", label: "CAPTAIN MORGAN", aliases: ["CAPTAIN MORGAN BOTTLE"] },
  { kind: "stock", label: "BACARDI", aliases: ["BACARDI BOTTLE"] },
  { kind: "stock", label: "ANCIENT RUM (COCONUT)", aliases: ["ANCIENT RUM COCONUT BOTTLE"] },
  { kind: "section", label: "W H I S K E Y" },
  { kind: "stock", label: "CAPE STARS", aliases: ["CAPE STARS WHISKEY BOTTLE"] },
  { kind: "stock", label: "J & B", aliases: ["J&B WHISKEY BOTTLE"] },
  { kind: "stock", label: "JAMESON", aliases: ["JAMESON BOTTLE"] },
  { kind: "stock", label: "RED LABEL", aliases: ["JOHNNIE WALKER RED LABEL"] },
  { kind: "stock", label: "JACK DANIELS", aliases: ["JACK DANIELS BOTTLE"] },
  { kind: "section", label: "V O D K A" },
  { kind: "stock", label: "CAPE STARS", aliases: ["CAPE STARS VODKA BOTTLE"] },
  { kind: "stock", label: "MALAWI VODKA", aliases: ["MALAWI VODKA BOTTLE"] },
  { kind: "stock", label: "ABSOLUT", aliases: ["ABSOLUT VODKA BOTTLE"] },
  { kind: "stock", label: "SMIRNOFF", aliases: ["SMIRNOFF VODKA BOTTLE"] },
  { kind: "stock", label: "TEQUILA SILVER", aliases: ["TEQUILA SILVER BOTTLE"] },
  { kind: "stock", label: "TEQUILA GOLD", aliases: ["TEQUILA GOLD BOTTLE"] },
  { kind: "stock", label: "MARTINI RED", aliases: ["MARTINI RED BOTTLE"] },
  { kind: "stock", label: "JAGERMEISTER", aliases: ["JAGERMEISTER BOTTLE"] },
  { kind: "stock", label: "PORTO WINE", aliases: ["PORTO WINE BOTTLE"] },
  { kind: "stock", label: "AMARULA", aliases: ["AMARULA BOTTLE"] },
  { kind: "section", label: "S O F T   D R I N K S" },
  { kind: "stock", label: "WATER", aliases: ["WATER BOTTLE"] },
  { kind: "stock", label: "COKE", aliases: ["COKE BOTTLE/CAN"] },
  { kind: "stock", label: "FANTA ORANGE", aliases: ["FANTA ORANGE BOTTLE/CAN"] },
  { kind: "stock", label: "FANTA PINEAPPLE", aliases: ["FANTA PINEAPPLE BOTTLE/CAN"] },
  { kind: "stock", label: "FANTA PASSION", aliases: ["FANTA PASSION BOTTLE/CAN"] },
  { kind: "stock", label: "SPRITE", aliases: ["SPRITE BOTTLE/CAN"] },
  { kind: "stock", label: "CHERRY PLUM", aliases: ["CHERRY PLUM BOTTLE/CAN"] },
  { kind: "stock", label: "COCOPINA", aliases: ["COCOPINA BOTTLE/CAN"] },
  { kind: "stock", label: "GINGER SOBO", aliases: ["GINGER SOBO BOTTLE/CAN"] },
  { kind: "stock", label: "GINGER ALE CAN", aliases: ["GINGER ALE BOTTLE/CAN"] },
  { kind: "stock", label: "TONIC CAN", aliases: ["TONIC BOTTLE/CAN"] },
  { kind: "stock", label: "SODA WATER CAN", aliases: ["SODA WATER BOTTLE/CAN"] },
  { kind: "stock", label: "FRESH JUICES", aliases: ["FRESH JUICES"] },
  { kind: "stock", label: "BOX JUICES", aliases: ["BOX JUICE"] },
  { kind: "stock", label: "LIME CORDIAL", aliases: ["LIME CORDIAL"] },
  { kind: "stock", label: "SOBO ORANGE", aliases: ["SOBO ORANGE BOTTLE/CAN"] },
];

export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " AND ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\bAND\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dateTitle(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const label = new Date(year, (month || 1) - 1, day || 1).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
  return `DATE ${label.toUpperCase()}`;
}

export function itemIndex(items: MatrixItem[]) {
  const exact = new Map<string, MatrixItem>();
  items.forEach((item) => exact.set(normalizeName(item.name), item));
  return exact;
}

export function resolveItem(
  items: MatrixItem[],
  exact: Map<string, MatrixItem>,
  label: string,
  aliases: string[] = [],
) {
  const candidates = [...aliases, label];
  for (const candidate of candidates) {
    const found = exact.get(normalizeName(candidate));
    if (found) return found;
  }

  for (const candidate of candidates) {
    const key = normalizeName(candidate);
    const found = items.find((item) => {
      const itemKey = normalizeName(item.name);
      return itemKey === key || itemKey.includes(key) || key.includes(itemKey);
    });
    if (found) return found;
  }

  return undefined;
}

function orderRef(order: MatrixOrder) {
  return order.physical_order_no || order.id.slice(0, 8).toUpperCase();
}

function movementRef(movement: MatrixMovement) {
  return (
    movement.invoice_no ||
    movement.production_ref ||
    movement.expense_ref ||
    movement.source_label ||
    ""
  );
}

function movementDestination(movement: MatrixMovement) {
  return (
    movement.menu_item_names ||
    movement.destination ||
    movement.source_detail ||
    movement.supplier_name ||
    movement.expense_category ||
    ""
  );
}

function compactDetails(details: string[]) {
  return Array.from(new Set(details.map((detail) => detail.trim()).filter(Boolean))).join("; ");
}

function stockDetails(movements: MatrixMovement[]) {
  return compactDetails(
    movements.map((movement) => {
      const ref = movementRef(movement);
      const destination = movementDestination(movement);
      const type = movement.type && movement.type !== "sale" ? ` ${movement.type}` : "";
      return [ref, destination ? `${destination}${type}` : type.trim()].filter(Boolean).join(": ");
    }),
  );
}

export function menuSalesSummary(row: Extract<MatrixRowDef, { kind: "menu" }>, orders: MatrixOrder[]) {
  const aliases = new Set(row.menuAliases.map(normalizeName));
  let qty = 0;
  const details: string[] = [];

  orders.forEach((order) => {
    order.order_items?.forEach((line) => {
      const itemName = line.menu_items?.name ?? "";
      if (!aliases.has(normalizeName(itemName))) return;
      const lineQty = Number(line.qty) || 0;
      qty += lineQty;
      details.push(`${orderRef(order)}: ${itemName} x${fmtQty(lineQty)}`);
    });
  });

  return { qty, details: compactDetails(details) };
}

function numeric(value: unknown) {
  return Number(value) || 0;
}

export function summarizeStock(
  item: MatrixItem | undefined,
  periodMovements: MatrixMovement[],
  ledgerMovements: MatrixMovement[],
): StockSummary {
  if (!item) {
    return {
      opening: 0,
      purchase: 0,
      usage: 0,
      expected: 0,
      closing: 0,
      missing: 0,
      details: "",
    };
  }

  const period = periodMovements.filter((movement) => movement.item_id === item.id);
  const ledger = ledgerMovements.filter((movement) => movement.item_id === item.id);
  const periodNet = period.reduce((sum, movement) => sum + numeric(movement.qty), 0);
  const ledgerNet = ledger.reduce((sum, movement) => sum + numeric(movement.qty), 0);
  const closing = numeric(item.qty_on_hand);
  const opening = closing - ledgerNet;
  const purchase = period.reduce(
    (sum, movement) => sum + (numeric(movement.qty) > 0 ? numeric(movement.qty) : 0),
    0,
  );
  const usage = Math.abs(
    period.reduce(
      (sum, movement) => sum + (numeric(movement.qty) < 0 ? numeric(movement.qty) : 0),
      0,
    ),
  );
  const expected = opening + periodNet;
  const missing = expected - closing;

  return {
    item,
    opening,
    purchase,
    usage,
    expected,
    closing,
    missing,
    details: stockDetails(period.filter((movement) => numeric(movement.qty) < 0)),
  };
}

export function asNumberOrBlank(value: number) {
  return Math.abs(value) <= 0.000001 ? "" : Number(value.toFixed(3));
}

export function metricCell(value: number) {
  return Math.abs(value) <= 0.000001 ? "" : Number(value.toFixed(3));
}

function beverageMetric(value: number, item?: MatrixItem) {
  const servings = servingQty(value, item ?? null);
  if (servings === null) return metricCell(value);
  return wholeServingQty(servings);
}

function beverageUnit(item?: MatrixItem) {
  const servings = servingQty(1, item ?? null);
  return servings === null ? item?.units?.code || "" : servingLabel(item ?? null, servings);
}

function previewValue(value: string | number) {
  return value === "" ? "" : value;
}

function foodRows(input: StockMatrixInput): ReportRow[] {
  const exact = itemIndex(input.items);
  return FOOD_ROWS.flatMap((row): ReportRow[] => {
    if (row.kind === "section") {
      return [{ Sheet: "OPEN-CLOSE FOOD", Item: row.label }];
    }
    if (row.kind === "menu") {
      const sales = menuSalesSummary(row, input.sales);
      return [
        {
          Sheet: "OPEN-CLOSE FOOD",
          Item: row.label,
          Open: "",
          Purchase: "",
          Sales: asNumberOrBlank(sales.qty),
          Expected: "",
          Close: "",
          Missing: "",
          Details: sales.details,
        },
      ];
    }

    const item = resolveItem(input.items, exact, row.label, row.aliases);
    const summary = summarizeStock(item, input.movements, input.ledgerMovements);
    return [
      {
        Sheet: "OPEN-CLOSE FOOD",
        Item: row.label,
        Open: previewValue(metricCell(summary.opening)),
        Purchase: previewValue(metricCell(summary.purchase)),
        Sales: previewValue(metricCell(summary.usage)),
        Expected: previewValue(metricCell(summary.expected)),
        Close: previewValue(metricCell(summary.closing)),
        Missing: previewValue(asNumberOrBlank(summary.missing)),
        Details: summary.details,
      },
    ];
  });
}

function drinkRows(input: StockMatrixInput): ReportRow[] {
  const exact = itemIndex(input.items);
  return DRINK_ROWS.flatMap((row): ReportRow[] => {
    if (row.kind === "section") return [{ Sheet: "OPEN-CLOSE DRINKS", Item: row.label }];
    const item = resolveItem(input.items, exact, row.label, row.aliases);
    const summary = summarizeStock(item, input.movements, input.ledgerMovements);
    return [
      {
        Sheet: "OPEN-CLOSE DRINKS",
        Item: row.label,
        Open: previewValue(beverageMetric(summary.opening, item)),
        "T/A": previewValue(beverageMetric(summary.usage, item)),
        Purchase: previewValue(beverageMetric(summary.purchase, item)),
        Close: previewValue(beverageMetric(summary.closing, item)),
        Unit: beverageUnit(item),
      },
    ];
  });
}

function applyBaseSheetStyle(worksheet: ExcelJS.Worksheet, columns: number) {
  worksheet.properties.defaultRowHeight = 18;
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > columns) return;
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9D9D9" } },
        left: { style: "thin", color: { argb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
        right: { style: "thin", color: { argb: "FFD9D9D9" } },
      };
      cell.alignment = { vertical: "middle", wrapText: colNumber === columns };
      if (typeof cell.value === "number") cell.numFmt = "General";
    });
  });
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.height = 20;
  row.eachCell((cell) => {
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}

function styleSection(row: ExcelJS.Row, colCount: number) {
  row.font = { bold: true };
  row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  for (let col = 1; col <= colCount; col += 1) {
    row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  }
}

function styleFoodWorksheet(worksheet: ExcelJS.Worksheet) {
  worksheet.columns = [
    { width: 36.7 },
    { width: 8.5 },
    { width: 10.5 },
    { width: 10.5 },
    { width: 11.5 },
    { width: 10.5 },
    { width: 10.5 },
    { width: 64 },
  ];
  worksheet.autoFilter = "A1:H1";
  applyBaseSheetStyle(worksheet, 8);
}

function styleDrinkWorksheet(worksheet: ExcelJS.Worksheet) {
  worksheet.columns = [
    { width: 36.3 },
    { width: 10.5 },
    { width: 10.5 },
    { width: 10.5 },
    { width: 10.5 },
  ];
  worksheet.autoFilter = "A1:E1";
  applyBaseSheetStyle(worksheet, 5);
}

function addFoodSheet(workbook: ExcelJS.Workbook, input: StockMatrixInput) {
  const worksheet = workbook.addWorksheet("OPEN-CLOSE FOOD");
  worksheet.addRow([
    dateTitle(input.date),
    "OPEN",
    "PURCHASE",
    "SALES",
    "EXPECTED",
    "CLOSE",
    "MISSING",
    "detailes",
  ]);
  styleHeader(worksheet.getRow(1));

  const exact = itemIndex(input.items);
  FOOD_ROWS.forEach((row) => {
    if (row.kind === "section") {
      const sectionRow = worksheet.addRow([
        row.label,
        "",
        row.c ?? "",
        row.d ?? "",
        "",
        "",
        "",
        "",
      ]);
      styleSection(sectionRow, 8);
      return;
    }

    if (row.kind === "menu") {
      const sales = menuSalesSummary(row, input.sales);
      const dataRow = worksheet.addRow([
        row.label,
        "",
        "",
        asNumberOrBlank(sales.qty),
        "",
        "",
        "",
        sales.details,
      ]);
      if (row.highlight)
        dataRow.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFFF00" },
        };
      return;
    }

    const item = resolveItem(input.items, exact, row.label, row.aliases);
    const summary = summarizeStock(item, input.movements, input.ledgerMovements);
    const dataRow = worksheet.addRow([
      row.label,
      metricCell(summary.opening),
      metricCell(summary.purchase),
      metricCell(summary.usage),
      metricCell(summary.expected),
      metricCell(summary.closing),
      asNumberOrBlank(summary.missing),
      summary.details,
    ]);
    if (row.highlight)
      dataRow.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFF00" },
      };
    if (Math.abs(summary.missing) > 0.000001) {
      dataRow.getCell(7).font = { color: { argb: "FFB91C1C" }, bold: true };
    }
  });

  styleFoodWorksheet(worksheet);
}

function addDrinkSheet(workbook: ExcelJS.Workbook, input: StockMatrixInput) {
  const worksheet = workbook.addWorksheet("OPEN-CLOSE DRINKS");
  worksheet.addRow([dateTitle(input.date), "OPEN ", "T/A", "PURCHASE", "CLOSE"]);
  styleHeader(worksheet.getRow(1));

  const exact = itemIndex(input.items);
  DRINK_ROWS.forEach((row) => {
    if (row.kind === "section") {
      const sectionRow = worksheet.addRow([row.label, "", "", "", ""]);
      styleSection(sectionRow, 5);
      return;
    }

    const item = resolveItem(input.items, exact, row.label, row.aliases);
    const summary = summarizeStock(item, input.movements, input.ledgerMovements);
    worksheet.addRow([
      row.label,
      beverageMetric(summary.opening, item),
      beverageMetric(summary.usage, item),
      beverageMetric(summary.purchase, item),
      beverageMetric(summary.closing, item),
    ]);
  });

  styleDrinkWorksheet(worksheet);
}

export function buildStockMatrixPreviewRows(input: StockMatrixInput): ReportRow[] {
  return [...foodRows(input), ...drinkRows(input)];
}

export function buildStockMatrixWorkbook(input: StockMatrixInput) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jungle Pepper POS";
  workbook.company = "Jungle Pepper";
  workbook.subject = "Daily stock matrix";
  workbook.title = `Jungle Pepper Stock Matrix ${input.date}`;
  workbook.created = input.generatedAt ?? new Date();
  addFoodSheet(workbook, input);
  addDrinkSheet(workbook, input);
  return workbook;
}

export function stockMatrixFilename(date: string) {
  return `stock-matrix-${date}.xlsx`;
}
