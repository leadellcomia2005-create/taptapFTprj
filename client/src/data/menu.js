const stockByCategory = {
  "Favorite Meal": 35,
  Alacarte: 25,
  Solo: 25,
  Drinks: 60,
  "Special Meal": 30,
  "Walk-in Add-on": 100
};

const descriptions = {
  "Favorite Meal": "Served as a complete favorite meal.",
  Alacarte: "Full alacarte serving for dine-in, takeout, or delivery.",
  Solo: "Solo serving for a lighter order.",
  Drinks: "Cold drink add-on.",
  "Special Meal": "House special meal.",
  "Walk-in Add-on": "Counter add-on for walk-in orders only."
};

const imagePositions = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"];
const photoRules = [
  ["egg-rice-unli-soup", "egg-rice-soup"],
  ["sisig-alacarte", "sisig-ala-carte"],
  ["boneless-chicken", "boneless-chicken"],
  ["skinless-longganisa", "skinless"],
  ["lechon-kawali", "lechon"],
  ["chicken-wings", "chicken-wings"],
  ["chicken-fillet", "chicken-fillet"],
  ["longganisa", "longganisa"],
  ["hungarian", "hungarian"],
  ["porkchop", "porkchop"],
  ["bottled-water", "bottled-water"],
  ["softdrinks", "softdrinks"],
  ["dinuguan", "dinuguan"],
  ["papaitan", "beef-papaitan"],
  ["tocino", "tocino"],
  ["bangus", "bangus"],
  ["hotdog", "hotdog"],
  ["chibu", "chibu"],
  ["squid", "squid"],
  ["sisig", "sisig"],
  ["tapa", "tapa"]
];

const photoFor = (id) => {
  const match = photoRules.find(([prefix]) => id === prefix || id.startsWith(`${prefix}-`));
  return match ? `/assets/menu/${match[1]}.png` : undefined;
};

const item = (id, name, category, price, index, options = {}) => {
  const image = photoFor(id);
  return {
    id,
    name,
    category,
    price,
    ...(image ? { image } : {}),
    imagePosition: imagePositions[index % imagePositions.length],
    description: descriptions[category],
    allergens: [],
    stock: stockByCategory[category] || 30,
    featured: category === "Favorite Meal" && index < 6,
    ...options
  };
};

export const fallbackMenu = [
  item("porkchop-meal", "Porkchop", "Favorite Meal", 99, 0),
  item("tapa-meal", "Tapa Meal", "Favorite Meal", 99, 1),
  item("chibu-meal", "Chibu Meal", "Favorite Meal", 99, 2),
  item("lechon-kawali-meal", "Lechon Kawali Meal", "Favorite Meal", 99, 3),
  item("sisig-meal", "Sisig Meal", "Favorite Meal", 99, 4),
  item("chicken-wings-meal", "Chicken Wings Meal", "Favorite Meal", 99, 5),
  item("boneless-chicken-meal", "Boneless Chicken Meal", "Favorite Meal", 99, 6),
  item("chicken-fillet-meal", "Chicken Fillet Meal", "Favorite Meal", 99, 7),
  item("bangus-meal", "Bangus Meal", "Favorite Meal", 99, 8),
  item("squid-meal", "Squid Meal", "Favorite Meal", 99, 9),
  item("tocino-meal", "Tocino Meal", "Favorite Meal", 99, 10),
  item("skinless-longganisa-meal", "Skinless Longganisa Meal", "Favorite Meal", 89, 11),
  item("longganisa-meal", "Longganisa Meal", "Favorite Meal", 89, 12),
  item("hungarian-meal", "Hungarian Meal", "Favorite Meal", 89, 13),
  item("hotdog-meal", "Hotdog Meal", "Favorite Meal", 69, 14),

  item("egg-rice-unli-soup", "Egg, Rice, Unli Soup", "Walk-in Add-on", 20, 15, { walkInOnly: true, featured: false }),

  item("porkchop-alacarte", "Porkchop Alacarte", "Alacarte", 149, 16),
  item("porkchop-solo", "Porkchop Solo", "Solo", 79, 17),
  item("tapa-alacarte", "Tapa Alacarte", "Alacarte", 149, 18),
  item("tapa-solo", "Tapa Solo", "Solo", 79, 19),
  item("chibu-alacarte", "Chibu Alacarte", "Alacarte", 149, 20),
  item("chibu-solo", "Chibu Solo", "Solo", 79, 21),
  item("lechon-kawali-alacarte", "Lechon Kawali Alacarte", "Alacarte", 149, 22),
  item("lechon-kawali-solo", "Lechon Kawali Solo", "Solo", 79, 23),
  item("sisig-alacarte", "Sisig Alacarte", "Alacarte", 149, 24),
  item("sisig-solo", "Sisig Solo", "Solo", 79, 25),
  item("chicken-wings-alacarte", "Chicken Wings Alacarte", "Alacarte", 149, 26),
  item("chicken-wings-solo", "Chicken Wings Solo", "Solo", 79, 27),
  item("boneless-chicken-alacarte", "Boneless Chicken Alacarte", "Alacarte", 149, 28),
  item("boneless-chicken-solo", "Boneless Chicken Solo", "Solo", 79, 29),
  item("chicken-fillet-alacarte", "Chicken Fillet Alacarte", "Alacarte", 149, 30),
  item("chicken-fillet-solo", "Chicken Fillet Solo", "Solo", 79, 31),
  item("bangus-alacarte", "Bangus Alacarte", "Alacarte", 149, 32),
  item("bangus-solo", "Bangus Solo", "Solo", 79, 33),
  item("squid-alacarte", "Squid Alacarte", "Alacarte", 149, 34),
  item("squid-solo", "Squid Solo", "Solo", 79, 35),
  item("tocino-alacarte", "Tocino Alacarte", "Alacarte", 149, 36),
  item("tocino-solo", "Tocino Solo", "Solo", 79, 37),
  item("skinless-longganisa-alacarte", "Skinless Longganisa Alacarte", "Alacarte", 135, 38),
  item("skinless-longganisa-solo", "Skinless Longganisa Solo", "Solo", 69, 39),
  item("longganisa-alacarte", "Longganisa Alacarte", "Alacarte", 135, 40),
  item("longganisa-solo", "Longganisa Solo", "Solo", 69, 41),
  item("hungarian-alacarte", "Hungarian Alacarte", "Alacarte", 135, 42),
  item("hungarian-solo", "Hungarian Solo", "Solo", 69, 43),
  item("hotdog-alacarte", "Hotdog Alacarte", "Alacarte", 96, 44),
  item("hotdog-solo", "Hotdog Solo", "Solo", 49, 45),

  item("softdrinks", "SoftDrinks", "Drinks", 15, 46),
  item("bottled-water", "Bottled Water", "Drinks", 15, 47),

  item("dinuguan-meal", "Dinuguan Meal", "Special Meal", 85, 48, { availability: { mode: "schedule", days: ["sat", "sun"], start: "00:00", end: "23:59" } }),
  item("papaitan-meal", "Papaitan Meal", "Special Meal", 85, 49)
];

export const demoAccounts = {
  customer: { email: "customer@demo.ph", password: "Customer123!", name: "Juan Dela Cruz" },
  owner: { email: "owner@taptap.ph", password: "Owner123!", name: "Leadell Comia" },
  staff: { email: "staff@taptap.ph", password: "Staff123!", name: "Mika Reyes" },
  rider: { email: "rider@taptap.ph", password: "Rider123!", name: "Marco Dela Cruz" }
};
