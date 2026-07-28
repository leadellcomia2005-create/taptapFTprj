import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchOrderPush,
  orderPushEvent,
  pushStatus,
  registerPushToken,
  removePushTokens
} from "../src/pushNotifications.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const token = "fcm-test-token-that-is-long-enough-for-validation";

function messagingFixture(responses = [{ success: true }]) {
  const calls = [];
  return {
    calls,
    firebase: {
      messaging: () => ({
        async sendEachForMulticast(message) {
          calls.push(message);
          return {
            responses,
            successCount: responses.filter((result) => result.success).length,
            failureCount: responses.filter((result) => !result.success).length
          };
        }
      })
    }
  };
}

test("registers and removes private user-scoped push tokens", async () => {
  const db = new FakeRealtimeDatabase({ users: { "customer-1": { role: "customer" } } });
  const { firebase } = messagingFixture();
  const user = { uid: "customer-1", role: "customer" };

  await registerPushToken(db, firebase, user, token);
  const registered = await pushStatus(db, firebase, user.uid);
  assert.deepEqual(registered, { configured: true, enabled: true, tokenCount: 1 });
  assert.equal(db.read("users/customer-1/notificationPreferences/push"), true);
  assert.equal(Object.values(db.read("pushTokens/customer-1"))[0].token, token);

  await removePushTokens(db, user, { all: true });
  assert.deepEqual(await pushStatus(db, firebase, user.uid), {
    configured: true,
    enabled: false,
    tokenCount: 0
  });
  assert.equal(db.read("users/customer-1/notificationPreferences/push"), false);
});

test("maps only approved customer order events to push messages", () => {
  assert.equal(orderPushEvent({ status: "preparing" }, {}, { created: true }), null);
  assert.equal(orderPushEvent({ status: "ready", deliveryType: "delivery" }, { status: "ready" }), null);
  assert.equal(orderPushEvent({ status: "ready", deliveryType: "pickup" }, { status: "ready" }).key, "ready-for-pickup");
  assert.equal(orderPushEvent({}, { status: "out-for-delivery" }).key, "out-for-delivery");
  assert.equal(orderPushEvent({}, { status: "arrived" }).key, "rider-arrived");
  assert.equal(orderPushEvent({}, { status: "cancelled" }).key, "cancelled");
  assert.equal(orderPushEvent({}, { deliveryIssue: "Could not reach customer" }).key, "customer-action-required");
});

test("sends a privacy-safe order push once and deduplicates the same event", async () => {
  const db = new FakeRealtimeDatabase({
    users: {
      "customer-1": {
        role: "customer",
        notificationPreferences: { orderUpdates: true, push: true }
      }
    }
  });
  const fixture = messagingFixture();
  await registerPushToken(db, fixture.firebase, { uid: "customer-1", role: "customer" }, token);
  const order = {
    customerId: "customer-1",
    customerName: "Private Customer",
    phone: "+639171234567",
    address: "Private address",
    deliveryType: "delivery",
    status: "out-for-delivery"
  };

  const first = await dispatchOrderPush({
    firebase: fixture.firebase,
    db,
    orderId: "order-123",
    order,
    changes: { status: "out-for-delivery" },
    appBaseUrl: "https://example.test"
  });
  const duplicate = await dispatchOrderPush({
    firebase: fixture.firebase,
    db,
    orderId: "order-123",
    order,
    changes: { status: "out-for-delivery" },
    appBaseUrl: "https://example.test"
  });

  assert.equal(first.sent, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(fixture.calls.length, 1);
  const serialized = JSON.stringify(fixture.calls[0]);
  assert.doesNotMatch(serialized, /Private Customer|Private address|639171234567/);
  assert.deepEqual(Object.keys(fixture.calls[0].data).sort(), [
    "body",
    "destination",
    "event",
    "orderId",
    "title"
  ]);
});

test("removes an invalid FCM token after a provider rejection", async () => {
  const db = new FakeRealtimeDatabase({
    users: {
      "customer-1": {
        role: "customer",
        notificationPreferences: { orderUpdates: true, push: true }
      }
    }
  });
  const fixture = messagingFixture([{
    success: false,
    error: { code: "messaging/registration-token-not-registered" }
  }]);
  await registerPushToken(db, fixture.firebase, { uid: "customer-1", role: "customer" }, token);

  const result = await dispatchOrderPush({
    firebase: fixture.firebase,
    db,
    orderId: "order-invalid-token",
    order: {
      customerId: "customer-1",
      deliveryType: "pickup",
      status: "ready"
    },
    changes: { status: "ready" }
  });

  assert.equal(result.sent, false);
  assert.deepEqual(db.read("pushTokens/customer-1"), {});
  assert.equal(db.read("users/customer-1/notificationPreferences/push"), false);
});

test("keeps order workflows successful when optional push delivery cannot read its records", async () => {
  const warnings = [];
  const fixture = messagingFixture();
  const result = await dispatchOrderPush({
    firebase: fixture.firebase,
    db: {
      ref() {
        throw new Error("simulated database outage");
      }
    },
    orderId: "order-push-outage",
    order: {
      customerId: "customer-1",
      deliveryType: "delivery",
      status: "out-for-delivery"
    },
    changes: { status: "out-for-delivery" },
    logger: {
      warn(event, details) {
        warnings.push({ event, details });
      }
    }
  });

  assert.deepEqual(result, { sent: false, reason: "dispatch-error" });
  assert.equal(warnings[0].event, "push_delivery_failed");
  assert.equal(fixture.calls.length, 0);
});
