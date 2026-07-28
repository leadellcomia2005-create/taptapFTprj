import test from "node:test";
import assert from "node:assert/strict";
import { serviceStatus } from "../src/services.js";

test("service status reports all credentialed integrations", () => {
  const status = serviceStatus();
  assert.deepEqual(Object.keys(status).sort(), ["dialogflow", "emailOtp", "firebase", "openai", "paymongo", "socket", "turnstile", "twilio", "twoFactor"]);
  assert.equal(status.socket, true);
});

test("deferred providers require explicit opt-in even when credentials exist", () => {
  const names = [
    "ENABLE_OPENAI",
    "ENABLE_PAYMONGO",
    "ENABLE_TWILIO",
    "OPENAI_API_KEY",
    "PAYMONGO_SECRET_KEY",
    "PAYMONGO_WEBHOOK_SECRET",
    "PAYMONGO_MODE",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER"
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.PAYMONGO_SECRET_KEY = "sk_test_example";
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsk_example";
    process.env.PAYMONGO_MODE = "test";
    process.env.TWILIO_ACCOUNT_SID = "test-sid";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_FROM_NUMBER = "+630000000000";
    delete process.env.ENABLE_OPENAI;
    delete process.env.ENABLE_PAYMONGO;
    delete process.env.ENABLE_TWILIO;
    assert.deepEqual(
      { openai: serviceStatus().openai, paymongo: serviceStatus().paymongo, twilio: serviceStatus().twilio },
      { openai: false, paymongo: false, twilio: false }
    );

    process.env.ENABLE_OPENAI = "true";
    process.env.ENABLE_PAYMONGO = "true";
    process.env.ENABLE_TWILIO = "true";
    assert.deepEqual(
      { openai: serviceStatus().openai, paymongo: serviceStatus().paymongo, twilio: serviceStatus().twilio },
      { openai: true, paymongo: true, twilio: true }
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
