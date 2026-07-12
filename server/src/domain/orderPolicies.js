import { HttpError } from "./errors.js";

export const roles = ["owner", "staff", "rider", "customer"];
export const orderStatusFlow = ["received", "preparing", "ready", "out-for-delivery", "arrived", "delivered"];
export const counterStatusFlow = ["received", "preparing", "ready", "completed"];
export const cancellableOrderStatuses = ["pending-payment", "received", "preparing"];

export function validRecordId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function canAccessOrder(user, order, { allowAvailableRiderOrder = false } = {}) {
  if (!user || !order) return false;
  if (["owner", "staff"].includes(user.role)) return true;
  if (user.role === "customer") return order.customerId === user.uid;
  if (user.role === "rider") {
    return order.riderId === user.uid ||
      (allowAvailableRiderOrder && order.deliveryType === "delivery" && order.status === "ready" && !order.riderId);
  }
  return false;
}

function isDeliveryOrder(order) {
  return order?.deliveryType === "delivery";
}

function staffStatusFlowForOrder(order) {
  return isDeliveryOrder(order) ? ["received", "preparing", "ready"] : counterStatusFlow;
}

export function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new HttpError(400, "Add between 1 and 50 order items.");
  }
  return items.map((item) => {
    if (!validRecordId(item?.id)) throw new HttpError(400, "An order item has an invalid product ID.");
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      throw new HttpError(400, "Item quantities must be whole numbers from 1 to 50.");
    }
    return { id: item.id, qty };
  });
}

export function validateLocation(payload = {}) {
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const accuracy = Number(payload.accuracy || 0);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, "Invalid latitude.");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, "Invalid longitude.");
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10_000) throw new HttpError(400, "Invalid GPS accuracy.");
  return { lat, lng, accuracy };
}

export function validateDeliveryProof(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/jpeg;base64,")) {
    throw new HttpError(400, "Delivery proof must be a JPEG image.");
  }
  const encoded = dataUrl.slice("data:image/jpeg;base64,".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HttpError(400, "Delivery proof contains invalid image data.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new HttpError(400, "Delivery proof must contain a valid JPEG header.");
  }
  if (bytes.length > 500_000) throw new HttpError(413, "Delivery proof must be smaller than 500 KB.");
  return dataUrl;
}

