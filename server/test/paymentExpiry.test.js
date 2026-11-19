import assert from "node:assert/strict";
import test from "node:test";
import { expirePendingOnlinePayments } from "../src/application/paymentExpiry.js";
import { expirePendingPaymentOrder } from "../src/business.js";
import { claimPayMongoCheckoutCreation, recordPayMongoCheckoutSession } from "../src/application/payments.js";
import { onlinePaymentWindowMs } from "../src/domain/paymentExpiry.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const now = Date.UTC(2026, 10, 19, 8);
const pending = (createdAt, extra = {}) => ({
  customerId: "customer-1", customerName: "Customer", paymentMethod: "gcash",
  paymentStatus: "pending", status: "pending-payment", deliveryType: "pickup",
  createdAt, paymentRequiredAt: createdAt, paymentExpiresAt: createdAt + onlinePaymentWindowMs,
  items: [{ id: "meal-1", name: "Meal", qty: 2, price: 100 }], total: 200,
  ...extra
});

test("each pending order expires on its own deadline and restores stock once", async () => {
  const db = new FakeRealtimeDatabase({
    users: { "customer-1": { role: "customer" } },
    inventory: { "meal-1": { name: "Meal", stock: 3 } },
    public: { menu: { "meal-1": { name: "Meal", stock: 3 } } },
    orders: {
      older: pending(now - onlinePaymentWindowMs - 1000),
      newer: pending(now - 10 * 60 * 1000)
    }
  });
  const result = await expirePendingOnlinePayments({ db, now });
  assert.equal(result.expired, 1);
  assert.equal(db.read("orders/older/status"), "cancelled");
  assert.equal(db.read("orders/older/paymentStatus"), "failed");
  assert.equal(db.read("orders/newer/status"), "pending-payment");
  assert.equal(db.read("inventory/meal-1/stock"), 5);
  assert.equal(db.read("public/menu/meal-1/stock"), 5);
  assert.equal(db.read("paymentMovements/older/expiry/status"), "failed");
  const repeated = await expirePendingPaymentOrder(db, "older", now + 1000);
  assert.equal(repeated.expired, false);
  assert.equal(db.read("inventory/meal-1/stock"), 5);
});

test("a paid session is reconciled and an in-progress payment is deferred", async () => {
  const db = new FakeRealtimeDatabase({ orders: {
    paid: pending(now - onlinePaymentWindowMs - 1000, { providerSessionId: "cs_paid" }),
    processing: pending(now - onlinePaymentWindowMs - 1000, { providerSessionId: "cs_processing" })
  } });
  const confirmed = [];
  const cancelled = [];
  const result = await expirePendingOnlinePayments({ db, now, provider: {
    retrieve: async (id) => id === "cs_paid"
      ? { id, referenceNumber: "paid", status: "active", livemode: false, payments: [{ id: "pay_paid", attributes: { status: "paid", amount: 20000, currency: "PHP" } }] }
      : { id, referenceNumber: "processing", status: "active", livemode: false, payments: [{ id: "pay_processing", attributes: { status: "processing" } }] },
    expire: async () => { throw new Error("Payment processing"); },
    confirm: async (_db, payment) => confirmed.push(payment.orderId),
    cancel: async (_db, id) => { cancelled.push(id); return { expired: true }; }
  } });
  assert.deepEqual(confirmed, ["paid"]);
  assert.deepEqual(cancelled, []);
  assert.equal(result.paid, 1);
  assert.equal(result.deferred, 1);
});

test("an active unpaid checkout is closed before its order releases stock", async () => {
  const db = new FakeRealtimeDatabase({
    users: { "customer-1": { role: "customer" } },
    inventory: { "meal-1": { name: "Meal", stock: 3 } },
    public: { menu: { "meal-1": { name: "Meal", stock: 3 } } },
    orders: { waiting: pending(now - onlinePaymentWindowMs - 1000, { providerSessionId: "cs_waiting" }) }
  });
  let providerClosed = false;
  const result = await expirePendingOnlinePayments({ db, now, provider: {
    retrieve: async () => ({ id: "cs_waiting", referenceNumber: "waiting", status: "active", payments: [] }),
    expire: async () => {
      providerClosed = true;
      assert.equal(db.read("orders/waiting/status"), "pending-payment");
      return { id: "cs_waiting", referenceNumber: "waiting", status: "expired", payments: [] };
    }
  } });
  assert.equal(providerClosed, true);
  assert.equal(result.expired, 1);
  assert.equal(db.read("orders/waiting/status"), "cancelled");
  assert.equal(db.read("inventory/meal-1/stock"), 5);
});

test("checkout creation is blocked after its own deadline", async () => {
  const db = new FakeRealtimeDatabase({ orders: {
    late: pending(Date.now() - onlinePaymentWindowMs - 1000),
    current: pending(Date.now() - 1000)
  } });
  await assert.rejects(() => claimPayMongoCheckoutCreation(db, "late"), /payment window has ended/i);
  const startedAt = await claimPayMongoCheckoutCreation(db, "current");
  assert.equal(db.read("orders/current/checkoutStartingAt"), startedAt);
  await assert.rejects(() => claimPayMongoCheckoutCreation(db, "current"), /already being prepared/i);
  await recordPayMongoCheckoutSession(db, "current", { id: "cs_current", livemode: false }, "test");
  assert.equal(db.read("orders/current/providerSessionId"), "cs_current");
  assert.equal(db.read("orders/current/checkoutStartingAt"), null);
});
