import { createHash } from "node:crypto";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const increment = (value) => ({ ".sv": { increment: Number(value || 0) } });

export function normalizeIdempotencyKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{12,128}$/.test(key) ? key : "";
}

export function orderRequestFingerprint(user, input = {}) {
  const items = Array.isArray(input.items)
    ? input.items
        .map((item) => ({ id: String(item?.id || ""), qty: Number(item?.qty || 0) }))
        .sort((left, right) => left.id.localeCompare(right.id) || left.qty - right.qty)
    : [];
  const location = input.deliveryLocation && typeof input.deliveryLocation === "object"
    ? {
        lat: Number(input.deliveryLocation.lat),
        lng: Number(input.deliveryLocation.lng),
        source: String(input.deliveryLocation.source || "")
      }
    : null;
  const request = {
    actorId: String(user?.uid || ""),
    actorRole: String(user?.role || ""),
    items,
    paymentMethod: String(input.paymentMethod || ""),
    deliveryType: String(input.deliveryType || ""),
    phone: String(input.phone || "").replace(/\D/g, ""),
    address: String(input.address || "").trim(),
    landmark: String(input.landmark || "").trim(),
    notes: String(input.notes || "").trim(),
    location,
    discount: Number(input.discount || 0),
    discountReason: String(input.discountReason || "").trim(),
    cashReceived: Number(input.cashReceived || 0),
    diningOption: String(input.diningOption || ""),
    smsNotifications: Boolean(input.smsNotifications)
  };
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export function manilaDateKey(timestamp = Date.now()) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function orderCreationAggregateUpdates(order, timestamp = Date.now()) {
  const date = manilaDateKey(timestamp);
  const path = `reportAggregates/daily/${date}`;
  return {
    [`${path}/date`]: date,
    [`${path}/grossSales`]: increment(order.total),
    [`${path}/paidSales`]: increment(order.paymentStatus === "paid" ? order.total : 0),
    [`${path}/orderCount`]: increment(1),
    [`${path}/cancelledCount`]: increment(0),
    [`${path}/deliveryCount`]: increment(order.deliveryType === "delivery" ? 1 : 0),
    [`${path}/pickupCount`]: increment(order.deliveryType === "pickup" ? 1 : 0),
    [`${path}/walkInCount`]: increment(order.deliveryType === "walk-in" ? 1 : 0),
    [`${path}/updatedAt`]: timestamp
  };
}

export function orderTransitionAggregateUpdates(previous, next, timestamp = Date.now()) {
  const date = manilaDateKey(previous.createdAt || timestamp);
  const path = `reportAggregates/daily/${date}`;
  const updates = { [`${path}/updatedAt`]: timestamp };
  if (previous.status !== "cancelled" && next.status === "cancelled") {
    updates[`${path}/grossSales`] = increment(-Number(previous.total || 0));
    updates[`${path}/cancelledCount`] = increment(1);
    if (previous.paymentStatus === "paid") updates[`${path}/paidSales`] = increment(-Number(previous.total || 0));
  }
  if (previous.paymentStatus !== "paid" && next.paymentStatus === "paid" && next.status !== "cancelled") {
    updates[`${path}/paidSales`] = increment(next.total);
  }
  return Object.keys(updates).length > 1 ? updates : {};
}

export function paymentMovementRecord({ orderId, order, previousStatus = null, user, createdAt = Date.now(), reason = "" }) {
  return {
    orderId,
    method: order.paymentMethod,
    previousStatus,
    status: order.paymentStatus,
    amount: Number(order.total || 0),
    actorId: user?.uid || "system",
    actorRole: user?.role || "system",
    reason,
    createdAt
  };
}

export function availableDeliveryProjection(orderId, order) {
  if (!order || order.status !== "ready" || order.deliveryType !== "delivery" || order.riderId) return null;
  return {
    customerId: "available",
    customerName: "Delivery customer",
    address: "Available after claiming",
    deliveryLocation: null,
    deliveryType: "delivery",
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({ id: item.id, name: item.name, price: Number(item.price || 0), qty: Number(item.qty || 0) }))
      : [],
    subtotal: Number(order.subtotal || 0),
    total: Number(order.total || 0),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: "ready",
    sourceOrderId: orderId,
    createdAt: Number(order.createdAt || Date.now()),
    readyAt: Number(order.readyAt || Date.now())
  };
}

export function retentionTimestamp(createdAt = Date.now(), days = 30) {
  return createdAt + days * 24 * 60 * 60 * 1000;
}
