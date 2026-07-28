import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeOrderUpdate,
  bearerToken,
  canAccessOrder,
  HttpError,
  validRecordId,
  validateDeliveryProof,
  validateLocation,
  validateOrderItems
} from "../src/security.js";
import { createCustomerRegistration, passwordChecklist, validateCustomerRegistration, verifyTurnstileToken } from "../src/registration.js";

const order = {
  customerId: "customer-1",
  deliveryType: "delivery",
  riderId: "rider-1",
  status: "ready"
};

test("extracts only valid bearer tokens", () => {
  assert.equal(bearerToken("Bearer abc.def"), "abc.def");
  assert.equal(bearerToken("Basic abc"), "");
  assert.equal(bearerToken(""), "");
});

test("validates secure customer registration inputs", () => {
  const values = validateCustomerRegistration({
    name: "  Juan   Dela Cruz  ",
    email: "  CUSTOMER@Example.COM ",
    password: "TapTapFood2026!",
    confirmPassword: "TapTapFood2026!",
    termsAccepted: true,
    privacyAccepted: true
  });

  assert.equal(values.name, "Juan Dela Cruz");
  assert.equal(values.email, "customer@example.com");
  assert.equal(passwordChecklist("TapTapFood2026!").length, true);
  assert.equal(passwordChecklist("TapTapFood2026!").uppercase, true);
  assert.equal(passwordChecklist("TapTapFood2026!").lowercase, true);
  assert.equal(passwordChecklist("TapTapFood2026!").number, true);
  assert.equal(passwordChecklist("TapTapFood2026!").symbol, true);
  assert.equal(passwordChecklist("password123!").common, false);
});

test("rejects unsafe customer registration inputs", () => {
  const base = {
    name: "Juan Dela Cruz",
    email: "juan@example.com",
    password: "TapTapFood2026!",
    confirmPassword: "TapTapFood2026!",
    termsAccepted: true,
    privacyAccepted: true
  };

  assert.throws(() => validateCustomerRegistration({ ...base, name: "Juan123" }), /full name/i);
  assert.throws(() => validateCustomerRegistration({ ...base, email: "not-an-email" }), /email/i);
  assert.throws(() => validateCustomerRegistration({ ...base, password: "short", confirmPassword: "short" }), /stronger/i);
  assert.throws(() => validateCustomerRegistration({ ...base, confirmPassword: "Different2026!" }), /match/i);
  assert.throws(() => validateCustomerRegistration({ ...base, termsAccepted: false }), /Terms and Privacy/i);
  assert.throws(() => validateCustomerRegistration({ ...base, botField: "filled" }), /could not create/i);
});

test("audits rate-limited customer registrations with safe identifiers", async () => {
  const writes = {};
  const db = {
    ref(path) {
      return {
        once: async () => ({
          val: () => path.startsWith("security/registrationRate/")
            ? { windowStart: Date.now(), count: 5 }
            : null
        }),
        set: async (value) => {
          writes[path] = value;
        }
      };
    }
  };

  await assert.rejects(
    () => createCustomerRegistration({
      db,
      auth: { createUser: async () => assert.fail("rate-limited registration must not create a user") },
      input: {
        name: "Juan Dela Cruz",
        email: "juan@example.com",
        password: "TapTapFood2026!",
        confirmPassword: "TapTapFood2026!",
        termsAccepted: true,
        privacyAccepted: true
      },
      req: { headers: { "user-agent": "node-test" }, ip: "127.0.0.1" }
    }),
    /Too many registration attempts/
  );

  const auditEntry = Object.values(writes).find((entry) => entry.action === "registration_rate_limited");
  assert.equal(auditEntry.actorRole, "customer");
  assert.match(auditEntry.emailHash, /^[a-f0-9]{40}$/);
  assert.match(auditEntry.ipHash, /^[a-f0-9]{40}$/);
  assert.equal(auditEntry.reason, "Too many registration attempts");
});

