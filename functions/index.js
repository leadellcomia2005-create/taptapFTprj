import dialogflow from "@google-cloud/dialogflow";
import cors from "cors";
import express from "express";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import twilio from "twilio";
import {
  adjustInventoryRecord,
  canAccessOrder,
  createMenuItemRecord,
  createOrderRecord,
  HttpError,
  listOrdersForUser,
  saveDeliveryProofRecord,
  saveRiderLocationRecord,
  saveShiftLogRecord,
  updateMenuItemRecord,
  updateOrderRecord,
  updateReviewRecord,
  validRecordId
} from "./operations.js";
import {
  cleanupExpiredNotifications,
  clearReadNotifications,
  clearNotifications,
  createNotification,
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead
} from "./notifications.js";
import {
  beginTotpSetup,
  finishEnrollment,
  resetTwoFactor,
  sendEmailCode,
  sendSmsCode,
  twoFactorStatus,
  unlockTwoFactor,
  verifyChallenge
} from "./twoFactor.js";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration
} from "./passkeys.js";
import { createCustomerRegistration, verifyTurnstileToken } from "./registration.js";
import {
  confirmPayMongoPayment,
  recordPayMongoCheckoutSession
} from "../server/src/application/payments.js";
import {
  assertPayMongoConfiguration,
  checkoutPaymentFromEvent,
  createPayMongoCheckoutSession,
  retrievePayMongoCheckoutSession,
  verifyPayMongoWebhook
} from "../server/src/integrations/paymongo.js";
import {
  dispatchOrderPush,
  pushStatus,
  registerPushToken,
  removePushTokens
} from "../server/src/pushNotifications.js";

initializeApp();
const database = () => getDatabase();
const firebaseServices = { messaging: () => getMessaging() };
const pushLogger = {
  warn(event, details) {
    console.warn(event, details);
  }
};

const openaiKey = defineSecret("OPENAI_API_KEY");
const paymongoKey = defineSecret("PAYMONGO_SECRET_KEY");
const paymongoWebhookSecret = defineSecret("PAYMONGO_WEBHOOK_SECRET");
const twilioSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioToken = defineSecret("TWILIO_AUTH_TOKEN");
const twoFactorKey = defineSecret("TWO_FACTOR_ENCRYPTION_KEY");
const gmailUser = defineSecret("GMAIL_USER");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");
const turnstileSecret = defineSecret("TURNSTILE_SECRET_KEY");
const app = express();

const allowedOrigins = () => (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({
  limit: "1mb",
  verify(req, _res, buffer) {
    if (!req.rawBody && req.originalUrl.split("?")[0].endsWith("/payments/paymongo/webhook")) {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));

const route = (path) => [path, `/api${path}`];
const secretValue = (secret) => {
  try {
    return secret.value();
  } catch {
    return "";
  }
};

function paymongoConfiguration() {
  return assertPayMongoConfiguration({
    ENABLE_PAYMONGO: process.env.ENABLE_PAYMONGO,
    PAYMONGO_MODE: process.env.PAYMONGO_MODE,
    PAYMONGO_SECRET_KEY: secretValue(paymongoKey),
    PAYMONGO_WEBHOOK_SECRET: secretValue(paymongoWebhookSecret)
  });
}

function paymongoEnabled() {
  try {
    paymongoConfiguration();
    return true;
  } catch {
    return false;
  }
}

function checkoutReturnUrls(orderId) {
  let base = "http://localhost:5173";
  try {
    base = new URL(allowedOrigins()[0] || base).origin;
  } catch {}
  const encodedOrderId = encodeURIComponent(orderId);
  return {
    successUrl: `${base}/?payment=success&orderId=${encodedOrderId}`,
    cancelUrl: `${base}/?payment=cancelled&orderId=${encodedOrderId}`
  };
}

async function verifyUserToken(token) {
  const decoded = await getAuth().verifyIdToken(token);
  if (decoded.role) return decoded;
  const profile = (await database().ref(`users/${decoded.uid}`).once("value")).val() || {};
  return { ...decoded, role: profile.role || "customer", name: profile.name || decoded.name };
}

async function authenticateBootstrap(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    req.authToken = token;
    req.user = await verifyUserToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token." });
  }
}

function requireVerifiedEmail(req, res, next) {
  if (req.user?.email_verified !== true) {
    return res.status(403).json({ error: "Verify your email address before continuing.", code: "EMAIL_VERIFICATION_REQUIRED" });
  }
  return next();
}

async function authenticate(req, res, next) {
  return authenticateBootstrap(req, res, () => {
    if (req.user?.email_verified !== true) return res.status(403).json({ error: "Verify your email address before accessing the POS.", code: "EMAIL_VERIFICATION_REQUIRED" });
    if (req.user.mfaSession !== true) return res.status(403).json({ error: "Complete two-factor authentication before accessing the POS." });
    return next();
  });
}

const requireRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return res.status(403).json({ error: `${roles.join(" or ")} access required.` });
  return next();
};

const asyncRoute = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : "The server could not complete the request." });
  }
};

