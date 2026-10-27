import { notificationDisplayReference, notificationUpdates, userIdsForRoles } from "../notifications.js";
import { sendOrderStatusSms } from "../services.js";

const supportedStatuses = new Set(["out-for-delivery", "cancelled"]);
const claimLeaseMs = 2 * 60 * 1000;

function safeKey(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160);
}

async function claimDispatch(db, orderId, status, now) {
  const ref = db.ref(`smsDispatchClaims/${safeKey(orderId)}/${safeKey(status)}`);
  const transaction = await ref.transaction((current) => {
    if (current?.status === "queued" || current?.status === "sent" || current?.status === "delivered") return undefined;
    if (current?.status === "processing" && Number(current.expiresAt || 0) > now) return undefined;
    return { status: "processing", startedAt: now, expiresAt: now + claimLeaseMs };
  }, undefined, false);
  return { claimed: transaction.committed, ref, previous: transaction.snapshot?.val() || null };
}

function deliveryRecord({ orderId, status, result, now }) {
  return {
    provider: "textbee",
    category: "order-status",
    orderId,
    orderReference: notificationDisplayReference(orderId),
    orderStatus: status,
    smsBatchId: result.smsBatchId,
    deviceId: result.deviceId || null,
    deliveryStatus: "pending",
    createdAt: now,
    updatedAt: now
  };
}

export async function dispatchOrderSms({ db, orderId, order, changes = {}, logger, sendSms = sendOrderStatusSms, now = Date.now() }) {
  const status = String(changes.status || "");
  if (!supportedStatuses.has(status)) return { sent: false, skipped: "status" };
  if (order?.customerId === "walk-in" || !order?.phoneVerified || !order?.smsNotifications || !order?.phone) {
    return { sent: false, skipped: "not-eligible" };
  }
  const claim = await claimDispatch(db, orderId, status, now);
  if (!claim.claimed) return { sent: false, duplicate: true };
  try {
    const result = await sendSms({ to: order.phone, orderId, status });
    if (!result?.smsBatchId) throw Object.assign(new Error("SMS provider response was incomplete."), { code: "SMS_PROVIDER_INVALID_RESPONSE" });
    const deliveryId = db.ref("smsDeliveries").push().key;
    await db.ref().update({
      [`smsDeliveries/${deliveryId}`]: deliveryRecord({ orderId, status, result, now }),
      [`smsDeliveryBatches/${safeKey(result.smsBatchId)}`]: deliveryId,
      [`smsDispatchClaims/${safeKey(orderId)}/${safeKey(status)}`]: {
        status: "queued",
        deliveryId,
        smsBatchId: result.smsBatchId,
        queuedAt: now,
        expiresAt: null
      }
    });
    return { sent: true, deliveryId, smsBatchId: result.smsBatchId };
  } catch (error) {
    const deliveryId = db.ref("smsDeliveries").push().key;
    const ownerIds = await userIdsForRoles(db, ["owner"]);
    const failureNotifications = notificationUpdates(db, ownerIds, {
      title: "SMS delivery needs attention",
      message: `${notificationDisplayReference(orderId)} ${status.replaceAll("-", " ")} text could not be queued.`,
      type: "system",
      orderId,
      entityType: "system",
      entityId: orderId,
      actionView: "owner-settings"
    });
    for (const notification of Object.values(failureNotifications)) {
      notification.deliveryStatus = "failed";
      notification.errorCode = String(error?.code || "SMS_SEND_FAILED").slice(0, 80);
      notification.failedAt = now;
    }
    await db.ref().update({
      [`smsDeliveries/${deliveryId}`]: {
        provider: "textbee",
        category: "order-status",
        orderId,
        orderReference: notificationDisplayReference(orderId),
        orderStatus: status,
        deliveryStatus: "failed",
        errorCode: String(error?.code || "SMS_SEND_FAILED").slice(0, 80),
        failedAt: now,
        createdAt: now,
        updatedAt: now
      },
      [`smsDispatchClaims/${safeKey(orderId)}/${safeKey(status)}`]: {
        status: "failed",
        deliveryId,
        failedAt: now,
        expiresAt: null
      },
      ...failureNotifications
    });
    logger?.warn?.("order_sms_delivery_failed", {
      orderId,
      orderStatus: status,
      errorCode: error?.code || "SMS_SEND_FAILED"
    });
    return { sent: false, failed: true, deliveryId };
  }
}

