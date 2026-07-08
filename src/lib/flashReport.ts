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
      { label: "CHICKEN FRANGO FULL 1.2KG", aliases: ["FRANGO FULL (1.2KG)"] },
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
    "CHEESE",
    [
      { label: "BLOCK (Qty)", aliases: ["CHEESE BLOCK QTY", "BLOCK (QTY)"] },
      { label: "BLOCK (Kg)", aliases: ["CHEESE BLOCK"] },
      { label: "PIZZA CHEESE PKTS (120g)", aliases: ["CHEESE PIZZA PKTS (120G)"] },
      { label: "CHEESE BURGER/LOAF (40g)", aliases: ["CHEESE BURGER PKTS (40G)"] },
      { label: "MILK (500g)", aliases: ["MILK"] },
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
      { label: "SUGAR (Kg)", aliases: ["SUGAR"] },
    ],
  ],
  ["PASTA", [
    { label: "SPAGHETTI (Kg)", aliases: ["SPAGHETTI"] },
    { label: "PENNE (Kg)", aliases: ["PENNE"] },
    { label: "FETTUCCINE (Kg)", aliases: ["FETTUCCINE"] },
  ]],
  ["OILS / SAUCES", [{ label: "COOKING OIL BULK (L)", aliases: ["COOKING OIL BULK"] }]],
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
  ["CHARCOAL / FIREWOOD", [{ label: "CHARCOAL (Kg)", aliases: ["CHARCOAL"] }]],
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

function stripContext(value: string): string {
  const trimmed = value.trim();
  if (/^(modifier|packaging)\s/i.test(trimmed)) return "";
  return trimmed.replace(/\s+-\s+(modifier|packaging)\s+.*$/i, "").trim();
}

function parseDishQty(value: string, fallbackQty = 1) {
  const trimmed = stripContext(value.trim());
  const match = trimmed.match(/^(.*?)(?:\s+x\s*([0-9]+(?:\.[0-9]+)?))?$/i);
  const name = (match?.[1] ?? trimmed).trim();
  const qty = match?.[2] ? Number(match[2]) : fallbackQty;
  return {
    name,
    qty: Number.isFinite(qty) && qty > 0 ? qty : fallbackQty,
  };
}

