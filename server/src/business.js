import {
  authorizeOrderUpdate,
  canAccessOrder,
  HttpError,
  validRecordId,
  validateDeliveryProof,
  validateLocation,
  validateOrderItems
} from "./security.js";
import { getAuth } from "firebase-admin/auth";
import { notificationUpdates, userIdsForRoles } from "./notifications.js";

const deliveryFee = 49;
const paymentMethods = ["gcash", "cod", "cash"];

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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
  const [usersSnapshot, ordersSnapshot] = await Promise.all([
    db.ref("users").once("value"),
    db.ref("orders").once("value")
  ]);
  const riders = Object.entries(usersSnapshot.val() || {})
    .map(([uid, profile]) => ({ uid, ...profile }))
    .filter((profile) => profile.role === "rider");
  if (riders.length === 0) return null;
  const activeCounts = new Map(riders.map((rider) => [rider.uid, 0]));
  for (const order of Object.values(ordersSnapshot.val() || {})) {
    if (order.riderId && activeDeliveryStatuses.has(order.status) && activeCounts.has(order.riderId)) {
      activeCounts.set(order.riderId, activeCounts.get(order.riderId) + 1);
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
  const discount = isWalkIn ? Math.max(0, Math.min(subtotal, Number(input.discount || 0))) : 0;
  if (!Number.isFinite(discount)) throw new HttpError(400, "Enter a valid discount.");
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
    phone: cleanText(input.phone, 40),
    address: isWalkIn ? "Counter" : deliveryType === "pickup" ? "Store pickup" : cleanText(input.address, 300),
    deliveryType,
    notes: cleanText(input.notes, 300),
    paymentMethod: input.paymentMethod,
    subtotal,
    discount,
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
    source: isWalkIn ? "walk-in-pos" : "online"
  };
  if (!isWalkIn && !order.phone) throw new HttpError(400, "A phone number is required.");
  if (deliveryType === "delivery" && !order.address) throw new HttpError(400, "A delivery address is required.");

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

  if (!transaction.committed) throw new HttpError(409, transactionError || "The order could not be completed.");

  const committedInventory = transaction.snapshot.val() || {};

  const updates = {
    [`orders/${orderId}`]: order,
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
      orderId
    }),
    ...notificationUpdates(db, onlinePayment ? [] : staffUserIds, {
      title: "New order received",
      message: `${orderId} from ${customerName} is waiting in the queue.`,
      type: "order",
      orderId
    }),
    ...notificationUpdates(db, onlinePayment ? [] : ownerUserIds, {
      title: "New sale recorded",
      message: `${orderId} added ${total} PHP to the live sales ledger.`,
      type: "sale",
      orderId
    })
  };
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
  let previous;
  let changes;
  let updateError;
  const transaction = await transactionWithInitial(orderRef, initialOrder, (order) => {
    if (!order) {
      updateError = new HttpError(404, "Order not found.");
      return undefined;
    }
    previous = { ...order };
    try {
      changes = authorizeOrderUpdate(user, order, input);
    } catch (error) {
      updateError = error;
      return undefined;
    }
    return { ...order, ...changes };
  });
  if (!transaction.committed) throw updateError || new HttpError(409, "The order changed before this update was applied.");

  const order = transaction.snapshot.val();
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
      order.riderId = autoAssignedRider.uid;
      order.riderName = autoAssignedRider.name || autoAssignedRider.email || "Rider";
      order.assignedAt = now;
      order.assignedBy = "system";
      order.assignmentMode = "auto";
      changes.riderId = autoAssignedRider.uid;
      changes.riderName = order.riderName;
      changes.assignedAt = now;
    }
  }
  const updates = {
    [`auditLogs/AUD-${now}-${orderId}`]: {
      action: "order_updated",
      orderId,
      status: changes.status || null,
      details: auditDetails(previous, order, ["status", "riderId", "riderName", "paymentStatus", "cancelReason", "refundStatus", "codRemittedAt"]),
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: now
    }
  };
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
      orderId
    }));
  }
  if (changes.riderId && changes.riderId !== previous.riderId) {
    Object.assign(updates, notificationUpdates(db, [changes.riderId], {
      title: "Delivery assigned",
      message: `${orderId} has been assigned to you.`,
      type: "delivery",
      orderId
    }));
  }
  if (changes.deliveryIssue) {
    const ownerIds = await userIdsForRoles(db, ["owner", "staff"]);
    Object.assign(updates, notificationUpdates(db, ownerIds, {
      title: "Delivery issue reported",
      message: `${orderId}: ${changes.deliveryIssue}`,
      type: "delivery",
      orderId
    }));
  }
  if (changes.status === "cancelled" && previous.status !== "cancelled") {
    const inventoryRef = db.ref("inventory");
    const inventorySnapshot = await inventoryRef.once("value");
    const restoredInventory = {};
    for (const item of previous.items || []) {
      const current = inventorySnapshot.child(`${item.id}/stock`).val();
      const nextStock = Number(current || 0) + Number(item.qty || 0);
      const historyId = db.ref(`stockHistory/${item.id}`).push().key;
      restoredInventory[`inventory/${item.id}/stock`] = nextStock;
      restoredInventory[`public/menu/${item.id}/stock`] = nextStock;
      restoredInventory[`stockHistory/${item.id}/${historyId}`] = stockHistoryEntry({
        item,
        itemId: item.id,
        beforeStock: Number(current || 0),
        afterStock: nextStock,
        delta: Number(item.qty || 0),
        reason: `Cancelled order ${orderId}`,
        user,
        action: "order_cancel_restored",
        orderId
      });
    }
    Object.assign(updates, restoredInventory);
    if (order.customerId !== "walk-in") {
      Object.assign(updates, notificationUpdates(db, [order.customerId], {
        title: "Order cancelled",
        message: `${orderId} was cancelled: ${changes.cancelReason}.`,
        type: "order",
        orderId
      }));
    }
  }
  if (changes.codRemittedAt) {
    const ownerIds = await userIdsForRoles(db, ["owner"]);
    Object.assign(updates, notificationUpdates(db, ownerIds, {
      title: "COD remitted",
      message: `${orderId} COD cash was marked as remitted.`,
      type: "sale",
      orderId
    }));
  }
  await db.ref().update(updates);
  return { order, changes };
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
    [`inventory/${id}`]: { name, category, price, stock, reorderPoint, unavailable: item.unavailable, createdAt },
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
      unavailable: item.unavailable,
      updatedAt: item.updatedAt
    },
    [`auditLogs/${db.ref("auditLogs").push().key}`]: {
      action: "menu_item_updated",
      itemId,
      itemName: name,
      details: auditDetails({ ...currentMenu, stock: currentInventory.stock }, item, ["name", "category", "description", "price", "stock", "reorderPoint", "walkInOnly", "unavailable"]),
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
  await db.ref().update({
    [`reviews/${reviewId}/moderationStatus`]: status,
    [`reviews/${reviewId}/reply`]: reply,
    [`reviews/${reviewId}/moderatedAt`]: updatedAt,
    [`reviews/${reviewId}/moderatedBy`]: user.uid,
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
      type: "inventory"
    }));
  }
  await db.ref().update(updates);
  return { item: { id: itemId, ...item } };
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

