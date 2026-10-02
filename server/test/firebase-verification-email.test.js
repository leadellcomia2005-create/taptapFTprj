import test from "node:test";
import assert from "node:assert/strict";
import { sendFirebaseVerificationEmail } from "../src/integrations/firebaseVerificationEmail.js";

test("sends Firebase verification email through HTTPS without exposing the custom token", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => requests.length === 1 ? { idToken: "private-id-token" } : { email: "customer@example.com" }
    };
  };

  await sendFirebaseVerificationEmail({
    auth: { createCustomToken: async (uid) => `custom-token-for-${uid}` },
    uid: "customer-1",
    webApiKey: "public-web-api-key",
    continueUrl: "https://orders.example.com/?emailVerified=1",
    fetchImpl
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /accounts:signInWithCustomToken/);
  assert.equal(requests[0].body.token, "custom-token-for-customer-1");
  assert.match(requests[1].url, /accounts:sendOobCode/);
  assert.deepEqual(requests[1].body, {
    requestType: "VERIFY_EMAIL",
    idToken: "private-id-token",
    continueUrl: "https://orders.example.com/?emailVerified=1"
  });
});

test("fails closed when Firebase rejects verification email delivery", async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });

  await assert.rejects(
    () => sendFirebaseVerificationEmail({
      auth: { createCustomToken: async () => "custom-token" },
      uid: "customer-1",
      webApiKey: "public-web-api-key",
      continueUrl: "https://orders.example.com/?emailVerified=1",
      fetchImpl
    }),
    (error) => error.code === "firebase-verification-email-failed"
  );
});
