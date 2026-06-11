export const roles = ["owner", "staff", "rider", "customer"];
export const orderStatusFlow = ["received", "preparing", "ready", "out-for-delivery", "arrived", "delivered"];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function bearerToken(header = "") {
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ error: `${allowedRoles.join(" or ")} access required.` });
    }
    return next();
  };
}

export function validRecordId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function canAccessOrder(user, order, { allowAvailableRiderOrder = false } = {}) {
  if (!user || !order) return false;
  if (["owner", "staff"].includes(user.role)) return true;
  if (user.role === "customer") return order.customerId === user.uid;
  if (user.role === "rider") {
    return order.riderId === user.uid ||
      (allowAvailableRiderOrder && order.status === "ready" && !order.riderId);
  }
  return false;
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
    if (input.status !== undefined) {
      const currentIndex = orderStatusFlow.indexOf(order.status);
      const nextStatus = orderStatusFlow[currentIndex + 1];
      if (!nextStatus || input.status !== nextStatus) {
        throw new HttpError(409, `The next valid status is ${nextStatus || "none"}.`);
      }
      changes.status = input.status;
      changes.updatedAt = now;
    }
    if (input.riderId !== undefined) {
      if (input.riderId !== null && !validRecordId(input.riderId)) throw new HttpError(400, "Invalid rider ID.");
      changes.riderId = input.riderId;
      changes.assignedAt = now;
    }
    if (Object.keys(changes).length === 0) throw new HttpError(400, "No supported order update was provided.");
    return changes;
  }

  if (user.role !== "rider") throw new HttpError(403, "Order updates require an operations role.");

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
    if (!secureUrl && !storedProof) {
      throw new HttpError(400, "A proof-of-delivery record is required.");
    }
    if (secureUrl) changes.proofOfDeliveryUrl = input.proofOfDeliveryUrl;
    if (storedProof) changes.proofOfDeliveryRef = input.proofOfDeliveryRef;
    changes.deliveredAt = now;
  }
  return changes;
}

export function errorResponse(error) {
  return {
    status: error?.status || 500,
    message: error?.status ? error.message : "The server could not complete the request."
  };
}
