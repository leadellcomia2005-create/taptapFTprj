import { Router } from "express";
import { assistantRequestSchema, orderIdBodySchema } from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody } from "../middleware/validation.js";
import { requireRoles, canAccessOrder, HttpError } from "../security.js";
import {
  askOpenAI,
  createPayMongoCheckout,
  detectDialogflowIntent,
  generateInsights,
  sendTwilioSms
} from "../services.js";

export function createIntegrationsRouter({ firebase, authentication }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/assistant", authenticate, validateBody(assistantRequestSchema), asyncRoute(async (req, res) => {
    const detected = await detectDialogflowIntent(req.body);
    if (detected && detected.intent !== "Default Fallback Intent" && detected.confidence >= 0.55) {
      return res.json({ text: detected.text, source: "assistant", intent: detected.intent });
    }
    const generated = await askOpenAI(req.body);
    if (generated) return res.json({ text: generated, source: "assistant" });
    return res.json({ text: detected?.text || "Live assistant answers are not ready yet.", source: "assistant" });
  }));

  router.post("/insights", authenticate, requireRoles("owner"), asyncRoute(async (req, res) => {
    const text = await generateInsights(req.body);
    res.json({ text: text || "Business insight is not ready yet." });
  }));

  router.post("/payments/checkout", authenticate, validateBody(orderIdBodySchema), asyncRoute(async (req, res) => {
    const order = (await firebase.db().ref(`orders/${req.body.orderId}`).once("value")).val();
    if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
    if (order.paymentMethod !== "gcash") throw new HttpError(409, "Only GCash orders use online checkout.");
    if (order.paymentStatus === "paid") throw new HttpError(409, "This order is already paid.");
    const result = await createPayMongoCheckout({ ...order, orderId: req.body.orderId });
    if (!result) throw new HttpError(503, "Online payment is not ready yet.");
    await firebase.db().ref(`orders/${req.body.orderId}`).update({
      paymentProvider: "paymongo",
      providerSessionId: result.id,
      checkoutCreatedAt: Date.now()
    });
    res.json(result);
  }));

  router.post("/notifications/sms", authenticate, requireRoles("owner", "staff"), validateBody(orderIdBodySchema), asyncRoute(async (req, res) => {
    const order = (await firebase.db().ref(`orders/${req.body.orderId}`).once("value")).val();
    if (!order) throw new HttpError(404, "Order not found.");
    if (!order.phoneVerified || !order.smsNotifications) {
      throw new HttpError(409, "SMS updates require a verified phone number and customer consent.");
    }
    const result = await sendTwilioSms({ to: order.phone, orderId: req.body.orderId, status: order.status });
    res.json({ sent: Boolean(result), sid: result?.sid || null });
  }));

  return router;
}
