import test from "node:test";
import assert from "node:assert/strict";
import { serviceStatus } from "../src/services.js";

test("service status reports all credentialed integrations", () => {
  const status = serviceStatus();
  assert.deepEqual(Object.keys(status).sort(), ["dialogflow", "emailOtp", "firebase", "openai", "paymongo", "socket", "turnstile", "twilio", "twoFactor"]);
  assert.equal(status.socket, true);
});
