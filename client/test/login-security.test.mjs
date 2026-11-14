import test from "node:test";
import assert from "node:assert/strict";
import { retryLoginSecurity } from "../src/services/loginSecurity.ts";

test("security status recovers from a cold-start gateway response without signing in again", async () => {
  let attempts = 0;
  const status = { role: "customer", emailVerified: true, enabled: true };
  const result = await retryLoginSecurity(async () => {
    if (++attempts === 1) throw Object.assign(new Error("Waking up"), { status: 503 });
    return status;
  }, async () => {});
  assert.equal(result, status);
  assert.equal(attempts, 2);
});

test("timeout and connection failures receive one bounded retry", async () => {
  for (const code of ["API_TIMEOUT", "NETWORK_ERROR"]) {
    let attempts = 0;
    const failure = Object.assign(new Error("Unavailable"), { code });
    await assert.rejects(retryLoginSecurity(async () => {
      attempts++;
      throw failure;
    }, async () => {}), (error) => error === failure);
    assert.equal(attempts, 2);
  }
});

test("security rejections are returned immediately without retrying or granting access", async () => {
  for (const status of [400, 401, 403, 423, 429]) {
    let attempts = 0;
    const failure = Object.assign(new Error("Rejected"), { status });
    await assert.rejects(retryLoginSecurity(async () => {
      attempts++;
      throw failure;
    }, async () => {}), (error) => error === failure);
    assert.equal(attempts, 1);
  }
});
