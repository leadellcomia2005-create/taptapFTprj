import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import {
  HttpError,
  validRecordId,
  validateDeliveryProof,
  validateLocation
} from "../security.js";
import { retentionTimestamp } from "../domain/orderIntegrity.js";

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseProofHandoff(input = {}, order = {}) {
  const handoff = input || {};
  const otp = cleanText(handoff.otp, 12).replace(/\D/g, "").slice(0, 6);
  if (otp && order.handoffOtp && otp !== order.handoffOtp) {
    throw new HttpError(409, "Delivery OTP does not match this order.");
  }
  const proof = {
    customerName: cleanText(handoff.customerName, 80),
    signature: cleanText(handoff.signature, 80),
    otpVerified: Boolean(otp && order.handoffOtp && otp === order.handoffOtp),
    photoQualityWarning: cleanText(handoff.photoQualityWarning, 160),
    capturedAt: Date.now()
  };
  if (!proof.customerName && !proof.signature) {
    throw new HttpError(400, "Add the receiver name or typed signature before delivery proof.");
  }
  return proof;
}

async function persistProofImage(orderId, dataUrl, logger) {
  const encoded = dataUrl.slice("data:image/jpeg;base64,".length);
  const imageBuffer = Buffer.from(encoded, "base64");
  const configuredBucket = String(
    process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || ""
  ).replace(/^gs:\/\//, "");
  if (!configuredBucket) {
    return { dataUrl, sizeBytes: imageBuffer.length, storageMode: "database" };
  }
  try {
    const bucket = getStorage().bucket(configuredBucket);
    const storagePath = `proof-of-delivery/${orderId}/${Date.now()}.jpg`;
    const token = randomUUID();
    await bucket.file(storagePath).save(imageBuffer, {
      resumable: false,
      metadata: {
        contentType: "image/jpeg",
        metadata: { firebaseStorageDownloadTokens: token }
      }
    });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
    return {
      downloadUrl,
      storagePath,
      storageBucket: bucket.name,
      sizeBytes: imageBuffer.length,
      storageMode: "storage"
    };
  } catch {
    logger?.warn("delivery_proof_storage_fallback", { orderId, storageMode: "database" });
    return { dataUrl, sizeBytes: imageBuffer.length, storageMode: "database" };
  }
}

export async function saveRiderLocationRecord(db, user, orderId, input) {
  if (user.role !== "rider") throw new HttpError(403, "Rider access required.");
  if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db.ref(`orders/${orderId}`).once("value")).val();
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
  if (order.status === "delivered") throw new HttpError(409, "Delivered orders no longer accept GPS updates.");
  const location = { ...validateLocation(input), updatedAt: Date.now() };
  await db.ref().update({
    [`riderLocations/${user.uid}`]: { ...location, orderId },
    [`orders/${orderId}/riderLocation`]: location
  });
  return { location, order };
}

export async function saveDeliveryProofRecord(db, user, orderId, input, { logger } = {}) {
  if (user.role !== "rider") throw new HttpError(403, "Rider access required.");
  if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db.ref(`orders/${orderId}`).once("value")).val();
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
  if (order.status !== "arrived") throw new HttpError(409, "Proof can be captured only after arrival.");
  const handoff = parseProofHandoff(input.handoff, order);
  const image = await persistProofImage(orderId, validateDeliveryProof(input.dataUrl), logger);
  const proofOfDeliveryRef = `deliveryProofs/${orderId}`;
  const createdAt = Date.now();
  await db.ref(proofOfDeliveryRef).set({
    ...image,
    handoff,
    riderId: user.uid,
    riderName: user.name || user.email || "Rider",
    createdAt,
    expiresAt: retentionTimestamp(createdAt, 30)
  });
  return { proofOfDeliveryRef, proofOfDeliveryMeta: handoff };
}
