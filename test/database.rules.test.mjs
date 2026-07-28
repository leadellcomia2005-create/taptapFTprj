import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  equalTo,
  get,
  limitToLast,
  orderByChild,
  query,
  ref,
  set,
  update
} from "firebase/database";

const projectId = "demo-taptap-foodtrip";
const rulesPath = fileURLToPath(new URL("../database.rules.json", import.meta.url));
let environment;

const claims = (role, overrides = {}) => ({ role, email_verified: true, mfaSession: true, ...overrides });
const databaseFor = (uid, role, overrides) => environment.authenticatedContext(uid, claims(role, overrides)).database();

const seed = {
  public: {
    menu: { meal: { id: "meal", name: "Meal", category: "Favorite Meal", price: 99 } },
    reviews: {
      reviewPublic: {
        orderId: "order-own",
        customerLabel: "Juan customer",
        rating: 5,
        comment: "Fresh and filling.",
        moderationStatus: "approved",
        createdAt: 1
      }
    }
  },
  users: {
    "customer-1": {
      name: "Customer One",
      email: "customer1@example.test",
      role: "customer",
      staffRole: null,
      phoneVerified: false,
      phoneVerifiedAt: null,
      securitySetupRequired: false
    },
    "customer-2": { name: "Customer Two", role: "customer" },
    "rider-1": { name: "Rider One", role: "rider" },
    "rider-2": { name: "Rider Two", role: "rider" }
  },
  orders: {
    "order-own": { customerId: "customer-1", riderId: "rider-1", status: "delivered", deliveryType: "delivery" },
    "order-other": { customerId: "customer-2", riderId: "rider-2", status: "ready", deliveryType: "delivery" },
    "order-assigned": { customerId: "customer-2", riderId: "rider-1", status: "out-for-delivery", deliveryType: "delivery" }
  },
  availableDeliveries: {
    "order-available": {
      customerId: "available",
      customerName: "Delivery customer",
      address: "Available after claiming",
      deliveryType: "delivery",
      items: [],
      subtotal: 99,
      total: 148,
      paymentMethod: "cod",
      paymentStatus: "cod-pending",
      status: "ready",
      createdAt: 1
    }
  },
  inventory: { meal: { name: "Meal", stock: 10, reorderPoint: 3 } },
  stockHistory: { meal: { movement: { itemId: "meal", delta: -1, createdAt: 1 } } },
  paymentMovements: { "order-own": { payment: { orderId: "order-own", amount: 148, status: "paid" } } },
  paymongoWebhookEvents: { event: { status: "complete", orderId: "order-own" } },
  reportAggregates: { daily: { "2026-07-12": { date: "2026-07-12", grossSales: 148 } } },
  auditLogs: { audit: { action: "order_created", createdAt: 1 } },
  reviews: {},
  notifications: {
    own: { targetUserId: "customer-1", title: "Own", message: "Own notification", createdAt: 1 },
    other: { targetUserId: "customer-2", title: "Other", message: "Other notification", createdAt: 1 }
  },
  deliveryProofs: {
    "order-own": { riderId: "rider-1", createdAt: 1, expiresAt: 2 }
  }
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: await readFile(rulesPath, "utf8")
    }
  });
});

beforeEach(async () => {
  await environment.clearDatabase();
  await environment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database()), seed);
  });
});

after(async () => {
  await environment?.cleanup();
});

test("public catalog and approved reviews are readable without private review access", async () => {
  const database = environment.unauthenticatedContext().database();
  await assertSucceeds(get(ref(database, "public/menu")));
  await assertSucceeds(get(ref(database, "public/store")));
  await assertSucceeds(get(ref(database, "public/reviews")));
  await assertFails(get(ref(database, "reviews")));
  await assertFails(get(ref(database, "availableDeliveries")));
});

test("verified email and MFA claims are both required for private records", async () => {
  const unverified = databaseFor("customer-1", "customer", { email_verified: false });
  const missingMfa = databaseFor("customer-1", "customer", { mfaSession: false });
  await assertFails(get(ref(unverified, "users/customer-1")));
  await assertFails(get(ref(unverified, "orders/order-own")));
  await assertFails(update(ref(unverified, "users/customer-1"), { address: "Unverified update" }));
  await assertFails(get(ref(missingMfa, "users/customer-1")));
  await assertFails(get(ref(missingMfa, "orders/order-own")));
  await assertFails(update(ref(missingMfa, "users/customer-1"), { address: "Missing MFA update" }));
});

