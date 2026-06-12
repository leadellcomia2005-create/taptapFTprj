import test from "node:test";
import assert from "node:assert/strict";
import { notificationRecord } from "../src/notifications.js";
import { verifyTotp } from "../src/twoFactor.js";

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
