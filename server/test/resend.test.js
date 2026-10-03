import test from "node:test";
import assert from "node:assert/strict";
import { resendConfiguration, sendResendEmail } from "../src/integrations/resend.js";

test("requires explicit Resend opt-in and complete credentials", () => {
  assert.equal(resendConfiguration({
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM_EMAIL: "security@mail.example.com"
  }).enabled, false);
  assert.equal(resendConfiguration({
    ENABLE_RESEND: "true",
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM_EMAIL: "security@mail.example.com"
  }).enabled, true);
});

test("sends transactional email through the Resend HTTPS API", async () => {
  const previous = {
    ENABLE_RESEND: process.env.ENABLE_RESEND,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL
  };
  process.env.ENABLE_RESEND = "true";
  process.env.RESEND_API_KEY = "re_private_key";
  process.env.RESEND_FROM_EMAIL = "TapTap Foodtrip <security@mail.example.com>";
  let request;
  try {
    const result = await sendResendEmail({
      to: "customer@example.com",
      subject: "Verification code",
      text: "Your code is 123456.",
      html: "<p>Your code is <strong>123456</strong>.</p>",
      fetchImpl: async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({ id: "email-1" }) };
      }
    });
    assert.equal(result.id, "email-1");
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.headers.Authorization, "Bearer re_private_key");
    assert.deepEqual(request.body.to, ["customer@example.com"]);
    assert.equal(request.body.from, "TapTap Foodtrip <security@mail.example.com>");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("does not expose provider responses when Resend rejects delivery", async () => {
  const previous = {
    ENABLE_RESEND: process.env.ENABLE_RESEND,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL
  };
  process.env.ENABLE_RESEND = "true";
  process.env.RESEND_API_KEY = "re_private_key";
  process.env.RESEND_FROM_EMAIL = "security@mail.example.com";
  try {
    await assert.rejects(
      () => sendResendEmail({
        to: "customer@example.com",
        subject: "Verification code",
        text: "Your code is 123456.",
        fetchImpl: async () => ({ ok: false })
      }),
      (error) => error.code === "resend-delivery-failed" && !error.message.includes("customer@example.com")
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
