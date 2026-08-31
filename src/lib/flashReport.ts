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

export type FlashStockCount = {
  item_id: string;
  opening: number;
  closing: number;
};

export type FlashProductionBatch = {
  created_at: string;
  production_inputs?: Array<{
    item_id: string;
    qty: number;
    weight_kg?: number | null;
    cook_kg?: number | null;
    items?: { name?: string; id?: string } | null;
  }>;
  production_outputs?: Array<{
    item_id: string;
    qty: number;
    weight_kg?: number | null;
    cook_kg?: number | null;
    items?: { name?: string; id?: string } | null;
  }>;
  production_wastage?: Array<{
    item_id: string;
    qty: number;
    items?: { name?: string; id?: string } | null;
  }>;
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
  stockCounts?: FlashStockCount[];
  productionBatches?: FlashProductionBatch[];
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
      { label: "FRANGO FULL 1.2kg", aliases: ["CHICKEN FRANGO FULL 1.2KG", "FRANGO FULL (1.2KG)"] },
      { label: "FRANGO HALF (600g)", aliases: ["FRANGO HALF (600G)"] },
      { label: "FILLET TRAYS (500G)", aliases: ["FILLET TRAYS (400/500g)"] },
      { label: "PIZZA PKTS (80G)", aliases: ["CHICK PIZZA PKTS (80G)", "PIZZA PKTS (80G)"] },
      { label: "BURGER (120g)", aliases: ["CHICK BURGERS/BITOQUES (120g)", "BURGER (120G)"] },
    ],
  ],
  [
    "RUMP",
    [
      { label: "SLICED (1kg)", aliases: ["RUMP SLICED BULK (1Kg)", "RUMP SLICED (1KG)"] },
      { label: "PREGOS/BITOQUES (80)", aliases: ["PREGOS/BITOQUES (120g)", "SLICED 120G"] },
    ],
  ],
  [
    "MINCE",
    [
      { label: "BULK (1kg)", aliases: ["MINCE BULK (1Kg)", "MINCE BULK (1KG)", "BULK (1KG)"] },
      { label: "BURGERS (120g)", aliases: ["MINCE BURGERS (120g)", "MINCE BURGERS (120G)"] },
      {
        label: "PIZZA PKTS & BOLOG (80g)",
        aliases: ["MINCE PIZZA PKTS & BOLOG (80g)", "MINCE PIZZA PKTS & BOLOG (80G)"],
      },
    ],
  ],
  [
    "CAMARAO",
    [
      { label: "CAMARAO BOX PKTS (Qty)", aliases: ["CAMARAO BOX PKTS"] },
      { label: "CAMARAO HALF (pkt6)", aliases: ["CAMARAO HALF (PKT6)", "CAMARAO HALF"] },
      { label: "CAMARAO PASTA PKTS (80g)", aliases: ["CAMARAO PASTA PKTS (80G)"] },
    ],
  ],
  [
    "CHEESE",
    [
      { label: "BLOCK (Qty)", aliases: ["CHEESE BLOCK QTY", "BLOCK (QTY)"] },
      { label: "BLOCK (kg)", aliases: ["CHEESE BLOCK"] },
      { label: "CHEESE PIZZA PKTS (120g)", aliases: ["CHEESE PIZZA PKTS (120G)"] },
      { label: "CHEESE BURGER PKTS (40g)", aliases: ["CHEESE BURGER PKTS (40G)"] },
      { label: "MILK (500g)", aliases: ["MILK"] },
      { label: "CONDENSED MILK (390g)", aliases: ["CONDENSED MILK"] },
      { label: "EGGS (single)", aliases: ["EGGS"] },
    ],
  ],
  [
    "FLOUR / DOUGH",
    [
      { label: "FLOUR BAG (kg)", aliases: ["FLOUR BAG"] },
      { label: "DOUGH PIZZA BASES (Thin)", aliases: ["DOUGH PIZZA BASES THIN"] },
      { label: "DOUGH PIZZA BASES (Thick)", aliases: ["DOUGH PIZZA BASES THICK"] },
      { label: "MAIZE FLOUR (kg)", aliases: ["MAIZE FLOUR"] },
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
  opening: number;
  /** Column C: purchase qty for count-measured items (pkts, boxes, singles) */
  purchaseQty: number;
  /** Column D: purchase qty for weight-measured items (kg, L, g) */
  purchaseKg: number;
  /** Column E: sale deductions only (type=sale) */
  saleUsage: number;
  uncooked: number;
  cookKg: number;
  produced: number;
  waste: number;
  closing: number;
};

/** Check if a unit code represents a weight/volume measurement */
function isWeightUnit(unit?: string | null): boolean {
  if (!unit) return false;
  const u = unit.toLowerCase();
  return ["kg", "g", "l", "ml", "litre", "liter", "litres", "liters"].includes(u);
}

/** Check if a unit code represents a count measurement */
function isCountUnit(unit?: string | null): boolean {
  return !isWeightUnit(unit);
}

function resolveAndSummarize(
  items: MatrixItem[],
  label: string,
  aliases: string[],
  sales: MatrixOrder[],
  movements: MatrixMovement[],
  ledgerMovements: MatrixMovement[],
  menuAliases: string[] | undefined,
  isMenu: boolean | undefined,
  stockCounts?: FlashStockCount[],
): {
  item?: MatrixItem;
  opening: number;
  closing: number;
  soldAsItemId?: string;
} {
  const defaultRow = { opening: 0, closing: 0 };

  if (isMenu) {
    return { ...defaultRow };
  }

  const exact = itemIndex(items);
  const item = resolveItem(items, exact, label, aliases);
  if (!item) return { ...defaultRow };

  const periodMovements = movements.filter((mov) => {
    if (!mov.item_id) return false;
    const matches = mov.item_id === item.id;
    if (!matches) return false;
    const movementItem = mov.items?.name === item.name;
    if (!movementItem) return matches;
    return true;
  });

  const ledger = ledgerMovements.filter((mov) => {
    if (!mov.item_id) return false;
    const matches = mov.item_id === item.id;
    if (!matches) return false;
    const movementItem = mov.items?.name === item.name;
    if (!movementItem) return matches;
    return true;
  });

  const summary = summarizeStock(item, periodMovements, ledger);

  // Use stock counts for opening/closing if available
  let opening = summary.opening;
  let closing = summary.closing;
  if (stockCounts) {
    const count = stockCounts.find((sc) => sc.item_id === item.id);
    if (count) {
      opening = count.opening;
      closing = count.closing;
    }
  }

  return {
    item,
    opening,
    closing,
    soldAsItemId: item.id,
  };
}

function flashStockRows(input: FlashReportInput): FlashStockRow[] {
  const rows: FlashStockRow[] = [];
  const batches = input.productionBatches ?? [];

  // Build index for resolving item_id from name
  const nameToItemId = new Map<string, string>();
  input.items.forEach((item) => {
    if (item.name && item.id) {
      nameToItemId.set(normalizeName(item.name), item.id);
    }
  });

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
        input.stockCounts,
      );

      // Compute per-type movement breakdown for this item
      let purchaseQty = 0;  // Column C: purchases for count-measured items
      let purchaseKg = 0;   // Column D: purchases for weight-measured items
      let saleUsage = 0;    // Column E: ONLY recipe/sale deductions
      let uncooked = 0;     // Column F: raw ingredients consumed in production
      let cookKg = 0;       // Column G: post-cooking weight (from outputs ONLY)
      let produced = 0;     // Column H: items produced
      let waste = 0;        // Column I: wastage

      if (result.item) {
        const itemId = result.item.id;
        const itemKey = normalizeName(label);
        const unitCode = result.item.units?.code;
        const weightItem = isWeightUnit(unitCode);

        // Resolve item ID
        let resolvedId = itemId;
        const found = nameToItemId.get(itemKey);
        if (found) resolvedId = found;

        // ── Movement breakdown (correctly separated by type) ──
        const periodMovements = input.movements.filter((m) => m.item_id === resolvedId);

        for (const m of periodMovements) {
          const qty = Number(m.qty) || 0;
          switch (m.type) {
            case "purchase_in":
              if (qty > 0) {
                // Split by unit type: weight items → Column D, count items → Column C
                if (weightItem) {
                  purchaseKg += qty;
                } else {
                  purchaseQty += qty;
                }
              }
              break;
            case "sale":
              // ONLY POS sale deductions (recipe-based)
              saleUsage += Math.abs(Math.min(0, qty));
              break;
            case "production_in":
              // Raw ingredients consumed in production
              uncooked += Math.abs(Math.min(0, qty));
              break;
            case "wastage":
            case "breakage":
              waste += Math.abs(Math.min(0, qty));
              break;
            // production_out, adjustment, issue_out, complimentary are
            // tracked but not in the main stock formula columns
          }
        }

        // ── Production batch data ──
        batches.forEach((batch) => {
          batch.production_inputs?.forEach((inputLine) => {
            const inputName = normalizeName(inputLine.items?.name ?? "");
            if (inputLine.item_id === resolvedId || inputName === itemKey) {
              // uncooked already computed from movements above;
              // supplement with batch data if movements missed it
              const batchQty = Math.abs(Number(inputLine.qty) || 0);
              if (uncooked === 0 && batchQty > 0) uncooked = batchQty;
            }
          });
          batch.production_outputs?.forEach((output) => {
            const outputName = normalizeName(output.items?.name ?? "");
            if (output.item_id === resolvedId || outputName === itemKey) {
              produced += Number(output.qty) || 0;
              // cook_kg ONLY from outputs (post-cooking weight)
              const ck = Number(output.cook_kg) || 0;
              if (ck > 0) cookKg += ck;
            }
          });
          batch.production_wastage?.forEach((w) => {
            const wasteName = normalizeName(w.items?.name ?? "");
            if (w.item_id === resolvedId || wasteName === itemKey) {
              const wQty = Number(w.qty) || 0;
              // Supplement waste if movements didn't capture it
              if (waste === 0 && wQty > 0) waste = wQty;
            }
          });
        });
      }

      // Menu items: count sales from order_lines
      if (isMenu) {
        saleUsage = countMenuSales(label, input.sales);
      }

      rows.push({
        section: sectionName,
        label,
        soldAs: result.soldAsItemId ? buildSoldAs(result.soldAsItemId, input.movements) : "",
        isMenu,
        opening: result.opening,
        purchaseQty,
        purchaseKg,
        saleUsage,
        uncooked,
        cookKg,
        produced,
        waste,
        closing: result.closing,
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
      "OPEN": null,
      "IN/PURCHASE": null,
      "kg/IN": null,
      "SALES": null,
      "UNCOOK": null,
      "COOK kg": null,
      "PRODUCED": null,
      "WASTE": null,
      "CLOSE": null,
    });
  });

  flashStockRows(input).forEach((row) => {
    rows.push({
      Section: row.section,
      Item: row.label,
      "Expected Deposits": null,
      "Statement Deposited": null,
      "Delayed Deposits": null,
      "OPEN": stockCell(row.opening),
      "IN/PURCHASE": stockCell(row.purchaseQty),
      "kg/IN": stockCell(row.purchaseKg),
      "SALES": stockCell(row.saleUsage),
      "UNCOOK": stockCell(row.uncooked),
      "COOK kg": stockCell(row.cookKg),
      "PRODUCED": stockCell(row.produced),
      "WASTE": stockCell(row.waste),
      "CLOSE": stockCell(row.closing),
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
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 18;

  const titleRow = ws.addRow(["JUNGLE PEPPER — EXECUTIVE SUMMARY"]);
  titleRow.getCell(1).font = TITLE_FONT;
  ws.addRow([`Period: ${input.rangeLabel ?? input.reportDate}`]).getCell(1).font = SUBTITLE_FONT;
  ws.addRow([]);

  const movements = input.movements ?? [];
  const sales = input.sales ?? [];

  function addSectionHeader(title: string) {
    ws.addRow([]);
    const r = ws.addRow([title, "", "", ""]);
    r.getCell(1).font = { bold: true, size: 11, underline: "single" };
  }

  function addHeaderRow() {
    const r = ws.addRow(["Item", "Weight", "Sales", "Purchases Bulk"]);
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = BORDER_THIN;
    });
  }

  function addRow(label: string, salesVal: string | number, bulkVal: string | number) {
    const r = ws.addRow([label, "", salesVal ?? "", bulkVal ?? ""]);
    for (let c = 1; c <= 4; c++) r.getCell(c).border = BORDER_THIN;
  }

  function sumPurchase(keywords: string[]): { qty: number; unit: string } {
    let qty = 0;
    let unit = "";
    movements.forEach((m) => {
      if (m.type !== "purchase_in") return;
      const name = (m.items?.name ?? "").toUpperCase();
      if (keywords.some((k) => name.includes(k))) {
        qty += Number(m.qty);
        if (!unit && m.items?.units?.code) unit = m.items.units.code;
      }
    });
    return { qty, unit };
  }

  function sumDoughSales(keyword: string): number {
    let total = 0;
    movements.forEach((m) => {
      if (m.type !== "sale") return;
      const name = (m.items?.name ?? "").toUpperCase();
      if (name.includes(keyword)) total += Math.abs(Number(m.qty));
    });
    return total;
  }

  function sumOutbound(keywords: string[]): number {
    let total = 0;
    movements.forEach((m) => {
      if (m.type !== "production_out" && m.type !== "sale" && m.type !== "wastage") return;
      const name = (m.items?.name ?? "").toUpperCase();
      if (keywords.some((k) => name.includes(k))) total += Math.abs(Number(m.qty));
    });
    return total;
  }

  function fmtPurchase(qty: number, unit: string): string {
    if (!qty) return "";
    const display = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
    return unit ? `${display} ${unit}` : display;
  }

  // ── 1. FLOUR ──
  addSectionHeader("1. FLOUR");
  addHeaderRow();
  const flour = sumPurchase(["FLOUR BAG"]);
  addRow("Flour", "", fmtPurchase(flour.qty, flour.unit));
  addRow("Thin Crust Total", sumDoughSales("DOUGH PIZZA BASES THIN") || "", "");
  addRow("Thick Crust Total", sumDoughSales("DOUGH PIZZA BASES THICK") || "", "");
  // individual pizza types listed under their respective ingredients below

  // ── 2. FRANGO ──
  addSectionHeader("2. FRANGO");
  addHeaderRow();
  const frango = sumPurchase(["FRANGO FULL", "FRANGO HALF"]);
  addRow("Frango", "", fmtPurchase(frango.qty, frango.unit));
  addRow("Half Churrasco Chicken", countMenuSales("Half Churrasco Chicken", sales) || "", "");
  addRow("Full Churrasco Chicken", countMenuSales("Full Churrasco Chicken", sales) || "", "");

  // ── 3. FILLETS ──
  addSectionHeader("3. FILLETS");
  addHeaderRow();
  const fillets = sumPurchase(["FILLET TRAYS"]);
  addRow("Fillets", "", fmtPurchase(fillets.qty, fillets.unit));
  addRow("Katundu Pizza", countMenuSales("Katundu Pizza", sales) || "", "");
  addRow("Portuguese Chicken Pizza", countMenuSales("Portuguese Chicken Pizza", sales) || "", "");
  addRow("Chicken Mushroom Pizza", countMenuSales("Chicken Mushroom Pizza", sales) || "", "");
  addRow("Sweet and Sour Safari Pizza", countMenuSales("Sweet and Sour Safari Pizza", sales) || "", "");
  addRow("Maffiosa Pizza", countMenuSales("Maffiosa Pizza", sales) || "", "");
  addRow("Chicken Bitoque", countMenuSales("Chicken Bitoque", sales) || "", "");
  addRow("Spaghetti Creamy Chicken & Mushroom", countMenuSales("Spaghetti Creamy Chicken and Mushroom", sales) || "", "");
  addRow("Penne Creamy Chicken & Mushroom", countMenuSales("Penne Creamy Chicken and Mushroom", sales) || "", "");

  // ── 4. MINCE ──
  addSectionHeader("4. MINCE");
  addHeaderRow();
  const mince = sumPurchase(["MINCE BULK"]);
  addRow("Mince", "", fmtPurchase(mince.qty, mince.unit));
  addRow("Katundu Pizza", countMenuSales("Katundu Pizza", sales) || "", "");
  addRow("Mexicano Pizza", countMenuSales("Mexicano Pizza", sales) || "", "");
  addRow("Spaghetti Bolognese", countMenuSales("Spaghetti Bolognese", sales) || "", "");
  addRow("Penne Bolognese", countMenuSales("Penne Bolognese", sales) || "", "");

  // ── 5. RUMP ──
  addSectionHeader("5. RUMP");
  addHeaderRow();
  const rump = sumPurchase(["RUMP SLICED (1KG)"]);
  addRow("Rump Sliced 1kg", "", fmtPurchase(rump.qty, rump.unit));
  addRow("Plain Prego", countMenuSales("Plain Prego", sales) || "", "");
  addRow("Prego Pimento", countMenuSales("Prego Pimento", sales) || "", "");
  addRow("Beef Bitoque", countMenuSales("Beef Bitoque", sales) || "", "");
  addRow("Beef Prego", countMenuSales("Beef Prego", sales) || "", "");

  // ── 6. POTATOES ──
  addSectionHeader("6. POTATOES");
  addHeaderRow();
  const potatoes = sumPurchase(["POTATOES BULK"]);
  addRow("Potatoes", "", fmtPurchase(potatoes.qty, potatoes.unit));
  addRow("Plain Chips Small", countMenuSales("Plain Chips Small", sales) || "", "");
  addRow("Plain Chips Large", countMenuSales("Plain Chips Large", sales) || "", "");
  addRow("Masala Chips Small", countMenuSales("Masala Chips Small", sales) || "", "");
  addRow("Masala Chips Large", countMenuSales("Masala Chips Large", sales) || "", "");

  // ── 7. MILK ──
  addSectionHeader("7. MILK");
  addHeaderRow();
  const milk = sumPurchase(["MILK"]);
  addRow("Milk", "", fmtPurchase(milk.qty, milk.unit));
  addRow("Italian Cappuccino", countMenuSales("Italian Cappuccino", sales) || "", "");
  addRow("Brazilian Cappuccino", countMenuSales("Brazilian Cappuccino", sales) || "", "");
  addRow("Hot Chocolate", countMenuSales("Hot Chocolate", sales) || "", "");
  addRow("Chocachino", countMenuSales("Chocachino", sales) || "", "");

  // ── 8. RICE ──
  addSectionHeader("8. RICE");
  addHeaderRow();
  const rice = sumPurchase(["RICE BULK"]);
  addRow("Rice", "", fmtPurchase(rice.qty, rice.unit));
  addRow("Arroz de Marisco", countMenuSales("Arroz de Marisco", sales) || "", "");
  addRow("Beef Bitoque", countMenuSales("Beef Bitoque", sales) || "", "");
  addRow("Chicken Bitoque", countMenuSales("Chicken Bitoque", sales) || "", "");
  addRow("Half Churrasco Chicken", countMenuSales("Half Churrasco Chicken", sales) || "", "");
  addRow("Full Churrasco Chicken", countMenuSales("Full Churrasco Chicken", sales) || "", "");
  addRow("Camarao 6 Prawns", countMenuSales("Camarao 6 Prawns", sales) || "", "");
  addRow("Camarao 12 Prawns", countMenuSales("Camarao 12 Prawns", sales) || "", "");

  // ── 9. OIL ──
  addSectionHeader("9. OIL");
  addHeaderRow();
  const oilPurchase = sumPurchase(["COOKING OIL BULK"]);
  addRow("Cooking Oil", sumOutbound(["COOKING OIL BULK"]) || "", fmtPurchase(oilPurchase.qty, oilPurchase.unit));
}

export function buildFlashReport(input: FlashReportInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jungle Pepper POS";
  wb.title = "Jungle Pepper - Flash Report";

  const ws = wb.addWorksheet("Flash Report");

  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 10;
  ws.getColumn(6).width = 10;
  ws.getColumn(7).width = 12;
  ws.getColumn(8).width = 10;
  ws.getColumn(9).width = 10;
  ws.getColumn(10).width = 10;

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
  s2Title.getCell(1).font = { bold: true, size: 12 };
  ws.addRow([]);

  const stockHeader = ws.addRow([
    "",
    "OPEN",
    "IN/PURCHASE",
    "kg/IN",
    "SALES",
    "UNCOOK",
    "COOK kg",
    "PRODUCED",
    "WASTE",
    "CLOSE",
  ]);
  const STOCK_BOLD: Partial<ExcelJS.Font> = { bold: true, size: 11 };
  stockHeader.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = STOCK_BOLD;
  });

  // Sub-header row (PURCHASE under IN/PURCHASE, kg under kg/IN)
  const subHeader = ws.addRow([null, null, "PURCHASE", "kg", null, null, null, null, null, null]);
  subHeader.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = STOCK_BOLD;
  });

  let currentSection = "";
  flashStockRows(input).forEach((stockRow) => {
    if (stockRow.section !== currentSection) {
      currentSection = stockRow.section;
      const sectionRow = ws.addRow([currentSection, null, null, null, null, null, null, null, null, null]);
      sectionRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = STOCK_BOLD;
        cell.alignment = { horizontal: "center" };
      });
    }

    const r = ws.addRow([
      stockRow.label,
      stockCell(stockRow.opening),
      stockCell(stockRow.purchaseQty),
      stockCell(stockRow.purchaseKg),
      stockCell(stockRow.saleUsage),
      stockCell(stockRow.uncooked),
      stockCell(stockRow.cookKg),
      stockCell(stockRow.produced),
      stockCell(stockRow.waste),
      null, // CLOSE formula added below
    ]);
    // CLOSE = OPEN + IN/PURCHASE + kg/IN + PRODUCED - SALES
    // Note: IN/PURCHASE (C) and kg/IN (D) are mutually exclusive per item
    // (count-measured items use C, weight-measured items use D)
    const rowNum = r.number;
    r.getCell(10).value = { formula: `SUM(B${rowNum}+C${rowNum}+D${rowNum}+H${rowNum}-E${rowNum})` };

    // No borders on stock data rows — matching manual Excel
    for (let c = 1; c <= 10; c++) {
      r.getCell(c).font = { size: 11 };
    }
    [2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((c) => {
      r.getCell(c).alignment = { horizontal: "center" };
    });

    const FMT_INT = "#,##0";
    const FMT_DEC = "#,##0.###";

    const numCols = [2, 3, 4, 5, 6, 7, 8, 9, 10];
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
