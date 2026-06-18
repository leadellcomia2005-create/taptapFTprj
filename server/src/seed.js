import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { fallbackMenu } from "../../client/src/data/menu.js";

dotenv.config({ override: true });

if (!process.env.FIREBASE_DATABASE_URL) {
  throw new Error("Set FIREBASE_DATABASE_URL before running the seed command.");
}

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")))
    : applicationDefault(),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const auth = getAuth();
const database = getDatabase();

const menu = Object.fromEntries(fallbackMenu.map((item) => [item.id, item]));

const accounts = [
  { email: "owner@taptap.ph", password: "Owner123!", name: "Leadell Comia", role: "owner" },
  { email: "staff@taptap.ph", password: "Staff123!", name: "Mika Reyes", role: "staff" },
  { email: "rider@taptap.ph", password: "Rider123!", name: "Marco Dela Cruz", role: "rider" },
  { email: "customer@demo.ph", password: "Customer123!", name: "Juan Dela Cruz", role: "customer" }
];

for (const account of accounts) {
  let user;
  try {
    user = await auth.getUserByEmail(account.email);
  } catch {
    user = await auth.createUser({
      email: account.email,
      password: account.password,
      displayName: account.name,
      emailVerified: true
    });
  }
  if (account.role !== "customer" && !user.emailVerified) {
    user = await auth.updateUser(user.uid, { emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { role: account.role });
  await database.ref(`users/${user.uid}`).update({
    name: account.name,
    email: account.email,
    role: account.role,
    seededAt: Date.now()
  });
}

await database.ref("public/menu").set(menu);
await database.ref("inventory").set(
  Object.fromEntries(Object.values(menu).map((item) => [item.id, { name: item.name, stock: item.stock, reorderPoint: 10 }]))
);
await database.ref("public/store").set({
  name: "Taptap Foodtrip",
  address: "#17 Gemini Street, Pamplona Park, Pamplona Dos, Las Pinas City 1740",
  latitude: 14.4509229,
  longitude: 120.9764514,
  phone: "+639171234567",
  hours: "10:00 AM - 10:00 PM",
  updatedAt: Date.now()
});

console.log("Firebase demo accounts, menu and inventory seeded.");
process.exit(0);
