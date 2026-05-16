import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(
  new URL("../supabase/migrations/20260516103000_seed_menu_inventory_recipes.sql", import.meta.url),
);

const units = new Map([
  ["kg", "Kilogram"],
  ["g", "Gram"],
  ["l", "Litre"],
  ["ml", "Millilitre"],
  ["ea", "Each"],
  ["pkt", "Packet"],
  ["bottle", "Bottle"],
  ["piece", "Piece"],
]);

const inventory = new Map();
const menus = [];
const recipes = [];

function item(name, unit, stockType, category = null, options = {}) {
  const canonical = name.trim().replace(/\s+/g, " ").toUpperCase();
  if (!inventory.has(canonical)) {
    inventory.set(canonical, {
      name: canonical,
      unit,
      stockType,
      category:
        category ??
        (stockType === "beverage"
          ? "Beverages"
          : stockType === "consumable"
            ? "Consumables"
            : stockType === "production"
              ? "Produced prep"
              : "Raw ingredients"),
      bottleMl: options.bottleMl ?? null,
      shotMl: options.shotMl ?? null,
      reorder: options.reorder ?? 0,
    });
  }
}

function menu(category, name, price, description = null) {
  const menuItem = {
    category,
    name: name.trim(),
    price,
    description,
    sortOrder: menus.length + 1,
  };
  menus.push(menuItem);
  return menuItem.name;
}

function asItemUnit(itemName, qty, unit) {
  const entry = inventory.get(itemName.trim().replace(/\s+/g, " ").toUpperCase());
  if (!entry) throw new Error(`Missing inventory item for recipe: ${itemName}`);
  const u = unit.toLowerCase();

  if (entry.unit === u) return qty;
  if (entry.unit === "kg" && u === "g") return qty / 1000;
  if (entry.unit === "g" && u === "kg") return qty * 1000;
  if (entry.unit === "l" && u === "ml") return qty / 1000;
  if (entry.unit === "ml" && u === "l") return qty * 1000;
  if (entry.unit === "bottle" && u === "ml") {
    if (!entry.bottleMl) throw new Error(`${itemName} needs bottleMl for ml deduction`);
    return qty / entry.bottleMl;
  }
  if (entry.unit === "ea" && ["unit", "qty", "cup", "slice loaf"].includes(u)) return qty;
  if (entry.unit === "piece" && ["piece", "pieces"].includes(u)) return qty;
  if (entry.unit === "pkt" && ["pkt", "packet"].includes(u)) return qty;
  if (entry.unit === "bottle" && ["bottle", "unit"].includes(u)) return qty;

  throw new Error(`Cannot convert ${qty} ${unit} into ${entry.unit} for ${itemName}`);
}

function recipe(menuName, ingredient, qty, unit, takeawayOnly = false) {
  recipes.push({
    menuName,
    ingredient: ingredient.trim().replace(/\s+/g, " ").toUpperCase(),
    qty: asItemUnit(ingredient, qty, unit),
    takeawayOnly,
  });
}

function recipeMany(menuName, lines) {
  for (const line of lines) recipe(menuName, ...line);
}

