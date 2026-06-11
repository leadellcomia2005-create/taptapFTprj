export const fallbackMenu = [
  {
    id: "sisig",
    name: "Sizzling Pork Sisig",
    category: "Rice Meals",
    price: 189,
    imagePosition: "0% 0%",
    description: "Crispy pork, onions, chili, calamansi and creamy egg.",
    allergens: ["egg", "soy"],
    stock: 18,
    featured: true
  },
  {
    id: "inasal",
    name: "Chicken Inasal Meal",
    category: "Rice Meals",
    price: 179,
    imagePosition: "50% 0%",
    description: "Smoky grilled chicken, garlic rice and house atchara.",
    allergens: ["soy"],
    stock: 24,
    featured: true
  },
  {
    id: "liempo",
    name: "Crispy Liempo Bowl",
    category: "Rice Meals",
    price: 199,
    imagePosition: "100% 0%",
    description: "Crackling pork belly, steamed rice and fresh greens.",
    allergens: [],
    stock: 9,
    featured: false
  },
  {
    id: "pancit",
    name: "Pancit Canton",
    category: "Noodles",
    price: 159,
    imagePosition: "0% 100%",
    description: "Stir-fried noodles, vegetables, shrimp and quail egg.",
    allergens: ["shellfish", "egg", "soy", "gluten"],
    stock: 16,
    featured: true
  },
  {
    id: "lumpia",
    name: "Fresh Lumpia",
    category: "Merienda",
    price: 129,
    imagePosition: "50% 100%",
    description: "Fresh vegetable rolls with sweet garlic peanut sauce.",
    allergens: ["peanut"],
    stock: 7,
    featured: false
  },
  {
    id: "halohalo",
    name: "Classic Halo-Halo",
    category: "Desserts",
    price: 139,
    imagePosition: "100% 100%",
    description: "Shaved ice, ube, leche flan, jellies and milk.",
    allergens: ["dairy", "egg"],
    stock: 13,
    featured: true
  }
];

export const demoSales = [12450, 15600, 14200, 21850, 18700, 23900, 26750];

export const demoAccounts = {
  customer: { email: "customer@demo.ph", password: "Customer123!", name: "Juan Dela Cruz" },
  owner: { email: "owner@taptap.ph", password: "Owner123!", name: "Leadell Comia" },
  staff: { email: "staff@taptap.ph", password: "Staff123!", name: "Mika Reyes" },
  rider: { email: "rider@taptap.ph", password: "Rider123!", name: "Marco Dela Cruz" }
};
