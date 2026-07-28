import test from "node:test";
import assert from "node:assert/strict";
import {
  executeRecoveryAction,
  previewRecoveryAction,
  scanRecoveryIssues
} from "../src/application/recovery.js";
import { manilaDateKey } from "../src/domain/orderIntegrity.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const owner = { uid: "owner-1", role: "owner", name: "Owner One" };

test("recovery scan is read-only and covers operational risk classes", async () => {
  const now = Date.now();
  const db = new FakeRealtimeDatabase({
    users: {
      "owner-1": { role: "owner" },
      "customer-1": { role: "customer" }
    },
    public: { menu: { meal: { name: "Meal", stock: 2 } } },
    inventory: { meal: { name: "Meal", stock: 3 } },
    orders: {
      "order-cancelled": {
        customerId: "customer-1",
        status: "cancelled",
        cancellationRecoveryId: "cancel-recovery-1",
        items: [{ id: "meal", qty: 1 }],
        createdAt: now - 100
      },
      "order-delivered": {
        customerId: "customer-1",
        status: "delivered",
        paymentMethod: "cod",
        items: [{ id: "missing-item", qty: 0 }],
        createdAt: now
      }
    },
    notifications: {
      "notification-1": {
        targetUserId: "customer-1",
        deliveryStatus: "failed",
        createdAt: now
      }
    },
    idempotency: {
      orderCreation: {
        "customer-1": {
          "stale-request-key-001": {
            status: "processing",
            requestHash: "request-hash",
            expiresAt: now - 1
          }
        }
      }
    }
  });
  const before = db.read();
  const result = await scanRecoveryIssues(db, owner, { limit: 100 });
  const types = new Set(result.issues.map((issue) => issue.type));

  assert.deepEqual(db.read(), before);
  assert.deepEqual(types, new Set([
    "incomplete_cancellation",
    "order_quantity_mismatch",
    "missing_order_aggregate",
    "unresolved_cod_handoff",
    "missing_delivery_proof",
    "stock_projection_mismatch",
    "failed_notification_delivery",
    "stale_idempotency_claim"
  ]));
  assert.equal(result.issues.find((issue) => issue.type === "missing_delivery_proof").actionable, false);
  await assert.rejects(
    () => scanRecoveryIssues(db, { uid: "staff-1", role: "staff" }),
    /Owner access/i
  );
});

test("incomplete cancellation recovery restores stock exactly once", async () => {
  const now = Date.now();
  const date = manilaDateKey(now);
  const db = new FakeRealtimeDatabase({
    users: {
      "owner-1": { role: "owner" },
      "customer-1": { role: "customer" }
    },
    public: { menu: { meal: { name: "Meal", stock: 3 } } },
    inventory: { meal: { name: "Meal", stock: 3 } },
    orders: {
      "order-cancelled": {
        customerId: "customer-1",
        customerName: "Customer",
        status: "cancelled",
        statusBeforeCancellation: "received",
        cancellationRecoveryId: "cancel-recovery-1",
        cancelReason: "Customer request",
        cancelledAt: now,
        createdAt: now,
        items: [{ id: "meal", name: "Meal", price: 99, qty: 2 }],
        subtotal: 198,
        total: 198,
        deliveryType: "pickup",
        paymentMethod: "cod",
        paymentStatus: "cod-pending"
      }
    },
    reportAggregates: {
      daily: {
        [date]: { date, grossSales: 198, paidSales: 0, orderCount: 1, cancelledCount: 0 }
      }
    }
  });
  const scan = await scanRecoveryIssues(db, owner, { limit: 100 });
  const issue = scan.issues.find((entry) => entry.type === "incomplete_cancellation");
  const reason = "Resume verified cancellation recovery";
  const preview = await previewRecoveryAction(db, owner, { issueId: issue.id, reason });
  const input = {
    issueId: issue.id,
    reason,
    requestId: "recovery-request-001",
    previewHash: preview.previewHash,
    confirmation: "APPLY_RECOVERY"
  };

  const first = await executeRecoveryAction(db, owner, input);
  const replay = await executeRecoveryAction(db, owner, input);

  assert.equal(first.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(db.read("inventory/meal/stock"), 5);
  assert.equal(db.read("public/menu/meal/stock"), 5);
  assert.equal(typeof db.read("orders/order-cancelled/inventoryRestoredAt"), "number");
  assert.equal(Object.keys(db.read("stockHistory/meal")).length, 1);
  assert.equal(db.read("recoveryRequests/owner-1/recovery-request-001/status"), "complete");
  assert.equal(db.read("auditLogs/REC-recovery-request-001/action"), "recovery_action_applied");
});

test("safe stock and idempotency repairs preserve their authoritative data", async () => {
  const now = Date.now();
  const db = new FakeRealtimeDatabase({
    users: {
      "owner-1": { role: "owner" },
      "customer-1": { role: "customer" }
    },
    public: { menu: { meal: { name: "Meal", stock: 1 } } },
    inventory: { meal: { name: "Meal", stock: 4 } },
    idempotency: {
      orderCreation: {
        "customer-1": {
          "stale-request-key-001": {
            status: "processing",
            requestHash: "preserve-this-fingerprint",
            expiresAt: now - 1
          }
        }
      }
    }
  });
  const scan = await scanRecoveryIssues(db, owner, { limit: 100 });
  const stockIssue = scan.issues.find((issue) => issue.type === "stock_projection_mismatch");
  const claimIssue = scan.issues.find((issue) => issue.type === "stale_idempotency_claim");

  const stockPreview = await previewRecoveryAction(db, owner, { issueId: stockIssue.id, reason: "Synchronize public stock projection" });
  const stockInput = {
    issueId: stockIssue.id,
    reason: "Synchronize public stock projection",
    requestId: "recovery-request-002",
    previewHash: stockPreview.previewHash,
    confirmation: "APPLY_RECOVERY"
  };
  await executeRecoveryAction(db, owner, stockInput);
  const stockReplay = await executeRecoveryAction(db, owner, stockInput);
  assert.equal(stockReplay.idempotent, true);
  assert.equal(db.read("public/menu/meal/stock"), 4);

  const claimPreview = await previewRecoveryAction(db, owner, { issueId: claimIssue.id, reason: "Release expired checkout request claim" });
  const claimInput = {
    issueId: claimIssue.id,
    reason: "Release expired checkout request claim",
    requestId: "recovery-request-003",
    previewHash: claimPreview.previewHash,
    confirmation: "APPLY_RECOVERY"
  };
  await executeRecoveryAction(db, owner, claimInput);
  const claimReplay = await executeRecoveryAction(db, owner, claimInput);
  const claim = db.read("idempotency/orderCreation/customer-1/stale-request-key-001");
  assert.equal(claimReplay.idempotent, true);
  assert.equal(claim.status, "released");
  assert.equal(claim.requestHash, "preserve-this-fingerprint");
});