export function authorizeOrderUpdate(user, order, input = {}) {
  if (!user || !order) throw new HttpError(404, "Order not found.");
  const now = Date.now();

  if (["owner", "staff"].includes(user.role)) {
    const changes = {};
    if (input.cancel === true || input.status === "cancelled") {
      if (!cancellableOrderStatuses.includes(order.status)) {
        throw new HttpError(409, "Only pending or kitchen orders can be cancelled.");
      }
      const reason = typeof input.cancelReason === "string" ? input.cancelReason.trim().slice(0, 160) : "";
      if (!reason) throw new HttpError(400, "A cancellation reason is required.");
      return {
        status: "cancelled",
        cancelReason: reason,
        cancelledAt: now,
        cancelledBy: user.uid,
        cancelledByRole: user.role,
        updatedAt: now
      };
    }
    if (input.codRemitted === true) {
      if (order.paymentMethod !== "cod") throw new HttpError(409, "Only COD orders can be remitted.");
      if (order.status !== "delivered") throw new HttpError(409, "COD can be remitted only after delivery.");
      if (order.codRemittedAt) throw new HttpError(409, "COD was already remitted.");
      changes.codRemittedAt = now;
      changes.codRemittedBy = user.uid;
      changes.paymentStatus = "paid";
      changes.paymentConfirmedAt = now;
      changes.updatedAt = now;
    }
    if (input.status !== undefined) {
      const flow = staffStatusFlowForOrder(order);
      const currentIndex = flow.indexOf(order.status);
      if (currentIndex < 0) throw new HttpError(409, "This order no longer accepts status updates.");
      const nextStatus = flow[currentIndex + 1];
      if (!nextStatus || input.status !== nextStatus) {
        throw new HttpError(409, `The next valid status is ${nextStatus || "none"}.`);
      }
      changes.status = input.status;
      changes.updatedAt = now;
      if (input.status === "preparing" && !order.prepStartedAt) changes.prepStartedAt = now;
      if (input.status === "ready") changes.readyAt = now;
      if (input.status === "completed") {
        changes.completedAt = now;
        if (["cash", "cod"].includes(order.paymentMethod)) {
          changes.paymentStatus = "paid";
          changes.paymentConfirmedAt = now;
        }
      }
    }
    if (input.riderId !== undefined) {
      if (input.riderId !== null && !validRecordId(input.riderId)) throw new HttpError(400, "Invalid rider ID.");
      if (input.riderId !== null && !isDeliveryOrder(order)) throw new HttpError(409, "Riders can be assigned only to delivery orders.");
      if (input.riderId !== null && order.status !== "ready") throw new HttpError(409, "Riders can be assigned only when an order is ready.");
      changes.riderId = input.riderId;
      changes.assignedAt = now;
    }
    if (Object.keys(changes).length === 0) throw new HttpError(400, "No supported order update was provided.");
    return changes;
  }

  if (user.role === "customer") {
    if (order.customerId !== user.uid) throw new HttpError(403, "This order is not yours.");
    if (input.cancel !== true && input.status !== "cancelled") {
      throw new HttpError(403, "Customers can only cancel their own eligible orders.");
    }
    if (!["pending-payment", "received"].includes(order.status)) {
      throw new HttpError(409, "This order is already being prepared. Please contact staff for owner approval.");
    }
    const reason = typeof input.cancelReason === "string" ? input.cancelReason.trim().slice(0, 160) : "";
    if (!reason) throw new HttpError(400, "A cancellation reason is required.");
    const changes = {
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: now,
      cancelledBy: user.uid,
      cancelledByRole: user.role,
      updatedAt: now
    };
    if (order.paymentStatus === "paid") changes.refundStatus = "owner-review";
    return changes;
  }

  if (user.role !== "rider") throw new HttpError(403, "Order updates require an operations role.");

  if (input.codHandoffRequested === true) {
    if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
    if (!isDeliveryOrder(order) || order.paymentMethod !== "cod") throw new HttpError(409, "Only COD deliveries can record a cash handoff.");
    if (order.status !== "delivered") throw new HttpError(409, "Cash handoff can be recorded only after delivery.");
    if (order.codRemittedAt) throw new HttpError(409, "COD was already confirmed by the owner.");
    if (order.codHandoffRequestedAt) throw new HttpError(409, "Cash handoff was already recorded.");
    return { codHandoffRequestedAt: now, codHandoffRequestedBy: user.uid, updatedAt: now };
  }

  if (input.deliveryIssue) {
    const reason = typeof input.deliveryIssue === "string" ? input.deliveryIssue.trim().slice(0, 160) : "";
    if (!reason) throw new HttpError(400, "A delivery issue reason is required.");
    if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
    if (!isDeliveryOrder(order)) throw new HttpError(409, "Only delivery orders can have rider issue reports.");
    if (!["out-for-delivery", "arrived"].includes(order.status)) {
      throw new HttpError(409, "Delivery issues can be reported only while delivering.");
    }
    return { deliveryIssue: reason, deliveryIssueAt: now, deliveryIssueBy: user.uid, updatedAt: now };
  }

  if (!isDeliveryOrder(order)) throw new HttpError(409, "Riders can update delivery orders only.");
  if (!order.riderId && order.status === "ready" && input.riderId === user.uid && input.status === undefined) {
    return { riderId: user.uid, assignedAt: now };
  }
  if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");

  const allowedNext = {
    ready: "out-for-delivery",
    "out-for-delivery": "arrived",
    arrived: "delivered"
  }[order.status];
  if (!allowedNext || input.status !== allowedNext) {
    throw new HttpError(409, `The next valid rider status is ${allowedNext || "none"}.`);
  }

  const changes = { status: input.status, updatedAt: now };
  if (input.status === "out-for-delivery") changes.pickedUpAt = now;
  if (input.status === "arrived") changes.arrivedAt = now;
  if (input.status === "delivered") {
    const secureUrl = typeof input.proofOfDeliveryUrl === "string" && input.proofOfDeliveryUrl.startsWith("https://");
    const storedProof = typeof input.proofOfDeliveryRef === "string" && input.proofOfDeliveryRef.startsWith("deliveryProofs/");
    if (!secureUrl && !storedProof) throw new HttpError(400, "A proof-of-delivery record is required.");
    if (secureUrl) changes.proofOfDeliveryUrl = input.proofOfDeliveryUrl;
    if (storedProof) changes.proofOfDeliveryRef = input.proofOfDeliveryRef;
    if (input.proofOfDeliveryMeta && typeof input.proofOfDeliveryMeta === "object") {
      changes.proofOfDeliveryMeta = {
        customerName: String(input.proofOfDeliveryMeta.customerName || "").slice(0, 80),
        signature: String(input.proofOfDeliveryMeta.signature || "").slice(0, 80),
        otpVerified: Boolean(input.proofOfDeliveryMeta.otpVerified),
        capturedAt: Number(input.proofOfDeliveryMeta.capturedAt || now),
        photoQualityWarning: String(input.proofOfDeliveryMeta.photoQualityWarning || "").slice(0, 160)
      };
    }
    changes.deliveredAt = now;
    if (order.paymentMethod === "cod") {
      changes.codCollectedAt = now;
      changes.codCollectedBy = user.uid;
      changes.paymentStatus = "cod-collected";
    }
  }
  return changes;
}
