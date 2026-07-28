import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createAuthentication } from "../src/middleware/authentication.js";
import { createNoopLogger } from "../src/observability/logger.js";
import { createOperationalMetrics } from "../src/observability/metrics.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const config = {
  apiVersion: "test",
  allowedOrigins: ["http://localhost:5173"],
  trustProxy: false
};

function authenticationFor(user) {
  const attachUser = (req, _res, next) => {
    req.user = user;
    next();
  };
  return {
    authenticate: attachUser,
    authenticateBootstrap: attachUser,
    requireFirebaseAdmin: (_req, _res, next) => next(),
    verifyUserToken: async () => user
  };
}

function firebaseFixture(initialData = {}, userRecords = {}) {
  const database = new FakeRealtimeDatabase(initialData);
  const calls = { claims: [], revocations: [], disabled: [] };
  const auth = {
    async getUser(uid) {
      const user = userRecords[uid];
      if (!user) throw new Error(`Unknown test user: ${uid}`);
      return user;
    },
    async setCustomUserClaims(uid, claims) {
      calls.claims.push({ uid, claims });
      userRecords[uid].customClaims = claims;
    },
    async revokeRefreshTokens(uid) {
      calls.revocations.push(uid);
    },
    async updateUser(uid, values) {
      calls.disabled.push({ uid, disabled: values.disabled });
      userRecords[uid] = { ...userRecords[uid], ...values };
      return userRecords[uid];
    }
  };
  return {
    firebase: {
      enabled: true,
      publicError: null,
      db: () => database,
      auth: () => auth
    },
    database,
    calls
  };
}

async function withApp({ firebase, user, authentication = authenticationFor(user), metrics }, run) {
  const app = createApp({
    config,
    firebase,
    authentication,
    realtime: { emit() { return true; } },
    logger: createNoopLogger(),
    metrics,
    serverStartedAt: Date.now()
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("reports liveness/readiness and preserves a valid request ID", async () => {
  const { firebase } = firebaseFixture();
  await withApp({ firebase, user: { uid: "customer-1", role: "customer" } }, async (baseUrl) => {
    const live = await fetch(`${baseUrl}/health/live`, {
      headers: { "X-Request-ID": "request-test-1234" }
    });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("x-request-id"), "request-test-1234");
    assert.equal((await live.json()).status, "ok");

    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, "ready");
  });
});

test("rejects malformed order bodies with field-level validation details", async () => {
  const { firebase } = firebaseFixture();
  await withApp({ firebase, user: { uid: "customer-1", role: "customer" } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [], paymentMethod: "bitcoin" })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.ok(body.details.some((issue) => issue.path === "items"));
    assert.ok(body.details.some((issue) => issue.path === "paymentMethod"));
    assert.ok(body.requestId);
  });
});

test("rejects an unauthenticated API request", async () => {
  const { firebase } = firebaseFixture();
  firebase.auth = () => ({
    async verifyIdToken() {
      throw new Error("A missing bearer token must not be verified.");
    }
  });
  await withApp({ firebase, authentication: createAuthentication(firebase) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "Authentication required.");
  });
});

test("notification read endpoints are user scoped and clear only read records", async () => {
  const now = Date.now();
  const { firebase, database } = firebaseFixture({
    notifications: {
      "own-opened": { targetUserId: "customer-1", title: "Opened", message: "Opened", type: "order", createdAt: now - 3, expiresAt: now + 60_000, readAt: null },
      "own-unread": { targetUserId: "customer-1", title: "Unread", message: "Unread", type: "system", createdAt: now - 2, expiresAt: now + 60_000, readAt: null },
      "own-read": { targetUserId: "customer-1", title: "Read", message: "Read", type: "system", createdAt: now - 1, expiresAt: now + 60_000, readAt: now - 1_000 },
      "other-user": { targetUserId: "customer-2", title: "Other", message: "Other", type: "system", createdAt: now, expiresAt: now + 60_000, readAt: null }
    }
  });
  await withApp({ firebase, user: { uid: "customer-1", role: "customer" } }, async (baseUrl) => {
    const crossUser = await fetch(`${baseUrl}/api/notifications/other-user/read`, { method: "POST" });
    assert.equal(crossUser.status, 403);

    const markOne = await fetch(`${baseUrl}/api/notifications/own-opened/read`, { method: "POST" });
    assert.equal(markOne.status, 200);
    assert.equal((await markOne.json()).updated, true);
    assert.equal(typeof database.read("notifications/own-opened/readAt"), "number");
    assert.equal(database.read("notifications/own-unread/readAt"), null);

    const clearRead = await fetch(`${baseUrl}/api/notifications/read`, { method: "DELETE" });
    assert.equal(clearRead.status, 200);
    assert.equal((await clearRead.json()).cleared, 2);
    assert.equal(database.read("notifications/own-opened"), undefined);
    assert.equal(database.read("notifications/own-read"), undefined);
    assert.ok(database.read("notifications/own-unread"));
    assert.ok(database.read("notifications/other-user"));
  });
});

