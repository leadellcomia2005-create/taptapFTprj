import {
  authorizeOrderUpdate,
  canAccessOrder,
  HttpError,
  validRecordId,
  validateOrderItems
} from "./security.js";
import { randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { notificationUpdates, userIdsForRoles } from "./notifications.js";
import {
  availableDeliveryProjection,
  normalizeIdempotencyKey,
  orderCreationAggregateUpdates,
  orderRequestFingerprint,
  orderTransitionAggregateUpdates,
  paymentMovementRecord,
  retentionTimestamp
} from "./domain/orderIntegrity.js";

const deliveryFee = 49;
const paymentMethods = ["gcash", "cod", "cash"];
const cancellationRestorationKey = "__cancellationRestorations";
const cancellationLeaseMs = 2 * 60 * 1000;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePhilippinePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.startsWith("639") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("9") && digits.length === 10) return `+63${digits}`;
  return cleanText(value, 40);
}

function isValidPhilippineMobile(value = "") {
  return /^\+639\d{9}$/.test(value);
}

function parseDeliveryLocation(input = {}, address = "", landmark = "") {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const accuracy = Number(input?.accuracy || 0);
  return {
    lat,
    lng,
    address: cleanText(input.address || address, 300),
    landmark: cleanText(input.landmark || landmark, 160),
    source: cleanText(input.source || "map-picker", 40),
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(accuracy, 10000) : 0,
    confirmedAt: Date.now()
  };
}

function parseAvailability(input = {}) {
  const mode = input?.mode === "schedule" ? "schedule" : "always";
  const allowedDays = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  const days = Array.isArray(input?.days) ? input.days.map((day) => cleanText(day, 8)).filter((day) => allowedDays.has(day)).slice(0, 7) : [];
  const timePattern = /^\d{2}:\d{2}$/;
  const start = timePattern.test(String(input?.start || "")) ? input.start : "00:00";
  const end = timePattern.test(String(input?.end || "")) ? input.end : "23:59";
  return { mode, days, start, end };
}

function deliveryOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function slugifyId(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function cloneData(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function auditDetails(before = {}, after = {}, fields = []) {
  const beforeValues = {};
  const afterValues = {};
  for (const field of fields) {
    const previous = before[field] ?? null;
    const next = after[field] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      beforeValues[field] = previous;
      afterValues[field] = next;
    }
  }
  return { before: beforeValues, after: afterValues };
}

function stockHistoryEntry({ item, itemId, beforeStock, afterStock, delta, reason, user, action, orderId = null }) {
  return {
    itemId,
    itemName: item?.name || itemId,
    beforeStock: Number(beforeStock || 0),
    afterStock: Number(afterStock || 0),
    delta: Number(delta || 0),
    reason,
    action,
    orderId,
    actorId: user?.uid || "system",
    actorName: user?.name || user?.email || "System",
    actorRole: user?.role || "system",
    createdAt: Date.now()
  };
}

const activeDeliveryStatuses = new Set(["ready", "out-for-delivery", "arrived"]);

async function chooseLeastBusyRider(db) {
  const [usersSnapshot, ...activeOrderSnapshots] = await Promise.all([
    db.ref("users").once("value"),
    ...[...activeDeliveryStatuses].map((status) => db.ref("orders").orderByChild("status").equalTo(status).once("value"))
  ]);
  const riders = Object.entries(usersSnapshot.val() || {})
    .map(([uid, profile]) => ({ uid, ...profile }))
    .filter((profile) => profile.role === "rider");
  if (riders.length === 0) return null;
  const activeCounts = new Map(riders.map((rider) => [rider.uid, 0]));
  for (const snapshot of activeOrderSnapshots) {
    for (const order of Object.values(snapshot.val() || {})) {
      if (order.riderId && activeCounts.has(order.riderId)) {
        activeCounts.set(order.riderId, activeCounts.get(order.riderId) + 1);
      }
    }
  }
  return riders
    .sort((a, b) => (activeCounts.get(a.uid) || 0) - (activeCounts.get(b.uid) || 0) || String(a.name || a.email || a.uid).localeCompare(String(b.name || b.email || b.uid)))[0];
}

async function transactionWithInitial(ref, initialValue, update) {
  let firstCall = true;
  return ref.transaction((currentValue) => {
    const value = firstCall && currentValue === null && initialValue !== null
      ? cloneData(initialValue)
      : currentValue;
    firstCall = false;
    return update(value);
  }, undefined, false);
}

function cancellationRequested(input = {}) {
  return input.cancel === true || input.status === "cancelled";
}

function canFinalizeCancellation(user, order) {
  return ["owner", "staff"].includes(user?.role) || (user?.role === "customer" && order?.customerId === user.uid);
}

function combinedOrderItems(items = []) {
  const combined = new Map();
  for (const item of items) {
    const quantity = Number(item?.qty || 0);
    if (!validRecordId(item?.id) || !Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpError(409, "The order contains invalid inventory details and cannot be cancelled automatically.");
    }
    const current = combined.get(item.id);
    combined.set(item.id, current ? { ...current, qty: current.qty + quantity } : { ...item, qty: quantity });
  }
  return [...combined.values()];
}

async function claimCancellationFinalization(orderRef, recoveryId) {
  const token = randomUUID();
  const now = Date.now();
  const initial = (await orderRef.once("value")).val();
  let claimError;
  const transaction = await transactionWithInitial(orderRef, initial, (current) => {
    claimError = null;
    if (!current || current.cancellationRecoveryId !== recoveryId) {
      claimError = new HttpError(409, "Cancellation recovery details do not match this order.");
      return undefined;
    }
    if (current.inventoryRestoredAt) return undefined;
    const activeClaim = current.cancellationFinalizationClaim;
    if (activeClaim?.token && Number(activeClaim.expiresAt || 0) > now) {
      claimError = new HttpError(409, "This cancellation is already being finalized. Please retry in a moment.");
      return undefined;
    }
    return {
      ...current,
      cancellationFinalizationClaim: { token, startedAt: now, expiresAt: now + cancellationLeaseMs }
    };
  });
  if (!transaction.committed) {
    const current = (await orderRef.once("value")).val();
    if (current?.inventoryRestoredAt) return { complete: true, order: current };
    throw claimError || new HttpError(409, "This cancellation is already being finalized. Please retry in a moment.");
  }
  return { complete: false, token, order: transaction.snapshot.val() };
}

async function releaseCancellationFinalization(orderRef, token) {
  if (!token) return;
  const initial = (await orderRef.once("value")).val();
  await transactionWithInitial(orderRef, initial, (current) => {
    if (!current || current.inventoryRestoredAt || current.cancellationFinalizationClaim?.token !== token) return undefined;
    const next = { ...current };
    delete next.cancellationFinalizationClaim;
    return next;
  }).catch(() => {});
}

async function cancellationInventoryUpdates(db, user, orderId, order, recoveryId) {
  const items = combinedOrderItems(order.items || []);
  const inventoryRef = db.ref("inventory");
  const initial = (await inventoryRef.once("value")).val();
  const token = randomUUID();
  const startedAt = Date.now();
  let restorationError;
  const transaction = await transactionWithInitial(inventoryRef, initial, (inventory) => {
    restorationError = null;
    if (!inventory || typeof inventory !== "object") {
      restorationError = new HttpError(409, "Inventory could not be restored for this cancellation.");
      return undefined;
    }
    const existingMarker = inventory[cancellationRestorationKey]?.[orderId];
    if (existingMarker?.recoveryId === recoveryId) return inventory;
    if (existingMarker) {
      restorationError = new HttpError(409, "A different cancellation recovery is already recorded for this order.");
      return undefined;
    }
    const nextInventory = { ...inventory };
    for (const item of items) {
      const currentItem = inventory[item.id];
      if (!currentItem || !Number.isFinite(Number(currentItem.stock))) {
        restorationError = new HttpError(409, `${item.name || item.id} is missing from inventory and requires owner review.`);
        return undefined;
      }
      nextInventory[item.id] = {
        ...currentItem,
        stock: Number(currentItem.stock) + item.qty
      };
    }
    nextInventory[cancellationRestorationKey] = {
      ...(inventory[cancellationRestorationKey] || {}),
      [orderId]: { recoveryId, token, startedAt }
    };
    return nextInventory;
  });
  if (!transaction.committed) throw restorationError || new HttpError(409, "Inventory could not be restored for this cancellation.");

  const inventory = transaction.snapshot.val() || {};
  const marker = inventory[cancellationRestorationKey]?.[orderId];
  if (!marker || marker.recoveryId !== recoveryId) {
    throw new HttpError(409, "Inventory cancellation recovery could not be verified.");
  }
  const restoredAt = Number(marker.startedAt || startedAt);
  const updates = {
    [`inventory/${cancellationRestorationKey}/${orderId}`]: null,
    [`orders/${orderId}/inventoryRestoredAt`]: restoredAt,
    [`orders/${orderId}/cancellationFinalizationClaim`]: null
  };
  for (const item of items) {
    const nextStock = Number(inventory[item.id]?.stock || 0);
    updates[`public/menu/${item.id}/stock`] = nextStock;
    const historyId = db.ref(`stockHistory/${item.id}`).push().key;
    updates[`stockHistory/${item.id}/${historyId}`] = stockHistoryEntry({
      item,
      itemId: item.id,
      beforeStock: nextStock - item.qty,
      afterStock: nextStock,
      delta: item.qty,
      reason: `Cancelled order ${orderId}`,
      user,
      action: "order_cancel_restored",
      orderId
    });
  }
  return { updates, restoredAt };
}

async function finalizeCancelledOrder(db, user, orderId, previous, order, changes) {
  const orderRef = db.ref(`orders/${orderId}`);
  const claim = await claimCancellationFinalization(orderRef, order.cancellationRecoveryId);
  if (claim.complete) return claim.order;
  const claimedOrder = claim.order;
  const now = Date.now();
  try {
    const restoration = await cancellationInventoryUpdates(
      db,
      user,
      orderId,
      claimedOrder,
      claimedOrder.cancellationRecoveryId
    );
    const updates = {
      [`auditLogs/AUD-${claimedOrder.cancelledAt || now}-${orderId}-cancel`]: {
        action: "order_updated",
        orderId,
        status: "cancelled",
        details: auditDetails(previous, claimedOrder, ["status", "paymentStatus", "cancelReason", "refundStatus"]),
        actorId: user.uid,
        actorName: user.name || user.email,
        actorRole: user.role,
        createdAt: now
      },
      [`availableDeliveries/${orderId}`]: null,
      ...orderTransitionAggregateUpdates(previous, claimedOrder, now),
      ...restoration.updates
    };
    if (claimedOrder.customerId !== "walk-in") {
      Object.assign(updates, notificationUpdates(db, [claimedOrder.customerId], {
        title: "Order cancelled",
        message: `${orderId} was cancelled: ${changes.cancelReason || claimedOrder.cancelReason}.`,
        type: "order",
        orderId,
        entityType: "order",
        entityId: orderId,
        actionView: "orders"
      }));
    }
    await db.ref().update(updates);
    const finalized = { ...claimedOrder, inventoryRestoredAt: restoration.restoredAt };
    delete finalized.cancellationFinalizationClaim;
    return finalized;
  } catch (error) {
    await releaseCancellationFinalization(orderRef, claim.token);
    throw error;
  }
}

async function cancelOrderForApprovedVoid(db, user, orderId, reason, approvalId) {
  const orderRef = db.ref(`orders/${orderId}`);
  const initial = (await orderRef.once("value")).val();
  if (!initial) throw new HttpError(404, "Order not found.");
  if (initial.status === "cancelled") {
    if (initial.cancellationSourceId === approvalId && initial.cancellationRecoveryId && !initial.inventoryRestoredAt) {
      const previous = { ...initial, status: initial.statusBeforeCancellation || "received" };
      return finalizeCancelledOrder(db, user, orderId, previous, initial, initial);
    }
    return initial;
  }

  const recoveryId = randomUUID();
  let previous;
  const transaction = await transactionWithInitial(orderRef, initial, (current) => {
    if (!current || current.status === "cancelled") return undefined;
    previous = { ...current };
    const now = Date.now();
    return {
      ...current,
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: now,
      cancelledBy: user.uid,
      cancelledByRole: user.role,
      updatedAt: now,
      statusBeforeCancellation: current.status,
      cancellationRecoveryId: recoveryId,
      cancellationSourceId: approvalId
    };
  });
  if (!transaction.committed) {
    const current = (await orderRef.once("value")).val();
    if (current?.status === "cancelled" && current.cancellationSourceId === approvalId) {
      return current.inventoryRestoredAt
        ? current
        : finalizeCancelledOrder(db, user, orderId, { ...current, status: current.statusBeforeCancellation || "received" }, current, current);
    }
    throw new HttpError(409, "The order changed before the approved void was applied.");
  }
  const order = transaction.snapshot.val();
  return finalizeCancelledOrder(db, user, orderId, previous, order, order);
}

export async function createOrderRecord(db, user, input) {
  if (!["customer", "staff", "owner"].includes(user.role)) throw new HttpError(403, "This role cannot create orders.");
  const requestedItems = validateOrderItems(input.items);
  if (!paymentMethods.includes(input.paymentMethod)) throw new HttpError(400, "Unsupported payment method.");
  if (user.role === "customer" && !["gcash", "cod"].includes(input.paymentMethod)) {
    throw new HttpError(400, "Customers can pay through GCash or cash on delivery.");
  }

  const inventoryRef = db.ref("inventory");
  const [menuSnapshot, profileSnapshot, inventorySnapshot] = await Promise.all([
    db.ref("public/menu").once("value"),
    db.ref(`users/${user.uid}`).once("value"),
    inventoryRef.once("value")
  ]);
  const menu = menuSnapshot.val() || {};
  const profile = profileSnapshot.val() || {};
  const items = requestedItems.map(({ id, qty }) => {
    const product = menu[id];
    if (!product) throw new HttpError(400, `Product ${id} is unavailable.`);
    if (product.unavailable) throw new HttpError(400, `${product.name} is currently unavailable.`);
    if (user.role === "customer" && product.walkInOnly) throw new HttpError(403, `${product.name} is available for walk-in orders only.`);
    return { id, name: product.name, price: Number(product.price), qty };
  });
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const isWalkIn = user.role !== "customer";
  const deliveryType = isWalkIn ? "walk-in" : input.deliveryType === "pickup" ? "pickup" : "delivery";
  const phone = normalizePhilippinePhone(input.phone);
  const landmark = cleanText(input.landmark, 160);
  const address = isWalkIn ? "Counter" : deliveryType === "pickup" ? "Store pickup" : cleanText(input.address, 300);
  const deliveryLocation = deliveryType === "delivery" ? parseDeliveryLocation(input.deliveryLocation, address, landmark) : null;
  const profilePhone = normalizePhilippinePhone(profile.phone || "");
  const phoneVerified = Boolean(!isWalkIn && isValidPhilippineMobile(phone) && profilePhone === phone && profile.phoneVerified);
  const smsNotificationsRequested = Boolean(input.smsNotifications);
  const smsNotifications = Boolean(phoneVerified && smsNotificationsRequested);
  const discount = isWalkIn ? Math.max(0, Math.min(subtotal, Number(input.discount || 0))) : 0;
  if (!Number.isFinite(discount)) throw new HttpError(400, "Enter a valid discount.");
  const discountReason = discount > 0 ? cleanText(input.discountReason, 80) : "";
  if (discount > 0 && !discountReason) throw new HttpError(400, "Select a discount reason.");
  const fee = deliveryType === "delivery" ? deliveryFee : 0;
  const total = subtotal - discount + fee;
  const cashReceived = isWalkIn && input.paymentMethod === "cash" ? Number(input.cashReceived ?? total) : 0;
  if (isWalkIn && input.paymentMethod === "cash" && (!Number.isFinite(cashReceived) || cashReceived < total)) {
    throw new HttpError(400, "Cash received must cover the order total.");
  }
  const customerId = isWalkIn ? "walk-in" : user.uid;
  const customerName = isWalkIn ? "Walk-in Customer" : profile.name || user.name || user.email;
  const onlinePayment = !isWalkIn && input.paymentMethod === "gcash";
  const orderId = db.ref("orders").push().key;
  const [staffUserIds, ownerUserIds] = await Promise.all([
    userIdsForRoles(db, ["staff"]),
    userIdsForRoles(db, ["owner"])
  ]);
  const createdAt = Date.now();
  const order = {
    customerId,
    customerName,
    customerEmail: isWalkIn ? "" : user.email || profile.email || "",
    phone,
    phoneVerified,
    phoneVerifiedAt: phoneVerified ? Number(profile.phoneVerifiedAt || Date.now()) : null,
    smsNotifications,
    smsNotificationsRequested,
    address,
    landmark,
    deliveryLocation,
    deliveryType,
    notes: cleanText(input.notes, 300),
    paymentMethod: input.paymentMethod,
    subtotal,
    discount,
    discountReason,
    deliveryFee: fee,
    total,
    cashReceived: isWalkIn && input.paymentMethod === "cash" ? cashReceived : null,
    changeDue: isWalkIn && input.paymentMethod === "cash" ? cashReceived - total : 0,
    diningOption: isWalkIn ? cleanText(input.diningOption, 40) || "dine-in" : deliveryType,
    cashierId: isWalkIn ? user.uid : null,
    cashierName: isWalkIn ? user.name || user.email : "",
    items,
    createdAt,
    status: onlinePayment ? "pending-payment" : "received",
    paymentStatus: onlinePayment ? "pending" : input.paymentMethod === "cod" ? "cod-pending" : "paid",
    paymentProvider: onlinePayment ? "paymongo" : input.paymentMethod,
    paymentRequiredAt: onlinePayment ? createdAt : null,
    paymentConfirmedAt: onlinePayment ? null : createdAt,
    handoffOtp: deliveryType === "delivery" ? deliveryOtp() : null,
    source: isWalkIn ? "walk-in-pos" : "online"
  };
  if (!isWalkIn && !isValidPhilippineMobile(order.phone)) throw new HttpError(400, "Enter a valid Philippine mobile number.");
  if (deliveryType === "delivery" && !order.address) throw new HttpError(400, "A delivery address is required.");
  if (user.role === "customer" && deliveryType === "delivery" && !order.deliveryLocation) throw new HttpError(400, "Confirm the delivery pin before placing the order.");

  const requestHash = orderRequestFingerprint(user, input);
  const orderClaim = await claimOrderCreation(db, user, input.idempotencyKey, requestHash);
  if (orderClaim.existing) return orderClaim.existing;

  let transactionError;
  const transaction = await transactionWithInitial(inventoryRef, inventorySnapshot.val(), (inventory) => {
    if (!inventory) {
      transactionError = "Inventory is unavailable.";
      return undefined;
    }
    const nextInventory = { ...inventory };
    for (const item of items) {
      const current = Number(inventory[item.id]?.stock);
      if (!Number.isFinite(current) || current < item.qty) {
        transactionError = `${item.name} only has ${Number.isFinite(current) ? current : 0} item(s) available.`;
        return undefined;
      }
      nextInventory[item.id] = { ...inventory[item.id], stock: current - item.qty };
    }
    return nextInventory;
  });

  if (!transaction.committed) {
    await releaseOrderCreationClaim(db, orderClaim);
    throw new HttpError(409, transactionError || "The order could not be completed.");
  }

  const committedInventory = transaction.snapshot.val() || {};

  const paymentMovementId = db.ref(`paymentMovements/${orderId}`).push().key;
  const updates = {
    [`orders/${orderId}`]: order,
    [`paymentMovements/${orderId}/${paymentMovementId}`]: paymentMovementRecord({
      orderId,
      order,
      user,
      createdAt,
      reason: "order_created"
    }),
    [`auditLogs/AUD-${createdAt}-${orderId}`]: {
      action: "order_created",
      orderId,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      total,
      createdAt
    },
    ...notificationUpdates(db, customerId === "walk-in" ? [] : [customerId], {
      title: onlinePayment ? "Payment pending" : "Order confirmed",
      message: onlinePayment ? `Order ${orderId} is waiting for GCash payment confirmation.` : `Order ${orderId} was received.`,
      type: "order",
      orderId,
      entityType: "order",
      entityId: orderId,
      actionView: "orders"
    }),
    ...notificationUpdates(db, onlinePayment ? [] : staffUserIds, {
      title: "New order received",
      message: `${orderId} from ${customerName} is waiting in the queue.`,
      type: "order",
      orderId,
      entityType: "order",
      entityId: orderId,
      actionView: "staff-orders"
    }),
    ...notificationUpdates(db, onlinePayment ? [] : ownerUserIds, {
      title: "New sale recorded",
      message: `${orderId} added ${total} PHP to the live sales ledger.`,
      type: "sale",
      orderId,
      entityType: "payment",
      entityId: orderId,
      amount: total,
      actionView: "owner-sales"
    }),
    ...orderCreationAggregateUpdates(order, createdAt)
  };
  if (orderClaim.path) {
    updates[orderClaim.path] = {
      status: "complete",
      actorId: user.uid,
      orderId,
      requestHash,
      createdAt,
      expiresAt: retentionTimestamp(createdAt, 7)
    };
  }
  // erick: i-mirror ang nabawasang stock sa public/menu para live ang storefront availability.
  for (const item of items) {
    const afterStock = Number(committedInventory[item.id]?.stock ?? 0);
    const historyId = db.ref(`stockHistory/${item.id}`).push().key;
    updates[`public/menu/${item.id}/stock`] = afterStock;
    updates[`stockHistory/${item.id}/${historyId}`] = stockHistoryEntry({
      item,
      itemId: item.id,
      beforeStock: afterStock + Number(item.qty || 0),
      afterStock,
      delta: -Number(item.qty || 0),
      reason: `Order ${orderId}`,
      user,
      action: "order_deducted",
      orderId
    });
  }

  try {
    await db.ref().update(updates);
  } catch (error) {
    const rollbackSnapshot = await inventoryRef.once("value");
    const rollback = await transactionWithInitial(inventoryRef, rollbackSnapshot.val(), (inventory) => {
      if (!inventory) return inventory;
      const restored = { ...inventory };
      for (const item of items) {
        const current = Number(inventory[item.id]?.stock || 0);
        restored[item.id] = { ...inventory[item.id], stock: current + item.qty };
      }
      return restored;
    });
    // erick: ibalik din ang public/menu stock kapag na-rollback ang order.
    const restoredInventory = rollback.snapshot?.val() || {};
    const menuRestore = {};
    for (const item of items) {
      menuRestore[`public/menu/${item.id}/stock`] = Number(restoredInventory[item.id]?.stock ?? 0);
    }
    await db.ref().update(menuRestore).catch(() => {});
    await releaseOrderCreationClaim(db, orderClaim);
    throw error;
  }
  return { id: orderId, order };
}

export async function updateOrderRecord(db, user, orderId, input) {
  if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
  if (input.status === "delivered" && input.proofOfDeliveryRef) {
    const expectedRef = `deliveryProofs/${orderId}`;
    if (input.proofOfDeliveryRef !== expectedRef) throw new HttpError(400, "Invalid delivery proof reference.");
    const proof = (await db.ref(expectedRef).once("value")).val();
    if (!proof || proof.riderId !== user.uid) throw new HttpError(403, "A verified delivery proof is required.");
  }
  const orderRef = db.ref(`orders/${orderId}`);
  const initialOrder = (await orderRef.once("value")).val();
  if (!initialOrder) throw new HttpError(404, "Order not found.");
  if (
    cancellationRequested(input) &&
    initialOrder.status === "cancelled" &&
    initialOrder.cancellationRecoveryId &&
    !initialOrder.inventoryRestoredAt
  ) {
    if (!canFinalizeCancellation(user, initialOrder)) throw new HttpError(403, "You cannot finalize this cancellation.");
    const previous = { ...initialOrder, status: initialOrder.statusBeforeCancellation || "received" };
    const changes = {
      status: "cancelled",
      cancelReason: initialOrder.cancelReason,
      cancelledAt: initialOrder.cancelledAt,
      cancelledBy: initialOrder.cancelledBy,
      cancelledByRole: initialOrder.cancelledByRole,
      updatedAt: initialOrder.updatedAt
    };
    const order = await finalizeCancelledOrder(db, user, orderId, previous, initialOrder, changes);
    return { order, changes: { ...changes, inventoryRestoredAt: order.inventoryRestoredAt } };
  }
  let previous;
  let changes;
  let updateError;
  const cancellationRecoveryId = randomUUID();
  const transaction = await transactionWithInitial(orderRef, initialOrder, (order) => {
    if (!order) {
      updateError = new HttpError(404, "Order not found.");
      return undefined;
    }
    previous = { ...order };
    try {
      changes = authorizeOrderUpdate(user, order, input);
      if (changes.status === "cancelled") {
        changes = {
          ...changes,
          statusBeforeCancellation: order.status,
          cancellationRecoveryId
        };
      }
    } catch (error) {
      updateError = error;
      return undefined;
    }
    return { ...order, ...changes };
  });
  if (!transaction.committed) throw updateError || new HttpError(409, "The order changed before this update was applied.");

  let order = transaction.snapshot.val();
  if (changes.status === "cancelled") {
    order = await finalizeCancelledOrder(db, user, orderId, previous, order, changes);
    return { order, changes: { ...changes, inventoryRestoredAt: order.inventoryRestoredAt } };
  }
  const now = Date.now();
  let autoAssignedRider = null;
  if (
    order.status === "ready" &&
    order.deliveryType === "delivery" &&
    !order.riderId &&
    previous.status !== "ready"
  ) {
    autoAssignedRider = await chooseLeastBusyRider(db);
    if (autoAssignedRider) {
      const riderName = autoAssignedRider.name || autoAssignedRider.email || "Rider";
      const assignment = await transactionWithInitial(orderRef, order, (current) => {
        if (!current || current.status !== "ready" || current.riderId) return undefined;
        return {
          ...current,
          riderId: autoAssignedRider.uid,
          riderName,
          assignedAt: now,
          assignedBy: "system",
          assignmentMode: "auto"
        };
      });
      if (assignment.committed) {
        order = assignment.snapshot.val();
        changes.riderId = autoAssignedRider.uid;
        changes.riderName = riderName;
        changes.assignedAt = now;
      } else {
        autoAssignedRider = null;
        order = (await orderRef.once("value")).val();
      }
    }
  }
  const updates = {
    [`auditLogs/AUD-${now}-${orderId}`]: {
      action: "order_updated",
      orderId,
      status: changes.status || null,
      details: auditDetails(previous, order, ["status", "riderId", "riderName", "paymentStatus", "cancelReason", "refundStatus", "codHandoffRequestedAt", "codRemittedAt"]),
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: now
    }
  };
  updates[`availableDeliveries/${orderId}`] = availableDeliveryProjection(orderId, order);
  Object.assign(updates, orderTransitionAggregateUpdates(previous, order, now));
  if (previous.paymentStatus !== order.paymentStatus) {
    const movementId = db.ref(`paymentMovements/${orderId}`).push().key;
    updates[`paymentMovements/${orderId}/${movementId}`] = paymentMovementRecord({
      orderId,
      order,
      previousStatus: previous.paymentStatus || null,
      user,
      createdAt: now,
      reason: changes.codRemittedAt ? "cod_remitted" : changes.status || "payment_updated"
    });
  }
  if (autoAssignedRider) {
    updates[`orders/${orderId}/riderId`] = autoAssignedRider.uid;
    updates[`orders/${orderId}/riderName`] = order.riderName;
    updates[`orders/${orderId}/assignedAt`] = now;
    updates[`orders/${orderId}/assignedBy`] = "system";
    updates[`orders/${orderId}/assignmentMode`] = "auto";
    updates[`auditLogs/AUD-${now}-${orderId}-auto-rider`] = {
      action: "rider_auto_assigned",
      orderId,
      actorId: "system",
      actorName: "System",
      actorRole: "system",
      details: { after: { riderId: autoAssignedRider.uid, riderName: order.riderName } },
      createdAt: now
    };
  }
  if (changes.status && order.customerId !== "walk-in") {
    Object.assign(updates, notificationUpdates(db, [order.customerId], {
      title: "Order status updated",
      message: `${orderId} is now ${changes.status.replaceAll("-", " ")}.`,
      type: "order",
      orderId,
      entityType: "order",
      entityId: orderId,
      actionView: "orders"
    }));
  }
  if (changes.riderId && changes.riderId !== previous.riderId) {
    Object.assign(updates, notificationUpdates(db, [changes.riderId], {
      title: "Delivery assigned",
      message: `${orderId} has been assigned to you.`,
      type: "delivery",
      orderId,
      entityType: "delivery",
      entityId: orderId,
      actionView: "rider-orders"
    }));
  }
  if (changes.deliveryIssue) {
    const ownerIds = await userIdsForRoles(db, ["owner", "staff"]);
    Object.assign(updates, notificationUpdates(db, ownerIds, {
      title: "Delivery issue reported",
      message: `${orderId}: ${changes.deliveryIssue}`,
      type: "delivery",
      orderId,
      entityType: "delivery",
      entityId: orderId
    }));
  }
  if (changes.codRemittedAt) {
    const ownerIds = await userIdsForRoles(db, ["owner"]);
    Object.assign(updates, notificationUpdates(db, ownerIds, {
      title: "COD remitted",
      message: `${orderId} COD cash was marked as remitted.`,
      type: "sale",
      orderId,
      entityType: "payment",
      entityId: orderId,
      amount: Number(order.total || 0),
      actionView: "owner-sales"
    }));
  }
  await db.ref().update(updates);
  return { order, changes };
}

async function claimOrderCreation(db, user, requestedKey, requestHash) {
  const key = normalizeIdempotencyKey(requestedKey);
  if (requestedKey && !key) throw new HttpError(400, "Invalid order request key.");
  if (!key) return { key: "", path: "", existing: null };
  const path = `idempotency/orderCreation/${user.uid}/${key}`;
  const claimRef = db.ref(path);
  const initial = (await claimRef.once("value")).val();
  if (initial?.requestHash && initial.requestHash !== requestHash) {
    throw new HttpError(409, "This order request key was already used for different order details.", { code: "IDEMPOTENCY_CONFLICT" });
  }
  if (initial?.orderId) {
    const order = (await db.ref(`orders/${initial.orderId}`).once("value")).val();
    if (order) return { key, path, existing: { id: initial.orderId, order, idempotent: true } };
  }

  const now = Date.now();
  const claimToken = randomUUID();
  let fingerprintConflict = false;
  const transaction = await transactionWithInitial(claimRef, initial, (current) => {
    if (current?.requestHash && current.requestHash !== requestHash) {
      fingerprintConflict = true;
      return undefined;
    }
    if (current?.orderId) return undefined;
    if (current?.status === "processing" && Number(current.expiresAt || 0) > now) return undefined;
    return {
      status: "processing",
      actorId: user.uid,
      requestHash,
      claimToken,
      createdAt: now,
      expiresAt: now + 10 * 60 * 1000
    };
  });
  if (!transaction.committed) {
    const current = (await claimRef.once("value")).val();
    if (fingerprintConflict || (current?.requestHash && current.requestHash !== requestHash)) {
      throw new HttpError(409, "This order request key was already used for different order details.", { code: "IDEMPOTENCY_CONFLICT" });
    }
    if (current?.orderId) {
      const order = (await db.ref(`orders/${current.orderId}`).once("value")).val();
      if (order) return { key, path, existing: { id: current.orderId, order, idempotent: true } };
    }
    throw new HttpError(409, "This order request is already being processed. Please wait a moment and retry.");
  }
  return { key, path, requestHash, claimToken, existing: null };
}

async function releaseOrderCreationClaim(db, claim) {
  if (!claim?.path || !claim.claimToken) return;
  const claimRef = db.ref(claim.path);
  const initial = (await claimRef.once("value")).val();
  await transactionWithInitial(claimRef, initial, (current) => {
    if (!current || current.claimToken !== claim.claimToken || current.status !== "processing") return undefined;
    return null;
  }).catch(() => {});
}

export async function createMenuItemRecord(db, user, input = {}) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  const name = cleanText(input.name, 120);
  const category = cleanText(input.category || "Favorite Meal", 80);
  const description = cleanText(input.description || "Menu item.", 220);
  const id = slugifyId(input.id || name);
  if (!name || !category) throw new HttpError(400, "Menu name and category are required.");
  if (!validRecordId(id)) throw new HttpError(400, "Enter a valid menu item ID.");
  const price = Number(input.price || 0);
  const stock = Number(input.stock || 0);
  const reorderPoint = Number(input.reorderPoint ?? 10);
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw new HttpError(400, "Enter a valid price.");
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw new HttpError(400, "Enter a valid stock count.");
  if (!Number.isInteger(reorderPoint) || reorderPoint < 0 || reorderPoint > 10000) throw new HttpError(400, "Enter a valid reorder point.");
  const itemRef = db.ref(`public/menu/${id}`);
  if ((await itemRef.once("value")).exists()) throw new HttpError(409, "A menu item with this ID already exists.");
  const createdAt = Date.now();
  const item = {
    id,
    name,
    category,
    description,
    price,
    stock,
    reorderPoint,
    availability: parseAvailability(input.availability),
    allergens: Array.isArray(input.allergens) ? input.allergens.map((value) => cleanText(value, 40)).filter(Boolean).slice(0, 8) : [],
    featured: Boolean(input.featured),
    walkInOnly: Boolean(input.walkInOnly),
    unavailable: Boolean(input.unavailable),
    image: cleanText(input.image, 300),
    imagePosition: cleanText(input.imagePosition, 40) || "center",
    createdAt,
    createdBy: user.uid,
    updatedAt: createdAt,
    updatedBy: user.uid
  };
  await db.ref().update({
    [`public/menu/${id}`]: item,
    [`inventory/${id}`]: { name, category, price, stock, reorderPoint, availability: item.availability, unavailable: item.unavailable, createdAt },
    [`stockHistory/${id}/${db.ref(`stockHistory/${id}`).push().key}`]: stockHistoryEntry({
      item,
      itemId: id,
      beforeStock: 0,
      afterStock: stock,
      delta: stock,
      reason: "Initial menu stock",
      user,
      action: "menu_item_created"
    }),
    [`auditLogs/${db.ref("auditLogs").push().key}`]: {
      action: "menu_item_created",
      itemId: id,
      itemName: name,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt
    }
  });
  return { item };
}

