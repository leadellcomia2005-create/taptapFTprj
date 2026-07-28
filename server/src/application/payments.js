import { notificationUpdates, userIdsForRoles } from "../notifications.js";
import { orderTransitionAggregateUpdates, paymentMovementRecord } from "../domain/orderIntegrity.js";
import { HttpError, validRecordId } from "../security.js";

const processingLeaseMs = 5 * 60 * 1000;

function paymentActor() {
  return { uid: "paymongo", name: "PayMongo", role: "system" };
}

async function claimWebhookEvent(db, payment, now) {
  if (!validRecordId(payment.eventId)) throw new HttpError(400, "Invalid PayMongo event ID.");
  const eventRef = db.ref(`paymongoWebhookEvents/${payment.eventId}`);
  let state = "claimed";
  const transaction = await eventRef.transaction((current) => {
    if (current?.status === "complete" || current?.status === "rejected") {
      state = "duplicate";
      return undefined;
    }
    if (current?.status === "processing" && Number(current.startedAt || 0) > now - processingLeaseMs) {
      state = "processing";
      return undefined;
    }
    return {
      status: "processing",
      eventType: payment.eventType,
      sessionId: payment.sessionId,
      paymentId: payment.paymentId,
      livemode: payment.livemode,
      startedAt: now
    };
  });
  return { eventRef, state: transaction.committed ? "claimed" : state };
}

async function rejectWebhookEvent(eventRef, payment, reason, now) {
  await eventRef.set({
    status: "rejected",
    eventType: payment.eventType,
    sessionId: payment.sessionId,
    paymentId: payment.paymentId,
    livemode: payment.livemode,
    reason,
    completedAt: now
  });
}

export async function recordPayMongoCheckoutSession(db, orderId, session, mode) {
  if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
  let updateError;
  const orderRef = db.ref(`orders/${orderId}`);
  const transaction = await orderRef.transaction((order) => {
    if (!order) {
      updateError = new HttpError(404, "Order not found.");
      return undefined;
    }
    if (order.paymentMethod !== "gcash") {
      updateError = new HttpError(409, "Only GCash orders use PayMongo checkout.");
      return undefined;
    }
    if (order.status === "cancelled") {
      updateError = new HttpError(409, "A cancelled order cannot start payment.");
      return undefined;
    }
    if (order.paymentStatus === "paid") {
      updateError = new HttpError(409, "This order is already paid.");
      return undefined;
    }
    if (order.providerSessionId && order.providerSessionId !== session.id) {
      updateError = new HttpError(409, "This order already has a different PayMongo checkout session.");
      return undefined;
    }
    return {
      ...order,
      paymentProvider: "paymongo",
      providerSessionId: session.id,
      providerLivemode: mode === "live",
      checkoutCreatedAt: order.checkoutCreatedAt || Date.now(),
      updatedAt: Date.now()
    };
  });
  if (!transaction.committed) throw updateError || new HttpError(409, "The order changed before checkout was saved.");
  return transaction.snapshot.val();
}

