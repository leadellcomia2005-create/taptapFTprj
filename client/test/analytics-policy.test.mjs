import test from "node:test";
import assert from "node:assert/strict";
import {
  analyticsOnceStorageKey,
  buildAnalyticsPayload,
  hasRecordedAnalyticsEvent,
  rememberAnalyticsEvent
} from "../src/services/analyticsPolicy.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("analytics payloads retain only approved non-private fields", () => {
  const payload = buildAnalyticsPayload("purchase", {
    transaction_id: "TAP-1001",
    currency: "PHP",
    value: 198,
    email: "customer@example.com",
    phone: "09171234567",
    address: "Private address",
    items: [{
      item_id: "tapa-meal",
      item_name: "Tapa Meal",
      price: 99,
      quantity: 2,
      customerName: "Private Customer"
    }]
  });

  assert.deepEqual(payload, {
    transaction_id: "TAP-1001",
    currency: "PHP",
    value: 198,
    items: [{
      item_id: "tapa-meal",
      item_name: "Tapa Meal",
      price: 99,
      quantity: 2
    }]
  });
  assert.equal(buildAnalyticsPayload("unknown_event", {}), null);
});

test("completed-order analytics keys are recorded once and kept bounded", () => {
  const storage = memoryStorage();
  assert.equal(hasRecordedAnalyticsEvent(storage, "purchase:TAP-1001"), false);
  assert.equal(rememberAnalyticsEvent(storage, "purchase:TAP-1001", 1), true);
  assert.equal(hasRecordedAnalyticsEvent(storage, "purchase:TAP-1001"), true);
  assert.equal(rememberAnalyticsEvent(storage, "purchase:TAP-1001", 2), false);

  for (let index = 0; index < 220; index += 1) {
    rememberAnalyticsEvent(storage, `purchase:TAP-${index + 2000}`, index + 10);
  }
  const records = JSON.parse(storage.getItem(analyticsOnceStorageKey));
  assert.equal(Object.keys(records).length, 200);
});
