import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { listOrdersForUser } from "../application/orders.js";
import { confirmPayMongoPayment, recordPayMongoCheckoutSession } from "../application/payments.js";
import { assistantFeedbackSchema, assistantRequestSchema, insightRequestSchema, orderIdBodySchema, recordIdParams } from "../contracts/schemas.js";
import {
  assertPayMongoConfiguration,
  checkoutPaymentFromSession,
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
  assistantSourceCategories,
  generateCachedInsights,
  getCachedInventoryInsights,
  buildAssistantOrderContext,
  retrievePayMongoCheckout,
  sendTwilioSms
} from "../services.js";
import { dispatchOrderPush } from "../pushNotifications.js";
import { getSupportConversation } from "../application/support.js";

export function createIntegrationsRouter({ config, firebase, authentication, logger, metrics }) {
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
  const insightLimiter = rateLimit({
    windowMs: config.ai?.insightWindowMs || 300_000,
    limit: config.ai?.insightLimit || 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `${req.user?.uid || "owner"}:${ipKeyGenerator(req.ip)}`,
    handler: (_req, res) => {
      metrics?.increment("aiInsightRateLimits");
      res.status(429).json({ error: "The AI analysis limit was reached. Wait a few minutes, then retry.", code: "AI_RATE_LIMITED" });
    }
  });

  const openPaymentCheckout = async (req, res, orderId) => {
    const order = (await firebase.db().ref(`orders/${orderId}`).once("value")).val();
    if (!order) throw new HttpError(404, "Order not found.");
    if (!canAccessOrder(req.user, order)) throw new HttpError(403, "You cannot create a payment for this order.");
    if (order.paymentMethod !== "gcash") throw new HttpError(409, "Only GCash orders use online checkout.");
    if (order.paymentStatus === "paid") {
      return res.json({
        id: order.providerSessionId || "",
        checkoutUrl: null,
        reused: true,
        paid: true
      });
    }
    if (order.status === "cancelled") throw new HttpError(409, "A cancelled order cannot start payment.");
    if (order.providerSessionId) {
      const existing = await retrievePayMongoCheckout(order.providerSessionId);
      if (existing.referenceNumber !== orderId) {
        throw new HttpError(409, "The stored PayMongo checkout does not match this order.");
      }
      if (existing.payments.some((payment) => payment?.attributes?.status === "paid")) {
        const payment = checkoutPaymentFromSession(existing);
        const result = await confirmPayMongoPayment(firebase.db(), payment);
        if (!result.duplicate && !result.cancelled) {
          const updatedOrder = (await firebase.db().ref(`orders/${orderId}`).once("value")).val();
          await dispatchOrderPush({
            firebase,
            db: firebase.db(),
            orderId,
            order: updatedOrder,
            changes: { status: "received" },
            appBaseUrl: config.appBaseUrl,
            logger
          });
        }
        logger?.info("paymongo_payment_reconciled", {
          orderId,
          paymentId: payment.paymentId,
          duplicate: result.duplicate,
          livemode: payment.livemode
        });
        return res.json({
          id: existing.id,
          checkoutUrl: null,
          reused: true,
          paid: true,
          reconciled: !result.duplicate
        });
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
    metrics?.increment("aiChatRequests");
    const message = String(req.body.message || req.body.text || "");
    const sendAssistantResponse = async (payload) => {
      const messageId = firebase.db().ref(`assistantResponses/${req.user.uid}`).push().key;
      try {
        const createdAt = Date.now();
        await firebase.db().ref(`assistantResponses/${req.user.uid}/${messageId}`).set({
          customerId: req.user.uid,
          source: ["local", "groq", "openai", "assistant"].includes(payload.source) ? payload.source : "assistant",
          sources: Array.isArray(payload.sources) ? payload.sources.slice(0, 5) : [],
          createdAt,
          expiresAt: createdAt + 30 * 24 * 60 * 60 * 1000
        });
        return res.json({ ...payload, messageId });
      } catch (error) {
        logger?.warn("assistant_feedback_receipt_unavailable", { errorCode: error?.code || "RECEIPT_ERROR" });
        return res.json(payload);
      }
    };
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
      if (conversation.mode === "waiting") {
        return res.json({ text: "The support team has been notified.", source: "staff", status: "staff_waiting" });
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
        orders: buildAssistantOrderContext(customerOrders),
        history: req.body.history || []
      }
    };
    const sources = assistantSourceCategories(message, assistantInput.context);
    const detected = await detectDialogflowIntent(req.body);
    if (detected && detected.intent !== "Default Fallback Intent" && detected.confidence >= 0.55) {
      if (req.user.role === "customer" && (await getSupportConversation(firebase.db(), req.user.uid)).mode === "staff") {
        return res.json({ text: "A support team member is handling this conversation.", source: "staff", status: "staff_handling" });
      }
      metrics?.increment("aiProviderAnswers");
      return sendAssistantResponse({ text: detected.text, source: "assistant", intent: detected.intent, sources });
    }
    const generated = await askAssistant(assistantInput);
    if (req.user.role === "customer") {
      const latestConversation = await getSupportConversation(firebase.db(), req.user.uid);
      if (latestConversation.mode === "staff") return res.json({ text: "A support team member is handling this conversation.", source: "staff", status: "staff_handling" });
      if (latestConversation.mode === "waiting") return res.json({ text: "The support team has been notified.", source: "staff", status: "staff_waiting" });
    }
    if (generated) {
      metrics?.increment(generated.source === "local" ? "aiLocalAnswers" : "aiProviderAnswers");
      return sendAssistantResponse({ ...generated, sources });
    }
    metrics?.increment("aiProviderFailures");
    return sendAssistantResponse({ text: detected?.text || "Live assistant answers are not ready yet.", source: "assistant", sources });
  }));

  router.put("/assistant/feedback/:messageId", authenticate, requireRoles("customer"), validateParams(recordIdParams("messageId")), validateBody(assistantFeedbackSchema), asyncRoute(async (req, res) => {
    const now = Date.now();
    const path = `assistantFeedback/${req.user.uid}/${req.params.messageId}`;
    const responseRecord = (await firebase.db().ref(`assistantResponses/${req.user.uid}/${req.params.messageId}`).once("value")).val();
    if (!responseRecord) throw new HttpError(404, "Assistant response not found.");
    const previous = (await firebase.db().ref(path).once("value")).val();
    await firebase.db().ref(path).set({
      messageId: req.params.messageId,
      customerId: req.user.uid,
      rating: req.body.rating,
      source: responseRecord.source,
      createdAt: Number(previous?.createdAt || now),
      updatedAt: now
    });
    if (previous?.rating !== req.body.rating) metrics?.increment(req.body.rating === "helpful" ? "aiHelpfulRatings" : "aiUnhelpfulRatings");
    res.json({ rating: req.body.rating });
  }));

  router.delete("/assistant/feedback/:messageId", authenticate, requireRoles("customer"), validateParams(recordIdParams("messageId")), asyncRoute(async (req, res) => {
    await firebase.db().ref(`assistantFeedback/${req.user.uid}/${req.params.messageId}`).remove();
    res.json({ removed: true });
  }));

  router.post("/insights", authenticate, requireRoles("owner"), validateBody(insightRequestSchema), (req, res, next) => {
    const cached = getCachedInventoryInsights(req.body.sales, req.body.inventory, { period: req.body.period, category: req.body.category, decisionSupport: req.body.decisionSupport });
    if (!cached) return next();
    metrics?.increment("aiInsightCacheHits");
    return res.json(cached);
  }, insightLimiter, asyncRoute(async (req, res) => {
    try {
      const result = await generateCachedInsights({ ...req.body, cacheTtlMs: config.ai?.insightCacheTtlMs });
      if (!result) throw new HttpError(503, "AI inventory analysis is temporarily unavailable.");
      metrics?.increment("aiInsightGenerations");
      res.json(result);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (Number(error?.status) === 429) {
        throw new HttpError(429, "The AI analysis limit was reached. Wait a minute, then retry.", { code: "AI_RATE_LIMITED" });
      }
      logger?.warn("ai_inventory_analysis_failed", { provider: "groq", errorCode: error?.code || "PROVIDER_ERROR" });
      metrics?.increment("aiProviderFailures");
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
