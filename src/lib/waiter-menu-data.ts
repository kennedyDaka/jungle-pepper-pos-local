export const PDF_W = 411;
export const PDF_H = 780;

export type MenuItem = {
  id: string;
  name: string;
  dbName: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "normal" | "pizza" | "pasta";
  price: number;
};

export type ShapeOption = { shape: string; dbName: string };

export const PASTA_OPTIONS: ShapeOption[] = [
  { shape: "Spaghetti", dbName: "Spaghetti {name}" },
  { shape: "Penne", dbName: "Penne {name}" },
  { shape: "Fettucine", dbName: "Fettucine {name}" },
];

const I = (
  id: string,
  name: string,
  dbName: string,
  page: number,
  x: number,
  y: number,
  w: number,
  h: number,
  price: number,
  kind: MenuItem["kind"] = "normal",
): MenuItem => ({
  id,
  name,
  dbName,
  page,
  x,
  y,
  w,
  h,
  price,
  kind,
});

export const MENU: MenuItem[] = [
  I("garlic-loaf", "Garlic Loaf", "Garlic Loaf", 1, 40, 140, 320, 35, 14500),
  I(
    "garlic-loaf-cheese",
    "Garlic Loaf & Cheese",
    "Garlic Loaf and Cheese",
    1,
    40,
    196,
    320,
    35,
    15500,
  ),
  I("focaccia", "Focaccia", "Focaccia", 1, 40, 252, 320, 35, 25900),
  I("focaccia-cheese", "Focaccia & Cheese", "Focaccia and Cheese", 1, 40, 308, 320, 35, 32900),
  I("greek-salad", "Greek Salad", "Greek Salad", 1, 40, 419, 320, 35, 14000),
  I("mixed-salad", "Mixed Salad", "Mixed Salad", 1, 40, 461, 320, 35, 14000),
  I("extra-chicken", "Extra Topping: Chicken", "Extra Chicken Topping", 1, 40, 492, 320, 20, 8000),

  I("pasta-pomodoro", "Pasta Pomodoro", "Pomodoro", 2, 40, 222, 325, 42, 22900, "pasta"),
  I("pasta-picanti", "Pasta Picanti", "Picanti", 2, 40, 266, 325, 42, 22900, "pasta"),
  I("pasta-bolognese", "Pasta Bolognese", "Bolognese", 2, 40, 309, 325, 40, 27000, "pasta"),
  I(
    "pasta-creamy-chicken",
    "Creamy Chicken & Mushroom Pasta",
    "Creamy Chicken and Mushroom",
    2,
    40,
    353,
    325,
    40,
    27000,
    "pasta",
  ),
  I(
    "pasta-creamy-prawn",
    "Creamy Tomato & Prawn Pasta",
    "Creamy Tomato and Prawn",
    2,
    40,
    397,
    325,
    40,
    37000,
    "pasta",
  ),

  I("pizza-katundu", "Katundu Pizza", "Katundu Pizza", 3, 40, 310, 180, 40, 32900, "pizza"),
  I("pizza-mexicano", "Mexicano Pizza", "Mexicano Pizza", 3, 40, 354, 180, 40, 32900, "pizza"),
  I(
    "pizza-portuguese",
    "Portuguese Chicken Pizza",
    "Portuguese Chicken Pizza",
    3,
    40,
    444,
    180,
    40,
    32900,
    "pizza",
  ),
  I(
    "pizza-chicken-mushroom",
    "Chicken Mushroom Pizza",
    "Chicken Mushroom Pizza",
    3,
    40,
    488,
    180,
    33,
    32900,
    "pizza",
  ),
  I(
    "pizza-sweet-sour",
    "Sweet & Sour Safari Pizza",
    "Sweet and Sour Safari Pizza",
    3,
    40,
    521,
    180,
    40,
    32900,
    "pizza",
  ),
  I("pizza-maffiosa", "Maffiosa Pizza", "Maffiosa Pizza", 3, 40, 565, 180, 30, 32900, "pizza"),
  I("pizza-prawn", "Prawn Pizza", "Prawn Pizza", 3, 40, 654, 180, 40, 36000, "pizza"),
  I("pizza-anchovy", "Anchovy Pizza", "Anchovy Pizza", 3, 40, 698, 180, 30, 36000, "pizza"),
  I(
    "pizza-vegetarian",
    "Vegetarian Pizza",
    "Vegetarian Pizza",
    3,
    235,
    345,
    150,
    42,
    32900,
    "pizza",
  ),
  I("pizza-vegan", "Vegan Pizza", "Vegan Pizza", 3, 235, 393, 150, 33, 32900, "pizza"),
  I("pizza-margarita", "Margarita Pizza", "Margarita Pizza", 3, 235, 441, 150, 33, 32900, "pizza"),
  I("pizza-piccanti", "Piccanti Pizza", "Piccanti Pizza", 3, 235, 477, 150, 40, 32900, "pizza"),
  I("pizza-jalapeno", "Jalapeno Pizza", "Jalapeno Pizza", 3, 235, 525, 150, 42, 32900, "pizza"),
  I("pizza-hummus", "Hummus Pizza", "Hummus Pizza", 3, 235, 573, 150, 42, 32900, "pizza"),
  I("pizza-godfather", "Godfather Pizza", "Godfather Pizza", 3, 235, 621, 150, 42, 32900, "pizza"),
  I(
    "pizza-medit",
    "Mediterranean Pizza",
    "Mediterranean Pizza",
    3,
    235,
    669,
    150,
    55,
    32900,
    "pizza",
  ),

  I("burger-jungle", "Jungle Pepper Burger", "Jungle Pepper Burger", 4, 40, 300, 325, 40, 27000),
  I("burger-chicken", "Chicken Burger", "Chicken Burger", 4, 40, 355, 325, 50, 27000),
  I("burger-prawn", "Prawn Burger", "Prawn Burger", 4, 40, 421, 325, 40, 32900),
  I("burger-veggie", "Veggie Burger", "Veggie Burger", 4, 40, 476, 325, 40, 27000),
  I("chips-plain-sm", "Plain Chips (Small)", "Plain Chips Small", 4, 40, 640, 325, 20, 11900),
  I("chips-plain-lg", "Plain Chips (Large)", "Plain Chips Large", 4, 40, 660, 325, 20, 12900),
  I("chips-masala-sm", "Masala Chips (Small)", "Masala Chips Small", 4, 40, 707, 325, 20, 12900),
  I("chips-masala-lg", "Masala Chips (Large)", "Masala Chips Large", 4, 40, 727, 325, 20, 14900),

  I("prego-plain", "Plain Prego", "Plain Prego", 5, 40, 275, 325, 30, 29000),
  I("prego-pimento", "Prego Pimento", "Prego Pimento", 5, 40, 308, 325, 30, 29000),
  I("prego-extra", "Prego Extra Topping", "Extra Chicken Topping", 5, 40, 341, 325, 30, 8000),
  I("beef-bitoque", "Beef Bitoque", "Beef Bitoque", 5, 40, 387, 325, 40, 34000),
  I("chicken-bitoque", "Chicken Bitoque", "Chicken Bitoque", 5, 40, 431, 325, 40, 34000),
  I(
    "churrasco-half",
    "Churrasco Half Chicken",
    "Half Churrasco Chicken",
    5,
    195,
    624,
    180,
    18,
    38000,
  ),
  I(
    "churrasco-full",
    "Churrasco Full Chicken",
    "Full Churrasco Chicken",
    5,
    195,
    638,
    180,
    18,
    55000,
  ),

  I("paella", "Arroz de Marisco", "Arroz de Marisco", 6, 20, 40, 370, 130, 66000),
  I("camarao-6", "Camarao - 6 Prawns", "Camarao 6 Prawns", 6, 20, 395, 370, 30, 46000),
  I("camarao-12", "Prawns in Shell - 12 Prawns", "Camarao 12 Prawns", 6, 20, 425, 370, 70, 66000),

  I("dessert-cake", "Chocolate Cake", "Chocolate Cake", 7, 20, 130, 370, 35, 13900),
  I("dessert-pancakes", "Pancakes", "Pancakes", 7, 20, 178, 370, 35, 12000),
  I(
    "dessert-pancakes-ic",
    "Pancakes with Ice Cream",
    "Pancakes with Ice Cream",
    7,
    20,
    226,
    370,
    35,
    14900,
  ),
  I("dessert-ice-cream", "Ice Cream", "Ice Cream", 7, 20, 274, 370, 35, 12000),
  I("dessert-oreo", "Oreo Ice Cream", "Oreo Ice Cream", 7, 20, 310, 370, 25, 13900),
  I("dessert-pastel", "Pastel de Belem", "Pastel de Belem", 7, 20, 346, 370, 70, 7500),

  I("italian-cap", "Italian Cappuccino", "Italian Cappuccino", 8, 40, 132, 325, 32, 7000),
  I("brazil-cap", "Brazilian Cappuccino", "Brazilian Cappuccino", 8, 40, 162, 325, 32, 7000),
  I("kiddoccino", "Kiddoccino", "Kiddoccino", 8, 40, 192, 325, 42, 7500),
  I("bica", "Bica (Espresso)", "Bica Espresso", 8, 40, 232, 325, 32, 5500),
  I("railway", "Railway Espresso (Bombom)", "Railway Espresso Bombom", 8, 40, 262, 325, 32, 7500),
  I("carioca", "Carioca", "Carioca", 8, 40, 292, 325, 32, 5500),
  I("macchiato", "Macchiato", "Macchiato", 8, 40, 322, 325, 32, 5500),
  I("pingo", "Pingo", "Pingo", 8, 40, 352, 325, 32, 5500),
  I("babychino", "Babychino", "Babychino", 8, 40, 382, 325, 32, 5500),
  I("galao", "Galao (Caffe Latte)", "Galao Caffe Latte", 8, 150, 428, 215, 32, 8500),
  I("hot-choc", "Hot Chocolate", "Hot Chocolate", 8, 150, 458, 215, 20, 10000),
  I("submarine", "Submarine", "Submarine", 8, 150, 478, 215, 32, 9000),
  I("chocachino", "Chocachino", "Chocachino", 8, 150, 508, 215, 42, 9500),
  I("filter-coffee", "Filter Coffee", "Filter Coffee", 8, 150, 548, 215, 32, 6500),
  I("malawian-tea", "Malawian Tea", "Malawian Tea", 8, 40, 638, 240, 11, 4000),
  I("earl-grey", "Earl Grey", "Earl Grey Tea", 8, 40, 651, 240, 11, 7500),
  I("rooibos", "Rooibos", "Rooibos Tea", 8, 40, 664, 240, 11, 6000),
  I("carioca-limao", "Carioca de Limao", "Carioca de Limao", 8, 40, 677, 240, 11, 4000),
  I("herbal-teas", "Herbal Teas", "Herbal Teas", 8, 40, 690, 240, 11, 7500),
];

