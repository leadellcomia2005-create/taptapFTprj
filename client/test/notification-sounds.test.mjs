import assert from "node:assert/strict";
import test from "node:test";
import { highestPriorityNotificationSound, notificationSoundKind } from "../src/services/notificationSounds.js";

test("maps operational notifications to distinct sound patterns", () => {
  assert.equal(notificationSoundKind({ type: "chat", title: "New support message" }), "chat");
  assert.equal(notificationSoundKind({ type: "order", title: "New order received" }), "order");
  assert.equal(notificationSoundKind({ type: "order", title: "Order ready" }), "ready");
  assert.equal(notificationSoundKind({ type: "inventory", title: "Low stock" }), "priority");
  assert.equal(notificationSoundKind({ type: "system", title: "Account updated" }), null);
});

test("plays only the highest-priority sound for a notification burst", () => {
  const kind = highestPriorityNotificationSound([
    { type: "chat", title: "Customer replied" },
    { type: "order", title: "New order" },
    { type: "complaint", title: "Urgent customer issue" }
  ]);
  assert.equal(kind, "priority");
});
