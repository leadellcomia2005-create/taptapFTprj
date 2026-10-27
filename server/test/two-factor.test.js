import test from "node:test";
import assert from "node:assert/strict";
import { notificationRecord } from "../src/notifications.js";
import { hasVerifiedEmail } from "../src/security.js";
import {
  allowedTwoFactorMethods,
  sendEmailCode,
  sendPhoneVerificationCode,
  sendSmsCode,
  twoFactorStatus,
  verifyChallenge,
  verifyPhoneVerificationCode,
  verifyTotp
} from "../src/twoFactor.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";

function fakeDatabase(initial) {
  const state = structuredClone(initial);
  const read = (path) => path.split("/").filter(Boolean).reduce((value, key) => value?.[key], state);
  const write = (path, value) => {
    const parts = path.split("/").filter(Boolean);
    const key = parts.pop();
    const parent = parts.reduce((value, part) => (value[part] ||= {}), state);
    if (value === null) delete parent[key];
    else parent[key] = structuredClone(value);
  };
  return {
    state,
    ref(path) {
      return {
        once: async () => ({ val: () => structuredClone(read(path) ?? null) }),
        set: async (value) => write(path, value),
        remove: async () => write(path, null),
        push: async (value) => {
          const current = read(path) || {};
          write(path, { ...current, [`entry-${Object.keys(current).length + 1}`]: value });
        }
      };
    }
  };
}

test("verifies RFC 6238 compatible six-digit TOTP values", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "000000", 59_000), false);
  assert.equal(verifyTotp(secret, "28708", 59_000), false);
});

test("creates user-scoped notifications with a 30-day expiry", () => {
  const before = Date.now();
  const entry = notificationRecord("user-123", {
    title: "Shift summary ready",
    message: "Your shift summary is ready.",
    type: "shift"
  });
  assert.equal(entry.targetUserId, "user-123");
  assert.equal(entry.readAt, null);
  assert.ok(entry.expiresAt - entry.createdAt === 30 * 24 * 60 * 60 * 1000);
  assert.ok(entry.createdAt >= before);
  assert.equal("targetRole" in entry, false);
});

test("requires Firebase's verified-email claim before POS access", () => {
  assert.equal(hasVerifiedEmail({ email_verified: true }), true);
  assert.equal(hasVerifiedEmail({ email_verified: false }), false);
  assert.equal(hasVerifiedEmail({}), false);
});

test("allows email OTP for verified operational accounts without enabling passkeys or SMS", () => {
  assert.deepEqual(allowedTwoFactorMethods("customer"), ["sms", "email"]);
  assert.deepEqual(allowedTwoFactorMethods("owner"), ["totp", "email"]);
  assert.deepEqual(allowedTwoFactorMethods("staff"), ["totp", "email"]);
  assert.deepEqual(allowedTwoFactorMethods("rider"), ["totp", "email"]);
});

test("requires legacy customer passkey accounts to choose email or SMS", async () => {
  const db = new FakeRealtimeDatabase({
    users: { customer1: { role: "customer", phone: "+639171234567", phoneVerified: true } },
    twoFactor: { customer1: { enabled: true, method: "passkey", passkeys: { credential1: {} } } }
  });
  const status = await twoFactorStatus(
    db,
    { uid: "customer1", email: "customer@example.com", email_verified: true, role: "customer" },
    true,
    true,
    "unused-token"
  );
  assert.equal(status.enabled, false);
  assert.equal(status.method, null);
  assert.equal(status.passkeyAvailable, false);
  assert.deepEqual(status.allowedMethods, ["sms", "email"]);
});

test("rejects backup-code verification for customer accounts", async () => {
  const db = new FakeRealtimeDatabase({
    users: { customer1: { role: "customer" } },
    twoFactor: { customer1: { enabled: true, method: "email", backupCodes: ["legacy-record"] } }
  });
  await assert.rejects(
    () => verifyChallenge(db, { uid: "customer1", role: "customer" }, { backupCode: "ABCD-EFGH" }, "unused-token"),
    (error) => error.status === 403 && /email or SMS/.test(error.message)
  );
});

test("creates hashed customer email OTP records and throttles resends", async () => {
  const db = fakeDatabase({
    users: { customer1: { role: "customer" } },
    twoFactor: { customer1: {} }
  });
  let deliveredCode;
  const now = 1_750_000_000_000;
  const result = await sendEmailCode(
    db,
    { uid: "customer1", email: "customer@example.com", email_verified: true, role: "customer" },
    async (_email, code) => { deliveredCode = code; },
    "setup",
    now
  );

  const pending = db.state.twoFactor.customer1.pendingEmail;
  assert.match(deliveredCode, /^\d{6}$/);
  assert.equal(result.emailMasked, "cu******@example.com");
  assert.equal(pending.purpose, "setup");
  assert.equal(pending.expiresAt, now + 5 * 60 * 1000);
  assert.equal("code" in pending, false);
  assert.notEqual(pending.hash, deliveredCode);

  await assert.rejects(
    () => sendEmailCode(
      db,
      { uid: "customer1", email: "customer@example.com", email_verified: true, role: "customer" },
      async () => {},
      "setup",
      now + 30_000
    ),
    (error) => error.status === 429
  );
});