export async function updateMenuItemRecord(db, user, itemId, input = {}) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  if (!validRecordId(itemId)) throw new HttpError(400, "Invalid menu item ID.");
  const [menuSnapshot, inventorySnapshot] = await Promise.all([
    db.ref(`public/menu/${itemId}`).once("value"),
    db.ref(`inventory/${itemId}`).once("value")
  ]);
  const currentMenu = menuSnapshot.val();
  const currentInventory = inventorySnapshot.val() || {};
  if (!currentMenu) throw new HttpError(404, "Menu item not found.");
  const price = input.price !== undefined ? Number(input.price) : Number(currentMenu.price || 0);
  const reorderPoint = input.reorderPoint !== undefined ? Number(input.reorderPoint) : Number(currentInventory.reorderPoint ?? currentMenu.reorderPoint ?? 10);
  const stock = input.stock !== undefined ? Number(input.stock) : Number(currentInventory.stock ?? currentMenu.stock ?? 0);
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw new HttpError(400, "Enter a valid price.");
  if (!Number.isInteger(reorderPoint) || reorderPoint < 0 || reorderPoint > 10000) throw new HttpError(400, "Enter a valid reorder point.");
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw new HttpError(400, "Enter a valid stock count.");
  const name = cleanText(input.name ?? currentMenu.name, 120);
  const category = cleanText(input.category ?? currentMenu.category, 80);
  const description = cleanText(input.description ?? currentMenu.description, 220);
  if (!name || !category) throw new HttpError(400, "Menu name and category are required.");
  const item = {
    ...currentMenu,
    name,
    category,
    description,
    price,
    stock,
    reorderPoint,
    availability: input.availability !== undefined ? parseAvailability(input.availability) : currentMenu.availability || { mode: "always", days: [], start: "00:00", end: "23:59" },
    walkInOnly: input.walkInOnly !== undefined ? Boolean(input.walkInOnly) : Boolean(currentMenu.walkInOnly),
    unavailable: input.unavailable !== undefined ? Boolean(input.unavailable) : Boolean(currentMenu.unavailable),
    updatedAt: Date.now(),
    updatedBy: user.uid
  };
  await db.ref().update({
    [`public/menu/${itemId}`]: item,
    [`inventory/${itemId}`]: {
      ...currentInventory,
      name,
      category,
      price,
      stock,
      reorderPoint,
      availability: item.availability,
      unavailable: item.unavailable,
      updatedAt: item.updatedAt
    },
    [`auditLogs/${db.ref("auditLogs").push().key}`]: {
      action: "menu_item_updated",
      itemId,
      itemName: name,
      details: auditDetails({ ...currentMenu, stock: currentInventory.stock }, item, ["name", "category", "description", "price", "stock", "reorderPoint", "availability", "walkInOnly", "unavailable"]),
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: Date.now()
    },
    [`stockHistory/${itemId}/${db.ref(`stockHistory/${itemId}`).push().key}`]: stockHistoryEntry({
      item,
      itemId,
      beforeStock: Number(currentInventory.stock ?? currentMenu.stock ?? 0),
      afterStock: stock,
      delta: stock - Number(currentInventory.stock ?? currentMenu.stock ?? 0),
      reason: "Owner menu stock edit",
      user,
      action: "menu_stock_updated"
    })
  });
  return { item: { id: itemId, ...item } };
}

