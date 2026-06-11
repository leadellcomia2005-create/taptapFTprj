import dialogflow from "@google-cloud/dialogflow";
import cors from "cors";
import express from "express";
import admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import OpenAI from "openai";
import twilio from "twilio";

admin.initializeApp();

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

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token." });
  }
}

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

app.post(route("/payments/checkout"), authenticate, async (req, res) => {
  const key = secretValue(paymongoKey);
  if (!key) return res.status(503).json({ error: "PayMongo is not configured." });
  try {
    const authorization = Buffer.from(`${key}:`).toString("base64");
    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          attributes: {
            billing: { email: req.body.customerEmail, name: req.body.customerName, phone: req.body.phone },
            description: `Taptap Foodtrip ${req.body.orderId}`,
            line_items: req.body.items.map((item) => ({ currency: "PHP", amount: Math.round(item.price * 100), name: item.name, quantity: item.qty })),
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
    if (!response.ok) throw new Error(payload.errors?.[0]?.detail || "PayMongo request failed.");
    return res.json({ id: payload.data.id, checkoutUrl: payload.data.attributes.checkout_url });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post(route("/notifications/sms"), authenticate, async (req, res) => {
  const sid = secretValue(twilioSid);
  const token = secretValue(twilioToken);
  if (!sid || !token || !process.env.TWILIO_FROM_NUMBER || !req.body.to) return res.json({ sent: false });
  try {
    const client = twilio(sid, token);
    const message = await client.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to: req.body.to,
      body: `Taptap Foodtrip: Order ${req.body.orderId} is now ${String(req.body.status).replaceAll("-", " ")}.`
    });
    return res.json({ sent: true, sid: message.sid });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post(route("/admin/roles"), authenticate, async (req, res) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner access required." });
  if (!["owner", "staff", "rider", "customer"].includes(req.body.role)) return res.status(400).json({ error: "Unsupported role." });
  await admin.auth().setCustomUserClaims(req.body.uid, { role: req.body.role });
  await admin.database().ref(`users/${req.body.uid}/role`).set(req.body.role);
  return res.json({ updated: true });
});

export const api = onRequest({
  region: "asia-southeast1",
  timeoutSeconds: 60,
  memory: "512MiB",
  secrets: [openaiKey, paymongoKey, twilioSid, twilioToken]
}, app);
