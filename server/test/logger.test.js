import assert from "node:assert/strict";
import test from "node:test";
import { createErrorHandler } from "../src/middleware/errors.js";
import { createLogger, sanitizeLogDetails } from "../src/observability/logger.js";

test("redacts customer and credential fields from structured logs", () => {
  const sanitized = sanitizeLogDetails({
    requestId: "request-1234",
    userId: "user-1",
    email: "customer@example.com",
    phoneNumber: "+639171234567",
    deliveryLocation: { lat: 14.45, lng: 120.98 },
    nested: { authorization: "Bearer secret-token", note: "contact customer@example.com or 09171234567" }
  });

  assert.equal(sanitized.requestId, "request-1234");
  assert.equal(sanitized.userId, "user-1");
  assert.equal(sanitized.email, "[REDACTED]");
  assert.equal(sanitized.phoneNumber, "[REDACTED]");
  assert.equal(sanitized.deliveryLocation, "[REDACTED]");
  assert.equal(sanitized.nested.authorization, "[REDACTED]");
  assert.equal(sanitized.nested.note, "contact [REDACTED_EMAIL] or [REDACTED_PHONE]");
});

test("serializes redacted errors without throwing on circular details", () => {
  const lines = [];
  const sink = { log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  const logger = createLogger({ service: "test", sink });
  const details = { requestId: "request-1234", password: "do-not-log" };
  details.self = details;
  logger.error("test_failure", details);
  logger.error("runtime_failure", new Error("Failed for customer@example.com with Bearer secret-token"));

  const first = JSON.parse(lines[0]);
  const second = JSON.parse(lines[1]);
  assert.equal(first.password, "[REDACTED]");
  assert.equal(first.self, "[CIRCULAR]");
  assert.equal(second.errorMessage, "Failed for [REDACTED_EMAIL] with Bearer [REDACTED]");
});

test("returns a generic public response for unexpected server failures", () => {
  const lines = [];
  const sink = { log() {}, warn() {}, error: (line) => lines.push(line) };
  const logger = createLogger({ service: "test", sink });
  let statusCode = 0;
  let responseBody;
  const response = {
    headersSent: false,
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    }
  };
  const request = {
    context: { requestId: "request-1234" },
    method: "POST",
    originalUrl: "/api/orders?email=customer@example.com"
  };

  createErrorHandler(logger)(new Error("Database failure for customer@example.com"), request, response, () => {});

  assert.equal(statusCode, 500);
  assert.deepEqual(responseBody, {
    error: "The server could not complete the request.",
    code: "INTERNAL_ERROR",
    requestId: "request-1234"
  });
  assert.equal(lines[0].includes("customer@example.com"), false);
  assert.equal(JSON.parse(lines[0]).path, "/api/orders");
});