const managedAccountRoles = new Set(["owner", "staff", "rider"]);
const managedStaffRoles = new Set(["manager", "cashier", "kitchen", "inventory"]);

function normalizeManagedAccountInput(input = {}) {
  const name = String(input.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const email = String(input.email || "").trim().toLowerCase();
  const role = String(input.role || "staff").trim().toLowerCase();
  const staffRole = managedStaffRoles.has(input.staffRole) ? input.staffRole : "manager";
  const temporaryPassword = String(input.temporaryPassword || "").trim();
  if (name.length < 2) throw new HttpError(400, "Enter the team member's full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (!managedAccountRoles.has(role)) throw new HttpError(400, "Owners can create owner, staff, or rider accounts only.");
  if (temporaryPassword.length < 12) throw new HttpError(400, "Use a temporary password with at least 12 characters.");
  if (temporaryPassword.length > 128) throw new HttpError(400, "Temporary password is too long.");
  return { name, email, role, staffRole, temporaryPassword };
}

app.get(route("/status"), (_req, res) => {
  res.json({
    services: {
      firebase: true,
      socket: false,
      openai: Boolean(secretValue(openaiKey)),
      dialogflow: Boolean(process.env.DIALOGFLOW_PROJECT_ID || process.env.GCLOUD_PROJECT),
      paymongo: paymongoEnabled(),
      twilio: Boolean(secretValue(twilioSid) && secretValue(twilioToken) && process.env.TWILIO_FROM_NUMBER),
      emailOtp: Boolean(secretValue(gmailUser) && secretValue(gmailAppPassword)),
      turnstile: Boolean(secretValue(turnstileSecret)),
      twoFactor: Boolean(secretValue(twoFactorKey))
    }
  });
});

app.post(route("/auth/register"), asyncRoute(async (req, res) => {
  const result = await createCustomerRegistration({
    db: database(),
    auth: getAuth(),
    input: req.body,
    req,
    sendVerificationEmail: secretValue(gmailUser) && secretValue(gmailAppPassword) ? sendCustomerVerificationEmail : null,
    appBaseUrl: allowedOrigins()[0] || "http://localhost:5173",
    verifyHuman: secretValue(turnstileSecret)
      ? (token, request) => verifyTurnstileToken({
        secret: secretValue(turnstileSecret),
        token,
        req: request,
        expectedAction: "customer_registration",
        allowedHostnames: allowedOrigins().map((origin) => new URL(origin).hostname)
      })
      : null
  });
  res.status(201).json(result);
}));

const sendTwoFactorSms = async (to, code) => {
  const sid = secretValue(twilioSid);
  const token = secretValue(twilioToken);
  if (!sid || !token || !process.env.TWILIO_FROM_NUMBER) throw new HttpError(503, "SMS verification is not ready yet.");
  return twilio(sid, token).messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to,
    body: `Taptap Foodtrip verification code: ${code}. It expires in 10 minutes.`
  });
};

let gmailTransport;

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function displayLabel(value) {
  return String(value || "").replaceAll("-", " ");
}

function orderDate(value) {
  return new Date(Number(value || Date.now())).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila"
  });
}

