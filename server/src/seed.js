import "dotenv/config";
import admin from "firebase-admin";

if (!process.env.FIREBASE_DATABASE_URL) {
  throw new Error("Set FIREBASE_DATABASE_URL before running the seed command.");
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const menu = {
  sisig: { id: "sisig", name: "Sizzling Pork Sisig", category: "Rice Meals", price: 189, imagePosition: "0% 0%", description: "Crispy pork, onions, chili, calamansi and creamy egg.", allergens: ["egg", "soy"], stock: 18, featured: true },
  inasal: { id: "inasal", name: "Chicken Inasal Meal", category: "Rice Meals", price: 179, imagePosition: "50% 0%", description: "Smoky grilled chicken, garlic rice and house atchara.", allergens: ["soy"], stock: 24, featured: true },
  liempo: { id: "liempo", name: "Crispy Liempo Bowl", category: "Rice Meals", price: 199, imagePosition: "100% 0%", description: "Crackling pork belly, steamed rice and fresh greens.", allergens: [], stock: 9, featured: false },
  pancit: { id: "pancit", name: "Pancit Canton", category: "Noodles", price: 159, imagePosition: "0% 100%", description: "Stir-fried noodles, vegetables, shrimp and quail egg.", allergens: ["shellfish", "egg", "soy", "gluten"], stock: 16, featured: true },
  lumpia: { id: "lumpia", name: "Fresh Lumpia", category: "Merienda", price: 129, imagePosition: "50% 100%", description: "Fresh vegetable rolls with sweet garlic peanut sauce.", allergens: ["peanut"], stock: 7, featured: false },
  halohalo: { id: "halohalo", name: "Classic Halo-Halo", category: "Desserts", price: 139, imagePosition: "100% 100%", description: "Shaved ice, ube, leche flan, jellies and milk.", allergens: ["dairy", "egg"], stock: 13, featured: true }
};

const accounts = [
  { email: "owner@taptap.ph", password: "Owner123!", name: "Leadell Comia", role: "owner" },
  { email: "staff@taptap.ph", password: "Staff123!", name: "Mika Reyes", role: "staff" },
  { email: "rider@taptap.ph", password: "Rider123!", name: "Marco Dela Cruz", role: "rider" },
  { email: "customer@demo.ph", password: "Customer123!", name: "Juan Dela Cruz", role: "customer" }
];

for (const account of accounts) {
  let user;
  try {
    user = await admin.auth().getUserByEmail(account.email);
  } catch {
    user = await admin.auth().createUser({
      email: account.email,
      password: account.password,
      displayName: account.name,
      emailVerified: true
    });
  }
  await admin.auth().setCustomUserClaims(user.uid, { role: account.role });
  await admin.database().ref(`users/${user.uid}`).update({
    name: account.name,
    email: account.email,
    role: account.role,
    seededAt: Date.now()
  });
}

await admin.database().ref("public/menu").set(menu);
await admin.database().ref("inventory").set(
  Object.fromEntries(Object.values(menu).map((item) => [item.id, { name: item.name, stock: item.stock, reorderPoint: 10 }]))
);
await admin.database().ref("public/store").set({
  name: "Taptap Foodtrip",
  address: "BF Resort Drive, Las Pinas City",
  phone: "+639171234567",
  hours: "10:00 AM - 10:00 PM",
  updatedAt: Date.now()
});

console.log("Firebase demo accounts, menu and inventory seeded.");
process.exit(0);
