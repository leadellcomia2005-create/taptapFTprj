import test from "node:test";
import assert from "node:assert/strict";
import { loadServerConfig } from "../src/config/environment.js";

test("allows an explicit Turnstile bypass only outside production", () => {
  const config = loadServerConfig({
    NODE_ENV: "development",
    CLIENT_ORIGIN: "http://localhost:5173",
    TURNSTILE_BYPASS: "true"
  });

  assert.equal(config.turnstile.bypass, true);
  assert.deepEqual(config.turnstile.allowedHostnames, ["localhost"]);
  assert.equal(config.registration.verificationTtlMs, 180_000);
  assert.equal(config.registration.abandonedTtlMs, 86_400_000);
  assert.equal(config.registration.resendCooldownMs, 60_000);
  assert.equal(config.registration.resendDailyLimit, 5);
  assert.equal(config.ai.insightLimit, 5);
  assert.equal(config.ai.insightWindowMs, 300_000);
  assert.equal(config.ai.insightCacheTtlMs, 300_000);
});

test("rejects a Turnstile bypass in production", () => {
  assert.throws(
    () => loadServerConfig({
      NODE_ENV: "production",
      CLIENT_ORIGIN: "https://orders.example.com",
      TURNSTILE_BYPASS: "true"
    }),
    /TURNSTILE_BYPASS/
  );
});

test("keeps hosted Firebase credentials separate from local credential paths", () => {
  const config = loadServerConfig({
    CLIENT_ORIGIN: "https://orders.example.com",
    FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: "encoded-service-account"
  });

  assert.equal(config.firebase.credentialsPath, "");
  assert.equal(config.firebase.serviceAccountJsonBase64, "encoded-service-account");
});
