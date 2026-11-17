import { HttpError } from "../security.js";
import { notificationUpdates, userIdsForRoles } from "../notifications.js";
import { createPayMongoTestRefund, retrievePayMongoTestRefund } from "../integrations/paymongo.js";
import { orderTransitionAggregateUpdates, paymentMovementRecord } from "../domain/orderIntegrity.js";

const paidStatuses = new Set(["paid", "cod-collected"]);
const requestableMethods = new Set(["gcash", "cod", "cash"]);

function audit(db, orderId, user, action, details = {}) {
  return { [`auditLogs/${db.ref("auditLogs").push().key}`]: {
    action, orderId, actorId: user.uid, actorName: user.name || user.email || user.uid,
    actorRole: user.role, details, createdAt: Date.now()
  } };
}

async function notify(db, orderId, recipients, title, message, actionView) {
  if (!recipients.length) return;
  await db.ref().update(notificationUpdates(db, recipients, {
    title, message, type: "payment", orderId, entityType: "payment", entityId: orderId, actionView
  }));
}

function paidOrder(order) {
  return order && paidStatuses.has(order.paymentStatus) && requestableMethods.has(order.paymentMethod)
    && Number.isFinite(Number(order.total)) && Number(order.total) > 0;
}

export async function requestRefund(db, user, orderId, input) {
  const orderRef = db.ref(`orders/${orderId}`);
  let rejection;
  const now = Date.now();
  const result = await orderRef.transaction((order) => {
    // The Admin SDK can first invoke a transaction with an empty local cache.
    // Returning null lets it retry with the server's current order value.
    if (order === null) return null;
    if (order.customerId !== user.uid || user.role !== "customer") { rejection = new HttpError(403, "This order is not yours."); return; }
    if (!paidOrder(order)) { rejection = new HttpError(409, "Only paid orders can be reviewed for a refund."); return; }
    if (order.refundRequest) { rejection = new HttpError(409, "A refund request already exists for this order."); return; }
    const mode = order.paymentMethod === "gcash" ? "paymongo-test" : "manual-cash";
    if (mode === "paymongo-test" && (order.paymentProvider !== "paymongo" || order.providerLivemode !== false || !order.providerPaymentId)) {
      rejection = new HttpError(409, "This payment has no verified sandbox payment record for a refund."); return;
    }
    return { ...order, refundStatus: "pending-review", refundRequest: {
      id: `REF-${orderId}`, orderId, customerId: user.uid, customerName: order.customerName || user.name || "Customer",
      amount: Number(order.total), paymentMethod: order.paymentMethod, mode,
      reason: input.reason.trim(), details: input.details.trim(), status: "pending-review",
      createdAt: now, updatedAt: now
    } };
  }, undefined, false);
  if (!result.committed || !result.snapshot.val()) throw rejection || new HttpError(404, "Order not found.");
  await db.ref().update(audit(db, orderId, user, "refund_requested", { amount: Number(result.snapshot.val().total), mode: result.snapshot.val().refundRequest.mode }));
  const ownerIds = await userIdsForRoles(db, ["owner"]);
  await notify(db, orderId, ownerIds, "Refund review requested", `${orderId} needs an owner refund decision.`, "owner-reports");
  return { refundRequest: result.snapshot.val().refundRequest };
}

export async function decideRefund(db, user, orderId, input, options = {}) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  const orderRef = db.ref(`orders/${orderId}`);
  const before = (await orderRef.once("value")).val();
  if (!before?.refundRequest) throw new HttpError(404, "Refund request not found.");
  const current = before.refundRequest;
  if (input.action === "refresh") {
    if (current.mode !== "paymongo-test" || !current.providerRefundId || !["processing", "failed"].includes(current.status)) throw new HttpError(409, "No provider refund is awaiting verification.");
    const provider = await retrievePayMongoTestRefund(current.providerRefundId, {
      paymentId: before.providerPaymentId, amount: Math.round(current.amount * 100), ...options
    });
    return settleProviderRefund(db, user, orderId, provider);
  }
  if (current.status !== "pending-review") throw new HttpError(409, "This request has already been reviewed.");
  const now = Date.now();
  let rejection;
  const result = await orderRef.transaction((order) => {
    if (order === null) return null;
    if (order?.refundRequest?.status !== "pending-review") { rejection = new HttpError(409, "This request has already been reviewed."); return; }
    const status = input.action === "reject" ? "rejected" : order.refundRequest.mode === "manual-cash" ? "approved-manual" : "processing";
    return { ...order, refundStatus: status, refundRequest: { ...order.refundRequest, status, decisionNote: input.note.trim(), reviewedBy: user.uid, reviewedAt: now, updatedAt: now } };
  }, undefined, false);
  if (!result.committed || !result.snapshot.val()) throw rejection || new HttpError(409, "The request changed while it was being reviewed.");
  const order = result.snapshot.val();
  await db.ref().update(audit(db, orderId, user, `refund_${order.refundRequest.status.replaceAll("-", "_")}`, { note: input.note.trim() }));
  await notify(db, orderId, [order.customerId], "Refund request updated", `${orderId}: ${order.refundRequest.status.replaceAll("-", " ")}.`, "orders");
  if (order.refundRequest.status !== "processing") return { refundRequest: order.refundRequest };
  try {
    const provider = await createPayMongoTestRefund({
      paymentId: order.providerPaymentId, amount: Math.round(order.refundRequest.amount * 100), orderId,
      note: `TapTap Foodtrip ${orderId}: ${input.note.trim()}`
    }, options);
    return settleProviderRefund(db, user, orderId, provider);
  } catch (error) {
    // An uncertain provider outcome must never trigger a new refund. The owner can reconcile it.
    const status = "failed";
    await orderRef.update({ refundStatus: status, "refundRequest/status": status, "refundRequest/providerError": error.message, "refundRequest/updatedAt": Date.now() });
    await notify(db, orderId, [order.customerId], "Test refund needs review", `${orderId} could not be confirmed. No completed refund is recorded.`, "orders");
    return { refundRequest: (await orderRef.once("value")).val().refundRequest };
  }
}