test("replays an order submitted with the Idempotency-Key header", async () => {
  const { firebase, database } = firebaseFixture({
    public: { menu: { "meal-1": { id: "meal-1", name: "Test Meal", price: 99, stock: 2 } } },
    inventory: { "meal-1": { id: "meal-1", name: "Test Meal", price: 99, stock: 2 } },
    users: {
      "customer-1": { role: "customer", name: "Customer", phone: "+639171234567", phoneVerified: true },
      "owner-1": { role: "owner", name: "Owner" },
      "staff-1": { role: "staff", name: "Staff" }
    }
  });
  const customer = { uid: "customer-1", role: "customer", name: "Customer", email: "customer@example.test" };
  await withApp({ firebase, user: customer }, async (baseUrl) => {
    const request = () => fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "checkout-request-12345"
      },
      body: JSON.stringify({
        items: [{ id: "meal-1", qty: 1 }],
        paymentMethod: "cod",
        deliveryType: "pickup",
        phone: "09171234567"
      })
    });
    const first = await request();
    const replay = await request();
    const firstBody = await first.json();
    const replayBody = await replay.json();
    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replayBody.id, firstBody.id);
    assert.equal(replayBody.idempotent, true);
    assert.equal(database.read("inventory/meal-1/stock"), 1);
    assert.equal(Object.keys(database.read("orders")).length, 1);
  });
});

test("provides optional role-scoped order pages and validates pagination input", async () => {
  const orders = Object.fromEntries(Array.from({ length: 3 }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return [`order-${number}`, {
      customerId: "customer-1",
      customerName: "Customer",
      status: "received",
      deliveryType: "pickup",
      paymentMethod: "cod",
      items: [{ id: "meal-1", name: "Meal", price: 99, qty: 1 }],
      subtotal: 99,
      total: 99,
      createdAt: index + 1
    }];
  }));
  const { firebase } = firebaseFixture({ orders });
  const customer = { uid: "customer-1", role: "customer", name: "Customer" };
  await withApp({ firebase, user: customer }, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/api/orders?limit=2`);
    const pageBody = await page.json();
    assert.equal(page.status, 200);
    assert.deepEqual(pageBody.orders.map((order) => order.id), ["order-003", "order-002"]);
    assert.equal(pageBody.pagination.nextCursor, "order-002");

    const invalid = await fetch(`${baseUrl}/api/orders?limit=999`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "VALIDATION_ERROR");
  });
});

test("provides validated owner history pages without changing legacy endpoints", async () => {
  const auditLogs = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [
    `audit-${index + 1}`,
    { action: "test", createdAt: index + 1 }
  ]));
  const { firebase } = firebaseFixture({ auditLogs });
  const owner = { uid: "owner-1", role: "owner", name: "Owner" };
  await withApp({ firebase, user: owner }, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/api/history/audit-logs?limit=2`);
    const pageBody = await page.json();
    assert.equal(page.status, 200);
    assert.deepEqual(pageBody.records.map((record) => record.id), ["audit-3", "audit-2"]);
    assert.equal(pageBody.pagination.hasMore, true);

    const invalid = await fetch(`${baseUrl}/api/history/audit-logs?limit=999`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "VALIDATION_ERROR");
  });
});

test("keeps recovery scans owner-only and validates their bound", async () => {
  const fixture = firebaseFixture({
    users: {
      "owner-1": { role: "owner" },
      "staff-1": { role: "staff" }
    },
    public: { menu: {} },
    inventory: {}
  });
  await withApp({ firebase: fixture.firebase, user: { uid: "owner-1", role: "owner" } }, async (baseUrl) => {
    const scan = await fetch(`${baseUrl}/api/admin/recovery/scan?limit=20`);
    assert.equal(scan.status, 200);
    assert.deepEqual((await scan.json()).issues, []);

    const invalid = await fetch(`${baseUrl}/api/admin/recovery/scan?limit=1`);
    assert.equal(invalid.status, 400);
  });
  await withApp({ firebase: fixture.firebase, user: { uid: "staff-1", role: "staff" } }, async (baseUrl) => {
    const scan = await fetch(`${baseUrl}/api/admin/recovery/scan?limit=20`);
    assert.equal(scan.status, 403);
  });
});

