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
