import { createHash } from "node:crypto";
import { retentionTimestamp } from "./domain/orderIntegrity.js";
import { notificationDisplayReference } from "./notifications.js";
import { HttpError, validRecordId } from "./security.js";

const tokenRetentionDays = 90;
const deliveryRetentionDays = 30;
const invalidTokenCodes = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);

function cleanToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function messagingFor(firebase) {
  try {
    return firebase?.messaging?.() || null;
  } catch {
    return null;
  }
}

export function pushServiceAvailable(firebase) {
  return Boolean(messagingFor(firebase));
}

export function pushTokenId(token) {
  return createHash("sha256").update(cleanToken(token)).digest("hex");
}

function pushDeliveryId(orderId, eventKey) {
  return createHash("sha256").update(`${orderId}:${eventKey}`).digest("hex");
}

async function pushTokenRecords(db, userId) {
  const value = (await db.ref(`pushTokens/${userId}`).once("value")).val() || {};
  return Object.entries(value)
    .map(([id, record]) => ({ id, ...record }))
    .filter((record) => cleanToken(record.token))
    .slice(0, 20);
}

export async function pushStatus(db, firebase, userId) {
  const tokens = await pushTokenRecords(db, userId);
  return {
    configured: pushServiceAvailable(firebase),
    enabled: tokens.length > 0,
    tokenCount: tokens.length
  };
}

export async function registerPushToken(db, firebase, user, token) {
  if (!pushServiceAvailable(firebase)) {
    throw new HttpError(503, "Browser notifications are not configured.");
  }
  const clean = cleanToken(token);
  if (!clean) throw new HttpError(400, "A browser notification token is required.");
  const id = pushTokenId(clean);
  const path = `pushTokens/${user.uid}/${id}`;
  const existing = (await db.ref(path).once("value")).val();
  const now = Date.now();
  await db.ref().update({
    [path]: {
      token: clean,
      createdAt: Number(existing?.createdAt || now),
      updatedAt: now,
      expiresAt: retentionTimestamp(now, tokenRetentionDays)
    },
    [`users/${user.uid}/notificationPreferences/push`]: true
  });
  return { registered: true, tokenId: id };
}

export async function removePushTokens(db, user, { token, all = false } = {}) {
  const updates = {};
  if (all) {
    updates[`pushTokens/${user.uid}`] = null;
  } else {
    const clean = cleanToken(token);
    if (!clean) throw new HttpError(400, "A browser notification token is required.");
    updates[`pushTokens/${user.uid}/${pushTokenId(clean)}`] = null;
  }
  await db.ref().update(updates);
  const remaining = all ? [] : await pushTokenRecords(db, user.uid);
  if (!remaining.length) {
    await db.ref(`users/${user.uid}/notificationPreferences/push`).set(false);
  }
  return { removed: true, enabled: remaining.length > 0 };
}

export function orderPushEvent(order = {}, changes = {}, { created = false } = {}) {
  if (changes.deliveryIssue) {
    return {
      key: "customer-action-required",
      title: "Delivery needs your attention",
      body: "Open your order for the latest delivery update."
    };
  }

  const status = changes.status || (created ? order.status : "");
  if (status === "received") {
    return {
      key: "confirmed",
      title: "Order confirmed",
      body: "Your order has been confirmed."
    };
  }
  if (status === "ready" && order.deliveryType === "pickup") {
    return {
      key: "ready-for-pickup",
      title: "Ready for pickup",
      body: "Your order is ready at the counter."
    };
  }
  if (status === "out-for-delivery") {
    return {
      key: "out-for-delivery",
      title: "Out for delivery",
      body: "Your order is on the way."
    };
  }
  if (status === "arrived") {
    return {
      key: "rider-arrived",
      title: "Rider arrived",
      body: "Your rider has arrived at the delivery location."
    };
  }
  if (status === "cancelled") {
    return {
      key: "cancelled",
      title: "Order cancelled",
      body: "Open your order to review the cancellation."
    };
  }
  return null;
}