function q(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function number(value) {
  return Number(value.toFixed(6)).toString();
}

// Core inventory list, deduplicated and normalized.
[
  ["CHICKEN FRANGO FULL 1.2KG", "ea", "production"],
  ["FRANGO HALF (600G)", "ea", "production"],
  ["FILLET TRAYS (500G)", "kg", "production"],
  ["PIZZA PKTS (80G)", "pkt", "production"],
  ["BURGER (120G)", "ea", "production"],
  ["RUMP SLICED (1KG)", "kg", "production"],
  ["PREGOS/BITOQUES (80G)", "ea", "production"],
  ["MINCE BULK (1KG)", "kg", "raw"],
  ["PIZZA PKTS & BOLOG (80G)", "pkt", "production"],
  ["CAMARAO BOX PKTS", "pkt", "raw"],
  ["CAMARAO HALF (PKT6)", "pkt", "raw"],
  ["CAMARAO PASTA PKTS (80G)", "pkt", "production"],
  ["CHEESE BLOCK", "kg", "raw"],
  ["CHEESE PIZZA PKTS", "kg", "production"],
  ["CHEESE BURGER PKTS", "kg", "production"],
  ["MILK", "kg", "raw"],
  ["CONDENSED MILK", "kg", "raw"],
  ["EGGS", "ea", "raw"],
  ["FLOUR / DOUGH FLOUR BAG", "kg", "raw"],
  ["DOUGH PIZZA BASES THIN", "ea", "production"],
  ["DOUGH PIZZA BASES THICK", "ea", "production"],
  ["MAIZE FLOUR", "kg", "raw"],
  ["BREAD BURGER PKTS", "pkt", "raw"],
  ["LOAF PKTS", "ea", "production"],
  ["LOAF GARLIC WITH CHEESE", "ea", "production"],
  ["RICE BULK", "kg", "raw"],
  ["MARISCO PKTS", "kg", "production"],
  ["RICE COOKER", "kg", "production"],
  ["SALT", "kg", "raw"],
  ["SUGAR", "kg", "raw"],
  ["COOKING OIL BULK", "l", "raw"],
  ["BOTTLE KITCHEN (1L)", "bottle", "raw"],
  ["FRYER OIL", "l", "raw"],
  ["POTATOES BULK", "kg", "raw"],
  ["CHIPS PEELED", "kg", "production"],
  ["ONIONS", "kg", "raw"],
  ["GARLIC FULL", "kg", "raw"],
  ["GARLIC GRATED", "kg", "production"],
  ["TOMATO FRESH", "kg", "raw"],
  ["G. PEPPERS", "kg", "raw"],
  ["PIZZA BOX", "ea", "consumable"],
  ["WHITE SMALL BOX", "ea", "consumable"],
  ["WHITE LARGE BOX", "ea", "consumable"],
  ["FOIL CUPS", "ea", "consumable"],
  ["BLACK JUMBOS PKTS", "pkt", "consumable"],
  ["PIZZA PACKAGING PKTS", "pkt", "consumable"],
  ["CHARCOAL", "kg", "consumable"],
  ["FIREWOOD", "piece", "consumable"],
  ["CHOCOLATE CAKE", "ea", "production"],
  ["ICE CREAM", "ea", "production"],
  ["OREO", "ea", "raw"],
].forEach((args) => item(...args));

// Ingredients introduced by the menu recipe master.
[
  ["MARGARINE", "kg", "raw"],
  ["PARSLEY", "kg", "raw"],
  ["ROSEMARY", "kg", "raw"],
  ["LETTUCE", "kg", "raw"],
  ["CUCUMBER", "kg", "raw"],
  ["FETA CHEESE", "kg", "raw"],
  ["OLIVES", "kg", "raw"],
  ["SALAD DRESSING", "l", "production"],
  ["CABBAGE", "kg", "raw"],
  ["APPLE", "kg", "raw"],
  ["SPAGHETTI", "kg", "raw"],
  ["PENNE", "kg", "raw"],
  ["FETTUCCINE", "kg", "raw"],
  ["POMODORO SAUCE", "kg", "production"],
  ["PARMESAN", "kg", "raw"],
  ["CHILLI SAUCE", "kg", "production"],
  ["MINCE COOKED", "kg", "production"],
  ["MUSHROOM", "kg", "raw"],
  ["WHITE SAUCE", "kg", "production"],
  ["PIZZA TOMATO BASE", "kg", "production"],
  ["PINEAPPLE", "kg", "raw"],
  ["ANCHOVY", "kg", "raw"],
  ["CAPERS", "kg", "raw"],
  ["JALAPENO", "kg", "raw"],
  ["HUMMUS", "kg", "production"],
  ["SPINACH", "kg", "raw"],
  ["DRIED TOMATO", "kg", "raw"],
  ["BASIL", "kg", "raw"],
  ["EXTRA CHEESE", "kg", "raw"],
  ["PANCAKES PORTION", "ea", "production"],
  ["PASTEL DE BELEM", "ea", "production"],
  ["COFFEE", "kg", "raw"],
  ["TEA", "ea", "raw"],
  ["HOT CHOCOLATE MIX", "kg", "raw"],
  ["CHOCOLATE PIECE", "ea", "raw"],
].forEach((args) => item(...args));

// Bar inventory.
[
  "COKE BOTTLE/CAN",
  "FANTA ORANGE BOTTLE/CAN",
  "FANTA PINEAPPLE BOTTLE/CAN",
  "FANTA PASSION BOTTLE/CAN",
  "SPRITE BOTTLE/CAN",
  "CHERRY PLUM BOTTLE/CAN",
  "COCOPINA BOTTLE/CAN",
  "GINGER SOBO BOTTLE/CAN",
  "WATER BOTTLE",
  "BOX JUICE",
  "GINGER ALE BOTTLE/CAN",
  "TONIC BOTTLE/CAN",
  "SODA WATER BOTTLE/CAN",
  "SOBO ORANGE BOTTLE/CAN",
].forEach((name) => item(name, "ea", "beverage"));

[
  "FANTA MIXER",
  "SPRITE MIXER",
  "GRENADINE",
  "ANGOSTURA BITTERS",
  "SODA WATER MIXER",
  "LEMONADE MIXER",
  "LIME CORDIAL",
  "WATER MIXER",
].forEach((name) => item(name, "l", "beverage"));
item("ICE CUBES", "ea", "consumable");

[
  "DROSTDY WINE BOTTLE",
  "OVERMEER WINE BOTTLE",
  "RED SWEET WINE BOTTLE",
  "WHITE WINE BOTTLE",
  "PORTO WINE BOTTLE",
  "CAPE STARS GIN BOTTLE",
  "MALAWI GIN BOTTLE",
  "CAPE STARS BRANDY BOTTLE",
  "PREMIER BRANDY BOTTLE",
  "KLIPDRIFT BRANDY BOTTLE",
  "KWV 3 YEARS BRANDY BOTTLE",
  "KWV 5 YEARS BRANDY BOTTLE",
  "CAPTAIN MORGAN BOTTLE",
  "BACARDI BOTTLE",
  "ANCIENT RUM COCONUT BOTTLE",
  "CAPE STARS WHISKEY BOTTLE",
  "J&B WHISKEY BOTTLE",
  "JAMESON BOTTLE",
  "JOHNNIE WALKER RED LABEL",
  "JACK DANIELS BOTTLE",
  "TEQUILA SILVER BOTTLE",
  "TEQUILA GOLD BOTTLE",
  "MARTINI RED BOTTLE",
  "JAGERMEISTER BOTTLE",
  "AMARULA BOTTLE",
  "PELLEGRINI BITTERS BOTTLE",
  "MALAWI VODKA BOTTLE",
  "ABSOLUT VODKA BOTTLE",
  "SMIRNOFF VODKA BOTTLE",
].forEach((name) => item(name, "bottle", "beverage", null, { bottleMl: 750, shotMl: 50 }));

[
  "CHILL BEER",
  "GREEN BEER",
  "CASTEL BEER",
  "SPECIAL BEER",
  "KUCHE KUCHE BEER",
  "SAPITWA BEER",
  "POME BREEZE CIDER",
].forEach((name) => item(name, "bottle", "beverage"));

const softDrinks = [
  ["COKE", 3000, "COKE BOTTLE/CAN"],
  ["FANTA ORANGE", 3000, "FANTA ORANGE BOTTLE/CAN"],
  ["FANTA PINEAPPLE", 3000, "FANTA PINEAPPLE BOTTLE/CAN"],
  ["FANTA PASSION", 3000, "FANTA PASSION BOTTLE/CAN"],
  ["SPRITE", 3000, "SPRITE BOTTLE/CAN"],
  ["CHERRY PLUM", 3000, "CHERRY PLUM BOTTLE/CAN"],
  ["COCOPINA", 3000, "COCOPINA BOTTLE/CAN"],
  ["GINGER SOBO", 3000, "GINGER SOBO BOTTLE/CAN"],
  ["WATER", 2000, "WATER BOTTLE"],
  ["BOX JUICES", 8000, "BOX JUICE"],
  ["GINGER ALE", 3000, "GINGER ALE BOTTLE/CAN"],
  ["TONIC", 3000, "TONIC BOTTLE/CAN"],
  ["SODA WATER", 3000, "SODA WATER BOTTLE/CAN"],
  ["SOBO ORANGE", 3000, "SOBO ORANGE BOTTLE/CAN"],
];
for (const [name, price, inv] of softDrinks)
  recipe(menu("Soft Drinks", name, price), inv, 1, "unit");

recipeMany(menu("Mocktails", "CHAPMAN", 12000), [
  ["FANTA MIXER", 200, "ml"],
  ["SPRITE MIXER", 200, "ml"],
  ["GRENADINE", 20, "ml"],
  ["ANGOSTURA BITTERS", 5, "ml"],
  ["CUCUMBER", 20, "g"],
  ["ICE CUBES", 1, "cup"],
]);
recipeMany(menu("Mocktails", "ROCKSHANDY", 12000), [
  ["SODA WATER MIXER", 200, "ml"],
  ["LEMONADE MIXER", 200, "ml"],
  ["ANGOSTURA BITTERS", 5, "ml"],
  ["ICE CUBES", 1, "cup"],
]);
recipeMany(menu("Mocktails", "LIME CORDIAL", 5000), [
  ["LIME CORDIAL", 50, "ml"],
  ["WATER MIXER", 250, "ml"],
]);

[
  ["RED DRY (DROSTDY)", 9900, "DROSTDY WINE BOTTLE"],
  ["RED DRY (OVERMEER)", 9500, "OVERMEER WINE BOTTLE"],
  ["RED SWEET", 9500, "RED SWEET WINE BOTTLE"],
  ["WHITE WINE GLASS", 9900, "WHITE WINE BOTTLE"],
].forEach(([name, price, inv]) => recipe(menu("Wine", name, price), inv, 175, "ml"));

[
  ["CHILL", 7000, "CHILL BEER"],
  ["GREEN", 6500, "GREEN BEER"],
  ["CASTEL", 6000, "CASTEL BEER"],
  ["SPECIAL", 6500, "SPECIAL BEER"],
  ["KUCHE KUCHE", 6000, "KUCHE KUCHE BEER"],
  ["SAPITWA", 6000, "SAPITWA BEER"],
  ["POME BREEZE", 7000, "POME BREEZE CIDER"],
].forEach(([name, price, inv]) => recipe(menu("Beers & Ciders", name, price), inv, 1, "bottle"));

[
  ["Gin", "CAPE STARS GIN", 6000, "CAPE STARS GIN BOTTLE"],
  ["Gin", "MALAWI GIN", 6000, "MALAWI GIN BOTTLE"],
  ["Brandy", "CAPE STARS BRANDY", 5000, "CAPE STARS BRANDY BOTTLE"],
  ["Brandy", "PREMIER BRANDY", 5000, "PREMIER BRANDY BOTTLE"],
  ["Brandy", "KLIPDRIFT", 7000, "KLIPDRIFT BRANDY BOTTLE"],
  ["Brandy", "KWV 3 YRS", 6000, "KWV 3 YEARS BRANDY BOTTLE"],
  ["Brandy", "KWV 5 YRS", 7000, "KWV 5 YEARS BRANDY BOTTLE"],
  ["Rum", "CAPTAIN MORGAN", 6500, "CAPTAIN MORGAN BOTTLE"],
  ["Rum", "BACARDI", 6000, "BACARDI BOTTLE"],
  ["Whiskey", "CAPE STARS WHISKEY", 7000, "CAPE STARS WHISKEY BOTTLE"],
  ["Whiskey", "J & B", 8000, "J&B WHISKEY BOTTLE"],
  ["Whiskey", "JAMESON", 13000, "JAMESON BOTTLE"],
  ["Whiskey", "RED LABEL", 8000, "JOHNNIE WALKER RED LABEL"],
  ["Whiskey", "JACK DANIELS", 13000, "JACK DANIELS BOTTLE"],
  ["Tequila", "TEQUILA SILVER", 13000, "TEQUILA SILVER BOTTLE"],
  ["Tequila", "TEQUILA GOLD", 13000, "TEQUILA GOLD BOTTLE"],
  ["Liqueurs", "MARTINI RED", 6000, "MARTINI RED BOTTLE"],
  ["Liqueurs", "JAGERMEISTER", 10000, "JAGERMEISTER BOTTLE"],
  ["Liqueurs", "AMARULA", 10000, "AMARULA BOTTLE"],
  ["Liqueurs", "PELLEGRINI BITTERS", 5000, "PELLEGRINI BITTERS BOTTLE"],
  ["Vodka", "MALAWI VODKA", 5000, "MALAWI VODKA BOTTLE"],
  ["Vodka", "ABSOLUTE", 10200, "ABSOLUT VODKA BOTTLE"],
  ["Vodka", "SMIRNOFF", 9800, "SMIRNOFF VODKA BOTTLE"],
].forEach(([category, name, price, inv]) => recipe(menu(category, name, price), inv, 50, "ml"));

recipeMany(menu("Starters", "Garlic Loaf", 14500), [
  ["LOAF PKTS", 1, "unit"],
  ["GARLIC GRATED", 10, "g"],
  ["MARGARINE", 30, "g"],
  ["PARSLEY", 2, "g"],
]);
recipeMany(menu("Starters", "Garlic Loaf and Cheese", 15500), [
  ["LOAF PKTS", 1, "unit"],
  ["GARLIC GRATED", 10, "g"],
  ["MARGARINE", 30, "g"],
  ["CHEESE BURGER PKTS", 40, "g"],
  ["PARSLEY", 2, "g"],
]);
recipeMany(menu("Starters", "Focaccia", 25900), [
  ["DOUGH PIZZA BASES THIN", 1, "unit"],
  ["GARLIC GRATED", 5, "g"],
  ["COOKING OIL BULK", 20, "ml"],
  ["SALT", 3, "g"],
  ["ROSEMARY", 2, "g"],
]);
recipeMany(menu("Starters", "Focaccia and Cheese", 28900), [
  ["DOUGH PIZZA BASES THIN", 1, "unit"],
  ["GARLIC GRATED", 5, "g"],
  ["COOKING OIL BULK", 20, "ml"],
  ["SALT", 3, "g"],
  ["ROSEMARY", 2, "g"],
  ["CHEESE PIZZA PKTS", 80, "g"],
]);

recipeMany(menu("Salads", "Greek Salad", 14000), [
  ["LETTUCE", 80, "g"],
  ["TOMATO FRESH", 50, "g"],
  ["CUCUMBER", 40, "g"],
  ["FETA CHEESE", 30, "g"],
  ["OLIVES", 20, "g"],
  ["SALAD DRESSING", 30, "ml"],
]);
recipeMany(menu("Salads", "Mixed Salad", 14000), [
  ["LETTUCE", 60, "g"],
  ["CABBAGE", 60, "g"],
  ["TOMATO FRESH", 40, "g"],
  ["CUCUMBER", 40, "g"],
  ["APPLE", 30, "g"],
  ["SALAD DRESSING", 30, "ml"],
]);
recipe(menu("Salads", "Salad Chicken Topping", 6000), "PIZZA PKTS (80G)", 1, "pkt");

const pastaTypes = [
  ["Spaghetti", "SPAGHETTI"],
  ["Penne", "PENNE"],
  ["Fettucine", "FETTUCCINE"],
];
for (const [label, pasta] of pastaTypes) {
  recipeMany(menu("Pastas", `${label} Pomodoro`, 20900), [
    [pasta, 120, "g"],
    ["POMODORO SAUCE", 120, "g"],
    ["COOKING OIL BULK", 15, "ml"],
    ["SALT", 2, "g"],
    ["PARMESAN", 10, "g"],
  ]);
  recipeMany(menu("Pastas", `${label} Picanti`, 20900), [
    [pasta, 120, "g"],
    ["POMODORO SAUCE", 100, "g"],
    ["CHILLI SAUCE", 15, "g"],
    ["OLIVES", 20, "g"],
    ["GARLIC GRATED", 5, "g"],
  ]);
  recipeMany(menu("Pastas", `${label} Bolognese`, 25000), [
    [pasta, 120, "g"],
    ["MINCE COOKED", 120, "g"],
    ["POMODORO SAUCE", 100, "g"],
    ["PARMESAN", 10, "g"],
  ]);
  recipeMany(menu("Pastas", `${label} Creamy Chicken and Mushroom`, 25000), [
    [pasta, 120, "g"],
    ["FILLET TRAYS (500G)", 200, "g"],
    ["MUSHROOM", 40, "g"],
    ["WHITE SAUCE", 120, "g"],
    ["PARMESAN", 10, "g"],
  ]);
  recipeMany(menu("Pastas", `${label} Creamy Tomato and Prawn`, 35000), [
    [pasta, 120, "g"],
    ["CAMARAO PASTA PKTS (80G)", 2, "pkt"],
    ["POMODORO SAUCE", 80, "g"],
    ["WHITE SAUCE", 80, "g"],
    ["GARLIC GRATED", 5, "g"],
  ]);
}

const pizzaBase = [
  ["DOUGH PIZZA BASES THIN", 1, "unit"],
  ["PIZZA TOMATO BASE", 100, "g"],
  ["CHEESE PIZZA PKTS", 120, "g"],
  ["PIZZA BOX", 1, "qty", true],
];
const pizzas = [
  [
    "Katundu Pizza",
    28900,
    [
      ["PIZZA PKTS (80G)", 1, "pkt"],
      ["PIZZA PKTS & BOLOG (80G)", 1, "pkt"],
      ["G. PEPPERS", 40, "g"],
      ["ONIONS", 40, "g"],
    ],
  ],
  [
    "Mexicano Pizza",
    28900,
    [
      ["PIZZA PKTS & BOLOG (80G)", 1, "pkt"],
      ["G. PEPPERS", 40, "g"],
      ["ONIONS", 40, "g"],
      ["CHILLI SAUCE", 15, "g"],
    ],
  ],
  [
    "Portuguese Chicken Pizza",
    28900,
    [
      ["PIZZA PKTS (80G)", 1, "pkt"],
      ["ONIONS", 40, "g"],
      ["G. PEPPERS", 40, "g"],
    ],
  ],
  [
    "Chicken Mushroom Pizza",
    28900,
    [
      ["PIZZA PKTS (80G)", 1, "pkt"],
      ["MUSHROOM", 40, "g"],
    ],
  ],
  [
    "Sweet and Sour Safari Pizza",
    28900,
    [
      ["PIZZA PKTS (80G)", 1, "pkt"],
      ["PINEAPPLE", 50, "g"],
      ["G. PEPPERS", 30, "g"],
    ],
  ],
  [
    "Maffiosa Pizza",
    28900,
    [
      ["PIZZA PKTS (80G)", 1, "pkt"],
      ["OLIVES", 20, "g"],
      ["CHILLI SAUCE", 10, "g"],
    ],
  ],
  [
    "Prawn Pizza",
    32000,
    [
      ["CAMARAO PASTA PKTS (80G)", 1, "pkt"],
      ["GARLIC GRATED", 5, "g"],
    ],
  ],
  [
    "Anchovy Pizza",
    32000,
    [
      ["ANCHOVY", 40, "g"],
      ["CAPERS", 10, "g"],
    ],
  ],
  [
    "Vegetarian Pizza",
    28900,
    [
      ["MUSHROOM", 40, "g"],
      ["G. PEPPERS", 40, "g"],
      ["ONIONS", 40, "g"],
      ["OLIVES", 20, "g"],
    ],
  ],
  [
    "Vegan Pizza",
    28900,
    [
      ["MUSHROOM", 40, "g"],
      ["G. PEPPERS", 40, "g"],
      ["ONIONS", 40, "g"],
      ["TOMATO FRESH", 40, "g"],
    ],
  ],
  ["Margarita Pizza", 28900, [["EXTRA CHEESE", 40, "g"]]],
  [
    "Piccanti Pizza",
    28900,
    [
      ["CHILLI SAUCE", 15, "g"],
      ["GARLIC GRATED", 5, "g"],
      ["G. PEPPERS", 40, "g"],
    ],
  ],
  [
    "Jalapeno Pizza",
    28900,
    [
      ["JALAPENO", 20, "g"],
      ["ONIONS", 30, "g"],
    ],
  ],
  [
    "Hummus Pizza",
    28900,
    [
      ["HUMMUS", 60, "g"],
      ["OLIVES", 20, "g"],
    ],
  ],
  [
    "Godfather Pizza",
    28900,
    [
      ["FETA CHEESE", 30, "g"],
      ["SPINACH", 40, "g"],
      ["OLIVES", 20, "g"],
    ],
  ],
  [
    "Mediterranean Pizza",
    28900,
    [
      ["DRIED TOMATO", 30, "g"],
      ["OLIVES", 20, "g"],
      ["BASIL", 5, "g"],
    ],
  ],
];
for (const [name, price, lines] of pizzas) {
  const menuName = menu("Pizza", name, price);
  recipeMany(menuName, [...pizzaBase, ...lines]);
}

[
  ["Chocolate Cake", "Jungle Pepper signature chocolate cake", 11900, "CHOCOLATE CAKE"],
  ["Pancakes", "Four fluffy pancakes drizzled with syrup", 10000, "PANCAKES PORTION"],
  [
    "Pancakes with Ice Cream",
    "Four fluffy pancakes with ice cream and syrup",
    10900,
    "PANCAKES PORTION",
  ],
  ["Ice Cream", "Vanilla ice cream drizzled with chocolate", 10000, "ICE CREAM"],
  ["Oreo Ice Cream", "Oreo ice cream", 11500, "ICE CREAM"],
  [
    "Pastel de Belem",
    "Portuguese custard tart served warm and dusted with cinnamon",
    6500,
    "PASTEL DE BELEM",
  ],
].forEach(([name, description, price, inv]) => {
  const menuName = menu("Desserts", name, price, description);
  recipe(menuName, inv, 1, "unit");
});

[
  ["Italian Cappuccino", "Coffee with frothed milk sprinkled with chocolate", 7000],
  ["Brazilian Cappuccino", "Coffee with frothed milk sprinkled with cinnamon", 7000],
  [
    "Kiddoccino",
    "Hot milk in a cappuccino cup topped with frothed milk and chocolate powder",
    7500,
  ],
  ["Bica Espresso", "Small strong coffee", 5500],
  ["Railway Espresso Bombom", "Strong espresso floating on condensed milk", 7500],
  ["Carioca", "Weak espresso", 5500],
  ["Macchiato", "Espresso with a dash of frothed milk", 5500],
  ["Pingo", "Milky espresso", 5500],
  ["Babychino", "Frothy milk in an espresso cup sprinkled with chocolate powder", 5500],
  ["Galao Caffe Latte", "Milky coffee served with frothed milk", 8500],
  ["Hot Chocolate", "Hot chocolate", 10000],
  ["Submarine", "Piece of chocolate submerged in hot milk", 9000],
  ["Chocachino", "Hot chocolate and coffee blended", 9500],
  ["Filter Coffee", "Malawi blend of coffee served in a plunger", 6500],
  ["Malawian Tea", "Malawian tea", 4000],
  ["Earl Grey Tea", "Earl Grey tea", 7500],
  ["Rooibos Tea", "Rooibos tea", 6000],
  ["Carioca de Limao", "Lemon tea", 4000],
  ["Herbal Teas", "Selection of herbal teas", 7500],
].forEach(([name, description, price]) => menu("Coffee & Tea", name, price, description));

const categoryRows = [
  ["inventory", "Raw ingredients", 1],
  ["inventory", "Consumables", 2],
  ["inventory", "Beverages", 3],
  ["inventory", "Produced prep", 4],
  ["menu", "Starters", 1],
  ["menu", "Salads", 2],
  ["menu", "Pastas", 3],
  ["menu", "Pizza", 4],
  ["menu", "Desserts", 5],
  ["menu", "Coffee & Tea", 6],
  ["menu", "Soft Drinks", 7],
  ["menu", "Mocktails", 8],
  ["menu", "Wine", 9],
  ["menu", "Beers & Ciders", 10],
  ["menu", "Gin", 11],
  ["menu", "Brandy", 12],
  ["menu", "Rum", 13],
  ["menu", "Whiskey", 14],
  ["menu", "Tequila", 15],
  ["menu", "Liqueurs", 16],
  ["menu", "Vodka", 17],
];

const unitValues = [...units.entries()]
  .map(([code, name]) => `  (${q(code)}, ${q(name)})`)
  .join(",\n");
const categoryValues = categoryRows
  .map(([kind, name, sort]) => `  (${q(kind)}, ${q(name)}, ${sort})`)
  .join(",\n");
const itemValues = [...inventory.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(
    (i) =>
      `  (${q(i.name)}, ${q(i.stockType)}, ${q(i.category)}, ${q(i.unit)}, ${i.reorder}, ${i.bottleMl ?? "null"}, ${i.shotMl ?? "null"})`,
  )
  .join(",\n");
const menuValues = menus
  .map((m) => `  (${q(m.name)}, ${q(m.category)}, ${m.price}, ${q(m.description)}, ${m.sortOrder})`)
  .join(",\n");
const recipeValues = recipes
  .map(
    (r) =>
      `  (${q(r.menuName)}, ${q(r.ingredient)}, ${number(r.qty)}, ${r.takeawayOnly ? "true" : "false"})`,
  )
  .join(",\n");

const sql = `-- Jungle Pepper catalog seed: inventory, bar/food menu, and menu recipes.
-- Generated by scripts/build-catalog-seed.mjs. Names are normalized and duplicates are intentionally collapsed.

update public.items
set active = false,
    qty_on_hand = 0,
    updated_at = now()
where lower(name) = 'flour';

create temp table seed_units (
  code text primary key,
  name text not null
) on commit drop;

insert into seed_units (code, name)
values
${unitValues};

insert into public.units (code, name)
select code, name from seed_units
on conflict do nothing;

create temp table seed_categories (
  kind public.category_kind not null,
  name text not null,
  sort_order integer not null,
  primary key (kind, name)
) on commit drop;

insert into seed_categories (kind, name, sort_order)
values
${categoryValues};

insert into public.categories (kind, name, sort_order, active)
select kind, name, sort_order, true from seed_categories
on conflict do nothing;

update public.categories c
set sort_order = s.sort_order,
    active = true,
    updated_at = now()
from seed_categories s
where c.kind = s.kind
  and lower(c.name) = lower(s.name);

create temp table seed_inventory (
  name text primary key,
  stock_type public.stock_type not null,
  category_name text not null,
  unit_code text not null,
  reorder_level numeric(14, 3) not null default 0,
  bottle_ml numeric(10, 3),
  shot_ml numeric(10, 3)
) on commit drop;

insert into seed_inventory (name, stock_type, category_name, unit_code, reorder_level, bottle_ml, shot_ml)
values
${itemValues};

update public.items i
set stock_type = s.stock_type,
    category_id = c.id,
    unit_id = u.id,
    reorder_level = s.reorder_level,
    bottle_ml = s.bottle_ml,
    shot_ml = s.shot_ml,
    active = true,
    updated_at = now()
from seed_inventory s
join public.categories c on c.kind = 'inventory' and lower(c.name) = lower(s.category_name)
join public.units u on lower(u.code) = lower(s.unit_code)
where i.active
  and lower(i.name) = lower(s.name);

insert into public.items (
  name,
  stock_type,
  category_id,
  unit_id,
  reorder_level,
  bottle_ml,
  shot_ml,
  active
)
select
  s.name,
  s.stock_type,
  c.id,
  u.id,
  s.reorder_level,
  s.bottle_ml,
  s.shot_ml,
  true
from seed_inventory s
join public.categories c on c.kind = 'inventory' and lower(c.name) = lower(s.category_name)
join public.units u on lower(u.code) = lower(s.unit_code)
where not exists (
  select 1 from public.items i
  where i.active
    and lower(i.name) = lower(s.name)
);

create temp table seed_menu (
  name text primary key,
  category_name text not null,
  price numeric(14, 2) not null,
  description text,
  sort_order integer not null
) on commit drop;

insert into seed_menu (name, category_name, price, description, sort_order)
values
${menuValues};

update public.menu_items m
set category_id = c.id,
    price = s.price,
    description = s.description,
    sort_order = s.sort_order,
    active = true,
    updated_at = now()
from seed_menu s
join public.categories c on c.kind = 'menu' and lower(c.name) = lower(s.category_name)
where m.active
  and lower(m.name) = lower(s.name);

insert into public.menu_items (category_id, name, description, price, active, sort_order)
select c.id, s.name, s.description, s.price, true, s.sort_order
from seed_menu s
join public.categories c on c.kind = 'menu' and lower(c.name) = lower(s.category_name)
where not exists (
  select 1 from public.menu_items m
  where m.active
    and lower(m.name) = lower(s.name)
);

create temp table seed_recipes (
  menu_name text not null,
  item_name text not null,
  qty numeric(14, 6) not null,
  takeaway_only boolean not null default false
) on commit drop;

insert into seed_recipes (menu_name, item_name, qty, takeaway_only)
values
${recipeValues};

do $$
begin
  if exists (
    select 1
    from seed_recipes r
    left join public.menu_items m on m.active and lower(m.name) = lower(r.menu_name)
    left join public.items i on i.active and lower(i.name) = lower(r.item_name)
    where m.id is null or i.id is null
  ) then
    raise exception 'Catalog seed contains recipe rows with missing menu items or inventory items';
  end if;
end $$;

delete from public.recipes r
using public.menu_items m
join seed_menu s on lower(s.name) = lower(m.name)
where r.menu_item_id = m.id;

insert into public.recipes (menu_item_id, item_id, qty, takeaway_only)
select m.id, i.id, r.qty, r.takeaway_only
from seed_recipes r
join public.menu_items m on m.active and lower(m.name) = lower(r.menu_name)
join public.items i on i.active and lower(i.name) = lower(r.item_name);
`;

writeFileSync(outputPath, sql, "utf8");
