import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { listOrdersForUser } from "../application/orders.js";
import { confirmPayMongoPayment, recordPayMongoCheckoutSession } from "../application/payments.js";
import { assistantRequestSchema, insightRequestSchema, orderIdBodySchema, recordIdParams } from "../contracts/schemas.js";
import {
  assertPayMongoConfiguration,
  checkoutPaymentFromEvent,
  verifyPayMongoWebhook
} from "../integrations/paymongo.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { requireRoles, canAccessOrder, HttpError } from "../security.js";
import {
  askAssistant,
  createPayMongoCheckout,
  detectDialogflowIntent,
  generateInsights,
  buildAssistantOrderContext,
  retrievePayMongoCheckout,
  sendTwilioSms
} from "../services.js";
import { dispatchOrderPush } from "../pushNotifications.js";
import { getSupportConversation } from "../application/support.js";

export function createIntegrationsRouter({ config, firebase, authentication, logger }) {
  const router = Router();
  const { authenticate } = authentication;
  const assistantLimiter = rateLimit({
    windowMs: 60_000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req.ip),
    message: { error: "Too many assistant messages. Please wait a minute, then try again." }
  });

  const openPaymentCheckout = async (req, res, orderId) => {
    const order = (await firebase.db().ref(`orders/${orderId}`).once("value")).val();
    if (!order) throw new HttpError(404, "Order not found.");
    if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
    if (order.paymentMethod !== "gcash") throw new HttpError(409, "Only GCash orders use online checkout.");
    if (order.paymentStatus === "paid") throw new HttpError(409, "This order is already paid.");
    if (order.status === "cancelled") throw new HttpError(409, "A cancelled order cannot start payment.");
    if (order.providerSessionId) {
      const existing = await retrievePayMongoCheckout(order.providerSessionId);
      if (existing.referenceNumber !== orderId) {
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
    const result = await createPayMongoCheckout({ ...order, orderId });
    await recordPayMongoCheckoutSession(firebase.db(), orderId, result, result.livemode ? "live" : "test");
    return res.json({ id: result.id, checkoutUrl: result.checkoutUrl, reused: false });
  };

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

  router.post("/assistant", authenticate, assistantLimiter, validateBody(assistantRequestSchema), asyncRoute(async (req, res) => {
    const message = String(req.body.message || req.body.text || "");
    if (req.user.role === "customer") {
      const conversation = await getSupportConversation(firebase.db(), req.user.uid);
      if (conversation.mode === "staff") {
        return res.json({
          text: "A support team member is handling this conversation.",
          source: "staff",
          status: "staff_handling",
          assignedStaffName: conversation.assignedStaffName || null
        });
      }
    }
    const needsOrderContext = /\b(my order|order status|track.*order|where.*order)\b/i.test(message);
    const customerOrders = req.user.role === "customer" && needsOrderContext
      ? await listOrdersForUser(firebase.db(), req.user)
      : [];
    const assistantInput = {
      ...req.body,
      context: {
        ...req.body.context,
        orders: buildAssistantOrderContext(customerOrders)
      }
    };
    const detected = await detectDialogflowIntent(req.body);
    if (detected && detected.intent !== "Default Fallback Intent" && detected.confidence >= 0.55) {
      if (req.user.role === "customer" && (await getSupportConversation(firebase.db(), req.user.uid)).mode === "staff") {
        return res.json({ text: "A support team member is handling this conversation.", source: "staff", status: "staff_handling" });
      }
      return res.json({ text: detected.text, source: "assistant", intent: detected.intent });
    }
    const generated = await askAssistant(assistantInput);
    if (req.user.role === "customer" && (await getSupportConversation(firebase.db(), req.user.uid)).mode === "staff") {
      return res.json({ text: "A support team member is handling this conversation.", source: "staff", status: "staff_handling" });
    }
    if (generated) return res.json(generated);
    return res.json({ text: detected?.text || "Live assistant answers are not ready yet.", source: "assistant" });
  }));

  router.post("/insights", authenticate, requireRoles("owner"), validateBody(insightRequestSchema), asyncRoute(async (req, res) => {
    try {
      const result = await generateInsights(req.body);
      if (!result) throw new HttpError(503, "AI inventory analysis is temporarily unavailable.");
      res.json(result);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (Number(error?.status) === 429) {
        throw new HttpError(429, "The AI analysis limit was reached. Wait a minute, then retry.", { code: "AI_RATE_LIMITED" });
      }
      logger?.warn("ai_inventory_analysis_failed", { provider: "groq", errorCode: error?.code || "PROVIDER_ERROR" });
      throw new HttpError(503, "AI inventory analysis is temporarily unavailable.", { code: "AI_UNAVAILABLE" });
    }
  }));

  router.post("/payments/checkout/:orderId", authenticate, validateParams(recordIdParams("orderId")), asyncRoute(
    (req, res) => openPaymentCheckout(req, res, req.params.orderId)
  ));

  // Keep the body-based endpoint during the client transition.
  router.post("/payments/checkout", authenticate, validateBody(orderIdBodySchema), asyncRoute(
    (req, res) => openPaymentCheckout(req, res, req.body.orderId)
  ));

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
