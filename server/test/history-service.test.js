import test from "node:test";
import assert from "node:assert/strict";
import { listHistoryPage } from "../src/application/history.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

test("paginates audit history with a stable opaque cursor", async () => {
  const auditLogs = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
    `audit-${index + 1}`,
    { action: "test", createdAt: index + 1 }
  ]));
  const db = new FakeRealtimeDatabase({ auditLogs });
  const owner = { uid: "owner-1", role: "owner" };

  const first = await listHistoryPage(db, owner, "audit-logs", { limit: 2 });
  const second = await listHistoryPage(db, owner, "audit-logs", {
    limit: 2,
    before: first.pagination.nextCursor
  });

  assert.deepEqual(first.records.map((record) => record.id), ["audit-5", "audit-4"]);
  assert.equal(first.pagination.hasMore, true);
  assert.match(first.pagination.nextCursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(second.records.map((record) => record.id), ["audit-3", "audit-2"]);
});

test("keeps notification and customer feedback pages user scoped", async () => {
  const db = new FakeRealtimeDatabase({
    notifications: {
      "notification-1": { targetUserId: "customer-1", createdAt: 1 },
      "notification-2": { targetUserId: "customer-2", createdAt: 2 },
      "notification-3": { targetUserId: "customer-1", createdAt: 3 }
    },
    complaints: {
      "complaint-1": { customerId: "customer-1", createdAt: 1 },
      "complaint-2": { customerId: "customer-2", createdAt: 2 }
    }
  });
  const customer = { uid: "customer-1", role: "customer" };

  const notifications = await listHistoryPage(db, customer, "notifications", { limit: 10 });
  const complaints = await listHistoryPage(db, customer, "complaints", { limit: 10 });

  assert.deepEqual(notifications.records.map((record) => record.id), ["notification-3", "notification-1"]);
  assert.deepEqual(complaints.records.map((record) => record.id), ["complaint-1"]);
  await assert.rejects(
    () => listHistoryPage(db, customer, "audit-logs", { limit: 10 }),
    /not allowed/i
  );
});

test("rejects malformed history cursors without reading a collection", async () => {
  const db = new FakeRealtimeDatabase({ auditLogs: {} });
  await assert.rejects(
    () => listHistoryPage(db, { uid: "owner-1", role: "owner" }, "audit-logs", {
      limit: 10,
      before: "not-a-valid-cursor"
    }),
    /Invalid history cursor/i
  );
});
