import assert from "node:assert/strict";
import test from "node:test";
import { applyTextBeeWebhook, dispatchOrderSms } from "../src/application/smsNotifications.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const eligibleOrder = {
  customerId: "customer-1",
  phone: "+639171234567",
  phoneVerified: true,
  smsNotifications: true
};

test("sends exactly one out-for-delivery SMS and suppresses duplicate status updates", async () => {
  const db = new FakeRealtimeDatabase();
  let sends = 0;
  const sendSms = async () => ({ smsBatchId: `batch-${++sends}`, deviceId: "device-1" });
  const first = await dispatchOrderSms({ db, orderId: "order-1", order: eligibleOrder, changes: { status: "out-for-delivery" }, sendSms, now: 1000 });
  const duplicate = await dispatchOrderSms({ db, orderId: "order-1", order: eligibleOrder, changes: { status: "out-for-delivery" }, sendSms, now: 2000 });
  assert.equal(first.sent, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(sends, 1);
});

test("sends cancellation SMS but not preparing or delivered SMS", async () => {
  const db = new FakeRealtimeDatabase();
  let sends = 0;
  const sendSms = async () => ({ smsBatchId: `batch-${++sends}` });
  for (const status of ["preparing", "delivered"]) {
    const result = await dispatchOrderSms({ db, orderId: `order-${status}`, order: eligibleOrder, changes: { status }, sendSms });
    assert.equal(result.skipped, "status");
  }
  const cancelled = await dispatchOrderSms({ db, orderId: "order-cancelled", order: eligibleOrder, changes: { status: "cancelled" }, sendSms });
  assert.equal(cancelled.sent, true);
  assert.equal(sends, 1);
});

test("rejects unverified or opted-out customer phone numbers", async () => {
  const db = new FakeRealtimeDatabase();
  const sendSms = async () => { throw new Error("must not send"); };
  for (const order of [
    { ...eligibleOrder, phoneVerified: false },
    { ...eligibleOrder, smsNotifications: false },
    { ...eligibleOrder, phone: "" }
  ]) {
    const result = await dispatchOrderSms({ db, orderId: Math.random().toString(), order, changes: { status: "out-for-delivery" }, sendSms });
    assert.equal(result.skipped, "not-eligible");
  }
});

test("processes webhook delivery once and ignores duplicate events", async () => {
  const db = new FakeRealtimeDatabase({
    smsDeliveryBatches: { "batch-1": "delivery-1" },
    smsDeliveries: { "delivery-1": { deliveryStatus: "pending", orderId: "order-1", orderReference: "TAP-12345678" } }
  });
  const event = { idempotencyKey: "event-1", smsBatchId: "batch-1", webhookEvent: "MESSAGE_DELIVERED", smsId: "sms-1" };
  const first = await applyTextBeeWebhook({ db, event, now: 1000 });
  const duplicate = await applyTextBeeWebhook({ db, event, now: 2000 });
  assert.equal(first.processed, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.read("smsDeliveries/delivery-1/deliveryStatus"), "delivered");
});