export async function saveDeliveryProofRecord(db, user, orderId, input) {
  if (user.role !== "rider") throw new HttpError(403, "Rider access required.");
  if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db.ref(`orders/${orderId}`).once("value")).val();
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
  if (order.status !== "arrived") throw new HttpError(409, "Proof can be captured only after arrival.");
  const proofOfDeliveryRef = `deliveryProofs/${orderId}`;
  await db.ref(proofOfDeliveryRef).set({
    dataUrl: validateDeliveryProof(input.dataUrl),
    riderId: user.uid,
    createdAt: Date.now()
  });
  return { proofOfDeliveryRef };
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
      type: "shift"
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
  const orders = Object.values((await db.ref("orders").once("value")).val() || {})
    .filter((order) => Number(order.createdAt || 0) >= Number(activeShift.startedAt || 0))
    .filter((order) => order.cashierId === user.uid || (user.role === "owner" && order.source === "walk-in-pos"));
  const cashSales = orders
    .filter((order) => order.paymentMethod === "cash" || (order.paymentMethod === "cod" && order.status === "delivered"))
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
      type: "shift"
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
  const requests = Object.entries((await db.ref("approvalRequests").once("value")).val() || {})
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
      await getAuth().setCustomUserClaims(uid, { role });
      updates[`users/${uid}/role`] = role;
    }
    if (request.type === "void_order") {
      const orderId = cleanText(request.payload?.orderId || request.targetId, 128);
      const order = (await db.ref(`orders/${orderId}`).once("value")).val();
      if (!order) throw new HttpError(404, "Order not found.");
      if (order.status !== "cancelled") {
        const reason = request.reason;
        const inventorySnapshot = await db.ref("inventory").once("value");
        updates[`orders/${orderId}/status`] = "cancelled";
        updates[`orders/${orderId}/cancelReason`] = reason;
        updates[`orders/${orderId}/cancelledAt`] = now;
        updates[`orders/${orderId}/cancelledBy`] = user.uid;
        updates[`orders/${orderId}/cancelledByRole`] = user.role;
        for (const item of order.items || []) {
          const beforeStock = Number(inventorySnapshot.child(`${item.id}/stock`).val() || 0);
          const afterStock = beforeStock + Number(item.qty || 0);
          updates[`inventory/${item.id}/stock`] = afterStock;
          updates[`public/menu/${item.id}/stock`] = afterStock;
          updates[`stockHistory/${item.id}/${db.ref(`stockHistory/${item.id}`).push().key}`] = stockHistoryEntry({
            item,
            itemId: item.id,
            beforeStock,
            afterStock,
            delta: Number(item.qty || 0),
            reason,
            user,
            action: "owner_void_restored",
            orderId
          });
        }
      }
    }
  }

  await db.ref().update(updates);
  return { id: requestId, status: decision };
}