export async function updateReviewRecord(db, user, reviewId, input = {}) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  if (!validRecordId(reviewId)) throw new HttpError(400, "Invalid review ID.");
  const status = cleanText(input.moderationStatus, 40);
  if (!["pending", "approved", "hidden"].includes(status)) throw new HttpError(400, "Unsupported review status.");
  const reply = cleanText(input.reply, 500);
  const reviewRef = db.ref(`reviews/${reviewId}`);
  const review = (await reviewRef.once("value")).val();
  if (!review) throw new HttpError(404, "Review not found.");
  const updatedAt = Date.now();
  const publicReview = status === "approved"
    ? {
        orderId: review.orderId || reviewId,
        customerLabel: "Verified customer",
        rating: Number(review.rating || 0),
        comment: cleanText(review.comment, 1000),
        items: Array.isArray(review.items) ? review.items.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 3) : [],
        moderationStatus: "approved",
        createdAt: Number(review.createdAt || updatedAt)
      }
    : null;
  await db.ref().update({
    [`reviews/${reviewId}/moderationStatus`]: status,
    [`reviews/${reviewId}/reply`]: reply,
    [`reviews/${reviewId}/moderatedAt`]: updatedAt,
    [`reviews/${reviewId}/moderatedBy`]: user.uid,
    [`public/reviews/${reviewId}`]: publicReview,
    [`auditLogs/${db.ref("auditLogs").push().key}`]: {
      action: "review_moderated",
      reviewId,
      orderId: review.orderId || reviewId,
      status,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: updatedAt
    }
  });
  return { review: { id: reviewId, ...review, moderationStatus: status, reply, moderatedAt: updatedAt, moderatedBy: user.uid } };
}

