import test from "node:test";
import assert from "node:assert/strict";
import { serviceStatus } from "../src/services.js";

test("service status reports all credentialed integrations", () => {
  const status = serviceStatus();
  assert.deepEqual(Object.keys(status).sort(), ["dialogflow", "emailOtp", "firebase", "groq", "openai", "paymongo", "sms", "socket", "textbee", "turnstile", "twoFactor"]);
  assert.equal(status.socket, true);
});

test("deferred providers require explicit opt-in even when credentials exist", () => {
  const names = [
    "ENABLE_OPENAI",
    "ENABLE_GROQ",
    "ENABLE_PAYMONGO",
    "ENABLE_TEXTBEE",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "PAYMONGO_SECRET_KEY",
    "PAYMONGO_WEBHOOK_SECRET",
    "PAYMONGO_MODE",
    "TEXTBEE_API_KEY",
    "TEXTBEE_DEVICE_ID",
    "TEXTBEE_WEBHOOK_SECRET",
    "ENABLE_RESEND",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL"
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GROQ_API_KEY = "test-key";
    process.env.PAYMONGO_SECRET_KEY = "sk_test_example";
    process.env.PAYMONGO_WEBHOOK_SECRET = "whsk_example";
    process.env.PAYMONGO_MODE = "test";
    process.env.TEXTBEE_API_KEY = "test-api-key";
    process.env.TEXTBEE_DEVICE_ID = "device-1";
    process.env.TEXTBEE_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "TapTap Foodtrip <security@mail.example.com>";
    delete process.env.ENABLE_OPENAI;
    delete process.env.ENABLE_GROQ;
    delete process.env.ENABLE_PAYMONGO;
    delete process.env.ENABLE_TEXTBEE;
    delete process.env.ENABLE_RESEND;
    assert.deepEqual(
      { emailOtp: serviceStatus().emailOtp, groq: serviceStatus().groq, openai: serviceStatus().openai, paymongo: serviceStatus().paymongo, sms: serviceStatus().sms, textbee: serviceStatus().textbee },
      { emailOtp: false, groq: false, openai: false, paymongo: false, sms: false, textbee: false }
    );

    process.env.ENABLE_OPENAI = "true";
    process.env.ENABLE_GROQ = "true";
    process.env.ENABLE_PAYMONGO = "true";
    process.env.ENABLE_TEXTBEE = "true";
    process.env.ENABLE_RESEND = "true";
    assert.deepEqual(
      { emailOtp: serviceStatus().emailOtp, groq: serviceStatus().groq, openai: serviceStatus().openai, paymongo: serviceStatus().paymongo, sms: serviceStatus().sms, textbee: serviceStatus().textbee },
      { emailOtp: true, groq: true, openai: true, paymongo: true, sms: true, textbee: true }
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
