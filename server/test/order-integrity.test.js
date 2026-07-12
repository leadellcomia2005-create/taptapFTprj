import test from "node:test";
import assert from "node:assert/strict";
import {
  availableDeliveryProjection,
  manilaDateKey,
  normalizeIdempotencyKey,
  orderCreationAggregateUpdates,
  orderTransitionAggregateUpdates,
  paymentMovementRecord,
  retentionTimestamp
} from "../src/domain/orderIntegrity.js";

test("projects available deliveries without customer contact data", () => {
  const projection = availableDeliveryProjection("TAP-1", {
    customerId: "customer-1",
    customerName: "Private Customer",
    phone: "+639123456789",
    address: "Private address",
    status: "ready",
    deliveryType: "delivery",
    paymentMethod: "cod",
    paymentStatus: "cod-pending",
    items: [{ id: "meal-1", name: "Meal", price: 99, qty: 1 }],
    subtotal: 99,
    total: 148,
    createdAt: 1000
  });
  assert.equal(projection.customerId, "available");
  assert.equal(projection.address, "Available after claiming");
  assert.equal("phone" in projection, false);
  assert.equal(availableDeliveryProjection("TAP-1", { status: "ready", deliveryType: "delivery", riderId: "rider-1" }), null);
});

test("normalizes retry-safe order keys", () => {
  assert.equal(normalizeIdempotencyKey("order_123456789"), "order_123456789");
  assert.equal(normalizeIdempotencyKey("short"), "");
  assert.equal(normalizeIdempotencyKey("../../orders/delete"), "");
});

test("uses Asia Manila dates for report aggregates", () => {
  assert.equal(manilaDateKey(Date.UTC(2026, 0, 1, 16, 30)), "2026-01-02");
  const updates = orderCreationAggregateUpdates({ total: 118, paymentStatus: "paid", deliveryType: "pickup" }, Date.UTC(2026, 0, 1, 16, 30));
  assert.deepEqual(updates["reportAggregates/daily/2026-01-02/grossSales"], { ".sv": { increment: 118 } });
  assert.deepEqual(updates["reportAggregates/daily/2026-01-02/pickupCount"], { ".sv": { increment: 1 } });
});

test("reverses aggregate revenue when an order is cancelled", () => {
  const previous = { status: "received", paymentStatus: "paid", total: 150, createdAt: Date.UTC(2026, 0, 2) };
  const updates = orderTransitionAggregateUpdates(previous, { ...previous, status: "cancelled" }, Date.UTC(2026, 0, 2, 1));
  const prefix = "reportAggregates/daily/2026-01-02";
  assert.deepEqual(updates[`${prefix}/grossSales`], { ".sv": { increment: -150 } });
  assert.deepEqual(updates[`${prefix}/paidSales`], { ".sv": { increment: -150 } });
  assert.deepEqual(updates[`${prefix}/cancelledCount`], { ".sv": { increment: 1 } });
});

test("creates immutable payment movements and retention timestamps", () => {
  const movement = paymentMovementRecord({
    orderId: "TAP-1",
    order: { paymentMethod: "cod", paymentStatus: "paid", total: 199 },
    previousStatus: "cod-collected",
    user: { uid: "owner-1", role: "owner" },
    createdAt: 1000,
    reason: "cod_remitted"
  });
  assert.equal(movement.previousStatus, "cod-collected");
  assert.equal(movement.amount, 199);
  assert.equal(retentionTimestamp(1000, 30), 2_592_001_000);
});
