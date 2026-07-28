import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const apiBaseUrl = "https://api.paymongo.com/v1";
const webhookToleranceSeconds = 5 * 60;
const keyPrefixes = {
  test: "sk_test_",
  live: "sk_live_"
};

export class PayMongoError extends Error {
  constructor(message, { status = 502, code = "PAYMONGO_ERROR" } = {}) {
    super(message);
    this.name = "PayMongoError";
    this.status = status;
    this.code = code;
  }
}

export function payMongoMode(environment = process.env) {
  return environment.PAYMONGO_MODE === "live" ? "live" : "test";
}

export function payMongoConfiguration(environment = process.env) {
  const mode = payMongoMode(environment);
  const secretKey = String(environment.PAYMONGO_SECRET_KEY || "").trim();
  const webhookSecret = String(environment.PAYMONGO_WEBHOOK_SECRET || "").trim();
  const keyMatchesMode = secretKey.startsWith(keyPrefixes[mode]);
  return {
    enabled: environment.ENABLE_PAYMONGO === "true" && keyMatchesMode && webhookSecret.startsWith("whsk_"),
    mode,
    secretKey,
    webhookSecret,
    keyMatchesMode
  };
}

export function assertPayMongoConfiguration(environment = process.env) {
  if (environment.PAYMONGO_MODE && !["test", "live"].includes(environment.PAYMONGO_MODE)) {
    throw new PayMongoError("PAYMONGO_MODE must be test or live.", {
      status: 503,
      code: "PAYMONGO_MODE_INVALID"
    });
  }
  const configuration = payMongoConfiguration(environment);
  if (environment.ENABLE_PAYMONGO !== "true") {
    throw new PayMongoError("Online payment is disabled.", { status: 503, code: "PAYMONGO_DISABLED" });
  }
  if (!configuration.secretKey) {
    throw new PayMongoError("The PayMongo secret key is not configured.", { status: 503, code: "PAYMONGO_KEY_MISSING" });
  }
  if (!configuration.keyMatchesMode) {
    throw new PayMongoError(`PAYMONGO_MODE=${configuration.mode} requires an ${keyPrefixes[configuration.mode]} key.`, {
      status: 503,
      code: "PAYMONGO_MODE_MISMATCH"
    });
  }
  if (!configuration.webhookSecret.startsWith("whsk_")) {
    throw new PayMongoError("The PayMongo webhook secret is not configured.", {
      status: 503,
      code: "PAYMONGO_WEBHOOK_SECRET_MISSING"
    });
  }
  return configuration;
}

function authorizationHeader(secretKey) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new PayMongoError("PayMongo returned an invalid response.");
  }
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail;
    throw new PayMongoError(typeof detail === "string" ? detail : "PayMongo could not process the request.", {
      status: response.status >= 500 ? 502 : 400,
      code: "PAYMONGO_API_ERROR"
    });
  }
  return payload;
}

