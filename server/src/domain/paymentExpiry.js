export const onlinePaymentWindowMs = 30 * 60 * 1000;

export function onlinePaymentDeadline(order) {
  const createdAt = Number(order?.paymentRequiredAt || order?.createdAt || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return 0;
  return Number(order?.paymentExpiresAt) || createdAt + onlinePaymentWindowMs;
}

export function isExpiredOnlineOrder(order, now = Date.now()) {
  return order?.paymentMethod === "gcash" && order?.status === "pending-payment" &&
    order?.paymentStatus === "pending" && onlinePaymentDeadline(order) > 0 &&
    onlinePaymentDeadline(order) <= now;
}
