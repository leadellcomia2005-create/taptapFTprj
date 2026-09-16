import assert from "node:assert/strict";
import test from "node:test";
import { cleanupExpiredCustomerRegistrations } from "../src/application/registrationCleanup.js";
import { createCustomerRegistration } from "../src/registration.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

const registrationInput = {
  name: "Juan Dela Cruz",
  email: "juan@example.com",
  password: "TapTapFood2026!",
  confirmPassword: "TapTapFood2026!",
  termsAccepted: true,
  privacyAccepted: true
};

test("new customer registrations receive the configured verification deadline", async () => {
  const database = new FakeRealtimeDatabase();
  const before = Date.now();
  const result = await createCustomerRegistration({
    db: database,
    auth: {
      createUser: async () => ({ uid: "customer-new" }),
      deleteUser: async () => {}
    },
    input: registrationInput,
    req: { headers: { "user-agent": "node-test" }, ip: "127.0.0.1" },
    verificationTtlMs: 180_000
  });

  const storedDeadline = database.read("users/customer-new/registration/verificationExpiresAt");
  assert.equal(result.verificationExpiresAt, storedDeadline);
  assert.ok(storedDeadline >= before + 180_000);
  assert.ok(storedDeadline <= Date.now() + 180_000);
});

test("cleanup removes only expired unverified customer registrations", async () => {
  const now = Date.now();
  const database = new FakeRealtimeDatabase({
    users: {
      expired: { role: "customer", registration: { verificationExpiresAt: now - 1 } },
      verified: { role: "customer", registration: { verificationExpiresAt: now - 1 } },
      pending: { role: "customer", registration: { verificationExpiresAt: now + 60_000 } },
      owner: { role: "owner", registration: { verificationExpiresAt: now - 1 } }
    }
  });
  const deleted = [];
  const auth = {
    getUser: async (uid) => ({ uid, emailVerified: uid === "verified" }),
    deleteUser: async (uid) => deleted.push(uid)
  };

  const result = await cleanupExpiredCustomerRegistrations({ db: database, auth, now });

  assert.deepEqual(deleted, ["expired"]);
  assert.equal(database.read("users/expired"), undefined);
  assert.equal(database.read("users/verified/registration/verificationExpiresAt"), undefined);
  assert.equal(database.read("users/verified/registration/emailVerifiedAt"), now);
  assert.ok(database.read("users/pending"));
  assert.ok(database.read("users/owner"));
  assert.deepEqual(result, { checked: 2, deleted: 1, verified: 1, failed: 0 });
});