const sendTwoFactorEmail = async (to, code) => {
  const user = secretValue(gmailUser);
  const password = secretValue(gmailAppPassword);
  if (!user || !password || !to) throw new HttpError(503, "Email code is not ready yet.");
  gmailTransport ||= nodemailer.createTransport({ service: "gmail", auth: { user, pass: password } });
  return gmailTransport.sendMail({
    from: `"Taptap Foodtrip" <${user}>`,
    to,
    subject: "Your Taptap Foodtrip verification code",
    text: `Your Taptap Foodtrip verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Taptap Foodtrip verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes.</p>`
  });
};

const sendCustomerVerificationEmail = async (to, verificationLink, name = "Customer") => {
  const user = secretValue(gmailUser);
  const password = secretValue(gmailAppPassword);
  if (!user || !password || !to || !verificationLink) throw new HttpError(503, "Email verification is not ready yet.");
  gmailTransport ||= nodemailer.createTransport({ service: "gmail", auth: { user, pass: password } });
  const safeName = escapeHtml(name || "Customer");
  const safeLink = escapeHtml(verificationLink);
  return gmailTransport.sendMail({
    from: `"Taptap Foodtrip" <${user}>`,
    to,
    subject: "Verify your Taptap Foodtrip account",
    text: `Hi ${name || "Customer"}, verify your Taptap Foodtrip account here: ${verificationLink}`,
    html: `<p>Hi ${safeName},</p><p>Verify your Taptap Foodtrip account before placing orders.</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#e33d2e;color:#fff;text-decoration:none;border-radius:8px">Verify account</a></p><p>If the button does not work, copy this link:</p><p>${safeLink}</p>`
  });
};

