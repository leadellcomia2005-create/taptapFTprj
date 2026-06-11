import dialogflow from "@google-cloud/dialogflow";
import cors from "cors";
import express from "express";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import OpenAI from "openai";
import twilio from "twilio";
import {
  adjustInventoryRecord,
  canAccessOrder,
  createOrderRecord,
  HttpError,
  listOrdersForUser,
  saveDeliveryProofRecord,
  saveRiderLocationRecord,
  saveShiftLogRecord,
  updateOrderRecord,
  validRecordId
} from "./operations.js";

initializeApp();
const database = () => getDatabase();

const openaiKey = defineSecret("OPENAI_API_KEY");
const paymongoKey = defineSecret("PAYMONGO_SECRET_KEY");
const twilioSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioToken = defineSecret("TWILIO_AUTH_TOKEN");
const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const route = (path) => [path, `/api${path}`];
const secretValue = (secret) => {
  try {
    return secret.value();
  } catch {
    return "";
  }
};

async function verifyUserToken(token) {
  const decoded = await getAuth().verifyIdToken(token);
  if (decoded.role) return decoded;
  const profile = (await database().ref(`users/${decoded.uid}`).once("value")).val() || {};
  return { ...decoded, role: profile.role || "customer", name: profile.name || decoded.name };
}

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    req.user = await verifyUserToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token." });
  }
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

app.get(route("/status"), (_req, res) => {
  res.json({
    services: {
      firebase: true,
      socket: false,
      openai: Boolean(secretValue(openaiKey)),
      dialogflow: Boolean(process.env.DIALOGFLOW_PROJECT_ID || process.env.GCLOUD_PROJECT),
      paymongo: Boolean(secretValue(paymongoKey)),
      twilio: Boolean(secretValue(twilioSid) && secretValue(twilioToken) && process.env.TWILIO_FROM_NUMBER)
    }
  });
});

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
        return res.json({ text: dialogflowResult.fulfillmentText, source: "Dialogflow", intent: dialogflowResult.intent.displayName });
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
      return res.json({ text: response.output_text, source: "OpenAI" });
    }
    return res.json({ text: dialogflowResult?.fulfillmentText || "AI services need project credentials.", source: "demo" });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post(route("/insights"), authenticate, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access required." });
  const apiKey = secretValue(openaiKey);
  if (!apiKey) return res.status(503).json({ error: "OpenAI is not configured." });
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

app.post(route("/payments/checkout"), authenticate, asyncRoute(async (req, res) => {
  const key = secretValue(paymongoKey);
  if (!key) return res.status(503).json({ error: "PayMongo is not configured." });
  if (!validRecordId(req.body.orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await database().ref(`orders/${req.body.orderId}`).once("value")).val();
  if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
  const authorization = Buffer.from(`${key}:`).toString("base64");
  const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        attributes: {
          billing: { email: order.customerEmail, name: order.customerName, phone: order.phone },
          description: `Taptap Foodtrip ${req.body.orderId}`,
          line_items: order.items.map((item) => ({ currency: "PHP", amount: Math.round(item.price * 100), name: item.name, quantity: item.qty })),
          payment_method_types: ["gcash"],
          success_url: req.body.successUrl,
          cancel_url: req.body.cancelUrl,
          reference_number: req.body.orderId,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true
        }
      }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new HttpError(502, payload.errors?.[0]?.detail || "PayMongo request failed.");
  res.json({ id: payload.data.id, checkoutUrl: payload.data.attributes.checkout_url });
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

app.get(route("/orders"), authenticate, asyncRoute(async (req, res) => {
  res.json({ orders: await listOrdersForUser(database(), req.user) });
}));

app.post(route("/orders"), authenticate, asyncRoute(async (req, res) => {
  const result = await createOrderRecord(database(), req.user, req.body);
  res.status(201).json(result);
}));

app.patch(route("/orders/:orderId"), authenticate, asyncRoute(async (req, res) => {
  const result = await updateOrderRecord(database(), req.user, req.params.orderId, req.body);
  res.json({ id: req.params.orderId, ...result });
}));

app.get(route("/inventory"), authenticate, requireRoles("owner", "staff"), asyncRoute(async (_req, res) => {
  res.json({ inventory: (await database().ref("inventory").once("value")).val() || {} });
}));

app.patch(route("/inventory/:itemId"), authenticate, requireRoles("owner", "staff"), asyncRoute(async (req, res) => {
  res.json(await adjustInventoryRecord(database(), req.user, req.params.itemId, req.body));
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
  if (!validRecordId(req.body.uid)) return res.status(400).json({ error: "Invalid user UID." });
  if (!["owner", "staff", "rider", "customer"].includes(req.body.role)) return res.status(400).json({ error: "Unsupported role." });
  await getAuth().setCustomUserClaims(req.body.uid, { role: req.body.role });
  await database().ref(`users/${req.body.uid}/role`).set(req.body.role);
  return res.json({ updated: true });
});

export const api = onRequest({
  region: "asia-southeast1",
  timeoutSeconds: 60,
  memory: "512MiB",
  secrets: [openaiKey, paymongoKey, twilioSid, twilioToken]
}, app);
