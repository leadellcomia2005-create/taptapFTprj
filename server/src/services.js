import dialogflow from "@google-cloud/dialogflow";
import nodemailer from "nodemailer";
import OpenAI from "openai";
import twilio from "twilio";
import {
  createPayMongoCheckoutSession,
  payMongoConfiguration,
  retrievePayMongoCheckoutSession
} from "./integrations/paymongo.js";

const has = (name) => Boolean(process.env[name]);
const enabled = (name) => process.env[name] === "true";

export function serviceStatus() {
  return {
    firebase: has("FIREBASE_DATABASE_URL"),
    socket: true,
    twoFactor: has("TWO_FACTOR_ENCRYPTION_KEY"),
    openai: enabled("ENABLE_OPENAI") && has("OPENAI_API_KEY"),
    dialogflow: has("DIALOGFLOW_PROJECT_ID"),
    paymongo: payMongoConfiguration().enabled,
    twilio: enabled("ENABLE_TWILIO") && has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN") && has("TWILIO_FROM_NUMBER"),
    emailOtp: has("GMAIL_USER") && has("GMAIL_APP_PASSWORD"),
    turnstile: has("TURNSTILE_SECRET_KEY")
  };
}

export async function detectDialogflowIntent({ message, sessionId }) {
  if (!has("DIALOGFLOW_PROJECT_ID")) return null;
  const client = new dialogflow.SessionsClient();
  const session = client.projectAgentSessionPath(process.env.DIALOGFLOW_PROJECT_ID, sessionId);
  const [response] = await client.detectIntent({
    session,
    queryInput: {
      text: {
        text: message,
        languageCode: process.env.DIALOGFLOW_LANGUAGE_CODE || "en"
      }
    }
  });
  const result = response.queryResult;
  if (!result?.fulfillmentText) return null;
  return {
    text: result.fulfillmentText,
    intent: result.intent?.displayName || "fallback",
    confidence: result.intentDetectionConfidence || 0
  };
}

function openaiClient() {
  return serviceStatus().openai ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
}

export async function askOpenAI({ message, context = {} }) {
  const client = openaiClient();
  if (!client) return null;
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    instructions: "You are the concise Taptap Foodtrip assistant. Answer menu, allergen, store and order questions. Never invent stock or order status; use only the supplied context.",
    input: `Context:\n${JSON.stringify(context)}\n\nCustomer message: ${message}`
  });
  return response.output_text;
}

export async function generateInsights({ sales, inventory }) {
  const client = openaiClient();
  if (!client) return null;
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    instructions: "Act as a food-service inventory analyst. Give a short sales trend summary, reorder recommendations, likely peak periods and one waste-reduction action. Use Philippine pesos.",
    input: JSON.stringify({ sales, inventory })
  });
  return response.output_text;
}

export function checkoutReturnUrls(orderId) {
  const [origin] = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let base = "http://localhost:5173";
  try {
    base = new URL(origin).origin;
  } catch {}
  const encodedOrderId = encodeURIComponent(orderId);
  return {
    successUrl: `${base}/?payment=success&orderId=${encodedOrderId}`,
    cancelUrl: `${base}/?payment=cancelled&orderId=${encodedOrderId}`
  };
}

export async function createPayMongoCheckout(order) {
  const returnUrls = checkoutReturnUrls(order.orderId);
  return createPayMongoCheckoutSession(order, returnUrls);
}

export async function retrievePayMongoCheckout(sessionId) {
  return retrievePayMongoCheckoutSession(sessionId);
}

export async function sendTwilioSms({ to, orderId, status }) {
  if (!serviceStatus().twilio || !to) return null;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to,
    body: `Taptap Foodtrip: Order ${orderId} is now ${String(status).replaceAll("-", " ")}.`
  });
}

export async function sendTwoFactorSms(to, code) {
  if (!serviceStatus().twilio || !to) {
    throw new Error("SMS verification is not ready yet.");
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to,
    body: `Taptap Foodtrip verification code: ${code}. It expires in 10 minutes.`
  });
}

let gmailTransport;

function gmailClient() {
  gmailTransport ||= nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  return gmailTransport;
}

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

export async function sendTwoFactorEmail(to, code) {
  if (!serviceStatus().emailOtp || !to) {
    throw new Error("Email code is not ready yet.");
  }
  return gmailClient().sendMail({
    from: `"Taptap Foodtrip" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your Taptap Foodtrip verification code",
    text: `Your Taptap Foodtrip verification code is ${code}. It expires in 10 minutes. If you did not request this code, change your password.`,
    html: `<p>Your Taptap Foodtrip verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this code, change your password.</p>`
  });
}

export async function sendCustomerVerificationEmail(to, verificationLink, name = "Customer") {
  if (!serviceStatus().emailOtp || !to || !verificationLink) {
    throw new Error("Email verification is not ready yet.");
  }
  const safeName = escapeHtml(name || "Customer");
  const safeLink = escapeHtml(verificationLink);
  return gmailClient().sendMail({
    from: `"Taptap Foodtrip" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Verify your Taptap Foodtrip account",
    text: `Hi ${name || "Customer"}, verify your Taptap Foodtrip account here: ${verificationLink}`,
    html: `<p>Hi ${safeName},</p><p>Verify your Taptap Foodtrip account before placing orders.</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#e33d2e;color:#fff;text-decoration:none;border-radius:8px">Verify account</a></p><p>If the button does not work, copy this link:</p><p>${safeLink}</p>`
  });
}

export async function sendOrderReceiptEmail(order = {}) {
  if (!serviceStatus().emailOtp || !order.customerEmail || order.source === "walk-in-pos") {
    return { sent: false };
  }

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

  await gmailClient().sendMail({
    from: `"Taptap Foodtrip" <${process.env.GMAIL_USER}>`,
    to: order.customerEmail,
    subject: `Your Taptap Foodtrip receipt for ${orderId}`,
    text,
    html
  });
  return { sent: true };
}