test("verifies current Turnstile registration tokens for the expected action and hostname", async () => {
  const now = Date.parse("2026-07-28T10:00:00.000Z");
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(options.method, "POST");
    assert.equal(options.body.get("secret"), "turnstile-secret");
    assert.equal(options.body.get("response"), "turnstile-token");
    assert.equal(options.body.get("remoteip"), "127.0.0.1");
    return new Response(JSON.stringify({
      success: true,
      hostname: "localhost",
      action: "customer_registration",
      challenge_ts: "2026-07-28T09:58:00.000Z"
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await verifyTurnstileToken({
    secret: "turnstile-secret",
    token: "turnstile-token",
    req: { headers: {}, ip: "127.0.0.1" },
    allowedHostnames: ["localhost"],
    fetchImpl,
    now
  });
  assert.equal(result.configured, true);
  assert.equal(result.hostname, "localhost");
  assert.equal(result.action, "customer_registration");
});

test("rejects missing Turnstile registration tokens", async () => {
  await assert.rejects(
    () => verifyTurnstileToken({ secret: "turnstile-secret", token: "", req: {} }),
    /security check/i
  );
});

test("rejects invalid Turnstile registration tokens", async () => {
  await assert.rejects(
    () => verifyTurnstileToken({
      secret: "turnstile-secret",
      token: "bad-token",
      req: {},
      fetchImpl: async () => new Response(JSON.stringify({
        success: false,
        "error-codes": ["invalid-input-response"]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    }),
    /security check/i
  );
});

test("rejects expired Turnstile registration tokens", async () => {
  await assert.rejects(
    () => verifyTurnstileToken({
      secret: "turnstile-secret",
      token: "expired-token",
      req: {},
      now: Date.parse("2026-07-28T10:00:00.000Z"),
      fetchImpl: async () => new Response(JSON.stringify({
        success: true,
        hostname: "localhost",
        action: "customer_registration",
        challenge_ts: "2026-07-28T09:54:59.000Z"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    }),
    /security check/i
  );
});

test("rejects duplicated Turnstile registration tokens", async () => {
  await assert.rejects(
    () => verifyTurnstileToken({
      secret: "turnstile-secret",
      token: "used-token",
      req: {},
      fetchImpl: async () => new Response(JSON.stringify({
        success: false,
        "error-codes": ["timeout-or-duplicate"]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    }),
    /security check/i
  );
});

test("fails closed when Turnstile verification is unavailable", async () => {
  await assert.rejects(
    () => verifyTurnstileToken({
      secret: "turnstile-secret",
      token: "turnstile-token",
      req: {},
      fetchImpl: async () => {
        throw new Error("network unavailable");
      }
    }),
    (error) => error instanceof HttpError && error.status === 503
  );
});

test("authorizes order access by verified ownership and role", () => {
  assert.equal(canAccessOrder({ uid: "owner-1", role: "owner" }, order), true);
  assert.equal(canAccessOrder({ uid: "customer-1", role: "customer" }, order), true);
  assert.equal(canAccessOrder({ uid: "customer-2", role: "customer" }, order), false);
  assert.equal(canAccessOrder({ uid: "rider-1", role: "rider" }, order), true);
  assert.equal(canAccessOrder({ uid: "rider-2", role: "rider" }, order), false);
});

test("allows riders to claim only ready unassigned orders", () => {
  const claim = authorizeOrderUpdate(
    { uid: "rider-2", role: "rider" },
    { ...order, riderId: null },
    { riderId: "rider-2" }
  );
  assert.equal(claim.riderId, "rider-2");
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-2", role: "rider" }, order, { riderId: "rider-2" }),
    HttpError
  );
});

test("records rider COD handoff separately from owner remittance", () => {
  const deliveredCod = {
    ...order,
    status: "delivered",
    paymentMethod: "cod"
  };
  const result = authorizeOrderUpdate(
    { uid: "rider-1", role: "rider" },
    deliveredCod,
    { codHandoffRequested: true }
  );
  assert.equal(result.codHandoffRequestedBy, "rider-1");
  assert.equal(typeof result.codHandoffRequestedAt, "number");
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-2", role: "rider" }, deliveredCod, { codHandoffRequested: true }),
    /not assigned/i
  );
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-1", role: "rider" }, { ...deliveredCod, codRemittedAt: Date.now() }, { codHandoffRequested: true }),
    /already confirmed/i
  );
});

test("enforces sequential order status changes", () => {
  const staffUpdate = authorizeOrderUpdate(
    { uid: "staff-1", role: "staff" },
    { ...order, status: "received" },
    { status: "preparing" }
  );
  assert.equal(staffUpdate.status, "preparing");
  assert.throws(
    () => authorizeOrderUpdate({ uid: "staff-1", role: "staff" }, order, { status: "delivered" }),
    /next valid status/i
  );
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-1", role: "rider" }, order, { status: "delivered" }),
    /next valid rider status/i
  );
});

test("requires secure proof for rider delivery completion", () => {
  const arrived = { ...order, status: "arrived" };
  assert.throws(
    () => authorizeOrderUpdate({ uid: "rider-1", role: "rider" }, arrived, { status: "delivered" }),
    /proof-of-delivery/i
  );
  const result = authorizeOrderUpdate(
    { uid: "rider-1", role: "rider" },
    arrived,
    { status: "delivered", proofOfDeliveryUrl: "https://example.com/proof.jpg" }
  );
  assert.equal(result.status, "delivered");
  const storedResult = authorizeOrderUpdate(
    { uid: "rider-1", role: "rider" },
    arrived,
    { status: "delivered", proofOfDeliveryRef: "deliveryProofs/order-1" }
  );
  assert.equal(storedResult.proofOfDeliveryRef, "deliveryProofs/order-1");
  assert.equal(validateDeliveryProof("data:image/jpeg;base64,/9j/2Q=="), "data:image/jpeg;base64,/9j/2Q==");
  assert.throws(() => validateDeliveryProof("data:image/png;base64,iVBORw0KGgo="), /JPEG/i);
});

test("validates record IDs, item quantities, and GPS coordinates", () => {
  assert.equal(validRecordId("TAP_123-abc"), true);
  assert.equal(validRecordId("../orders"), false);
  assert.deepEqual(validateOrderItems([{ id: "sisig", qty: 2 }]), [{ id: "sisig", qty: 2 }]);
  assert.throws(() => validateOrderItems([{ id: "sisig", qty: 0 }]), /quantities/i);
  assert.deepEqual(validateLocation({ lat: 14.45, lng: 120.97, accuracy: 8 }), {
    lat: 14.45,
    lng: 120.97,
    accuracy: 8
  });
  assert.throws(() => validateLocation({ lat: 100, lng: 120 }), /latitude/i);
});
