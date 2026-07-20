import assert from "node:assert/strict";
import test from "node:test";
import {
  apiErrorResponseSchema,
  complaintContractSchema,
  deliveryLocationContractSchema,
  notificationContractSchema,
  orderContractSchema,
  userContractSchema
} from "../src/contracts/domain.js";

test("shares canonical role, order, complaint, notification, and location contracts", () => {
  assert.equal(userContractSchema.safeParse({ uid: "customer-1", role: "customer" }).success, true);
  assert.equal(userContractSchema.safeParse({ uid: "customer-1", role: "administrator" }).success, false);
  assert.equal(deliveryLocationContractSchema.safeParse({ lat: 14.45, lng: 120.98 }).success, true);
  assert.equal(deliveryLocationContractSchema.safeParse({ lat: 100, lng: 120.98 }).success, false);
  assert.equal(complaintContractSchema.safeParse({
    orderId: "order-1",
    customerId: "customer-1",
    type: "wrong-item",
    status: "pending",
    details: "A different meal arrived.",
    createdAt: 1
  }).success, true);
  assert.equal(notificationContractSchema.safeParse({
    targetUserId: "customer-1",
    title: "Order ready",
    message: "Your order is ready.",
    type: "order",
    createdAt: 1
  }).success, true);
  assert.equal(orderContractSchema.safeParse({
    customerId: "customer-1",
    items: [{ id: "meal-1", qty: 1 }],
    status: "received",
    paymentMethod: "cod",
    paymentStatus: "cod-pending",
    deliveryType: "pickup",
    subtotal: 99,
    total: 99,
    createdAt: 1
  }).success, true);
  assert.equal(apiErrorResponseSchema.safeParse({ error: "Invalid body.", code: "VALIDATION_ERROR" }).success, true);
});
