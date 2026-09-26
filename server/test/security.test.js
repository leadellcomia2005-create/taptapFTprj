import test from "node:test";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";
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
import {
  checkRegistrationEmail,
  createCustomerRegistration,
  passwordChecklist,
  resendCustomerRegistrationVerification,
  validateCustomerRegistration,
  verifyTurnstileToken
} from "../src/registration.js";

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
  assert.throws(() => validateCustomerRegistration({ ...base, email: "juan@@gmail.com" }), /email/i);
  assert.throws(() => validateCustomerRegistration({ ...base, password: "short", confirmPassword: "short" }), /stronger/i);
  assert.throws(() => validateCustomerRegistration({ ...base, confirmPassword: "Different2026!" }), /match/i);
  assert.throws(() => validateCustomerRegistration({ ...base, termsAccepted: false }), /Terms and Privacy/i);
  assert.throws(() => validateCustomerRegistration({ ...base, botField: "filled" }), /could not create/i);
});

test("checks registration email domains before CAPTCHA", async () => {
  const accepted = await checkRegistrationEmail("juan@example.test", {
    resolveMxImpl: async (domain) => {
      assert.equal(domain, "example.test");
      return [{ priority: 10, exchange: "mail.example.test" }];
    },
    now: 1
  });
  assert.equal(accepted.eligible, true);

  const missing = await checkRegistrationEmail("juan@missing.test", {
    resolveMxImpl: async () => {
      const error = new Error("not found");
      error.code = "ENOTFOUND";
      throw error;
    },
    now: 1
  });
  assert.equal(missing.code, "no_mail_server");
  assert.equal((await checkRegistrationEmail("juan@gmail.com.com")).code, "repeated_domain");
  assert.equal((await checkRegistrationEmail("juan@gmial.com")).suggestion, "gmail.com");
  assert.equal((await checkRegistrationEmail("juan@mailinator.com")).code, "disposable_domain");
});

test("prevents duplicate Firebase accounts without creating another profile", async () => {
  const database = new FakeRealtimeDatabase();
  let createCalls = 0;
  await assert.rejects(
    () => createCustomerRegistration({
      db: database,
      auth: {
        getUserByEmail: async () => ({ uid: "existing-customer", emailVerified: true }),
        createUser: async () => {
          createCalls += 1;
          return { uid: "must-not-exist" };
        }
      },
      input: {
        name: "Juan Dela Cruz",
        email: " CUSTOMER@Example.COM ",
        password: "TapTapFood2026!",
        confirmPassword: "TapTapFood2026!",
        termsAccepted: true,
        privacyAccepted: true
      },
      req: { headers: { "user-agent": "node-test" }, ip: "127.0.0.1" },
      verifyEmail: async () => ({ eligible: true, code: "deliverable_domain" })
    }),
    (error) => error instanceof HttpError
      && error.status === 409
      && error.code === "ACCOUNT_RECOVERY_REQUIRED"
      && /may already use/i.test(error.message)
  );
  assert.equal(createCalls, 0);
  assert.equal(database.read("users/must-not-exist"), undefined);
});

test("uses Firebase createUser as the final duplicate-email guard", async () => {
  const database = new FakeRealtimeDatabase();
  await assert.rejects(
    () => createCustomerRegistration({
      db: database,
      auth: {
        getUserByEmail: async () => {
          const error = new Error("not found");
          error.code = "auth/user-not-found";
          throw error;
        },
        createUser: async () => {
          const error = new Error("duplicate");
          error.code = "auth/email-already-exists";
          throw error;
        }
      },
      input: {
        name: "Juan Dela Cruz",
        email: "customer@example.com",
        password: "TapTapFood2026!",
        confirmPassword: "TapTapFood2026!",
        termsAccepted: true,
        privacyAccepted: true
      },
      req: { headers: { "user-agent": "node-test" }, ip: "127.0.0.1" },
      verifyEmail: async () => ({ eligible: true, code: "deliverable_domain" })
    }),
    (error) => error.code === "ACCOUNT_RECOVERY_REQUIRED"
  );
  assert.equal(database.read("users"), undefined);
});

test("resends verification only after cooldown and starts a new three-minute session", async () => {
  const now = Date.parse("2026-09-26T01:00:00.000Z");
  const database = new FakeRealtimeDatabase({
    users: {
      "customer-1": {
        name: "Juan Dela Cruz",
        role: "customer",
        registration: {
          cleanupEligibleAt: now + 60_000,
          lastVerificationSentAt: now - 61_000,
          verificationSendCount: 1,
          verificationSendWindowStartedAt: now - 120_000
        }
      }
    }
  });
  const sent = [];
  const auth = {
    getUser: async () => ({ uid: "customer-1", email: "juan@example.com", emailVerified: false }),
    generateEmailVerificationLink: async () => "https://example.test/verify"
  };

  const result = await resendCustomerRegistrationVerification({
    db: database,
    auth,
    user: { uid: "customer-1" },
    sendVerificationEmail: async (...args) => sent.push(args),
    appBaseUrl: "https://orders.example.test",
    now
  });

  assert.equal(result.verificationExpiresAt, now + 180_000);
  assert.equal(result.cooldownSeconds, 60);
  assert.equal(sent.length, 1);
  assert.equal(database.read("users/customer-1/registration/verificationSendCount"), 2);
  assert.ok(database.read("users/customer-1/registration/cleanupEligibleAt") >= now + 24 * 60 * 60 * 1000);

  await assert.rejects(
    () => resendCustomerRegistrationVerification({
      db: database,
      auth,
      user: { uid: "customer-1" },
      sendVerificationEmail: async () => {},
      now: now + 1_000
    }),
    (error) => error.code === "VERIFICATION_RESEND_COOLDOWN"
  );
});

test("allows only one simultaneous verification resend claim", async () => {
  const now = Date.parse("2026-09-26T02:00:00.000Z");
  const database = new FakeRealtimeDatabase({
    users: {
      "customer-1": {
        name: "Juan Dela Cruz",
        role: "customer",
        registration: {
          cleanupEligibleAt: now + 60_000,
          lastVerificationSentAt: now - 61_000,
          verificationSendCount: 1,
          verificationSendWindowStartedAt: now - 120_000
        }
      }
    }
  });
  const auth = {
    getUser: async () => ({ uid: "customer-1", email: "juan@example.com", emailVerified: false }),
    generateEmailVerificationLink: async () => "https://example.test/verify"
  };
  let sent = 0;
  const request = () => resendCustomerRegistrationVerification({
    db: database,
    auth,
    user: { uid: "customer-1" },
    sendVerificationEmail: async () => { sent += 1; },
    now
  });

  const results = await Promise.allSettled([request(), request()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(sent, 1);
  assert.equal(database.read("users/customer-1/registration/verificationSendCount"), 2);
});

test("falls back to domain-only HTTPS DNS when the local resolver is unavailable", async () => {
  let requestedUrl = "";
  const result = await checkRegistrationEmail("juan@fallback.test", {
    resolveMxImpl: async () => {
      const error = new Error("resolver unavailable");
      error.code = "ECONNREFUSED";
      throw error;
    },
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 15, data: "10 mail.fallback.test." }]
      }), { status: 200, headers: { "Content-Type": "application/dns-json" } });
    },
    now: 1
  });

  assert.equal(result.eligible, true);
  assert.match(requestedUrl, /name=fallback\.test/);
  assert.doesNotMatch(requestedUrl, /juan/);
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