async function payMongoRequest(path, { secretKey, fetchImpl = fetch, method = "GET", body, idempotencyKey } = {}) {
  const headers = {
    Accept: "application/json",
    Authorization: authorizationHeader(secretKey)
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let response;
  try {
    response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new PayMongoError("PayMongo could not be reached. Try again shortly.", { code: "PAYMONGO_UNREACHABLE" });
  }
  return parseResponse(response);
}

function checkoutLineItems(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const lineItems = items.map((item) => ({
    currency: "PHP",
    amount: Math.round(Number(item.price) * 100),
    name: String(item.name || "Menu item").slice(0, 120),
    quantity: Number(item.qty)
  }));
  if (Number(order.deliveryFee || 0) > 0) {
    lineItems.push({
      currency: "PHP",
      amount: Math.round(Number(order.deliveryFee) * 100),
      name: "Delivery fee",
      quantity: 1
    });
  }
  const valid = lineItems.length > 0 && lineItems.every((item) => (
    Number.isInteger(item.amount) && item.amount > 0 &&
    Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 50
  ));
  const lineItemTotal = lineItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
  const orderTotal = Math.round(Number(order.total) * 100);
  if (!valid || !Number.isInteger(orderTotal) || orderTotal < 100 || lineItemTotal !== orderTotal) {
    throw new PayMongoError("The order total could not be verified for online payment.", {
      status: 409,
      code: "PAYMONGO_TOTAL_MISMATCH"
    });
  }
  return lineItems;
}

function checkoutIdempotencyKey(orderId, mode) {
  const digest = createHash("sha256").update(`${mode}:${orderId}`).digest("hex");
  return `taptap-checkout-${mode}-${digest}`;
}

function checkoutResource(payload, expectedMode) {
  const resource = payload?.data;
  const attributes = resource?.attributes;
  if (resource?.type !== "checkout_session" || typeof resource.id !== "string" || !attributes) {
    throw new PayMongoError("PayMongo returned an invalid checkout session.");
  }
  const expectedLivemode = expectedMode === "live";
  if (Boolean(attributes.livemode) !== expectedLivemode) {
    throw new PayMongoError("PayMongo returned a checkout session from the wrong mode.", {
      status: 409,
      code: "PAYMONGO_MODE_MISMATCH"
    });
  }
  return {
    id: resource.id,
    checkoutUrl: attributes.checkout_url,
    referenceNumber: attributes.reference_number,
    status: attributes.status,
    livemode: Boolean(attributes.livemode),
    payments: Array.isArray(attributes.payments) ? attributes.payments : []
  };
}

export async function createPayMongoCheckoutSession(order, returnUrls, options = {}) {
  const configuration = options.configuration || assertPayMongoConfiguration(options.environment);
  const orderId = String(order.orderId || "");
  const payload = await payMongoRequest("/checkout_sessions", {
    secretKey: configuration.secretKey,
    fetchImpl: options.fetchImpl,
    method: "POST",
    idempotencyKey: checkoutIdempotencyKey(orderId, configuration.mode),
    body: {
      data: {
        attributes: {
          billing: {
            email: order.customerEmail || undefined,
            name: order.customerName || undefined,
            phone: order.phone || undefined
          },
          description: `TapTap Foodtrip order ${orderId}`,
          line_items: checkoutLineItems(order),
          payment_method_types: ["gcash"],
          success_url: returnUrls.successUrl,
          cancel_url: returnUrls.cancelUrl,
          reference_number: orderId,
          metadata: { order_id: orderId },
          send_email_receipt: true,
          show_description: true,
          show_line_items: true
        }
      }
    }
  });
  const session = checkoutResource(payload, configuration.mode);
  if (!session.checkoutUrl || session.referenceNumber !== orderId) {
    throw new PayMongoError("PayMongo returned an incomplete checkout session.");
  }
  return session;
}

export async function retrievePayMongoCheckoutSession(sessionId, options = {}) {
  const configuration = options.configuration || assertPayMongoConfiguration(options.environment);
  if (!/^cs_[A-Za-z0-9]+$/.test(String(sessionId || ""))) {
    throw new PayMongoError("The stored PayMongo checkout session is invalid.", {
      status: 409,
      code: "PAYMONGO_SESSION_INVALID"
    });
  }
  const payload = await payMongoRequest(`/checkout_sessions/${encodeURIComponent(sessionId)}`, {
    secretKey: configuration.secretKey,
    fetchImpl: options.fetchImpl
  });
  return checkoutResource(payload, configuration.mode);
}

function signaturesFromHeader(header) {
  const parts = Object.fromEntries(String(header || "")
    .split(",")
    .map((part) => part.trim().split("=", 2))
    .filter(([key, value]) => key && value !== undefined));
  return { timestamp: parts.t || "", test: parts.te || "", live: parts.li || "" };
}

function constantTimeHexMatch(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifyPayMongoWebhook({
  rawBody,
  signatureHeader,
  webhookSecret,
  mode = "test",
  now = Date.now(),
  toleranceSeconds = webhookToleranceSeconds
}) {
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string") {
    throw new PayMongoError("The raw PayMongo webhook body is unavailable.", {
      status: 400,
      code: "PAYMONGO_RAW_BODY_REQUIRED"
    });
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const signatures = signaturesFromHeader(signatureHeader);
  const timestamp = Number(signatures.timestamp);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    throw new PayMongoError("The PayMongo webhook signature is invalid.", {
      status: 401,
      code: "PAYMONGO_SIGNATURE_INVALID"
    });
  }
  if (Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) {
    throw new PayMongoError("The PayMongo webhook timestamp is outside the accepted window.", {
      status: 401,
      code: "PAYMONGO_WEBHOOK_EXPIRED"
    });
  }
  const supplied = mode === "live" ? signatures.live : signatures.test;
  const expected = createHmac("sha256", webhookSecret).update(`${signatures.timestamp}.${body}`).digest("hex");
  if (!constantTimeHexMatch(supplied, expected)) {
    throw new PayMongoError("The PayMongo webhook signature is invalid.", {
      status: 401,
      code: "PAYMONGO_SIGNATURE_INVALID"
    });
  }
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    throw new PayMongoError("The PayMongo webhook payload is invalid.", {
      status: 400,
      code: "PAYMONGO_WEBHOOK_INVALID"
    });
  }
  const livemode = Boolean(event?.data?.attributes?.livemode);
  if (livemode !== (mode === "live")) {
    throw new PayMongoError("The PayMongo webhook mode does not match this environment.", {
      status: 409,
      code: "PAYMONGO_MODE_MISMATCH"
    });
  }
  return event;
}

export function checkoutPaymentFromEvent(event) {
  const eventId = event?.data?.id;
  const attributes = event?.data?.attributes;
  if (event?.data?.type !== "event" || typeof eventId !== "string" || !attributes) {
    throw new PayMongoError("The PayMongo webhook event is invalid.", {
      status: 400,
      code: "PAYMONGO_WEBHOOK_INVALID"
    });
  }
  if (attributes.type !== "checkout_session.payment.paid") {
    return { eventId, eventType: attributes.type || "unknown", ignored: true };
  }
  const session = attributes.data;
  const sessionAttributes = session?.attributes;
  const payment = Array.isArray(sessionAttributes?.payments)
    ? sessionAttributes.payments.find((entry) => entry?.attributes?.status === "paid")
    : null;
  const amount = Number(payment?.attributes?.amount);
  if (
    session?.type !== "checkout_session" ||
    typeof session.id !== "string" ||
    typeof sessionAttributes?.reference_number !== "string" ||
    typeof payment?.id !== "string" ||
    !Number.isInteger(amount) || amount < 1
  ) {
    throw new PayMongoError("The paid checkout event is missing required payment details.", {
      status: 400,
      code: "PAYMONGO_WEBHOOK_INVALID"
    });
  }
  return {
    eventId,
    eventType: attributes.type,
    ignored: false,
    livemode: Boolean(attributes.livemode),
    orderId: sessionAttributes.reference_number,
    sessionId: session.id,
    paymentId: payment.id,
    amount,
    currency: payment.attributes.currency,
    paidAt: Number(payment.attributes.paid_at || sessionAttributes.paid_at || attributes.created_at || 0) * 1000
  };
}