export async function applyTextBeeWebhook({ db, event, logger, now = Date.now() }) {
  const idempotencyKey = safeKey(event?.idempotencyKey);
  const smsBatchId = safeKey(event?.smsBatchId);
  if (!idempotencyKey || !smsBatchId) return { processed: false, ignored: true };
  const eventRef = db.ref(`smsWebhookEvents/${idempotencyKey}`);
  const claimed = await eventRef.transaction((current) => current ? undefined : { receivedAt: now }, undefined, false);
  if (!claimed.committed) return { processed: false, duplicate: true };

  const deliveryId = (await db.ref(`smsDeliveryBatches/${smsBatchId}`).once("value")).val();
  if (!deliveryId) {
    await eventRef.update({ ignored: true, reason: "unknown-batch" });
    return { processed: false, ignored: true };
  }
  const deliveryRef = db.ref(`smsDeliveries/${deliveryId}`);
  const current = (await deliveryRef.once("value")).val() || {};
  const state = {
    MESSAGE_SENT: "sent",
    MESSAGE_DELIVERED: "delivered",
    MESSAGE_FAILED: "failed",
    UNKNOWN_STATE: "unknown"
  }[event.webhookEvent];
  if (!state) {
    await eventRef.update({ ignored: true, reason: "unsupported-event" });
    return { processed: false, ignored: true };
  }
  const rank = { pending: 0, sent: 1, unknown: 1, delivered: 3, failed: 3 };
  const finalCurrent = ["delivered", "failed"].includes(current.deliveryStatus);
  if (!finalCurrent && (rank[state] ?? -1) >= (rank[current.deliveryStatus] ?? -1)) {
    await deliveryRef.update({
      deliveryStatus: state,
      smsId: String(event.smsId || "").slice(0, 160) || null,
      updatedAt: now,
      ...(event.sentAt ? { sentAt: Date.parse(event.sentAt) || now } : {}),
      ...(event.deliveredAt ? { deliveredAt: Date.parse(event.deliveredAt) || now } : {}),
      ...(event.failedAt ? { failedAt: Date.parse(event.failedAt) || now } : {}),
      ...(state === "failed" ? { errorCode: String(event.errorCode || "SMS_FAILED").slice(0, 80) } : {})
    });
    if (state === "failed") {
      const ownerIds = await userIdsForRoles(db, ["owner"]);
      const failureNotifications = notificationUpdates(db, ownerIds, {
        title: "SMS delivery failed",
        message: `${current.orderReference || notificationDisplayReference(current.orderId)} ${String(current.orderStatus || "order update").replaceAll("-", " ")} text was not delivered.`,
        type: "system",
        orderId: current.orderId,
        entityType: "system",
        entityId: current.orderId,
        actionView: "owner-settings"
      });
      for (const notification of Object.values(failureNotifications)) {
        notification.deliveryStatus = "failed";
        notification.errorCode = String(event.errorCode || "SMS_FAILED").slice(0, 80);
        notification.failedAt = now;
      }
      if (Object.keys(failureNotifications).length) await db.ref().update(failureNotifications);
    }
  }
  await eventRef.update({ processedAt: now, deliveryId, event: String(event.webhookEvent || "").slice(0, 40) });
  logger?.info?.("textbee_webhook_processed", { deliveryId, state });
  return { processed: true, deliveryId, state };
}
