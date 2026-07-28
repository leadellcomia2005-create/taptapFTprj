import assert from "node:assert/strict";
import test from "node:test";
import {
  clearReadNotifications,
  markNotificationRead,
  notificationDisplayReference,
  notificationRecord
} from "../src/notifications.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

test("creates backward-compatible structured notification records", () => {
  const before = Date.now();
  const record = notificationRecord("owner-1", {
    title: "New sale recorded",
    message: "A sale was added to the ledger.",
    type: "sale",
    orderId: "-Ow6nA3A5SvOvN3VNs0",
    entityType: "payment",
    amount: 475,
    actionView: "owner-sales"
  });

  assert.equal(record.targetUserId, "owner-1");
  assert.equal(record.orderId, "-Ow6nA3A5SvOvN3VNs0");
  assert.equal(record.entityId, "-Ow6nA3A5SvOvN3VNs0");
  assert.equal(record.entityType, "payment");
  assert.equal(record.displayReference, notificationDisplayReference(record.orderId));
  assert.equal(record.amount, 475);
  assert.equal(record.actionView, "owner-sales");
  assert.equal(record.readAt, null);
  assert.ok(record.createdAt >= before);
  assert.equal(record.expiresAt - record.createdAt, 30 * 24 * 60 * 60 * 1000);
});

test("marks only the owned notification as read", async () => {
  const database = new FakeRealtimeDatabase({
    notifications: {
      "own-one": { targetUserId: "customer-1", title: "One", message: "One", createdAt: 1, expiresAt: Date.now() + 60_000, readAt: null },
      "own-two": { targetUserId: "customer-1", title: "Two", message: "Two", createdAt: 2, expiresAt: Date.now() + 60_000, readAt: null },
      other: { targetUserId: "customer-2", title: "Other", message: "Other", createdAt: 3, expiresAt: Date.now() + 60_000, readAt: null }
    }
  });

  assert.equal(await markNotificationRead(database, "customer-1", "own-one"), true);
  assert.equal(typeof database.read("notifications/own-one/readAt"), "number");
  assert.equal(database.read("notifications/own-two/readAt"), null);
  assert.equal(database.read("notifications/other/readAt"), null);
  await assert.rejects(() => markNotificationRead(database, "customer-1", "other"), /another user's notification/i);
});

test("clears read and expired records without deleting unread notifications", async () => {
  const now = Date.now();
  const database = new FakeRealtimeDatabase({
    notifications: {
      read: { targetUserId: "owner-1", readAt: now - 1_000, expiresAt: now + 60_000 },
      expired: { targetUserId: "owner-1", readAt: null, expiresAt: now - 1_000 },
      unread: { targetUserId: "owner-1", readAt: null, expiresAt: now + 60_000 },
      other: { targetUserId: "owner-2", readAt: now - 1_000, expiresAt: now + 60_000 }
    }
  });

  assert.equal(await clearReadNotifications(database, "owner-1"), 2);
  assert.equal(database.read("notifications/read"), undefined);
  assert.equal(database.read("notifications/expired"), undefined);
  assert.ok(database.read("notifications/unread"));
  assert.ok(database.read("notifications/other"));
});
