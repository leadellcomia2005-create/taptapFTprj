import assert from "node:assert/strict";
import test from "node:test";
import { cleanupExpiredCustomerRegistrations } from "../src/application/registrationCleanup.js";
import { checkCustomerRegistrationVerification, createCustomerRegistration } from "../src/registration.js";
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
    verifyEmail: async () => ({ eligible: true, code: "deliverable_domain" }),
    verificationTtlMs: 180_000
  });

  const storedDeadline = database.read("users/customer-new/registration/verificationExpiresAt");
  assert.equal(result.verificationExpiresAt, storedDeadline);
  assert.ok(storedDeadline >= before + 180_000);
  assert.ok(storedDeadline <= Date.now() + 180_000);
  const cleanupEligibleAt = database.read("users/customer-new/registration/cleanupEligibleAt");
  assert.ok(cleanupEligibleAt >= before + 24 * 60 * 60 * 1000);
  assert.equal(result.cleanupEligibleAt, cleanupEligibleAt);
  assert.equal(database.read("users/customer-new/consent/termsVersion"), "2026-10-01");
  assert.equal(database.read("users/customer-new/consent/privacyVersion"), "2026-10-01");
  assert.equal(database.read("users/customer-new/consent/termsAccepted"), true);
  assert.equal(database.read("users/customer-new/consent/privacyAccepted"), true);
  assert.ok(result.statusToken.length >= 32);
  assert.notEqual(database.read("users/customer-new/registration/statusTokenHash"), result.statusToken);
});

test("registration status token detects verification and closes the pending session", async () => {
  const database = new FakeRealtimeDatabase();
  const result = await createCustomerRegistration({
    db: database,
    auth: {
      createUser: async () => ({ uid: "customer-verified" }),
      deleteUser: async () => {}
    },
    input: registrationInput,
    req: { headers: { "user-agent": "node-test" }, ip: "127.0.0.1" },
    verifyEmail: async () => ({ eligible: true, code: "deliverable_domain" })
  });

  const status = await checkCustomerRegistrationVerification({
    db: database,
    auth: { getUser: async () => ({ uid: result.uid, emailVerified: true }) },
    uid: result.uid,
    statusToken: result.statusToken,
    now: 1234
  });

  assert.equal(status.verified, true);
  assert.equal(database.read("users/customer-verified/registration/verificationStatus"), "verified");
  assert.equal(database.read("users/customer-verified/registration/emailVerifiedAt"), 1234);
  assert.equal(database.read("users/customer-verified/registration/verificationExpiresAt"), undefined);
  assert.equal(database.read("users/customer-verified/registration/statusTokenHash"), undefined);
});

test("cleanup waits for the abandonment deadline and preserves protected registrations", async () => {
  const now = Date.now();
  const database = new FakeRealtimeDatabase({
    users: {
      expired: { role: "customer", securitySetupRequired: true, registration: { verificationExpiresAt: now - 1, cleanupEligibleAt: now - 1 } },
      sessionOnlyExpired: { role: "customer", securitySetupRequired: true, registration: { verificationExpiresAt: now - 1, cleanupEligibleAt: now + 60_000 } },
      verified: { role: "customer", securitySetupRequired: true, registration: { verificationExpiresAt: now - 1, cleanupEligibleAt: now - 1 } },
      withOrder: { role: "customer", securitySetupRequired: true, registration: { verificationExpiresAt: now - 1, cleanupEligibleAt: now - 1 } },
      demo: { role: "customer", demoAccount: true, securitySetupRequired: true, registration: { verificationExpiresAt: now - 1, cleanupEligibleAt: now - 1 } },
      owner: { role: "owner", registration: { verificationExpiresAt: now - 1, cleanupEligibleAt: now - 1 } }
    },
    orders: {
      "order-1": { customerId: "withOrder", status: "delivered" }
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
  assert.equal(database.read("users/verified/registration/cleanupEligibleAt"), undefined);
  assert.equal(database.read("users/verified/registration/emailVerifiedAt"), now);
  assert.ok(database.read("users/sessionOnlyExpired"));
  assert.ok(database.read("users/withOrder"));
  assert.ok(database.read("users/demo"));
  assert.ok(database.read("users/owner"));
  assert.deepEqual(result, { checked: 4, deleted: 1, verified: 1, preserved: 2, failed: 0 });
});
