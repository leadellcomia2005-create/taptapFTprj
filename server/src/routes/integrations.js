import { Router } from "express";
import { confirmPayMongoPayment, recordPayMongoCheckoutSession } from "../application/payments.js";
import { assistantRequestSchema, orderIdBodySchema } from "../contracts/schemas.js";
import {
  assertPayMongoConfiguration,
  checkoutPaymentFromEvent,
  verifyPayMongoWebhook
} from "../integrations/paymongo.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody } from "../middleware/validation.js";
import { requireRoles, canAccessOrder, HttpError } from "../security.js";
import {
  askOpenAI,
  createPayMongoCheckout,
  detectDialogflowIntent,
  generateInsights,
  retrievePayMongoCheckout,
  sendTwilioSms
} from "../services.js";
import { dispatchOrderPush } from "../pushNotifications.js";

export function createIntegrationsRouter({ config, firebase, authentication, logger }) {
  const router = Router();
  const { authenticate } = authentication;

  router.post("/payments/paymongo/webhook", asyncRoute(async (req, res) => {
    const configuration = assertPayMongoConfiguration();
    const event = verifyPayMongoWebhook({
      rawBody: req.rawBody,
      signatureHeader: req.get("Paymongo-Signature"),
      webhookSecret: configuration.webhookSecret,
      mode: configuration.mode
    });
    const payment = checkoutPaymentFromEvent(event);
    if (payment.ignored) {
      logger?.info("paymongo_webhook_ignored", { eventId: payment.eventId, eventType: payment.eventType });
      return res.json({ received: true, ignored: true });
    }
    const result = await confirmPayMongoPayment(firebase.db(), payment);
    if (!result.duplicate && !result.cancelled) {
      const order = (await firebase.db().ref(`orders/${payment.orderId}`).once("value")).val();
      await dispatchOrderPush({
        firebase,
        db: firebase.db(),
        orderId: payment.orderId,
        order,
        changes: { status: "received" },
        appBaseUrl: config.appBaseUrl,
        logger
      });
    }
    logger?.info("paymongo_payment_processed", {
      eventId: payment.eventId,
      orderId: payment.orderId,
      duplicate: result.duplicate,
      livemode: payment.livemode
    });
    return res.json({ received: true, duplicate: result.duplicate });
  }));

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
    if (!order) throw new HttpError(404, "Order not found.");
    if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
    if (order.paymentMethod !== "gcash") throw new HttpError(409, "Only GCash orders use online checkout.");
    if (order.paymentStatus === "paid") throw new HttpError(409, "This order is already paid.");
    if (order.status === "cancelled") throw new HttpError(409, "A cancelled order cannot start payment.");
    if (order.providerSessionId) {
      const existing = await retrievePayMongoCheckout(order.providerSessionId);
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
    const result = await createPayMongoCheckout({ ...order, orderId: req.body.orderId });
    await recordPayMongoCheckoutSession(firebase.db(), req.body.orderId, result, result.livemode ? "live" : "test");
    res.json({ id: result.id, checkoutUrl: result.checkoutUrl, reused: false });
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
