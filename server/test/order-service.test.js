import test from "node:test";
import assert from "node:assert/strict";
import { createOrderRecord, listOrdersForUser, listOrdersPageForUser, updateOrderRecord, updateReviewRecord } from "../src/business.js";
import { availableDeliveryProjection } from "../src/domain/orderIntegrity.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const customer = {
  uid: "customer-1",
  role: "customer",
  name: "Test Customer",
  email: "customer@example.test"
};

function orderDatabase(stock = 5) {
  return new FakeRealtimeDatabase({
    public: { menu: { "meal-1": { id: "meal-1", name: "Test Meal", price: 99, stock } } },
    inventory: { "meal-1": { id: "meal-1", name: "Test Meal", price: 99, stock, reorderPoint: 2 } },
    users: {
      "customer-1": { name: "Test Customer", role: "customer", phone: "+639171234567", phoneVerified: true },
      "staff-1": { name: "Test Staff", role: "staff" },
      "owner-1": { name: "Test Owner", role: "owner" }
    }
  });
}

function orderInput(key, qty = 1) {
  return {
    idempotencyKey: key,
    items: [{ id: "meal-1", qty }],
    paymentMethod: "cod",
    deliveryType: "pickup",
    phone: "09171234567",
    notes: "Test order"
  };
}

test("replays an identical order request without duplicating stock deductions", async () => {
  const db = orderDatabase();
  const input = orderInput("customer-order-12345");
  const first = await createOrderRecord(db, customer, input);
  const replay = await createOrderRecord(db, customer, input);

  assert.equal(replay.id, first.id);
  assert.equal(replay.idempotent, true);
  assert.equal(db.read("inventory/meal-1/stock"), 4);
  assert.equal(Object.keys(db.read("orders")).length, 1);
  assert.equal(db.read("idempotency/orderCreation/customer-1/customer-order-12345/status"), "complete");
});