async function dispatchOrderPushInternal({
  firebase,
  db,
  orderId,
  order,
  changes = {},
  created = false,
  appBaseUrl = "",
  logger
}) {
  const messaging = messagingFor(firebase);
  const event = orderPushEvent(order, changes, { created });
  if (!messaging || !event || !validRecordId(orderId) || !validRecordId(order?.customerId) || order.customerId === "walk-in") {
    return { sent: false, reason: "not-eligible" };
  }

  const profile = (await db.ref(`users/${order.customerId}`).once("value")).val() || {};
  if (profile.notificationPreferences?.orderUpdates === false || profile.notificationPreferences?.push === false) {
    return { sent: false, reason: "preference-disabled" };
  }

  const tokenRecords = await pushTokenRecords(db, order.customerId);
  if (!tokenRecords.length) return { sent: false, reason: "no-tokens" };

  const now = Date.now();
  const deliveryId = pushDeliveryId(orderId, event.key);
  const deliveryRef = db.ref(`pushDeliveries/${order.customerId}/${deliveryId}`);
  const claim = await deliveryRef.transaction((current) => {
    if (current?.status === "delivered") return undefined;
    if (current?.status === "processing" && Number(current.expiresAt || 0) > now) return undefined;
    return {
      status: "processing",
      event: event.key,
      orderId,
      attemptCount: Number(current?.attemptCount || 0) + 1,
      updatedAt: now,
      expiresAt: now + 5 * 60 * 1000
    };
  });
  if (!claim.committed) return { sent: false, duplicate: true };

  const reference = notificationDisplayReference(orderId);
  const data = {
    title: event.title,
    body: `${reference}. ${event.body}`,
    event: event.key,
    orderId,
    destination: "orders"
  };
  const link = appBaseUrl
    ? `${String(appBaseUrl).replace(/\/$/, "")}/?push=orders&orderId=${encodeURIComponent(orderId)}`
    : "";

  try {
    const response = await messaging.sendEachForMulticast({
      tokens: tokenRecords.map((record) => record.token),
      data,
      webpush: {
        headers: {
          TTL: "3600",
          Urgency: event.key === "rider-arrived" || event.key === "customer-action-required" ? "high" : "normal"
        },
        ...(link ? { fcmOptions: { link } } : {})
      }
    });
    const updates = {};
    response.responses.forEach((result, index) => {
      if (!result.success && invalidTokenCodes.has(result.error?.code)) {
        updates[`pushTokens/${order.customerId}/${tokenRecords[index].id}`] = null;
      }
    });
    const invalidTokenCount = Object.keys(updates).length;
    if (invalidTokenCount === tokenRecords.length) {
      updates[`users/${order.customerId}/notificationPreferences/push`] = false;
    }
    const deliveredAt = Date.now();
    updates[`pushDeliveries/${order.customerId}/${deliveryId}`] = {
      status: response.successCount > 0 ? "delivered" : "failed",
      event: event.key,
      orderId,
      successCount: response.successCount,
      failureCount: response.failureCount,
      updatedAt: deliveredAt,
      expiresAt: retentionTimestamp(deliveredAt, deliveryRetentionDays)
    };
    await db.ref().update(updates);
    return {
      sent: response.successCount > 0,
      successCount: response.successCount,
      failureCount: response.failureCount
    };
  } catch (error) {
    const failedAt = Date.now();
    await deliveryRef.update({
      status: "failed",
      updatedAt: failedAt,
      expiresAt: retentionTimestamp(failedAt, 1)
    });
    logger?.warn("push_delivery_failed", {
      orderId,
      event: event.key,
      errorCode: error?.code || "messaging_error"
    });
    return { sent: false, reason: "provider-error" };
  }
}

export async function dispatchOrderPush(options) {
  try {
    return await dispatchOrderPushInternal(options);
  } catch (error) {
    options?.logger?.warn?.("push_delivery_failed", {
      orderId: options?.orderId,
      event: "dispatch",
      errorCode: error?.code || "push_dispatch_error"
    });
    return { sent: false, reason: "dispatch-error" };
  }
}