export async function listComplaintsRecord(db, user) {
  const complaintsRef = user.role === "customer"
    ? db.ref("complaints").orderByChild("customerId").equalTo(user.uid)
    : db.ref("complaints");
  const complaints = Object.entries((await complaintsRef.once("value")).val() || {})
    .map(([id, complaint]) => ({ id, ...complaint }))
    .filter((complaint) => user.role !== "customer" || complaint.customerId === user.uid)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (!["owner", "staff", "customer"].includes(user.role)) throw new HttpError(403, "Complaint access requires an operations or customer role.");
  return { complaints };
}

export async function createComplaintRecord(db, user, input = {}) {
  if (user.role !== "customer") throw new HttpError(403, "Customer access required.");
  const orderId = cleanText(input.orderId, 128);
  if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db.ref(`orders/${orderId}`).once("value")).val();
  if (!order || order.customerId !== user.uid) throw new HttpError(403, "This order is not yours.");
  const type = cleanText(input.type, 40);
  if (!["wrong-item", "missing-item", "late-order", "bad-food"].includes(type)) throw new HttpError(400, "Unsupported complaint type.");
  const details = cleanText(input.details, 700);
  if (!details) throw new HttpError(400, "Complaint details are required.");
  const now = Date.now();
  const id = db.ref("complaints").push().key;
  const complaint = {
    orderId,
    customerId: user.uid,
    customerName: order.customerName || user.name || user.email,
    type,
    details,
    requestedResolution: cleanText(input.requestedResolution, 220),
    status: "pending",
    items: (order.items || []).map((item) => item.name).slice(0, 20),
    createdAt: now
  };
  const staffAndOwnerIds = await userIdsForRoles(db, ["owner", "staff"]);
  await db.ref().update({
    [`complaints/${id}`]: complaint,
    [`auditLogs/AUD-${now}-${id}`]: {
      action: "complaint_created",
      complaintId: id,
      orderId,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: now
    },
    ...notificationUpdates(db, staffAndOwnerIds, {
      title: "New order complaint",
      message: `${complaint.customerName} reported ${orderId}.`,
      type: "complaint",
      orderId,
      entityType: "complaint",
      entityId: id
    })
  });
  return { id, complaint };
}