const sendOrderReceiptEmail = async (order = {}) => {
  const user = secretValue(gmailUser);
  const password = secretValue(gmailAppPassword);
  if (!user || !password || !order.customerEmail || order.source === "walk-in-pos") return { sent: false };

  gmailTransport ||= nodemailer.createTransport({ service: "gmail", auth: { user, pass: password } });
  const orderId = order.id || order.orderId || "order";
  const items = Array.isArray(order.items) ? order.items : [];
  const itemLines = items.map((item) => {
    const qty = Number(item.qty || 0);
    const lineTotal = Number(item.price || 0) * qty;
    return `- ${qty} x ${item.name} @ ${money(item.price)} = ${money(lineTotal)}`;
  });
  const htmlRows = items.map((item) => {
    const qty = Number(item.qty || 0);
    const lineTotal = Number(item.price || 0) * qty;
    return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(item.name)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">${qty}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(item.price)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(lineTotal)}</td></tr>`;
  }).join("");
  const paymentStatus = displayLabel(order.paymentStatus || order.status);
  const paymentMethod = displayLabel(order.paymentMethod || "payment").toUpperCase();

  const text = [
    "Taptap Foodtrip digital receipt",
    "",
    `Order: ${orderId}`,
    `Date: ${orderDate(order.createdAt)}`,
    `Customer: ${order.customerName || "Customer"}`,
    `Payment: ${paymentMethod} - ${paymentStatus}`,
    `Address: ${order.address || "Counter"}`,
    "",
    "Items:",
    ...itemLines,
    "",
    `Subtotal: ${money(order.subtotal)}`,
    `Delivery fee: ${money(order.deliveryFee)}`,
    `Total: ${money(order.total)}`,
    "",
    "Thank you for ordering from Taptap Foodtrip."
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f1f1f;line-height:1.5;max-width:640px;margin:auto">
      <h1 style="color:#c81d25;margin-bottom:4px">Taptap Foodtrip</h1>
      <p style="margin-top:0;color:#555">Digital receipt</p>
      <p><strong>Order:</strong> ${escapeHtml(orderId)}<br>
      <strong>Date:</strong> ${escapeHtml(orderDate(order.createdAt))}<br>
      <strong>Customer:</strong> ${escapeHtml(order.customerName || "Customer")}<br>
      <strong>Payment:</strong> ${escapeHtml(paymentMethod)} - ${escapeHtml(paymentStatus)}<br>
      <strong>Address:</strong> ${escapeHtml(order.address || "Counter")}</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <thead><tr><th style="text-align:left;padding-bottom:8px">Item</th><th style="text-align:center;padding-bottom:8px">Qty</th><th style="text-align:right;padding-bottom:8px">Price</th><th style="text-align:right;padding-bottom:8px">Total</th></tr></thead>
        <tbody>${htmlRows}</tbody>
      </table>
      <p style="text-align:right;margin:0">Subtotal: <strong>${money(order.subtotal)}</strong></p>
      <p style="text-align:right;margin:0">Delivery fee: <strong>${money(order.deliveryFee)}</strong></p>
      <p style="text-align:right;font-size:20px;margin-top:8px">Total: <strong>${money(order.total)}</strong></p>
      <p style="margin-top:24px;color:#555">Thank you for ordering from Taptap Foodtrip.</p>
    </div>
  `;

  await gmailTransport.sendMail({
    from: `"Taptap Foodtrip" <${user}>`,
    to: order.customerEmail,
    subject: `Your Taptap Foodtrip receipt for ${orderId}`,
    text,
    html
  });
  return { sent: true };
};

app.get(route("/2fa/status"), authenticateBootstrap, asyncRoute(async (req, res) => {
  res.json(await twoFactorStatus(database(), req.user, Boolean(secretValue(twilioSid) && secretValue(twilioToken) && process.env.TWILIO_FROM_NUMBER), Boolean(secretValue(gmailUser) && secretValue(gmailAppPassword)), secretValue(twoFactorKey), req.authToken));
}));
app.post(route("/2fa/setup/totp"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await beginTotpSetup(database(), req.user, secretValue(twoFactorKey)));
}));
app.post(route("/2fa/sms/send"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await sendSmsCode(database(), req.user, sendTwoFactorSms, req.body.purpose === "setup" ? "setup" : "challenge"));
}));
app.post(route("/2fa/email/send"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await sendEmailCode(database(), req.user, sendTwoFactorEmail, req.body.purpose === "setup" ? "setup" : "challenge"));
}));
app.post(route("/2fa/setup/verify"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await finishEnrollment(database(), req.user, req.body.method, req.body.code, secretValue(twoFactorKey), req.authToken));
}));
app.post(route("/2fa/challenge"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await verifyChallenge(database(), req.user, req.body, secretValue(twoFactorKey), req.authToken));
}));

app.post(route("/passkeys/register/options"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await beginPasskeyRegistration(database(), req.user, req));
}));
app.post(route("/passkeys/register/verify"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await verifyPasskeyRegistration(database(), req.user, req.body, req));
}));
app.post(route("/passkeys/authenticate/options"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await beginPasskeyAuthentication(database(), req.user, req));
}));
app.post(route("/passkeys/authenticate/verify"), authenticateBootstrap, requireVerifiedEmail, asyncRoute(async (req, res) => {
  res.json(await verifyPasskeyAuthentication(database(), req.user, req.body, req));
}));

app.post(route("/assistant"), authenticate, async (req, res) => {
  try {
    const projectId = process.env.DIALOGFLOW_PROJECT_ID || process.env.GCLOUD_PROJECT;
    let dialogflowResult;
    if (projectId) {
      const client = new dialogflow.SessionsClient();
      const session = client.projectAgentSessionPath(projectId, req.body.sessionId || req.user.uid);
      const [response] = await client.detectIntent({
        session,
        queryInput: { text: { text: req.body.message, languageCode: process.env.DIALOGFLOW_LANGUAGE_CODE || "en" } }
      });
      dialogflowResult = response.queryResult;
      if (dialogflowResult?.fulfillmentText && dialogflowResult.intent?.displayName !== "Default Fallback Intent" && dialogflowResult.intentDetectionConfidence >= 0.55) {
        return res.json({ text: dialogflowResult.fulfillmentText, source: "assistant", intent: dialogflowResult.intent.displayName });
      }
    }

    const apiKey = secretValue(openaiKey);
    if (apiKey) {
      const client = new OpenAI({ apiKey });
      const response = await client.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        instructions: "You are the concise Taptap Foodtrip assistant. Use only supplied menu and order context. Never invent stock or order status.",
        input: `Context:\n${JSON.stringify(req.body.context || {})}\n\nCustomer message: ${req.body.message}`
      });
      return res.json({ text: response.output_text, source: "assistant" });
    }
    return res.json({ text: dialogflowResult?.fulfillmentText || "Live assistant answers are not ready yet.", source: "assistant" });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post(route("/insights"), authenticate, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access required." });
  const apiKey = secretValue(openaiKey);
  if (!apiKey) return res.status(503).json({ error: "Business insight is not ready yet." });
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: "Analyze food-service sales and inventory. Return concise trends, reorder quantities, peak hours and one waste-reduction action.",
      input: JSON.stringify(req.body)
    });
    return res.json({ text: response.output_text });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post(route("/payments/paymongo/webhook"), asyncRoute(async (req, res) => {
  const configuration = paymongoConfiguration();
  const event = verifyPayMongoWebhook({
    rawBody: req.rawBody,
    signatureHeader: req.get("Paymongo-Signature"),
    webhookSecret: configuration.webhookSecret,
    mode: configuration.mode
  });
  const payment = checkoutPaymentFromEvent(event);
  if (payment.ignored) return res.json({ received: true, ignored: true });
  const result = await confirmPayMongoPayment(database(), payment);
  if (!result.duplicate && !result.cancelled) {
    const order = (await database().ref(`orders/${payment.orderId}`).once("value")).val();
    await dispatchOrderPush({
      firebase: firebaseServices,
      db: database(),
      orderId: payment.orderId,
      order,
      changes: { status: "received" },
      appBaseUrl: allowedOrigins()[0] || "",
      logger: pushLogger
    });
  }
  return res.json({ received: true, duplicate: result.duplicate });
}));

app.post(route("/payments/checkout"), authenticate, asyncRoute(async (req, res) => {
  const configuration = paymongoConfiguration();
  if (!validRecordId(req.body.orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await database().ref(`orders/${req.body.orderId}`).once("value")).val();
  if (!order) throw new HttpError(404, "Order not found.");
  if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
  if (order.paymentMethod !== "gcash") throw new HttpError(409, "Only GCash orders use online checkout.");
  if (order.paymentStatus === "paid") throw new HttpError(409, "This order is already paid.");
  if (order.status === "cancelled") throw new HttpError(409, "A cancelled order cannot start payment.");
  if (order.providerSessionId) {
    const existing = await retrievePayMongoCheckoutSession(order.providerSessionId, { configuration });
    if (existing.referenceNumber !== req.body.orderId) {
      throw new HttpError(409, "The stored PayMongo checkout does not match this order.");
    }
    if (existing.payments.some((payment) => payment?.attributes?.status === "paid")) {
      throw new HttpError(409, "Payment was received and is waiting for webhook confirmation.");
    }
    if (existing.status === "active" && existing.checkoutUrl) {
      return res.json({ id: existing.id, checkoutUrl: existing.checkoutUrl, reused: true });
    }
    throw new HttpError(409, "The PayMongo checkout is no longer active. Cancel this order and place it again.");
  }
  const returnUrls = checkoutReturnUrls(req.body.orderId);
  const result = await createPayMongoCheckoutSession(
    { ...order, orderId: req.body.orderId },
    returnUrls,
    { configuration }
  );
  await recordPayMongoCheckoutSession(database(), req.body.orderId, result, configuration.mode);
  res.json({ id: result.id, checkoutUrl: result.checkoutUrl, reused: false });
}));

app.post(route("/notifications/sms"), authenticate, requireRoles("owner", "staff"), async (req, res) => {
  const sid = secretValue(twilioSid);
  const token = secretValue(twilioToken);
  if (!validRecordId(req.body.orderId)) return res.status(400).json({ error: "Invalid order ID." });
  const order = (await database().ref(`orders/${req.body.orderId}`).once("value")).val();
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!sid || !token || !process.env.TWILIO_FROM_NUMBER || !order.phone) return res.json({ sent: false });
  try {
    const client = twilio(sid, token);
    const message = await client.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to: order.phone,
      body: `Taptap Foodtrip: Order ${req.body.orderId} is now ${String(order.status).replaceAll("-", " ")}.`
    });
    return res.json({ sent: true, sid: message.sid });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post(route("/notifications"), authenticate, asyncRoute(async (req, res) => {
  res.status(201).json(await createNotification(database(), req.user, req.body));
}));
app.get(route("/notifications/push/status"), authenticate, asyncRoute(async (req, res) => {
  res.json(await pushStatus(database(), firebaseServices, req.user.uid));
}));
app.post(route("/notifications/push-tokens"), authenticate, asyncRoute(async (req, res) => {
  res.status(201).json(await registerPushToken(database(), firebaseServices, req.user, req.body?.token));
}));
app.delete(route("/notifications/push-tokens"), authenticate, asyncRoute(async (req, res) => {
  res.json(await removePushTokens(database(), req.user, {
    token: req.body?.token,
    all: req.body?.all === true
  }));
}));
app.post(route("/notifications/read-all"), authenticate, asyncRoute(async (req, res) => {
  await markAllNotificationsRead(database(), req.user.uid);
  res.json({ updated: true });
}));
app.post(route("/notifications/:notificationId/read"), authenticate, asyncRoute(async (req, res) => {
  const updated = await markNotificationRead(database(), req.user.uid, req.params.notificationId);
  res.json({ updated });
}));
app.post(route("/notifications/cleanup"), authenticate, asyncRoute(async (req, res) => {
  res.json({ deleted: await cleanupExpiredNotifications(database(), req.user.uid) });
}));
app.delete(route("/notifications"), authenticate, asyncRoute(async (req, res) => {
  await clearNotifications(database(), req.user.uid);
  res.json({ cleared: true });
}));
app.delete(route("/notifications/read"), authenticate, asyncRoute(async (req, res) => {
  res.json({ cleared: await clearReadNotifications(database(), req.user.uid) });
}));
app.delete(route("/notifications/:notificationId"), authenticate, asyncRoute(async (req, res) => {
  await dismissNotification(database(), req.user.uid, req.params.notificationId);
  res.json({ dismissed: true });
}));

app.get(route("/orders"), authenticate, asyncRoute(async (req, res) => {
  res.json({ orders: await listOrdersForUser(database(), req.user) });
}));

app.post(route("/orders"), authenticate, asyncRoute(async (req, res) => {
  const result = await createOrderRecord(database(), req.user, req.body);
  const receiptEmail = await sendOrderReceiptEmail({ id: result.id, ...result.order }).catch((error) => {
    console.warn("Receipt email failed:", error.message);
    return { sent: false };
  });
  if (!result.idempotent) {
    await dispatchOrderPush({
      firebase: firebaseServices,
      db: database(),
      orderId: result.id,
      order: result.order,
      created: true,
      appBaseUrl: allowedOrigins()[0] || "",
      logger: pushLogger
    });
  }
  res.status(201).json({ ...result, receiptEmail });
}));

app.patch(route("/orders/:orderId"), authenticate, asyncRoute(async (req, res) => {
  const result = await updateOrderRecord(database(), req.user, req.params.orderId, req.body);
  await dispatchOrderPush({
    firebase: firebaseServices,
    db: database(),
    orderId: req.params.orderId,
    order: result.order,
    changes: result.changes,
    appBaseUrl: allowedOrigins()[0] || "",
    logger: pushLogger
  });
  res.json({ id: req.params.orderId, ...result });
}));

app.get(route("/inventory"), authenticate, requireRoles("owner", "staff"), asyncRoute(async (_req, res) => {
  res.json({ inventory: (await database().ref("inventory").once("value")).val() || {} });
}));

app.patch(route("/inventory/:itemId"), authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.json(await adjustInventoryRecord(database(), req.user, req.params.itemId, req.body));
}));

app.patch(route("/menu/:itemId"), authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  res.json(await updateMenuItemRecord(database(), req.user, req.params.itemId, req.body));
}));

app.post(route("/menu"), authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  res.status(201).json(await createMenuItemRecord(database(), req.user, req.body));
}));

app.patch(route("/reviews/:reviewId"), authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.json(await updateReviewRecord(database(), req.user, req.params.reviewId, req.body));
}));

app.post(route("/riders/location"), authenticate, requireRoles("rider"), asyncRoute(async (req, res) => {
  res.json(await saveRiderLocationRecord(database(), req.user, req.body.orderId, req.body));
}));

app.post(route("/orders/:orderId/proof"), authenticate, requireRoles("rider"), asyncRoute(async (req, res) => {
  res.status(201).json(await saveDeliveryProofRecord(database(), req.user, req.params.orderId, req.body));
}));

app.post(route("/shift-logs"), authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.status(201).json(await saveShiftLogRecord(database(), req.user, req.body));
}));

app.post(route("/admin/roles"), authenticate, requireRoles("owner"), async (req, res) => {
  if (!validRecordId(req.body.uid)) return res.status(400).json({ error: "Invalid account ID." });
  if (!["owner", "staff", "rider", "customer"].includes(req.body.role)) return res.status(400).json({ error: "Unsupported role." });
  await getAuth().setCustomUserClaims(req.body.uid, { role: req.body.role });
  await database().ref(`users/${req.body.uid}/role`).set(req.body.role);
  return res.json({ updated: true });
});

app.post(route("/admin/users"), authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  const input = normalizeManagedAccountInput(req.body);
  let userRecord;
  try {
    userRecord = await getAuth().createUser({
      email: input.email,
      password: input.temporaryPassword,
      displayName: input.name,
      emailVerified: false,
      disabled: false
    });
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      throw new HttpError(409, "This email already has an account. Assign the role or reset security instead.");
    }
    throw error;
  }
  await getAuth().setCustomUserClaims(userRecord.uid, { role: input.role });
  const createdAt = Date.now();
  const profile = {
    uid: userRecord.uid,
    name: input.name,
    email: input.email,
    role: input.role,
    staffRole: input.role === "staff" ? input.staffRole : null,
    phone: "",
    phoneVerified: false,
    smsNotifications: false,
    createdAt,
    updatedAt: createdAt,
    createdByOwnerId: req.user.uid,
    securitySetupRequired: true
  };
  await database().ref().update({
    [`users/${userRecord.uid}`]: profile,
    [`auditLogs/AUD-${createdAt}-${userRecord.uid}-created`]: {
      action: "admin_user_created",
      targetUserId: userRecord.uid,
      actorId: req.user.uid,
      actorName: req.user.name || req.user.email,
      actorRole: req.user.role,
      details: { after: { role: input.role, staffRole: input.role === "staff" ? input.staffRole : null } },
      createdAt
    }
  });
  res.status(201).json({
    uid: userRecord.uid,
    email: input.email,
    name: input.name,
    role: input.role,
    staffRole: input.role === "staff" ? input.staffRole : null
  });
}));

app.get(route("/admin/users"), authenticate, requireRoles("owner"), asyncRoute(async (_req, res) => {
  const [authResult, profilesSnapshot, twoFactorSnapshot] = await Promise.all([
    getAuth().listUsers(1000),
    database().ref("users").once("value"),
    database().ref("twoFactor").once("value")
  ]);
  const profiles = profilesSnapshot.val() || {};
  const security = twoFactorSnapshot.val() || {};
  res.json({ users: authResult.users.map((record) => {
    const profile = profiles[record.uid] || {};
    const status = security[record.uid] || {};
    return { uid: record.uid, email: record.email || profile.email || "", name: profile.name || record.displayName || record.email || record.uid, role: record.customClaims?.role || profile.role || "customer", staffRole: profile.staffRole || "manager", twoFactorEnabled: Boolean(status.enabled), twoFactorMethod: status.method || null, twoFactorLocked: Boolean(status.locked) };
  }) });
}));
app.post(route("/admin/users/:uid/2fa/reset"), authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  await resetTwoFactor(database(), req.user, req.params.uid);
  res.json({ reset: true });
}));
app.post(route("/admin/users/:uid/2fa/unlock"), authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  await unlockTwoFactor(database(), req.user, req.params.uid);
  res.json({ unlocked: true });
}));
app.post(route("/admin/users/:uid/message"), authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
  res.status(201).json(await createNotification(database(), req.user, { targetUserId: req.params.uid, title: req.body.title || "Message from administrator", message: req.body.message, type: "admin" }));
}));

export const api = onRequest({
  region: "asia-southeast1",
  timeoutSeconds: 60,
  memory: "512MiB",
  secrets: [openaiKey, paymongoKey, paymongoWebhookSecret, twilioSid, twilioToken, twoFactorKey, gmailUser, gmailAppPassword, turnstileSecret]
}, app);
