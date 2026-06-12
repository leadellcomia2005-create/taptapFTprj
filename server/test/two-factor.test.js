import test from "node:test";
import assert from "node:assert/strict";
import { notificationRecord } from "../src/notifications.js";
import { hasVerifiedEmail } from "../src/security.js";
import { allowedTwoFactorMethods, sendEmailCode, verifyTotp } from "../src/twoFactor.js";

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

test("limits operational roles to authenticator 2FA", () => {
  assert.deepEqual(allowedTwoFactorMethods("customer"), ["totp", "sms", "email"]);
  assert.deepEqual(allowedTwoFactorMethods("owner"), ["totp"]);
  assert.deepEqual(allowedTwoFactorMethods("staff"), ["totp"]);
  assert.deepEqual(allowedTwoFactorMethods("rider"), ["totp"]);
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
  assert.equal(pending.expiresAt, now + 10 * 60 * 1000);
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

test("rejects email OTP for operational accounts", async () => {
  const db = fakeDatabase({
    users: { staff1: { role: "staff" } },
    twoFactor: { staff1: {} }
  });
  await assert.rejects(
    () => sendEmailCode(
      db,
      { uid: "staff1", email: "staff@example.com", email_verified: true, role: "staff" },
      async () => {},
      "setup"
    ),
    (error) => error.status === 403
  );
});