const SHORT_ITEM_NAMES: Record<string, string> = {
  // Starters
  "GARLIC LOAF": "LOAF",
  "GARLIC LOAF CHEESE": "LOAF + CHEESE",
  FOCACCIA: "FOCC",
  "FOCACCIA CHEESE": "FOCC + CHEESE",
  "GREEK SALAD": "GREEK",
  "MIXED SALAD": "MIXED",

  // Prego & Bitoques
  "PLAIN PREGO": "PREGO",
  "PREGO PIMENTO": "PIMENTO",
  "BEEF BITOQUE": "B. BITOQUE",
  "CHICKEN BITOQUE": "C. BITOQUE",

  // Frango
  "HALF CHURRASCO CHICKEN": "HALF",
  "FULL CHURRASCO CHICKEN": "FULL",

  // Pastas
  "SPAGHETTI POMODORO": "SPAGH POMO",
  "SPAGHETTI PICANTI": "SPAGH PICC",
  "SPAGHETTI BOLOGNESE": "SPAGH BOLOG",
  "SPAGHETTI CREAMY CHICKEN MUSHROOM": "SPAGH CHICK",
  "SPAGHETTI CREAMY TOMATO PRAWN": "SPAGH PRAWN",
  "PENNE POMODORO": "PENNE POMO",
  "PENNE PICANTI": "PENNE PICC",
  "PENNE BOLOGNESE": "PENNE BOLOG",
  "PENNE CREAMY CHICKEN MUSHROOM": "PENNE CHICK",
  "PENNE CREAMY TOMATO PRAWN": "PENNE PRAWN",
  "FETTUCINE POMODORO": "FETT POMO",
  "FETTUCINE PICANTI": "FETT PICC",
  "FETTUCINE BOLOGNESE": "FETT BOLOG",
  "FETTUCINE CREAMY CHICKEN MUSHROOM": "FETT CHICK",
  "FETTUCINE CREAMY TOMATO PRAWN": "FETT PRAWN",

  // Pizzas
  "KATUNDU PIZZA": "PIZZA",
  "MEXICANO PIZZA": "PIZZA",
  "PORTUGUESE CHICKEN PIZZA": "PIZZA",
  "CHICKEN MUSHROOM PIZZA": "PIZZA",
  "SWEET SOUR SAFARI PIZZA": "PIZZA",
  "MAFFIOSA PIZZA": "PIZZA",
  "PRAWN PIZZA": "PIZZA",
  "ANCHOVY PIZZA": "PIZZA",
  "VEGETARIAN PIZZA": "PIZZA",
  "VEGAN PIZZA": "PIZZA",
  "MARGARITA PIZZA": "PIZZA",
  "PICCANTI PIZZA": "PIZZA",
  "JALAPENO PIZZA": "PIZZA",
  "HUMMUS PIZZA": "PIZZA",
  "GODFATHER PIZZA": "PIZZA",
  "MEDITERRANEAN PIZZA": "PIZZA",

  // Burgers
  "JUNGLE PEPPER BURGER": "J. BURGER",
  "CHICKEN BURGER": "C. BURGER",
  "PRAWN BURGER": "PRAWN BURGER",
  "VEGGIE BURGER": "VEGGIE",

  // Chips
  "PLAIN CHIPS SMALL": "CHIPS S",
  "PLAIN CHIPS LARGE": "CHIPS L",
  "MASALA CHIPS SMALL": "MASALA S",
  "MASALA CHIPS LARGE": "MASALA L",

  // Desserts
  "CHOCOLATE CAKE": "CHOC CAKE",
  PANCAKES: "PANCAKE",
  "PANCAKES WITH ICE CREAM": "PANCAKE + ICE",
  "ICE CREAM": "ICE",
  "OREO ICE CREAM": "OREO",
  "PASTEL DE BELEM": "BELEM",

  // Hot drinks
  "ITALIAN CAPPUCCINO": "I. CAPP",
  "BRAZILIAN CAPPUCCINO": "B. CAPP",
  KIDDOCCINO: "KIDDO",
  "BICA ESPRESSO": "EXP",
  "RAILWAY ESPRESSO BOMBOM": "RAILWAY",
  CARIOCA: "CARIOCA",
  MACCHIATO: "MACC",
  PINGO: "PINGO",
  BABYCHINO: "BABY",
  "GALAO CAFFE LATTE": "GALAO",
  "HOT CHOCOLATE": "HOT CHOC",
  SUBMARINE: "SUB",
  CHOCACHINO: "CHOCA",
  "FILTER COFFEE": "FILTER",
  "MALAWIAN TEA": "M. TEA",

  // Teas
  "EARL GREY TEA": "E. GREY",
  "ROOIBOS TEA": "ROOIBOS",
  "CARIOCA DE LIMAO": "CARIOCA L",
  "HERBAL TEAS": "HERBAL",

  // Soft Drinks
  "FANTA ORANGE": "F. ORANGE",
  "FANTA PINEAPPLE": "F. PINE",
  "FANTA PASSION": "F. PASSION",
  "CHERRY PLUM": "CHERRY P",
  "GINGER SOBO": "G. SOBO",
  "GINGER ALE": "G. ALE",
  "SODA WATER": "SODA",
  "SOBO ORANGE": "S. ORANGE",
  "BOX JUICES": "BOX J",
  COCOPINA: "COCO",
  CHAPMAN: "CHAP",
  ROCKSHANDY: "ROCKY",
  "SWISS LEMONADE": "SWISS LEM",
  LEMONADE: "LEMON",
  "JUICE FRESH": "J FRESH",

  // Wine
  "RED DRY DROSTDY": "R. DRY D",
  "RED DRY OVERMEER": "R. DRY O",
  "RED SWEET": "R. SWEET",
  "WHITE WINE GLASS": "WINE G",

  // Beers & Ciders
  "KUCHE KUCHE": "KUCHE",
  "POME BREEZE": "POME",
  SAPITWA: "SAPI",

  // Gin
  "CAPE STARS GIN": "CS GIN",
  "MALAWI GIN": "M. GIN",

  // Brandy
  "CAPE STARS BRANDY": "CS BRANDY",
  "PREMIER BRANDY": "P. BRANDY",
  KLIPDRIFT: "KLIP",
  "KWV 3 YRS": "KWV 3",
  "KWV 5 YRS": "KWV 5",

  // Rum
  "CAPTAIN MORGAN": "C. MORGAN",

  // Whiskey
  "CAPE STARS WHISKEY": "CS WHISKY",
  "J B": "J+B",
  "RED LABEL": "R. LABEL",
  "JACK DANIELS": "J. DANIELS",

  // Tequila
  "TEQUILA SILVER": "T. SILVER",
  "TEQUILA GOLD": "T. GOLD",

  // Liqueurs
  "MARTINI RED": "MARTINI",
  JAGERMEISTER: "JAGER",
  "PELLEGRINI BITTERS": "P. BITTERS",

  // Vodka
  "MALAWI VODKA": "M. VODKA",

  // Seafood
  "ARROZ DE MARISCO": "RICE S/F",
  "CAMARAO 6 PRAWNS": "6 PRAWNS",
  "CAMARAO 12 PRAWNS": "12 PRAWNS",

  // Salads
  "EXTRA CHICKEN TOPPING": "CHICK TOP",
  "SALAD CHICKEN TOPPING": "CHICK TOP",
};