export async function updateComplaintRecord(db, user, complaintId, input = {}) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  if (!validRecordId(complaintId)) throw new HttpError(400, "Invalid complaint ID.");
  const complaint = (await db.ref(`complaints/${complaintId}`).once("value")).val();
  if (!complaint) throw new HttpError(404, "Complaint not found.");
  const status = cleanText(input.status || complaint.status || "pending", 40);
  if (!["pending", "reviewed", "resolved"].includes(status)) throw new HttpError(400, "Unsupported complaint status.");
  const now = Date.now();
  const updates = {
    [`complaints/${complaintId}/status`]: status,
    [`complaints/${complaintId}/resolution`]: cleanText(input.resolution, 700),
    [`complaints/${complaintId}/updatedAt`]: now,
    [`complaints/${complaintId}/resolvedBy`]: user.uid,
    [`complaints/${complaintId}/resolverName`]: user.name || user.email,
    [`auditLogs/AUD-${now}-${complaintId}`]: {
      action: "complaint_updated",
      complaintId,
      orderId: complaint.orderId,
      status,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: now
    },
    ...notificationUpdates(db, [complaint.customerId], {
      title: "Complaint updated",
      message: `${complaint.orderId} is now ${status}.`,
      type: "complaint",
      orderId: complaint.orderId,
      entityType: "complaint",
      entityId: complaintId,
      actionView: "orders"
    })
  };
  if (status === "reviewed") updates[`complaints/${complaintId}/reviewedAt`] = now;
  if (status === "resolved") updates[`complaints/${complaintId}/resolvedAt`] = now;
  await db.ref().update(updates);
  return { id: complaintId, complaint: { id: complaintId, ...complaint, status, resolution: cleanText(input.resolution, 700), updatedAt: now } };
}

export async function adjustInventoryRecord(db, user, itemId, input) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  if (!validRecordId(itemId)) throw new HttpError(400, "Invalid inventory item ID.");
  const delta = Number(input.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000) {
    throw new HttpError(400, "Inventory adjustment must be a non-zero whole number up to 1000.");
  }
  const reason = cleanText(input.reason, 120);
  if (!reason) throw new HttpError(400, "An adjustment reason is required.");
  const itemRef = db.ref(`inventory/${itemId}`);
  const initialItem = (await itemRef.once("value")).val();
  if (!initialItem) throw new HttpError(404, "Inventory item not found.");
  const beforeStock = Number(initialItem.stock || 0);
  let failure;
  const result = await transactionWithInitial(itemRef, initialItem, (item) => {
    if (!item) {
      failure = "Inventory item not found.";
      return undefined;
    }
    const nextStock = Number(item.stock || 0) + delta;
    if (nextStock < 0) {
      failure = `Only ${item.stock || 0} item(s) are available.`;
      return undefined;
    }
    return { ...item, stock: nextStock };
  });
  if (!result.committed) throw new HttpError(failure === "Inventory item not found." ? 404 : 409, failure || "Inventory was not updated.");
  const item = result.snapshot.val();
  // erick: i-sync ang public/menu stock sa manual na adjustment.
  await db.ref(`public/menu/${itemId}/stock`).set(Number(item.stock || 0));
  const updates = {
    [`auditLogs/${db.ref("auditLogs").push().key}`]: {
    action: delta > 0 ? "inventory_received" : "inventory_adjusted",
    itemId,
    itemName: item.name,
    quantity: delta,
    reason,
    details: { before: { stock: beforeStock }, after: { stock: Number(item.stock || 0) } },
    actorId: user.uid,
    actorName: user.name || user.email,
    actorRole: user.role,
    createdAt: Date.now()
    },
    [`stockHistory/${itemId}/${db.ref(`stockHistory/${itemId}`).push().key}`]: stockHistoryEntry({
      item,
      itemId,
      beforeStock,
      afterStock: Number(item.stock || 0),
      delta,
      reason,
      user,
      action: delta > 0 ? "inventory_received" : "inventory_adjusted"
    })
  };
  if (Number(item.stock || 0) <= Number(item.reorderPoint || 10)) {
    const ownerIds = await userIdsForRoles(db, ["owner"]);
    Object.assign(updates, notificationUpdates(db, [...ownerIds, user.uid], {
      title: "Low stock alert",
      message: `${item.name} has ${item.stock || 0} item(s) remaining.`,
      type: "inventory",
      entityType: "inventory",
      entityId: itemId,
      displayReference: item.name
    }));
  }
  await db.ref().update(updates);
  return { item: { id: itemId, ...item } };
}