test("creates hashed five-minute SMS OTP records only for customers", async () => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const db = new FakeRealtimeDatabase({
    users: { customer1: { role: "customer", phone: "09171234567", phoneVerified: true } },
    twoFactor: { customer1: {} }
  });
  const now = 1_750_000_000_000;
  let delivered;
  const result = await sendSmsCode(
    db,
    { uid: "customer1", role: "customer" },
    async (phone, code) => { delivered = { phone, code }; },
    "setup",
    now
  );
  const pending = db.read("twoFactor/customer1/pendingSms");
  assert.equal(delivered.phone, "09171234567");
  assert.match(delivered.code, /^\d{6}$/);
  assert.equal(pending.expiresAt, now + 5 * 60 * 1000);
  assert.equal(result.resendAt, now + 60_000);
  assert.equal("code" in pending, false);
  assert.notEqual(pending.hash, delivered.code);

  await assert.rejects(
    () => sendSmsCode(db, { uid: "customer1", role: "customer" }, async () => {}, "setup", now + 30_000),
    (error) => error.status === 429
  );
});

test("rejects SMS OTP for owner, staff, and rider roles", async () => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  for (const role of ["owner", "staff", "rider"]) {
    const db = new FakeRealtimeDatabase({ users: { account: { role, phone: "09171234567" } }, twoFactor: { account: {} } });
    await assert.rejects(
      () => sendSmsCode(db, { uid: "account", role }, async () => {}, "setup", Date.now()),
      (error) => error.status === 403
    );
  }
});

test("removes a pending SMS OTP when the provider is unavailable", async () => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const db = new FakeRealtimeDatabase({
    users: { customer1: { role: "customer", phone: "09171234567", phoneVerified: true } },
    twoFactor: { customer1: {} }
  });
  await assert.rejects(
    () => sendSmsCode(db, { uid: "customer1", role: "customer" }, async () => { throw new Error("offline"); }, "setup", Date.now()),
    /offline/
  );
  assert.equal(db.read("twoFactor/customer1/pendingSms"), undefined);
});

test("verifies a customer phone before enabling essential order SMS", async () => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 10).toString("base64");
  const db = new FakeRealtimeDatabase({
    users: { customer1: { role: "customer", smsNotificationsRequested: true } },
    twoFactor: { customer1: {} }
  });
  const now = 1_750_000_000_000;
  let deliveredCode;
  const sent = await sendPhoneVerificationCode(
    db,
    { uid: "customer1", role: "customer" },
    "0917 123 4567",
    async (_phone, code) => { deliveredCode = code; },
    now
  );
  assert.equal(sent.phoneMasked, "••••••4567");
  assert.equal("code" in db.read("twoFactor/customer1/pendingPhoneVerification"), false);

  const result = await verifyPhoneVerificationCode(db, { uid: "customer1", role: "customer" }, deliveredCode, now + 30_000);
  assert.equal(result.verified, true);
  assert.equal(db.read("users/customer1/phone"), "+639171234567");
  assert.equal(db.read("users/customer1/phoneVerified"), true);
  assert.equal(db.read("users/customer1/smsNotifications"), true);
  assert.equal(db.read("twoFactor/customer1/pendingPhoneVerification"), undefined);
});

test("expires customer phone verification codes after five minutes", async () => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  const db = new FakeRealtimeDatabase({ users: { customer1: { role: "customer" } }, twoFactor: { customer1: {} } });
  const now = 1_750_000_000_000;
  let deliveredCode;
  await sendPhoneVerificationCode(db, { uid: "customer1", role: "customer" }, "+639171234567", async (_phone, code) => { deliveredCode = code; }, now);
  await assert.rejects(
    () => verifyPhoneVerificationCode(db, { uid: "customer1", role: "customer" }, deliveredCode, now + 5 * 60_000 + 1),
    (error) => error.status === 410
  );
  assert.equal(db.read("users/customer1/phoneVerified"), undefined);
});

test("creates hashed email OTP records for operational accounts", async () => {
  const db = fakeDatabase({
    users: { staff1: { role: "staff" } },
    twoFactor: { staff1: {} }
  });
  let deliveredCode;
  const result = await sendEmailCode(
    db,
    { uid: "staff1", email: "staff@example.com", email_verified: true, role: "staff" },
    async (_email, code) => { deliveredCode = code; },
    "setup",
    1_750_000_000_000
  );
  assert.match(deliveredCode, /^\d{6}$/);
  assert.equal(result.emailMasked, "st***@example.com");
  assert.equal(db.state.twoFactor.staff1.pendingEmail.purpose, "setup");
  assert.equal("code" in db.state.twoFactor.staff1.pendingEmail, false);
});
