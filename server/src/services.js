import dialogflow from "@google-cloud/dialogflow";
import nodemailer from "nodemailer";
import OpenAI from "openai";
import twilio from "twilio";

const has = (name) => Boolean(process.env[name]);

export function serviceStatus() {
  return {
    firebase: has("FIREBASE_DATABASE_URL"),
    socket: true,
    twoFactor: has("TWO_FACTOR_ENCRYPTION_KEY"),
    openai: has("OPENAI_API_KEY"),
    dialogflow: has("DIALOGFLOW_PROJECT_ID"),
    paymongo: has("PAYMONGO_SECRET_KEY"),
    twilio: has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN") && has("TWILIO_FROM_NUMBER"),
    emailOtp: has("GMAIL_USER") && has("GMAIL_APP_PASSWORD")
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
  return has("OPENAI_API_KEY") ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
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

export async function createPayMongoCheckout(order) {
  if (!has("PAYMONGO_SECRET_KEY")) return null;
  const authorization = Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64");
  const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        attributes: {
          billing: {
            email: order.customerEmail,
            name: order.customerName,
            phone: order.phone
          },
          description: `Taptap Foodtrip ${order.orderId}`,
          line_items: order.items.map((item) => ({
            currency: "PHP",
            amount: Math.round(item.price * 100),
            name: item.name,
            quantity: item.qty
          })),
          payment_method_types: ["gcash"],
          success_url: order.successUrl,
          cancel_url: order.cancelUrl,
          reference_number: order.orderId,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true
        }
      }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.errors?.[0]?.detail || "PayMongo checkout creation failed.");
  return {
    id: payload.data.id,
    checkoutUrl: payload.data.attributes.checkout_url
  };
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
    throw new Error("SMS 2FA is unavailable because Twilio is not configured.");
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to,
    body: `Taptap Foodtrip verification code: ${code}. It expires in 10 minutes.`
  });
}

let gmailTransport;

export async function sendTwoFactorEmail(to, code) {
  if (!serviceStatus().emailOtp || !to) {
    throw new Error("Email OTP is unavailable because Gmail SMTP is not configured.");
  }
  gmailTransport ||= nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  return gmailTransport.sendMail({
    from: `"Taptap Foodtrip" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your Taptap Foodtrip verification code",
    text: `Your Taptap Foodtrip verification code is ${code}. It expires in 10 minutes. If you did not request this code, change your password.`,
    html: `<p>Your Taptap Foodtrip verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this code, change your password.</p>`
  });
}