test("exposes aggregate operational metrics only to owners", async () => {
  const { firebase } = firebaseFixture();
  const metrics = createOperationalMetrics({ startedAt: Date.now() - 2_000 });
  metrics.observeRequest({ method: "GET", path: "/health/live", status: 200, durationMs: 75 });

  await withApp({ firebase, user: { uid: "owner-1", role: "owner" }, metrics }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/metrics`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.metrics.requests.total, 1);
    assert.equal(body.metrics.latency.buckets.le100Ms, 1);
    assert.equal(body.metrics.counters.authorizationFailures, 0);
    assert.equal("users" in body.metrics, false);
  });

  await withApp({ firebase, user: { uid: "staff-1", role: "staff" }, metrics }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/metrics`);
    assert.equal(response.status, 403);
  });
});

test("denies a rider access to inventory routes", async () => {
  const { firebase } = firebaseFixture({ inventory: { "meal-1": { stock: 5 } } });
  await withApp({ firebase, user: { uid: "rider-1", role: "rider" } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/inventory`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /owner or staff access required/i);
  });
});

test("role changes preserve claims, revoke sessions, and protect the final owner", async () => {
  const records = {
    "owner-1": { uid: "owner-1", customClaims: { role: "owner" } },
    "staff-1": { uid: "staff-1", customClaims: { role: "staff", featureFlag: true } }
  };
  const { firebase, database, calls } = firebaseFixture({
    users: {
      "owner-1": { role: "owner", name: "Owner" },
      "staff-1": { role: "staff", staffRole: "cashier", name: "Staff" }
    }
  }, records);
  const owner = { uid: "owner-1", role: "owner", name: "Owner" };

  await withApp({ firebase, user: owner }, async (baseUrl) => {
    const change = await fetch(`${baseUrl}/api/admin/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "staff-1", role: "rider" })
    });
    assert.equal(change.status, 200);
    assert.deepEqual(calls.claims[0], {
      uid: "staff-1",
      claims: { role: "rider", featureFlag: true }
    });
    assert.deepEqual(calls.revocations, ["staff-1"]);
    assert.equal(database.read("users/staff-1/role"), "rider");
    assert.equal(database.read("users/staff-1/staffRole"), undefined);
    assert.equal(typeof database.read("users/staff-1/sessionRevokedAt"), "number");

    const finalOwnerChange = await fetch(`${baseUrl}/api/admin/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "owner-1", role: "staff", staffRole: "manager" })
    });
    const body = await finalOwnerChange.json();
    assert.equal(finalOwnerChange.status, 409);
    assert.equal(body.code, "LAST_OWNER_REQUIRED");
    assert.equal(calls.revocations.includes("owner-1"), false);
  });
});

test("owner suspension disables the account, revokes sessions, and protects the final owner", async () => {
  const records = {
    "owner-1": { uid: "owner-1", customClaims: { role: "owner" }, disabled: false },
    "staff-1": { uid: "staff-1", customClaims: { role: "staff" }, disabled: false }
  };
  const { firebase, database, calls } = firebaseFixture({
    users: {
      "owner-1": { role: "owner", name: "Owner" },
      "staff-1": { role: "staff", name: "Staff" }
    }
  }, records);
  const owner = { uid: "owner-1", role: "owner", name: "Owner" };

  await withApp({ firebase, user: owner }, async (baseUrl) => {
    const suspension = await fetch(`${baseUrl}/api/admin/users/staff-1/suspension`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended: true, reason: "Security review" })
    });
    assert.equal(suspension.status, 200);
    assert.deepEqual(calls.disabled, [{ uid: "staff-1", disabled: true }]);
    assert.deepEqual(calls.revocations, ["staff-1"]);
    assert.equal(database.read("users/staff-1/suspended"), true);
    assert.equal(database.read("users/staff-1/suspensionReason"), "Security review");

    const finalOwner = await fetch(`${baseUrl}/api/admin/users/owner-1/suspension`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended: true, reason: "Should be blocked" })
    });
    assert.equal(finalOwner.status, 409);
    assert.equal(calls.disabled.some((entry) => entry.uid === "owner-1"), false);
  });
});

test("staff cannot access owner account administration", async () => {
  const { firebase } = firebaseFixture();
  await withApp({ firebase, user: { uid: "staff-1", role: "staff", name: "Staff" } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "customer-1", role: "owner" })
    });
    assert.equal(response.status, 403);
  });
});