test("rejects reuse of an order key for different order details", async () => {
  const db = orderDatabase();
  const key = "customer-order-67890";
  await createOrderRecord(db, customer, orderInput(key, 1));
  await assert.rejects(
    createOrderRecord(db, customer, orderInput(key, 2)),
    (error) => error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.equal(db.read("inventory/meal-1/stock"), 4);
});

test("allows only one concurrent claim for the same order key", async () => {
  const db = orderDatabase();
  const input = orderInput("customer-order-24680");
  const results = await Promise.allSettled([
    createOrderRecord(db, customer, input),
    createOrderRecord(db, customer, input)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason?.status === 409).length, 1);
  assert.equal(db.read("inventory/meal-1/stock"), 4);
  assert.equal(Object.keys(db.read("orders")).length, 1);
});

test("prevents simultaneous checkouts from overselling the final item", async () => {
  const db = orderDatabase(1);
  const results = await Promise.allSettled([
    createOrderRecord(db, customer, orderInput("customer-order-stock-a")),
    createOrderRecord(db, customer, orderInput("customer-order-stock-b"))
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason?.status === 409).length, 1);
  assert.equal(db.read("inventory/meal-1/stock"), 0);
  assert.equal(Object.keys(db.read("orders")).length, 1);
});

test("rejects duplicate products and ignores stale client prices", async () => {
  const db = orderDatabase(5);
  await assert.rejects(
    createOrderRecord(db, customer, {
      ...orderInput("customer-order-duplicates"),
      items: [{ id: "meal-1", qty: 1 }, { id: "meal-1", qty: 1 }]
    }),
    /only once/i
  );
  const result = await createOrderRecord(db, customer, {
    ...orderInput("customer-order-stale-price"),
    items: [{ id: "meal-1", qty: 1, price: 1 }]
  });
  assert.equal(result.order.items[0].price, 99);
  assert.equal(result.order.subtotal, 99);
  assert.equal(db.read("inventory/meal-1/stock"), 4);
});

test("restores cancelled stock once and records the completed recovery", async () => {
  const db = orderDatabase(5);
  const created = await createOrderRecord(db, customer, orderInput("customer-order-cancel", 2));
  const result = await updateOrderRecord(db, customer, created.id, {
    status: "cancelled",
    cancelReason: "Customer changed the order"
  });
  assert.equal(result.order.status, "cancelled");
  assert.equal(typeof result.order.inventoryRestoredAt, "number");
  assert.equal(db.read("inventory/meal-1/stock"), 5);
  assert.equal(db.read(`inventory/__cancellationRestorations/${created.id}`), undefined);
  assert.equal(Object.values(db.read("stockHistory/meal-1")).filter((entry) => entry.action === "order_cancel_restored").length, 1);
  await assert.rejects(
    updateOrderRecord(db, customer, created.id, { status: "cancelled", cancelReason: "Duplicate retry" }),
    /already being prepared|status updates|eligible orders|no longer accepts/i
  );
  assert.equal(db.read("inventory/meal-1/stock"), 5);
});

test("resumes cancellation finalization after a root update failure without restoring twice", async () => {
  const db = orderDatabase(5);
  const created = await createOrderRecord(db, customer, orderInput("customer-order-recovery", 2));
  const originalRef = db.ref.bind(db);
  let failFinalUpdate = true;
  db.ref = (path = "") => {
    const reference = originalRef(path);
    if (path || !failFinalUpdate) return reference;
    return new Proxy(reference, {
      get(target, property, receiver) {
        if (property !== "update") return Reflect.get(target, property, receiver);
        return async (updates) => {
          if (Object.keys(updates || {}).some((key) => key.endsWith("/inventoryRestoredAt"))) {
            failFinalUpdate = false;
            throw new Error("Simulated final update failure");
          }
          return target.update(updates);
        };
      }
    });
  };

  await assert.rejects(
    updateOrderRecord(db, customer, created.id, { status: "cancelled", cancelReason: "Retry test" }),
    /simulated final update failure/i
  );
  assert.equal(db.read(`orders/${created.id}/status`), "cancelled");
  assert.equal(db.read(`orders/${created.id}/inventoryRestoredAt`), undefined);
  assert.equal(db.read("inventory/meal-1/stock"), 5);
  assert.ok(db.read(`inventory/__cancellationRestorations/${created.id}`));

  const recovered = await updateOrderRecord(db, customer, created.id, {
    status: "cancelled",
    cancelReason: "Retry test"
  });
  assert.equal(recovered.order.status, "cancelled");
  assert.equal(typeof recovered.order.inventoryRestoredAt, "number");
  assert.equal(db.read("inventory/meal-1/stock"), 5);
  assert.equal(db.read(`inventory/__cancellationRestorations/${created.id}`), undefined);
  assert.equal(Object.values(db.read("stockHistory/meal-1")).filter((entry) => entry.action === "order_cancel_restored").length, 1);
});

test("queries orders by role and keeps unassigned rider jobs private", async () => {
  const readyOrder = {
    customerId: "customer-2",
    customerName: "Private Name",
    phone: "+639171111111",
    address: "Private address",
    status: "ready",
    deliveryType: "delivery",
    paymentMethod: "cod",
    paymentStatus: "cod-pending",
    items: [{ id: "meal-1", name: "Meal", price: 99, qty: 1 }],
    total: 148,
    createdAt: 300
  };
  const db = new FakeRealtimeDatabase({
    orders: {
      assigned: { ...readyOrder, status: "out-for-delivery", riderId: "rider-1", createdAt: 200 },
      available: readyOrder,
      customer: { ...readyOrder, customerId: "customer-1", deliveryType: "pickup", status: "received", createdAt: 100 },
      archived: { ...readyOrder, customerId: "customer-1", archivedAt: 500, createdAt: 50 }
    },
    availableDeliveries: { available: availableDeliveryProjection("available", readyOrder) }
  });

  const riderOrders = await listOrdersForUser(db, { uid: "rider-1", role: "rider" });
  const available = riderOrders.find((order) => order.id === "available");
  assert.equal(riderOrders.length, 2);
  assert.equal(available.available, true);
  assert.equal(available.address, "Available after claiming");
  assert.equal("phone" in available, false);
  assert.equal("customerName" in available, true);
  assert.notEqual(available.customerName, "Private Name");

  const customerOrders = await listOrdersForUser(db, { uid: "customer-1", role: "customer" });
  assert.deepEqual(customerOrders.map((order) => order.id), ["customer"]);

  const ownerOrders = await listOrdersForUser(db, { uid: "owner-1", role: "owner" });
  assert.deepEqual(new Set(ownerOrders.map((order) => order.id)), new Set(["assigned", "available", "customer"]));
});

test("paginates role-scoped orders without changing the legacy list", async () => {
  const orders = Object.fromEntries(Array.from({ length: 5 }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return [`order-${number}`, {
      customerId: "customer-1",
      customerName: "Customer",
      status: "received",
      deliveryType: "pickup",
      paymentMethod: "cod",
      items: [{ id: "meal-1", name: "Meal", price: 99, qty: 1 }],
      subtotal: 99,
      total: 99,
      createdAt: index + 1
    }];
  }));
  const db = new FakeRealtimeDatabase({ orders });
  const legacy = await listOrdersForUser(db, customer);
  const first = await listOrdersPageForUser(db, customer, { limit: 2 });
  const second = await listOrdersPageForUser(db, customer, { limit: 2, before: first.pagination.nextCursor });

  assert.equal(legacy.length, 5);
  assert.deepEqual(first.orders.map((order) => order.id), ["order-005", "order-004"]);
  assert.equal(first.pagination.nextCursor, "order-004");
  assert.deepEqual(second.orders.map((order) => order.id), ["order-003", "order-002"]);
  assert.equal(second.pagination.nextCursor, "order-002");
});

test("publishes approved reviews without customer identity or contact details", async () => {
  const db = new FakeRealtimeDatabase({
    reviews: {
      "order-1": {
        orderId: "order-1",
        customerId: "customer-1",
        customerName: "Private Customer",
        customerEmail: "private@example.test",
        phone: "+639171234567",
        rating: 5,
        comment: "Fresh meal and clear delivery updates.",
        moderationStatus: "pending",
        createdAt: 1
      }
    }
  });
  await updateReviewRecord(db, { uid: "owner-1", role: "owner", name: "Owner" }, "order-1", {
    moderationStatus: "approved"
  });
  const published = db.read("public/reviews/order-1");
  assert.equal(published.customerLabel, "Verified customer");
  assert.equal("customerId" in published, false);
  assert.equal("customerName" in published, false);
  assert.equal("customerEmail" in published, false);
  assert.equal("phone" in published, false);
});
