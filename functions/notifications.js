import { HttpError, validRecordId } from "./operations.js";

const notificationTtlMs = 30 * 24 * 60 * 60 * 1000;
const notificationEntityTypes = new Set([
  "order",
  "complaint",
  "delivery",
  "payment",
  "inventory",
  "review",
  "shift",
  "chat",
  "system"
]);
const notificationActionViews = new Set([
  "orders",
  "receipts",
  "feedback",
  "owner-sales",
  "owner-inventory",
  "owner-reports",
  "owner-reviews",
  "staff-pos",
  "staff-kitchen",
  "staff-orders",
  "staff-inventory",
  "staff-shifts",
  "staff-chat",
  "staff-reviews",
  "rider-orders",
  "rider-cod"
]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function notificationDisplayReference(recordId, prefix = "TAP") {
  const value = cleanText(recordId, 128);
  if (!value) return "";
  if (/^TAP-[A-Z0-9-]{3,}$/i.test(value)) return value.toUpperCase();
  const suffix = value.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase();
  return suffix ? `${cleanText(prefix, 12).toUpperCase() || "TAP"}-${suffix}` : "";
}

export function notificationRecord(targetUserId, input = {}) {
  if (!validRecordId(targetUserId)) throw new HttpError(400, "Invalid notification recipient.");
  const title = cleanText(input.title, 120);
  const message = cleanText(input.message, 1000);
  const type = cleanText(input.type || "system", 40);
  if (!title || !message) throw new HttpError(400, "Notification title and message are required.");
  const createdAt = Date.now();
  const orderId = validRecordId(input.orderId) ? input.orderId : "";
  const entityType = notificationEntityTypes.has(input.entityType)
    ? input.entityType
    : orderId
      ? type === "sale" ? "payment" : type === "complaint" ? "complaint" : type === "delivery" ? "delivery" : "order"
      : "";
  const entityId = validRecordId(input.entityId) ? input.entityId : orderId;
  const displayReference = cleanText(input.displayReference, 80) || (orderId ? notificationDisplayReference(orderId) : "");
  const amount = Number(input.amount);
  const actionView = notificationActionViews.has(input.actionView) ? input.actionView : "";
  return {
    targetUserId,
    title,
    message,
    type,
    createdAt,
    expiresAt: createdAt + notificationTtlMs,
    readAt: null,
    ...(orderId ? { orderId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(displayReference ? { displayReference } : {}),
    ...(Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000 ? { amount } : {}),
    ...(actionView ? { actionView } : {})
  };
}

export function notificationUpdates(db, recipients, input) {
  const updates = {};
  for (const targetUserId of [...new Set(recipients.filter(Boolean))]) {
    updates[`notifications/${db.ref("notifications").push().key}`] = notificationRecord(targetUserId, input);
  }
  return updates;
}

export async function userIdsForRoles(db, roles) {
  const users = (await db.ref("users").once("value")).val() || {};
  const roleSet = new Set(roles);
  return Object.entries(users).filter(([, profile]) => roleSet.has(profile?.role)).map(([uid]) => uid).filter(validRecordId);
}

async function ownedNotifications(db, userId) {
  return (await db.ref("notifications").orderByChild("targetUserId").equalTo(userId).once("value")).val() || {};
}

export async function cleanupExpiredNotifications(db, userId, now = Date.now()) {
  const notifications = await ownedNotifications(db, userId);
  const updates = {};
  for (const [id, entry] of Object.entries(notifications)) {
    if (Number(entry.expiresAt || 0) <= now) updates[`notifications/${id}`] = null;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return Object.keys(updates).length;
}

export async function markAllNotificationsRead(db, userId) {
  const notifications = await ownedNotifications(db, userId);
  const now = Date.now();
  const updates = {};
  for (const [id, entry] of Object.entries(notifications)) {
    if (Number(entry.expiresAt || 0) <= now) updates[`notifications/${id}`] = null;
    else if (!entry.readAt) updates[`notifications/${id}/readAt`] = now;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
}

export async function markNotificationRead(db, userId, notificationId) {
  if (!validRecordId(notificationId)) throw new HttpError(400, "Invalid notification ID.");
  const ref = db.ref(`notifications/${notificationId}`);
  const entry = (await ref.once("value")).val();
  if (!entry) return false;
  if (entry.targetUserId !== userId) throw new HttpError(403, "You cannot update another user's notification.");
  const now = Date.now();
  if (Number(entry.expiresAt || Infinity) <= now) {
    await ref.remove();
    return false;
  }
  if (entry.readAt) return false;
  await ref.update({ readAt: now });
  return true;
}

export async function dismissNotification(db, userId, notificationId) {
  if (!validRecordId(notificationId)) throw new HttpError(400, "Invalid notification ID.");
  const ref = db.ref(`notifications/${notificationId}`);
  const entry = (await ref.once("value")).val();
  if (!entry) return;
  if (entry.targetUserId !== userId) throw new HttpError(403, "You cannot dismiss another user's notification.");
  await ref.remove();
}

export async function clearNotifications(db, userId) {
  const notifications = await ownedNotifications(db, userId);
  const updates = Object.fromEntries(Object.keys(notifications).map((id) => [`notifications/${id}`, null]));
  if (Object.keys(updates).length) await db.ref().update(updates);
}

export async function clearReadNotifications(db, userId) {
  const notifications = await ownedNotifications(db, userId);
  const now = Date.now();
  const updates = {};
  for (const [id, entry] of Object.entries(notifications)) {
    if (entry.readAt || Number(entry.expiresAt || Infinity) <= now) updates[`notifications/${id}`] = null;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return Object.keys(updates).length;
}

export async function createNotification(db, actor, input = {}) {
  let recipients = [];
  if (input.targetUserId) {
    if (actor.role !== "owner" && input.targetUserId !== actor.uid && !(actor.role === "staff" && input.type === "chat")) {
      throw new HttpError(403, "You cannot notify this user.");
    }
    recipients = [input.targetUserId];
  } else if (input.targetRole === "staff" && ["customer", "owner"].includes(actor.role) && ["chat", "review"].includes(input.type)) {
    recipients = await userIdsForRoles(db, ["staff"]);
  } else {
    throw new HttpError(400, "A permitted notification recipient is required.");
  }
  const updates = notificationUpdates(db, recipients, input);
  await db.ref().update(updates);
  return { created: Object.keys(updates).length };
}