test("customers cannot read another customer profile", async () => {
  const customer = databaseFor("customer-1", "customer");
  await assertSucceeds(get(ref(customer, "users/customer-1")));
  await assertFails(get(ref(customer, "users/customer-2")));
  await assertSucceeds(get(ref(databaseFor("owner-1", "owner"), "users/customer-2")));
});

test("customers can read only their order and cannot change protected profile fields", async () => {
  const database = databaseFor("customer-1", "customer");
  await assertSucceeds(get(ref(database, "orders/order-own")));
  await assertFails(get(ref(database, "orders/order-other")));
  await assertSucceeds(update(ref(database, "users/customer-1"), { address: "Updated address" }));
  await assertFails(update(ref(database, "users/customer-1"), { phoneVerified: true }));
  await assertFails(update(ref(database, "users/customer-1"), { role: "owner" }));
  await assertSucceeds(get(query(ref(database, "orders"), orderByChild("customerId"), equalTo("customer-1"), limitToLast(20))));
});

test("owner and staff operational access remains scoped", async () => {
  const owner = databaseFor("owner-1", "owner");
  const staff = databaseFor("staff-1", "staff");
  await assertSucceeds(get(ref(owner, "inventory")));
  await assertSucceeds(get(ref(owner, "auditLogs")));
  await assertSucceeds(get(ref(owner, "paymentMovements")));
  await assertFails(get(ref(owner, "paymongoWebhookEvents")));
  await assertSucceeds(get(ref(staff, "inventory")));
  await assertSucceeds(get(ref(staff, "reportAggregates")));
  await assertFails(get(ref(staff, "auditLogs")));
  await assertFails(get(ref(staff, "paymentMovements")));
});

test("riders read assigned orders and sanitized availability only", async () => {
  const database = databaseFor("rider-1", "rider");
  const assigned = await assertSucceeds(get(query(ref(database, "orders"), orderByChild("riderId"), equalTo("rider-1"))));
  assert.equal(assigned.hasChild("order-assigned"), true);
  await assertFails(get(query(ref(database, "orders"), orderByChild("status"), equalTo("ready"))));
  await assertFails(get(ref(database, "orders/order-other")));
  const available = await assertSucceeds(get(ref(database, "availableDeliveries")));
  assert.equal(available.child("order-available/phone").exists(), false);
});

test("only the delivered-order customer can create its pending review", async () => {
  const review = {
    orderId: "order-own",
    customerId: "customer-1",
    customerName: "Customer One",
    rating: 5,
    comment: "Great meal",
    moderationStatus: "pending",
    createdAt: Date.now()
  };
  await assertSucceeds(set(ref(databaseFor("customer-1", "customer"), "reviews/order-own"), review));
  await assertFails(set(ref(databaseFor("customer-2", "customer"), "reviews/order-own"), { ...review, customerId: "customer-2" }));
});

test("notifications require a bounded user-scoped query", async () => {
  const database = databaseFor("customer-1", "customer");
  const ownNotifications = await assertSucceeds(get(query(ref(database, "notifications"), orderByChild("targetUserId"), equalTo("customer-1"), limitToLast(100))));
  assert.equal(ownNotifications.hasChild("own"), true);
  assert.equal(ownNotifications.hasChild("other"), false);
  await assertFails(get(ref(database, "notifications")));
  await assertFails(get(ref(database, "notifications/other")));
});

test("sensitive records reject all direct browser writes", async () => {
  const owner = databaseFor("owner-1", "owner");
  const staff = databaseFor("staff-1", "staff");
  const rider = databaseFor("rider-1", "rider");
  await assertFails(set(ref(owner, "public/menu/new-meal"), { id: "new-meal", name: "Unvalidated meal" }));
  await assertFails(set(ref(owner, "public/store/hours"), { open: "00:00", close: "23:59" }));
  await assertFails(set(ref(staff, "public/menu/new-meal"), { id: "new-meal", name: "Staff meal" }));
  await assertFails(update(ref(owner, "orders/order-own"), { status: "completed" }));
  await assertFails(update(ref(owner, "inventory/meal"), { stock: 999 }));
  await assertFails(set(ref(owner, "paymentMovements/fake"), { amount: 1 }));
  await assertFails(set(ref(owner, "idempotency/fake"), { orderId: "fake" }));
  await assertFails(set(ref(owner, "paymongoWebhookEvents/fake"), { status: "complete" }));
  await assertFails(set(ref(rider, "deliveryProofs/order-own"), { riderId: "rider-1" }));
});