export async function archiveCompletedOrdersRecord(db, user, input = {}) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  const olderThanDays = Math.max(1, Math.min(365, Number(input.olderThanDays || 30)));
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const orders = (await db.ref("orders").once("value")).val() || {};
  const updates = {};
  let archived = 0;
  for (const [orderId, order] of Object.entries(orders)) {
    if (order.archivedAt) continue;
    if (!["delivered", "cancelled"].includes(order.status)) continue;
    const referenceTime = Number(order.deliveredAt || order.cancelledAt || order.updatedAt || order.createdAt || 0);
    if (referenceTime > cutoff) continue;
    archived += 1;
    updates[`orders/${orderId}/archivedAt`] = Date.now();
    updates[`orderArchive/${orderId}`] = { ...order, archivedAt: Date.now(), archivedBy: user.uid };
  }
  const createdAt = Date.now();
  updates[`auditLogs/AUD-${createdAt}-archive-orders`] = {
    action: "orders_archived",
    actorId: user.uid,
    actorName: user.name || user.email,
    actorRole: user.role,
    details: { after: { archived, olderThanDays } },
    createdAt
  };
  await db.ref().update(updates);
  return { archived };
}

export async function listOrdersForUser(db, user) {
  const orders = (await db.ref("orders").once("value")).val() || {};
  return Object.entries(orders)
    .map(([id, order]) => ({ id, ...order }))
    .filter((order) => !order.archivedAt)
    .filter((order) => canAccessOrder(user, order, { allowAvailableRiderOrder: true }));
}