function soldAsLabel(name: string, _movement: MatrixMovement) {
  const key = normalizeName(name);
  return SHORT_ITEM_NAMES[key] ?? (key.includes("PIZZA") ? "PIZZA" : name);
}

function shortItemName(movement: MatrixMovement): string {
  const raw = movement.items?.name;
  if (!raw) return "";
  const key = normalizeName(raw);
  return SHORT_ITEM_NAMES[key] ?? raw;
}

function buildSoldAs(itemId: string, movements: MatrixMovement[]): string {
  const agg = new Map<string, number>();
  for (const movement of movements) {
    if (movement.item_id !== itemId) continue;
    if ((movement.qty ?? 0) >= 0) continue;

    if (!movement.type) continue;
    if (movement.type === "transfer") {
      const name = shortItemName(movement) || "TRANSFER";
      agg.set(`${name} (TRANSFER)`, (agg.get(`${name} (TRANSFER)`) ?? 0) + Math.abs(movement.qty));
      continue;
    }
    if (movement.type !== "sale") {
      const name = shortItemName(movement) || movement.type.toUpperCase();
      agg.set(`${name} (${movement.type.toUpperCase()})`, (agg.get(`${name} (${movement.type.toUpperCase()})`) ?? 0) + Math.abs(movement.qty));
      continue;
    }

    const names = (movement.menu_item_names ?? movement.destination ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const rawName of names) {
      const parsed = parseDishQty(rawName, Number(movement.order_item_qty ?? 1) || 1);
      if (!parsed.name) continue;
      const label = soldAsLabel(parsed.name, movement) + " (POS)";
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
  soldAs: string;
  isMenu?: boolean;
  kitchenOpening: number;
  kitchenPurchases: number;
  kitchenUsage: number;
  kitchenClosing: number;
  storesOpening: number;
  storesPurchases: number;
  storesUsage: number;
  storesClosing: number;
};

function resolveAndSummarize(
  items: MatrixItem[],
  label: string,
  aliases: string[],
  sales: MatrixOrder[],
  movements: MatrixMovement[],
  ledgerMovements: MatrixMovement[],
  menuAliases: string[] | undefined,
  isMenu: boolean | undefined,
): {
  stores: { item?: MatrixItem; opening: number; purchases: number; usage: number; closing: number };
  kitchen: {
    item?: MatrixItem;
    opening: number;
    purchases: number;
    usage: number;
    closing: number;
  };
  soldAsItemId?: string;
} {
  const defaultRow = { item: undefined, opening: 0, purchases: 0, usage: 0, closing: 0 };

  if (isMenu) {
    const menuUsage = countMenuSales(label, sales);
    return {
      stores: { ...defaultRow, usage: menuUsage },
      kitchen: { ...defaultRow },
    };
  }

  // Helper to compute a single location's summary
  const locSummary = (location: string) => {
    const locItems = items.filter(
      (i) => i.location === location || (!i.location && location === "stores"),
    );
    const locExact = itemIndex(locItems);
    const item = resolveItem(locItems, locExact, label, aliases);
    if (!item) return { item: undefined, opening: 0, purchases: 0, usage: 0, closing: 0 };

    const periodMovements = movements.filter((mov) => {
      if (!mov.item_id) return false;
      const matches = mov.item_id === item.id;
      if (!matches) return false;
      const movementItem = mov.items?.name === item.name;
      if (!movementItem) return matches;

      const movLocation = mov.location || mov.items?.location;
      if (movLocation && movLocation !== location) return false;
      return true;
    });

    const ledger = ledgerMovements.filter((mov) => {
      if (!mov.item_id) return false;
      const matches = mov.item_id === item.id;
      if (!matches) return false;
      const movementItem = mov.items?.name === item.name;
      if (!movementItem) return matches;

      const movLocation = mov.location || mov.items?.location;
      if (movLocation && movLocation !== location) return false;
      return true;
    });

    const summary = summarizeStock(item, periodMovements, ledger);
    return {
      item,
      opening: summary.opening,
      purchases: summary.purchase,
      usage: summary.usage,
      closing: summary.closing,
    };
  };

  const stores = locSummary("stores");
  const kitchen = locSummary("kitchen");

  return {
    stores,
    kitchen,
    soldAsItemId: kitchen.item?.id || stores.item?.id,
  };
}

function flashStockRows(input: FlashReportInput): FlashStockRow[] {
  const rows: FlashStockRow[] = [];

  STOCK_SECTIONS.forEach(([sectionName, stockItems]) => {
    stockItems.forEach(({ label, aliases, isMenu, menuAliases }) => {
      const result = resolveAndSummarize(
        input.items,
        label,
        aliases,
        input.sales,
        input.movements,
        input.ledgerMovements,
        menuAliases,
        isMenu,
      );

      const s = result.stores;
      const k = result.kitchen;

      rows.push({
        section: sectionName,
        label,
        soldAs: result.soldAsItemId ? buildSoldAs(result.soldAsItemId, input.movements) : "",
        isMenu,
        kitchenOpening: k.opening,
        kitchenPurchases: k.purchases,
        kitchenUsage: k.usage,
        kitchenClosing: k.closing,
        storesOpening: s.opening,
        storesPurchases: s.purchases,
        storesUsage: s.usage,
        storesClosing: s.closing,
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
      "K Open": stockCell(row.kitchenOpening),
      "K Pur": stockCell(row.kitchenPurchases),
      "K Sale": stockCell(row.kitchenUsage),
      "K Close": stockCell(row.kitchenClosing),
      "S Open": stockCell(row.storesOpening),
      "S Pur": stockCell(row.storesPurchases),
      "S Sale": stockCell(row.storesUsage),
      "S Close": stockCell(row.storesClosing),
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

function addExecutiveSummary(wb: ExcelJS.Workbook, input: FlashReportInput) {
  const ws = wb.addWorksheet("Executive Summary");
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 16;

  const titleRow = ws.addRow(["JUNGLE PEPPER — EXECUTIVE SUMMARY"]);
  titleRow.getCell(1).font = TITLE_FONT;
  ws.addRow([`Period: ${input.rangeLabel ?? input.reportDate}`]).getCell(1).font = SUBTITLE_FONT;
  ws.addRow([]);

  const expenses = input.expenses ?? [];
  const movements = input.movements ?? [];
  const sales = input.sales ?? [];

  function sumExpense(itemKeywords: string[]): { qty: number; cost: number } {
    let qty = 0;
    let cost = 0;
    const upperKeywords = itemKeywords.map((k) => k.toUpperCase());
    expenses.forEach((row: any) => {
      const itemName = String(row.Item ?? "").toUpperCase();
      if (upperKeywords.some((kw) => itemName.includes(kw))) {
        qty += Number(row["Stock Qty"] ?? 0);
        cost += Number(row["Line Total"] ?? 0);
      }
    });
    return { qty, cost };
  }

  function addSectionHeader(title: string) {
    ws.addRow([]);
    const r = ws.addRow([title]);
    r.getCell(1).font = { bold: true, size: 11, underline: "single" };
  }

  function addDataRow(label: string, val1: string | number, val2?: string | number) {
    const r = ws.addRow([label, val1 ?? "", val2 ?? ""]);
    for (let c = 1; c <= 3; c++) r.getCell(c).border = BORDER_THIN;
  }

  // ── 1. KEY PURCHASES ──
  addSectionHeader("1. KEY PURCHASES");
  const header = ws.addRow(["Item", "Qty", "Cost"]);
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER_THIN;
  });

  const purchaseDefs: { label: string; keywords: string[] }[] = [
    { label: "Potatoes", keywords: ["POTATOES"] },
    { label: "Flour", keywords: ["FLOUR"] },
    { label: "Oil", keywords: ["OIL"] },
    { label: "Rice", keywords: ["RICE"] },
    { label: "Frango (chicken)", keywords: ["FRANGO", "CHICKEN"] },
    { label: "Mince", keywords: ["MINCE"] },
    { label: "Prego (rump sliced 120g)", keywords: ["SLICED 120G"] },
    { label: "Fillets", keywords: ["FILLET"] },
    { label: "Milk", keywords: ["MILK"] },
  ];

  purchaseDefs.forEach((def) => {
    const { qty, cost } = sumExpense(def.keywords);
    addDataRow(def.label, qty || "", cost || "");
  });

  // ── 2. PIZZA SALES ──
  addSectionHeader("2. PIZZA SALES");

  // Dough counts from stock movements
  let thinDough = 0;
  let thickDough = 0;
  movements.forEach((m) => {
    if (m.type !== "sale") return;
    const name = (m.items?.name ?? "").toUpperCase();
    if (name.includes("DOUGH PIZZA BASES THIN")) thinDough += Math.abs(Number(m.qty));
    if (name.includes("DOUGH PIZZA BASES THICK")) thickDough += Math.abs(Number(m.qty));
  });
  addDataRow("Thin Crust Total", thinDough || "");
  addDataRow("Thick Crust Total", thickDough || "");

  const pizzaTypes = [
    "Katundu Pizza",
    "Mexicano Pizza",
    "Portuguese Chicken Pizza",
    "Chicken Mushroom Pizza",
    "Sweet and Sour Safari Pizza",
    "Maffiosa Pizza",
    "Prawn Pizza",
    "Anchovy Pizza",
    "Vegetarian Pizza",
    "Vegan Pizza",
    "Margarita Pizza",
    "Piccanti Pizza",
    "Jalapeno Pizza",
    "Hummus Pizza",
    "Godfather Pizza",
    "Mediterranean Pizza",
  ];
  pizzaTypes.forEach((name) => {
    const q = countMenuSales(name, sales);
    addDataRow(name, q || "");
  });

  // ── 3. FRANGO SALES ──
  addSectionHeader("3. FRANGO SALES");
  addDataRow("Half Churrasco Chicken", countMenuSales("Half Churrasco Chicken", sales) || "");
  addDataRow("Full Churrasco Chicken", countMenuSales("Full Churrasco Chicken", sales) || "");

  // ── 4. PREGO / BITOQUE SALES ──
  addSectionHeader("4. PREGO / BITOQUE SALES");
  const pregoItems = [
    "Plain Prego",
    "Prego Pimento",
    "Beef Bitoque",
    "Chicken Bitoque",
    "Beef Prego",
  ];
  pregoItems.forEach((name) => {
    addDataRow(name, countMenuSales(name, sales) || "");
  });

  // ── 5. CHIPS SALES ──
  addSectionHeader("5. CHIPS SALES");
  const chipItems = [
    "Plain Chips Small",
    "Plain Chips Large",
    "Masala Chips Small",
    "Masala Chips Large",
  ];
  chipItems.forEach((name) => {
    addDataRow(name, countMenuSales(name, sales) || "");
  });

  // ── 6. HOT DRINKS SALES ──
  addSectionHeader("6. HOT DRINKS SALES");
  const drinkItems = [
    "Italian Cappuccino",
    "Hot Chocolate",
    "Brazilian Cappuccino",
    "Chocachino",
  ];
  drinkItems.forEach((name) => {
    addDataRow(name, countMenuSales(name, sales) || "");
  });

  // ── 7. PASTA SALES ──
  addSectionHeader("7. PASTA SALES");
  const pastaItems = [
    "Spaghetti Creamy Tomato and Prawn",
    "Spaghetti Bolognese",
    "Penne Creamy Chicken and Mushroom",
    "Penne Creamy Tomato and Prawn",
    "Penne Picanti",
    "Penne Pomodoro",
    "Penne Bolognese",
    "Spaghetti Picanti",
    "Spaghetti Creamy Chicken and Mushroom",
  ];
  pastaItems.forEach((name) => {
    addDataRow(name, countMenuSales(name, sales) || "");
  });
}

export function buildFlashReport(input: FlashReportInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jungle Pepper POS";
  wb.title = "Jungle Pepper - Flash Report";

  const ws = wb.addWorksheet("Flash Report");

  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 10;
  ws.getColumn(6).width = 10;
  ws.getColumn(7).width = 10;
  ws.getColumn(8).width = 10;
  ws.getColumn(9).width = 10;
  ws.getColumn(10).width = 48;

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
    "K Open",
    "K Pur",
    "K Sale",
    "K Close",
    "S Open",
    "S Pur",
    "S Sale",
    "S Close",
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
      stockCell(stockRow.kitchenOpening),
      stockCell(stockRow.kitchenPurchases),
      stockCell(stockRow.kitchenUsage),
      stockCell(stockRow.kitchenClosing),
      stockCell(stockRow.storesOpening),
      stockCell(stockRow.storesPurchases),
      stockCell(stockRow.storesUsage),
      stockCell(stockRow.storesClosing),
      stockRow.soldAs || null,
    ]);

    for (let c = 1; c <= 10; c++) {
      r.getCell(c).border = BORDER_THIN;
    }

    const FMT_INT = "#,##0";
    const FMT_DEC = "#,##0.###";

    const numCols = [2, 3, 4, 5, 6, 7, 8, 9];
    numCols.forEach((c) => {
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
  addExecutiveSummary(wb, input);

  return wb;
}
