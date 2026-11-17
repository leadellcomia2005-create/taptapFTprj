import test from "node:test";
import assert from "node:assert/strict";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";
import { completeManualRefund, decideRefund, requestRefund } from "../src/application/refunds.js";

const customer = { uid: "customer-1", role: "customer", name: "Customer" };
const owner = { uid: "owner-1", role: "owner", name: "Owner" };
const order = (overrides = {}) => ({ customerId: customer.uid, customerName: customer.name, total: 297, createdAt: Date.now(), status: "delivered", paymentMethod: "gcash", paymentStatus: "paid", paymentProvider: "paymongo", providerLivemode: false, providerPaymentId: "pay_test123", ...overrides });
const database = (value = order()) => new FakeRealtimeDatabase({ orders: { "TAP-1": value }, users: { [owner.uid]: { role: "owner" } } });
const request = { reason: "Missing item", details: "The delivered order was missing an item." };

test("customer can request one refund for a paid sandbox order, including after delivery", async () => {
  const db = database();
  const result = await requestRefund(db, customer, "TAP-1", request);
  assert.equal(result.refundRequest.status, "pending-review");
  assert.equal(result.refundRequest.mode, "paymongo-test");
  await assert.rejects(requestRefund(db, customer, "TAP-1", request), /already exists/);
  assert.equal(db.read("orders/TAP-1/refundRequest/id"), "REF-TAP-1");
});

test("refund request checks ownership and verified payment", async () => {
  const db = database();
  await assert.rejects(requestRefund(db, { uid: "other", role: "customer" }, "TAP-1", request), /not yours/);
  const unpaid = database(order({ paymentStatus: "pending" }));
  await assert.rejects(requestRefund(unpaid, customer, "TAP-1", request), /Only paid orders/);
  const live = database(order({ providerLivemode: true }));
  await assert.rejects(requestRefund(live, customer, "TAP-1", request), /sandbox payment record/);
});

test("only owner can approve a cash refund and records a separate manual completion", async () => {
  const db = database(order({ paymentMethod: "cod", paymentStatus: "cod-collected" }));
  await requestRefund(db, customer, "TAP-1", request);
  await assert.rejects(decideRefund(db, { uid: "staff-1", role: "staff" }, "TAP-1", { action: "approve", note: "Verified issue" }), /Owner access/);
  const approved = await decideRefund(db, owner, "TAP-1", { action: "approve", note: "Verified issue" });
  assert.equal(approved.refundRequest.status, "approved-manual");
  assert.equal(db.read("orders/TAP-1/paymentStatus"), "cod-collected");
  const completed = await completeManualRefund(db, owner, "TAP-1", { method: "Cash handoff", reference: "RECEIPT-123" });
  assert.equal(completed.refundRequest.status, "manual-refunded");
  assert.equal(db.read("orders/TAP-1/paymentStatus"), "refunded");
  await assert.rejects(completeManualRefund(db, owner, "TAP-1", { method: "Cash handoff", reference: "RECEIPT-123" }), /No approved manual refund/);
});

test("owner rejection records a decision without changing payment status", async () => {
  const db = database();
  await requestRefund(db, customer, "TAP-1", request);
  const result = await decideRefund(db, owner, "TAP-1", { action: "reject", note: "No missing item" });
  assert.equal(result.refundRequest.status, "rejected");
  assert.equal(result.refundRequest.decisionNote, "No missing item");
  assert.equal(db.read("orders/TAP-1/paymentStatus"), "paid");
});

test("PayMongo success is recorded as sandbox only and never repeated", async () => {
  const db = database();
  await requestRefund(db, customer, "TAP-1", request);
  let calls = 0;
  const options = { configuration: { mode: "test", secretKey: "sk_test_fake" }, fetchImpl: async (_url, init) => {
    calls += 1;
    assert.equal(init.headers["Idempotency-Key"].startsWith("taptap-refund-test-"), true);
    return new Response(JSON.stringify({ data: { type: "refund", id: "ref_test123", attributes: { payment_id: "pay_test123", amount: 29700, livemode: false, status: "succeeded" } } }), { status: 200 });
  } };
  const result = await decideRefund(db, owner, "TAP-1", { action: "approve", note: "Verified issue" }, options);
  assert.equal(result.refundRequest.status, "test-refunded");
  assert.equal(db.read("orders/TAP-1/paymentStatus"), "refunded");
  await assert.rejects(decideRefund(db, owner, "TAP-1", { action: "approve", note: "Again" }, options), /already been reviewed/);
  assert.equal(calls, 1);
});

test("provider failure never records a completed refund", async () => {
  const db = database();
  await requestRefund(db, customer, "TAP-1", request);
  const result = await decideRefund(db, owner, "TAP-1", { action: "approve", note: "Verified issue" }, {
    configuration: { mode: "test", secretKey: "sk_test_fake" },
    fetchImpl: async () => new Response(JSON.stringify({ errors: [{ detail: "Refund unavailable" }] }), { status: 409 })
  });
  assert.equal(result.refundRequest.status, "failed");
  assert.equal(db.read("orders/TAP-1/paymentStatus"), "paid");
});

test("pending PayMongo test refund stays processing until a verified status refresh", async () => {
  const db = database();
  await requestRefund(db, customer, "TAP-1", request);
  let calls = 0;
  const options = { configuration: { mode: "test", secretKey: "sk_test_fake" }, fetchImpl: async (url) => {
    calls += 1;
    assert.equal(url.endsWith(calls === 1 ? "/refunds" : "/refunds/ref_test123"), true);
    const status = calls === 1 ? "processing" : "succeeded";
    return new Response(JSON.stringify({ data: { type: "refund", id: "ref_test123", attributes: { payment_id: "pay_test123", amount: 29700, livemode: false, status } } }), { status: 200 });
  } };
  const pending = await decideRefund(db, owner, "TAP-1", { action: "approve", note: "Verified issue" }, options);
  assert.equal(pending.refundRequest.status, "processing");
  assert.equal(db.read("orders/TAP-1/paymentStatus"), "paid");
  const finished = await decideRefund(db, owner, "TAP-1", { action: "refresh", note: "Verify provider refund status" }, options);
  assert.equal(finished.refundRequest.status, "test-refunded");
  assert.equal(db.read("orders/TAP-1/paymentStatus"), "refunded");
  assert.equal(calls, 2);
});
