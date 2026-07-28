import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { confirmPayMongoPayment } from "../src/application/payments.js";
import {
  checkoutPaymentFromEvent,
  createPayMongoCheckoutSession,
  payMongoConfiguration,
  verifyPayMongoWebhook
} from "../src/integrations/paymongo.js";
import { FakeRealtimeDatabase } from "./helpers/fakeRealtimeDb.js";
import { createNoopLogger } from "../src/observability/logger.js";
import { createOperationalMetrics } from "../src/observability/metrics.js";

const testConfiguration = {
  enabled: true,
  mode: "test",
  secretKey: "sk_test_example",
  webhookSecret: "whsk_example",
  keyMatchesMode: true
};

function checkoutPaidEvent(overrides = {}) {
  return {
    data: {
      id: overrides.eventId || "evt_test123",
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        created_at: 1_750_000_000,
        data: {
          id: overrides.sessionId || "cs_test123",
          type: "checkout_session",
          attributes: {
            reference_number: overrides.orderId || "order-test123",
            paid_at: 1_750_000_000,
            payments: [{
              id: overrides.paymentId || "pay_test123",
              type: "payment",
              attributes: {
                amount: overrides.amount ?? 14_800,
                currency: overrides.currency || "PHP",
                status: "paid",
                paid_at: 1_750_000_000
              }
            }]
          }
        }
      }
    }
  };
}