export async function saveShiftLogRecord(db, user, input) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  const numericFields = ["startedAt", "endedAt", "openingCash", "cashSales", "expectedCash", "actualCash", "variance", "orderCount", "cashIn", "cashOut", "expenses"];
  const entry = {};
  for (const field of numericFields) {
    const value = Number(input[field] || 0);
    if (!Number.isFinite(value)) throw new HttpError(400, `Invalid ${field}.`);
    entry[field] = value;
  }
  if (entry.startedAt > entry.endedAt || entry.orderCount < 0 || !Number.isInteger(entry.orderCount)) {
    throw new HttpError(400, "Invalid shift time or order count.");
  }
  const shiftId = db.ref("shiftLogs").push().key;
  const createdAt = Date.now();
  await db.ref().update({
    [`shiftLogs/${shiftId}`]: {
      ...entry,
      notes: cleanText(input.notes, 300),
      staffId: user.uid,
      staffName: user.name || user.email,
      createdAt
    },
    [`auditLogs/AUD-${createdAt}-${shiftId}`]: {
      action: "shift_closed",
      shiftLogId: shiftId,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt
    },
    ...notificationUpdates(db, [user.uid], {
      title: "Shift summary ready",
      message: `Your shift summary is ready with ${entry.orderCount} order(s) and a variance of ${entry.variance} PHP.`,
      type: "shift",
      entityType: "shift",
      actionView: "staff-shifts"
    })
  });
  return { id: shiftId };
}

export async function getActiveShiftRecord(db, user) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  const shift = (await db.ref(`activeShifts/${user.uid}`).once("value")).val();
  return { shift: shift ? { id: user.uid, ...shift } : null };
}

export async function startShiftRecord(db, user, input = {}) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  const activeRef = db.ref(`activeShifts/${user.uid}`);
  if ((await activeRef.once("value")).exists()) throw new HttpError(409, "You already have an active shift.");
  const openingCash = Number(input.openingCash || 0);
  if (!Number.isFinite(openingCash) || openingCash < 0 || openingCash > 1_000_000) throw new HttpError(400, "Enter a valid opening cash amount.");
  const startedAt = Date.now();
  const shift = {
    staffId: user.uid,
    staffName: user.name || user.email,
    openingCash,
    notes: cleanText(input.notes, 200),
    startedAt,
    createdAt: startedAt
  };
  await db.ref().update({
    [`activeShifts/${user.uid}`]: shift,
    [`auditLogs/AUD-${startedAt}-${user.uid}-shift-started`]: {
      action: "shift_started",
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      details: { after: { openingCash } },
      createdAt: startedAt
    }
  });
  return { shift: { id: user.uid, ...shift } };
}

export async function closeActiveShiftRecord(db, user, input = {}) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  const activeRef = db.ref(`activeShifts/${user.uid}`);
  const activeShift = (await activeRef.once("value")).val();
  if (!activeShift) throw new HttpError(409, "Start a shift before closing one.");
  const now = Date.now();
  const ordersQuery = user.role === "owner"
    ? db.ref("orders").orderByChild("source").equalTo("walk-in-pos")
    : db.ref("orders").orderByChild("cashierId").equalTo(user.uid);
  const orders = Object.values((await ordersQuery.once("value")).val() || {})
    .filter((order) => Number(order.createdAt || 0) >= Number(activeShift.startedAt || 0))
    .filter((order) => !order.archivedAt);
  const cashSales = orders
    .filter((order) => order.paymentMethod === "cash" || (order.paymentMethod === "cod" && ["delivered", "completed"].includes(order.status)))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const cashIn = Number(input.cashIn || 0);
  const cashOut = Number(input.cashOut || 0);
  const expenses = Number(input.expenses || 0);
  const actualCash = Number(input.actualCash || 0);
  for (const [label, value] of Object.entries({ cashIn, cashOut, expenses, actualCash })) {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new HttpError(400, `Enter a valid ${label} amount.`);
  }
  const openingCash = Number(activeShift.openingCash || 0);
  const expectedCash = openingCash + cashSales + cashIn - cashOut - expenses;
  const variance = actualCash - expectedCash;
  const shiftId = db.ref("shiftLogs").push().key;
  const log = {
    staffId: user.uid,
    staffName: user.name || user.email,
    startedAt: Number(activeShift.startedAt || now),
    endedAt: now,
    openingCash,
    cashSales,
    expectedCash,
    actualCash,
    variance,
    orderCount: orders.length,
    cashIn,
    cashOut,
    expenses,
    notes: cleanText(input.notes, 300),
    createdAt: now
  };
  await db.ref().update({
    [`shiftLogs/${shiftId}`]: log,
    [`activeShifts/${user.uid}`]: null,
    [`auditLogs/AUD-${now}-${shiftId}`]: {
      action: "shift_closed",
      shiftLogId: shiftId,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      details: { before: { activeShift }, after: { expectedCash, actualCash, variance, orderCount: orders.length } },
      createdAt: now
    },
    ...notificationUpdates(db, [user.uid], {
      title: "Shift summary ready",
      message: `Your shift summary is ready with ${orders.length} order(s) and a variance of ${variance} PHP.`,
      type: "shift",
      entityType: "shift",
      actionView: "staff-shifts"
    })
  });
  return { id: shiftId, log };
}

export async function createApprovalRequestRecord(db, user, input = {}) {
  const type = cleanText(input.type, 80);
  if (!["stock_correction", "void_order", "menu_price_change", "menu_visibility", "role_change"].includes(type)) {
    throw new HttpError(400, "Unsupported approval request.");
  }
  const reason = cleanText(input.reason, 300);
  if (!reason) throw new HttpError(400, "A reason is required.");
  const createdAt = Date.now();
  const requestId = db.ref("approvalRequests").push().key;
  const request = {
    type,
    reason,
    targetId: cleanText(input.targetId, 128),
    payload: cloneData(input.payload || {}),
    status: "pending",
    requesterId: user.uid,
    requesterName: user.name || user.email,
    requesterRole: user.role,
    createdAt
  };
  await db.ref().update({
    [`approvalRequests/${requestId}`]: request,
    [`auditLogs/AUD-${createdAt}-${requestId}`]: {
      action: "approval_requested",
      approvalId: requestId,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      details: { after: { type, targetId: request.targetId, reason } },
      createdAt
    }
  });
  return { id: requestId, request };
}

export async function listApprovalRequestsRecord(db, user) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  const requestsRef = user.role === "staff"
    ? db.ref("approvalRequests").orderByChild("requesterId").equalTo(user.uid)
    : db.ref("approvalRequests");
  const requests = Object.entries((await requestsRef.once("value")).val() || {})
    .map(([id, request]) => ({ id, ...request }))
    .filter((request) => user.role === "owner" || request.requesterId === user.uid)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return { requests };
}

