import {
  authorizeOrderUpdate,
  canAccessOrder,
  HttpError,
  validRecordId,
  validateDeliveryProof,
  validateLocation,
  validateOrderItems
} from "./security.js";
import { notificationUpdates, userIdsForRoles } from "./notifications.js";

const deliveryFee = 49;
const paymentMethods = ["gcash", "cod", "cash"];

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cloneData(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
  const fee = deliveryType === "delivery" ? deliveryFee : 0;
  const total = subtotal + fee;
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
    deliveryFee: fee,
    total,
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
    updates[`public/menu/${item.id}/stock`] = Number(committedInventory[item.id]?.stock ?? 0);
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
  const updates = {
    [`auditLogs/AUD-${Date.now()}-${orderId}`]: {
      action: "order_updated",
      orderId,
      status: changes.status || null,
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: Date.now()
    }
  };
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
      restoredInventory[`inventory/${item.id}/stock`] = nextStock;
      restoredInventory[`public/menu/${item.id}/stock`] = nextStock;
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
      actorId: user.uid,
      actorName: user.name || user.email,
      actorRole: user.role,
      createdAt: Date.now()
    }
  });
  return { item: { id: itemId, ...item } };
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
    actorId: user.uid,
    actorName: user.name || user.email,
    actorRole: user.role,
    createdAt: Date.now()
    }
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

export async function listOrdersForUser(db, user) {
  const orders = (await db.ref("orders").once("value")).val() || {};
  return Object.entries(orders)
    .map(([id, order]) => ({ id, ...order }))
    .filter((order) => canAccessOrder(user, order, { allowAvailableRiderOrder: true }));
}