function signatureFor(body, timestamp, secret = testConfiguration.webhookSecret) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},te=${signature},li=`;
}

function paymentDatabase() {
  return new FakeRealtimeDatabase({
    users: {
      "customer-1": { role: "customer", name: "Customer" },
      "staff-1": { role: "staff", name: "Staff" },
      "owner-1": { role: "owner", name: "Owner" }
    },
    orders: {
      "order-test123": {
        customerId: "customer-1",
        customerName: "Customer",
        paymentMethod: "gcash",
        paymentProvider: "paymongo",
        paymentStatus: "pending",
        providerSessionId: "cs_test123",
        providerLivemode: false,
        status: "pending-payment",
        deliveryType: "pickup",
        total: 148,
        createdAt: Date.UTC(2026, 6, 22)
      }
    }
  });
}

test("PayMongo remains disabled unless mode-matched keys and a webhook secret are present", () => {
  assert.equal(payMongoConfiguration({
    ENABLE_PAYMONGO: "true",
    PAYMONGO_MODE: "test",
    PAYMONGO_SECRET_KEY: "sk_test_example"
  }).enabled, false);
  assert.equal(payMongoConfiguration({
    ENABLE_PAYMONGO: "true",
    PAYMONGO_MODE: "test",
    PAYMONGO_SECRET_KEY: "sk_live_example",
    PAYMONGO_WEBHOOK_SECRET: "whsk_example"
  }).enabled, false);
  assert.equal(payMongoConfiguration({
    ENABLE_PAYMONGO: "true",
    PAYMONGO_MODE: "test",
    PAYMONGO_SECRET_KEY: "sk_test_example",
    PAYMONGO_WEBHOOK_SECRET: "whsk_example"
  }).enabled, true);
});

test("creates a test checkout on the server with a stable idempotency key", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      data: {
        id: "cs_test123",
        type: "checkout_session",
        attributes: {
          checkout_url: "https://checkout.paymongo.com/cs_test123",
          reference_number: "order-test123",
          status: "active",
          livemode: false,
          payments: []
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const order = {
    orderId: "order-test123",
    customerEmail: "customer@example.test",
    customerName: "Customer",
    phone: "+639171234567",
    items: [{ name: "Test meal", price: 99, qty: 1 }],
    deliveryFee: 49,
    total: 148
  };
  const first = await createPayMongoCheckoutSession(order, {
    successUrl: "https://example.test/payment/success",
    cancelUrl: "https://example.test/payment/cancel"
  }, { configuration: testConfiguration, fetchImpl });
  const firstKey = request.options.headers["Idempotency-Key"];
  const body = JSON.parse(request.options.body);
  await createPayMongoCheckoutSession(order, {
    successUrl: "https://example.test/payment/success",
    cancelUrl: "https://example.test/payment/cancel"
  }, { configuration: testConfiguration, fetchImpl });

  assert.equal(request.url, "https://api.paymongo.com/v1/checkout_sessions");
  assert.match(request.options.headers.Authorization, /^Basic /);
  assert.match(firstKey, /^taptap-checkout-test-/);
  assert.equal(request.options.headers["Idempotency-Key"], firstKey);
  assert.deepEqual(body.data.attributes.payment_method_types, ["gcash"]);
  assert.equal(body.data.attributes.reference_number, "order-test123");
  assert.equal(first.checkoutUrl, "https://checkout.paymongo.com/cs_test123");
});

test("verifies the raw test webhook signature and extracts paid checkout data", () => {
  const event = checkoutPaidEvent();
  const body = JSON.stringify(event);
  const timestamp = 1_750_000_000;
  const verified = verifyPayMongoWebhook({
    rawBody: Buffer.from(body),
    signatureHeader: signatureFor(body, timestamp),
    webhookSecret: testConfiguration.webhookSecret,
    mode: "test",
    now: timestamp * 1000
  });
  const payment = checkoutPaymentFromEvent(verified);
  assert.equal(payment.orderId, "order-test123");
  assert.equal(payment.sessionId, "cs_test123");
  assert.equal(payment.paymentId, "pay_test123");
  assert.equal(payment.amount, 14_800);

  assert.throws(() => verifyPayMongoWebhook({
    rawBody: body,
    signatureHeader: signatureFor(body, timestamp, "wrong-secret"),
    webhookSecret: testConfiguration.webhookSecret,
    mode: "test",
    now: timestamp * 1000
  }), /signature is invalid/i);
});

test("confirms a paid checkout once and updates the order ledger", async () => {
  const database = paymentDatabase();
  const payment = checkoutPaymentFromEvent(checkoutPaidEvent());
  const first = await confirmPayMongoPayment(database, payment);
  const replay = await confirmPayMongoPayment(database, payment);

  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(database.read("orders/order-test123/status"), "received");
  assert.equal(database.read("orders/order-test123/paymentStatus"), "paid");
  assert.equal(database.read("orders/order-test123/providerPaymentId"), "pay_test123");
  assert.equal(database.read("paymongoWebhookEvents/evt_test123/status"), "complete");
  assert.equal(Object.keys(database.read("paymentMovements/order-test123")).length, 1);
  assert.equal(Object.keys(database.read("notifications")).length, 3);
  assert.equal(database.read("reportAggregates/daily/2026-07-22/paidSales"), 148);
});

test("rejects a signed payment whose amount does not match the server order", async () => {
  const database = paymentDatabase();
  const payment = checkoutPaymentFromEvent(checkoutPaidEvent({ amount: 14_700 }));
  await assert.rejects(() => confirmPayMongoPayment(database, payment), /does not match the order total/i);
  assert.equal(database.read("orders/order-test123/paymentStatus"), "pending");
  assert.equal(database.read("paymongoWebhookEvents/evt_test123/status"), "rejected");
});

test("the public webhook route verifies the exact raw request body", async () => {
  const names = ["ENABLE_PAYMONGO", "PAYMONGO_MODE", "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const database = paymentDatabase();
  const firebase = { enabled: true, db: () => database };
  const attachUser = (req, _res, next) => {
    req.user = { uid: "customer-1", role: "customer" };
    next();
  };
  const app = createApp({
    config: { apiVersion: "test", allowedOrigins: ["http://localhost:5173"], trustProxy: false },
    firebase,
    authentication: {
      authenticate: attachUser,
      authenticateBootstrap: attachUser,
      requireFirebaseAdmin: (_req, _res, next) => next()
    },
    realtime: { emit() {} },
    logger: createNoopLogger(),
    metrics: createOperationalMetrics(),
    serverStartedAt: Date.now()
  });
  const server = createServer(app);
  try {
    process.env.ENABLE_PAYMONGO = "true";
    process.env.PAYMONGO_MODE = "test";
    process.env.PAYMONGO_SECRET_KEY = testConfiguration.secretKey;
    process.env.PAYMONGO_WEBHOOK_SECRET = testConfiguration.webhookSecret;
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api/payments/paymongo/webhook`;
    const body = JSON.stringify(checkoutPaidEvent());
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Paymongo-Signature": signatureFor(body, timestamp)
      },
      body
    });
    assert.equal(response.status, 200);
    assert.equal(database.read("orders/order-test123/paymentStatus"), "paid");

    const unsigned = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    assert.equal(unsigned.status, 401);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
