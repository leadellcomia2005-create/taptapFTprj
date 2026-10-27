import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  healthyTextBeeDevice,
  normalizePhilippineMobile,
  sendTextBeeSms,
  textBeeConfiguration,
  verifyTextBeeWebhookSignature
} from "../src/integrations/textbee.js";

const configuration = {
  enabled: true,
  apiKey: "secret-api-key",
  deviceId: "device-1",
  webhookSecret: "webhook-secret",
  baseUrl: "https://api.textbee.dev/api/v1",
  timeoutMs: 1_000,
  heartbeatMaxAgeMs: 45 * 60 * 1000
};

test("normalizes valid Philippine mobile numbers to E.164", () => {
  assert.equal(normalizePhilippineMobile("0917 123 4567"), "+639171234567");
  assert.equal(normalizePhilippineMobile("+63 917 123 4567"), "+639171234567");
  assert.equal(normalizePhilippineMobile("9171234567"), "+639171234567");
  assert.equal(normalizePhilippineMobile("12345"), "");
});

test("TextBee remains disabled unless explicitly enabled with an API key", () => {
  assert.equal(textBeeConfiguration({ TEXTBEE_API_KEY: "key" }).enabled, false);
  assert.equal(textBeeConfiguration({ ENABLE_TEXTBEE: "true" }).enabled, false);
  assert.equal(textBeeConfiguration({ ENABLE_TEXTBEE: "true", TEXTBEE_API_KEY: "key" }).enabled, true);
});

test("sends SMS through the server adapter without exposing credentials", async () => {
  let request;
  const result = await sendTextBeeSms({
    to: "09171234567",
    message: "Test message",
    configuration,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ data: { smsBatchId: "batch-1" } }) };
    }
  });
  assert.equal(request.url, "https://api.textbee.dev/api/v1/gateway/send-sms");
  assert.equal(request.options.headers["x-api-key"], "secret-api-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    recipients: ["+639171234567"],
    message: "Test message",
    deviceId: "device-1"
  });
  assert.equal(result.smsBatchId, "batch-1");
  assert.equal(JSON.stringify(result).includes("secret-api-key"), false);
});

test("rejects an offline Android gateway before sending an OTP", async () => {
  await assert.rejects(
    () => healthyTextBeeDevice({
      configuration,
      now: 4_000_000,
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: "device-1", lastHeartbeat: 1 } }) })
    }),
    (error) => error.code === "SMS_GATEWAY_OFFLINE"
  );
});

test("validates TextBee webhook signatures over the raw request body", () => {
  const rawBody = Buffer.from(JSON.stringify({ idempotencyKey: "event-1" }));
  const signature = createHmac("sha256", "webhook-secret").update(rawBody).digest("hex");
  assert.equal(verifyTextBeeWebhookSignature(rawBody, signature, "webhook-secret"), true);
  assert.equal(verifyTextBeeWebhookSignature(rawBody, "0".repeat(64), "webhook-secret"), false);
});