export async function confirmPayMongoPayment(db, payment) {
  const now = Date.now();
  if (!validRecordId(payment.orderId)) throw new HttpError(400, "The PayMongo order reference is invalid.");
  const claim = await claimWebhookEvent(db, payment, now);
  if (claim.state === "duplicate") return { duplicate: true, orderId: payment.orderId };
  if (claim.state === "processing") {
    throw new HttpError(409, "This PayMongo event is already being processed.", { code: "PAYMONGO_EVENT_PROCESSING" });
  }

  const order = (await db.ref(`orders/${payment.orderId}`).once("value")).val();
  const reject = async (message, code) => {
    await rejectWebhookEvent(claim.eventRef, payment, code, now);
    throw new HttpError(409, message, { code });
  };
  if (!order) return reject("The PayMongo event references an unknown order.", "PAYMONGO_ORDER_NOT_FOUND");
  if (order.paymentMethod !== "gcash" || order.paymentProvider !== "paymongo") {
    return reject("The PayMongo event does not match an online-payment order.", "PAYMONGO_ORDER_MISMATCH");
  }
  if (order.providerSessionId !== payment.sessionId) {
    return reject("The PayMongo checkout session does not match this order.", "PAYMONGO_SESSION_MISMATCH");
  }
  if (Boolean(order.providerLivemode) !== Boolean(payment.livemode)) {
    return reject("The PayMongo payment mode does not match this order.", "PAYMONGO_MODE_MISMATCH");
  }
  if (payment.currency !== "PHP" || payment.amount !== Math.round(Number(order.total || 0) * 100)) {
    return reject("The PayMongo payment amount does not match the order total.", "PAYMONGO_AMOUNT_MISMATCH");
  }
  if (order.paymentStatus === "paid") {
    if (order.providerPaymentId && order.providerPaymentId !== payment.paymentId) {
      return reject("A different PayMongo payment is already attached to this order.", "PAYMONGO_PAYMENT_CONFLICT");
    }
    await claim.eventRef.set({
      status: "complete",
      eventType: payment.eventType,
      orderId: payment.orderId,
      sessionId: payment.sessionId,
      paymentId: payment.paymentId,
      livemode: payment.livemode,
      duplicate: true,
      completedAt: now
    });
    return { duplicate: true, orderId: payment.orderId };
  }

  const cancelled = order.status === "cancelled";
  const nextOrder = {
    ...order,
    status: order.status === "pending-payment" ? "received" : order.status,
    paymentStatus: "paid",
    paymentConfirmedAt: now,
    providerPaidAt: Number.isFinite(payment.paidAt) && payment.paidAt > 0 ? payment.paidAt : now,
    providerPaymentId: payment.paymentId,
    providerEventId: payment.eventId,
    providerLivemode: payment.livemode,
    ...(cancelled ? { refundStatus: "owner-review" } : {}),
    updatedAt: now
  };
  const [staffUserIds, ownerUserIds] = await Promise.all([
    userIdsForRoles(db, ["staff"]),
    userIdsForRoles(db, ["owner"])
  ]);
  const actor = paymentActor();
  const movementId = db.ref(`paymentMovements/${payment.orderId}`).push().key;
  const updates = {
    [`orders/${payment.orderId}/status`]: nextOrder.status,
    [`orders/${payment.orderId}/paymentStatus`]: nextOrder.paymentStatus,
    [`orders/${payment.orderId}/paymentConfirmedAt`]: nextOrder.paymentConfirmedAt,
    [`orders/${payment.orderId}/providerPaidAt`]: nextOrder.providerPaidAt,
    [`orders/${payment.orderId}/providerPaymentId`]: nextOrder.providerPaymentId,
    [`orders/${payment.orderId}/providerEventId`]: nextOrder.providerEventId,
    [`orders/${payment.orderId}/providerLivemode`]: nextOrder.providerLivemode,
    [`orders/${payment.orderId}/updatedAt`]: now,
    ...(cancelled ? { [`orders/${payment.orderId}/refundStatus`]: "owner-review" } : {}),
    [`paymongoWebhookEvents/${payment.eventId}`]: {
      status: "complete",
      eventType: payment.eventType,
      orderId: payment.orderId,
      sessionId: payment.sessionId,
      paymentId: payment.paymentId,
      livemode: payment.livemode,
      completedAt: now
    },
    [`paymentMovements/${payment.orderId}/${movementId}`]: paymentMovementRecord({
      orderId: payment.orderId,
      order: nextOrder,
      previousStatus: order.paymentStatus || null,
      user: actor,
      createdAt: now,
      reason: "paymongo_checkout_paid"
    }),
    [`auditLogs/AUD-${now}-${payment.orderId}-paymongo`]: {
      action: "paymongo_payment_confirmed",
      orderId: payment.orderId,
      actorId: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      providerSessionId: payment.sessionId,
      providerPaymentId: payment.paymentId,
      livemode: payment.livemode,
      amount: Number(order.total || 0),
      createdAt: now
    },
    ...orderTransitionAggregateUpdates(order, nextOrder, now),
    ...notificationUpdates(db, order.customerId === "walk-in" ? [] : [order.customerId], {
      title: cancelled ? "Payment needs review" : "Payment confirmed",
      message: cancelled
        ? `Payment for cancelled order ${payment.orderId} was received and will be reviewed.`
        : `GCash payment for ${payment.orderId} was confirmed. Your order is now in the queue.`,
      type: "payment",
      orderId: payment.orderId,
      entityType: "payment",
      entityId: payment.orderId,
      amount: Number(order.total || 0),
      actionView: "orders"
    }),
    ...notificationUpdates(db, cancelled ? [] : staffUserIds, {
      title: "Paid order received",
      message: `${payment.orderId} is paid and waiting in the kitchen queue.`,
      type: "order",
      orderId: payment.orderId,
      entityType: "order",
      entityId: payment.orderId,
      actionView: "staff-orders"
    }),
    ...notificationUpdates(db, ownerUserIds, {
      title: cancelled ? "Paid cancelled order" : "Online payment confirmed",
      message: cancelled
        ? `${payment.orderId} was paid after cancellation and needs refund review.`
        : `${payment.orderId} added ${Number(order.total || 0)} PHP through PayMongo.`,
      type: "sale",
      orderId: payment.orderId,
      entityType: "payment",
      entityId: payment.orderId,
      amount: Number(order.total || 0),
      actionView: "owner-sales"
    })
  };
  await db.ref().update(updates);
  return { duplicate: false, orderId: payment.orderId, cancelled };
}