export async function resolveApprovalRequestRecord(db, user, requestId, input = {}) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  if (!validRecordId(requestId)) throw new HttpError(400, "Invalid approval ID.");
  const requestRef = db.ref(`approvalRequests/${requestId}`);
  const request = (await requestRef.once("value")).val();
  if (!request) throw new HttpError(404, "Approval request not found.");
  if (request.status !== "pending") throw new HttpError(409, "This request was already reviewed.");
  const decision = input.decision === "approved" ? "approved" : "rejected";
  const now = Date.now();
  const updates = {
    [`approvalRequests/${requestId}/status`]: decision,
    [`approvalRequests/${requestId}/reviewedAt`]: now,
    [`approvalRequests/${requestId}/reviewedBy`]: user.uid,
    [`approvalRequests/${requestId}/reviewerName`]: user.name || user.email,
    [`approvalRequests/${requestId}/reviewNote`]: cleanText(input.note, 240),
    [`auditLogs/AUD-${now}-${requestId}`]: {
      action: decision === "approved" ? "approval_approved" : "approval_rejected",
      approvalId: requestId,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      details: { before: { status: "pending" }, after: { status: decision, type: request.type, targetId: request.targetId } },
      createdAt: now
    }
  };

  if (decision === "approved") {
    if (request.type === "stock_correction") {
      const itemId = cleanText(request.payload?.itemId || request.targetId, 128);
      if (!validRecordId(itemId)) throw new HttpError(400, "Invalid inventory item ID.");
      const inventory = (await db.ref(`inventory/${itemId}`).once("value")).val();
      if (!inventory) throw new HttpError(404, "Inventory item not found.");
      const beforeStock = Number(inventory.stock || 0);
      const countedStock = Number(request.payload?.countedStock);
      if (!Number.isInteger(countedStock) || countedStock < 0 || countedStock > 100000) throw new HttpError(400, "Invalid counted stock.");
      updates[`inventory/${itemId}/stock`] = countedStock;
      updates[`public/menu/${itemId}/stock`] = countedStock;
      updates[`stockHistory/${itemId}/${db.ref(`stockHistory/${itemId}`).push().key}`] = stockHistoryEntry({
        item: inventory,
        itemId,
        beforeStock,
        afterStock: countedStock,
        delta: countedStock - beforeStock,
        reason: request.reason,
        user,
        action: "stock_count_approved"
      });
    }
    if (request.type === "menu_price_change") {
      const itemId = cleanText(request.payload?.itemId || request.targetId, 128);
      const menuItem = (await db.ref(`public/menu/${itemId}`).once("value")).val();
      if (!menuItem) throw new HttpError(404, "Menu item not found.");
      const price = Number(request.payload?.price);
      if (!Number.isFinite(price) || price < 0 || price > 100000) throw new HttpError(400, "Invalid price.");
      updates[`public/menu/${itemId}/price`] = price;
      updates[`inventory/${itemId}/price`] = price;
    }
    if (request.type === "menu_visibility") {
      const itemId = cleanText(request.payload?.itemId || request.targetId, 128);
      const unavailable = Boolean(request.payload?.unavailable);
      updates[`public/menu/${itemId}/unavailable`] = unavailable;
      updates[`inventory/${itemId}/unavailable`] = unavailable;
    }
    if (request.type === "role_change") {
      const uid = cleanText(request.payload?.uid || request.targetId, 128);
      const role = cleanText(request.payload?.role, 30);
      if (!validRecordId(uid) || !["owner", "staff", "rider", "customer"].includes(role)) throw new HttpError(400, "Invalid role change.");
      const currentProfile = (await db.ref(`users/${uid}`).once("value")).val() || {};
      if (currentProfile.role === "owner" && role !== "owner") {
        const profiles = (await db.ref("users").once("value")).val() || {};
        const otherOwnerExists = Object.entries(profiles).some(([profileUid, profile]) => profileUid !== uid && profile?.role === "owner");
        if (!otherOwnerExists) throw new HttpError(409, "Assign another owner before removing the final owner account.");
      }
      const auth = getAuth();
      const account = await auth.getUser(uid);
      await auth.setCustomUserClaims(uid, { ...(account.customClaims || {}), role });
      await auth.revokeRefreshTokens(uid);
      updates[`users/${uid}/role`] = role;
      updates[`users/${uid}/sessionRevokedAt`] = now;
    }
    if (request.type === "void_order") {
      const orderId = cleanText(request.payload?.orderId || request.targetId, 128);
      if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
      await cancelOrderForApprovedVoid(db, user, orderId, request.reason, requestId);
    }
  }

  await db.ref().update(updates);
  return { id: requestId, status: decision };
}

export async function archiveCompletedOrdersRecord(db, user, input = {}) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  const olderThanDays = Math.max(1, Math.min(365, Number(input.olderThanDays || 30)));
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const terminalSnapshots = await Promise.all(
    ["delivered", "cancelled"].map((status) => db.ref("orders").orderByChild("status").equalTo(status).once("value"))
  );
  const orders = Object.assign({}, ...terminalSnapshots.map((snapshot) => snapshot.val() || {}));
  const updates = {};
  let archived = 0;
  let proofsPreserved = 0;
  for (const [orderId, order] of Object.entries(orders)) {
    if (order.archivedAt) continue;
    if (!["delivered", "cancelled"].includes(order.status)) continue;
    const referenceTime = Number(order.deliveredAt || order.cancelledAt || order.updatedAt || order.createdAt || 0);
    if (referenceTime > cutoff) continue;
    archived += 1;
    updates[`orders/${orderId}/archivedAt`] = Date.now();
    updates[`orderArchive/${orderId}`] = { ...order, archivedAt: Date.now(), archivedBy: user.uid };
    if (order.proofOfDeliveryRef) {
      proofsPreserved += 1;
      updates[`deliveryProofs/${orderId}/archivedWithOrderAt`] = Date.now();
    }
  }
  const createdAt = Date.now();
  updates[`auditLogs/AUD-${createdAt}-archive-orders`] = {
    action: "orders_archived",
    actorId: user.uid,
    actorName: user.name || user.email,
    actorRole: user.role,
    details: { after: { archived, proofsPreserved, olderThanDays } },
    createdAt
  };
  await db.ref().update(updates);
  return { archived, proofsPreserved };
}

export async function listOrdersForUser(db, user) {
  const ordersRef = db.ref("orders");
  let orders = {};
  let available = {};
  if (user.role === "customer") {
    orders = (await ordersRef.orderByChild("customerId").equalTo(user.uid).once("value")).val() || {};
  } else if (user.role === "rider") {
    const [assignedSnapshot, availableSnapshot] = await Promise.all([
      ordersRef.orderByChild("riderId").equalTo(user.uid).once("value"),
      db.ref("availableDeliveries").once("value")
    ]);
    orders = assignedSnapshot.val() || {};
    available = availableSnapshot.val() || {};
  } else if (["owner", "staff"].includes(user.role)) {
    orders = (await ordersRef.orderByChild("archivedAt").equalTo(null).once("value")).val() || {};
  } else {
    throw new HttpError(403, "Order access requires a supported role.");
  }

  const visibleOrders = Object.entries(orders)
    .map(([id, order]) => ({ id, ...order }))
    .filter((order) => !order.archivedAt)
    .filter((order) => canAccessOrder(user, order));
  if (user.role === "rider") {
    visibleOrders.push(...Object.entries(available).map(([id, order]) => ({ id, ...order, available: true })));
  }
  return visibleOrders.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
}

function pagedEqualQuery(ref, child, value, { limit, before }) {
  let result = ref.orderByChild(child).startAt(value);
  result = before ? result.endAt(value, before) : result.endAt(value);
  return result.limitToLast(limit + (before ? 2 : 1));
}

function pagedKeyQuery(ref, { limit, before }) {
  let result = ref.orderByKey();
  if (before) result = result.endAt(before);
  return result.limitToLast(limit + (before ? 2 : 1));
}

export async function listOrdersPageForUser(db, user, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
  const before = validRecordId(options.before) ? options.before : null;
  const ordersRef = db.ref("orders");
  let orders = {};
  let available = {};
  if (user.role === "customer") {
    orders = (await pagedEqualQuery(ordersRef, "customerId", user.uid, { limit, before }).once("value")).val() || {};
  } else if (user.role === "rider") {
    const [assignedSnapshot, availableSnapshot] = await Promise.all([
      pagedEqualQuery(ordersRef, "riderId", user.uid, { limit, before }).once("value"),
      pagedKeyQuery(db.ref("availableDeliveries"), { limit, before }).once("value")
    ]);
    orders = assignedSnapshot.val() || {};
    available = availableSnapshot.val() || {};
  } else if (["owner", "staff"].includes(user.role)) {
    orders = (await pagedEqualQuery(ordersRef, "archivedAt", null, { limit, before }).once("value")).val() || {};
  } else {
    throw new HttpError(403, "Order access requires a supported role.");
  }

  const visibleOrders = Object.entries(orders)
    .map(([id, order]) => ({ id, ...order }))
    .filter((order) => !order.archivedAt)
    .filter((order) => canAccessOrder(user, order));
  if (user.role === "rider") {
    visibleOrders.push(...Object.entries(available).map(([id, order]) => ({ id, ...order, available: true })));
  }
  const unique = [...new Map(visibleOrders.map((order) => [order.id, order])).values()]
    .filter((order) => order.id !== before)
    .sort((left, right) => String(right.id).localeCompare(String(left.id)));
  const hasMore = unique.length > limit;
  const selected = unique.slice(0, limit);
  const nextCursor = hasMore && selected.length ? selected.at(-1).id : null;
  return {
    orders: selected.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0)),
    pagination: { limit, nextCursor }
  };
}