async function settleProviderRefund(db, user, orderId, provider) {
  const orderRef = db.ref(`orders/${orderId}`);
  const previous = (await orderRef.once("value")).val();
  const now = Date.now();
  let rejection;
  const result = await orderRef.transaction((order) => {
    if (order === null) return null;
    if (!order?.refundRequest || order.refundRequest.mode !== "paymongo-test") { rejection = new HttpError(409, "Refund record changed."); return; }
    if (order.refundRequest.providerRefundId && order.refundRequest.providerRefundId !== provider.id) { rejection = new HttpError(409, "A different provider refund is already recorded."); return; }
    const status = provider.status === "succeeded" ? "test-refunded" : provider.status === "failed" ? "failed" : "processing";
    return { ...order, refundStatus: status, ...(status === "test-refunded" ? { paymentStatus: "refunded" } : {}), refundRequest: {
      ...order.refundRequest, status, providerRefundId: provider.id, providerStatus: provider.status,
      updatedAt: now, ...(status === "test-refunded" ? { completedAt: now } : {})
    } };
  }, undefined, false);
  if (!result.committed || !result.snapshot.val()) throw rejection || new HttpError(409, "The provider refund could not be recorded.");
  const order = result.snapshot.val();
  await db.ref().update({
    ...audit(db, orderId, user, "refund_provider_status", { status: provider.status, providerRefundId: provider.id }),
    ...(order.refundRequest.status === "test-refunded" && previous.paymentStatus !== "refunded" ? {
      ...orderTransitionAggregateUpdates(previous, order, now),
      [`paymentMovements/${orderId}/${db.ref(`paymentMovements/${orderId}`).push().key}`]: paymentMovementRecord({ orderId, order, previousStatus: previous.paymentStatus, user, createdAt: now, reason: "PayMongo sandbox refund" })
    } : {})
  });
  await notify(db, orderId, [order.customerId], "Test refund status updated", `${orderId}: ${order.refundRequest.status.replaceAll("-", " ")}. No real money moves in sandbox.`, "orders");
  return { refundRequest: order.refundRequest };
}

export async function completeManualRefund(db, user, orderId, input) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  const orderRef = db.ref(`orders/${orderId}`);
  const previous = (await orderRef.once("value")).val();
  let rejection;
  const now = Date.now();
  const result = await orderRef.transaction((order) => {
    if (order === null) return null;
    if (order?.refundRequest?.mode !== "manual-cash" || order.refundRequest.status !== "approved-manual") { rejection = new HttpError(409, "No approved manual refund is waiting for completion."); return; }
    return { ...order, refundStatus: "manual-refunded", paymentStatus: "refunded", refundRequest: {
      ...order.refundRequest, status: "manual-refunded", manualMethod: input.method.trim(),
      manualReference: input.reference.trim(), completedBy: user.uid, completedAt: now, updatedAt: now
    } };
  }, undefined, false);
  if (!result.committed || !result.snapshot.val()) throw rejection || new HttpError(409, "The manual refund could not be recorded.");
  const order = result.snapshot.val();
  await db.ref().update({
    ...audit(db, orderId, user, "refund_manual_completed", { method: input.method.trim(), reference: input.reference.trim() }),
    ...orderTransitionAggregateUpdates(previous, order, now),
    [`paymentMovements/${orderId}/${db.ref(`paymentMovements/${orderId}`).push().key}`]: paymentMovementRecord({ orderId, order, previousStatus: previous.paymentStatus, user, createdAt: now, reason: `Manual refund: ${input.method.trim()}` })
  });
  await notify(db, orderId, [order.customerId], "Manual refund recorded", `${orderId}: the owner recorded a manual refund.`, "orders");
  return { refundRequest: order.refundRequest };
}