export const TOTAL_PAGES = 10;

export const formatMK = (n: number) => "MK" + n.toLocaleString("en-US");

export type ExtraItem = {
  id: string;
  name: string;
  dbName: string;
  price: number;
  category: string;
};
export type ExtraCategory = { id: string; label: string; items: ExtraItem[] };

const E = (
  id: string,
  name: string,
  dbName: string,
  price: number,
  category: string,
): ExtraItem => ({
  id,
  name,
  dbName,
  price,
  category,
});

export const EXTRA_MENU: ExtraCategory[] = [
  {
    id: "beers",
    label: "Beers & Ciders",
    items: [
      E("beer-chill", "Chill", "CHILL", 7000, "Beers & Ciders"),
      E("beer-green", "Green", "GREEN", 6500, "Beers & Ciders"),
      E("beer-castel", "Castel", "CASTEL", 6000, "Beers & Ciders"),
      E("beer-special", "Special", "SPECIAL", 6500, "Beers & Ciders"),
      E("beer-kuche", "Kuche Kuche", "KUCHE KUCHE", 6000, "Beers & Ciders"),
      E("beer-sapitwa", "Sapitwa", "SAPITWA", 6000, "Beers & Ciders"),
      E("cider-pome", "Pome Breeze", "POME BREEZE", 7000, "Beers & Ciders"),
    ],
  },
  {
    id: "soft",
    label: "Soft Drinks",
    items: [
      E("sd-coke", "Coke", "COKE", 3000, "Soft Drinks"),
      E("sd-fanta-or", "Fanta Orange", "FANTA ORANGE", 3000, "Soft Drinks"),
      E("sd-fanta-pine", "Fanta Pineapple", "FANTA PINEAPPLE", 3000, "Soft Drinks"),
      E("sd-fanta-pass", "Fanta Passion", "FANTA PASSION", 3000, "Soft Drinks"),
      E("sd-sprite", "Sprite", "SPRITE", 3000, "Soft Drinks"),
      E("sd-cherry", "Cherry Plum", "CHERRY PLUM", 3000, "Soft Drinks"),
      E("sd-cocopina", "Cocopina", "COCOPINA", 3000, "Soft Drinks"),
      E("sd-ginger-sobo", "Ginger Sobo", "GINGER SOBO", 3000, "Soft Drinks"),
      E("sd-water", "Water", "WATER", 2000, "Soft Drinks"),
      E("sd-juice-box", "Box Juices", "BOX JUICES", 8000, "Soft Drinks"),
      E("sd-ginger-ale", "Ginger Ale", "GINGER ALE", 3000, "Soft Drinks"),
      E("sd-tonic", "Tonic", "TONIC", 3000, "Soft Drinks"),
      E("sd-soda", "Soda Water", "SODA WATER", 3000, "Soft Drinks"),
      E("sd-sobo-or", "Sobo Orange", "SOBO ORANGE", 3000, "Soft Drinks"),
      E("sd-chapman", "Chapman", "CHAPMAN", 12000, "Soft Drinks"),
      E("sd-rockshandy", "Rockshandy", "ROCKSHANDY", 12000, "Soft Drinks"),
      E("sd-swiss-lemonade", "Swiss Lemonade", "SWISS LEMONADE", 5000, "Soft Drinks"),
      E("sd-lemonade", "Lemonade", "LEMONADE", 5000, "Soft Drinks"),
      E("sd-juice-fresh", "Juice Fresh", "JUICE FRESH", 8000, "Soft Drinks"),
    ],
  },
  {
    id: "wine",
    label: "Wine",
    items: [
      E("wine-drostdy", "Red Dry (Drostdy)", "RED DRY (DROSTDY)", 9900, "Wine"),
      E("wine-overmeer", "Red Dry (Overmeer)", "RED DRY (OVERMEER)", 9500, "Wine"),
      E("wine-red-sweet", "Red Sweet", "RED SWEET", 9500, "Wine"),
      E("wine-white-glass", "White Wine (Glass)", "WHITE WINE GLASS", 9900, "Wine"),
    ],
  },
  {
    id: "liquor",
    label: "Liquor",
    items: [
      E("lq-martini-red", "Martini Red", "MARTINI RED", 6000, "Liquor"),
      E("lq-jager", "Jagermeister", "JAGERMEISTER", 10000, "Liquor"),
      E("lq-amarula", "Amarula", "AMARULA", 10000, "Liquor"),
      E("lq-pellegrini", "Pellegrini Bitters", "PELLEGRINI BITTERS", 5000, "Liquor"),
      E("gin-cape", "Gin - Cape Stars", "CAPE STARS GIN", 6000, "Liquor"),
      E("gin-malawi", "Gin - Malawi Gin", "MALAWI GIN", 6000, "Liquor"),
      E("br-cape", "Brandy - Cape Stars", "CAPE STARS BRANDY", 5000, "Liquor"),
      E("br-premier", "Brandy - Premier", "PREMIER BRANDY", 5000, "Liquor"),
      E("br-klipdrift", "Brandy - Klipdrift", "KLIPDRIFT", 7000, "Liquor"),
      E("br-kwv3", "Brandy - KWV 3 Yrs", "KWV 3 YRS", 6000, "Liquor"),
      E("br-kwv5", "Brandy - KWV 5 Yrs", "KWV 5 YRS", 7000, "Liquor"),
      E("rum-captain", "Rum - Captain Morgan", "CAPTAIN MORGAN", 6500, "Liquor"),
      E("rum-bacardi", "Rum - Bacardi", "BACARDI", 6000, "Liquor"),
      E("wh-cape", "Whiskey - Cape Stars", "CAPE STARS WHISKEY", 7000, "Liquor"),
      E("wh-jb", "Whiskey - J&B", "J & B", 8000, "Liquor"),
      E("wh-jameson", "Whiskey - Jameson", "JAMESON", 13000, "Liquor"),
      E("wh-red", "Whiskey - Red Label", "RED LABEL", 8000, "Liquor"),
      E("wh-jack", "Whiskey - Jack Daniels", "JACK DANIELS", 13000, "Liquor"),
      E("tq-silver", "Tequila - Silver", "TEQUILA SILVER", 13000, "Liquor"),
      E("tq-gold", "Tequila - Gold", "TEQUILA GOLD", 13000, "Liquor"),
      E("vk-malawi", "Vodka - Malawi", "MALAWI VODKA", 5000, "Liquor"),
      E("vk-absolute", "Vodka - Absolute", "ABSOLUTE", 10200, "Liquor"),
      E("vk-smirnoff", "Vodka - Smirnoff", "SMIRNOFF", 9800, "Liquor"),
    ],
  },
];

export const EXTRA_INDEX: Record<string, ExtraItem> = {};
for (const cat of EXTRA_MENU) {
  for (const item of cat.items) {
    EXTRA_INDEX[item.id] = item;
  }
}

export function resolveDbName(item: MenuItem, shape?: string): string {
  if (item.kind === "pasta" && shape) {
    return shape + " " + item.dbName;
  }
  return item.dbName;
}
