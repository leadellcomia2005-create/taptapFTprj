const roles = ["owner", "staff", "rider", "customer"];
const orderStatusFlow = ["received", "preparing", "ready", "out-for-delivery", "arrived", "delivered"];
const cancellableOrderStatuses = ["pending-payment", "received", "preparing"];
const paymentMethods = ["gcash", "cod", "cash"];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validRecordId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function canAccessOrder(user, order, { allowAvailableRiderOrder = false } = {}) {
  if (!user || !order) return false;
  if (["owner", "staff"].includes(user.role)) return true;
  if (user.role === "customer") return order.customerId === user.uid;
  return user.role === "rider" && (
    order.riderId === user.uid ||
    (allowAvailableRiderOrder && order.status === "ready" && !order.riderId)
  );
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function slugifyId(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new HttpError(400, "Add between 1 and 50 order items.");
  return items.map((item) => {
    if (!validRecordId(item?.id)) throw new HttpError(400, "An order item has an invalid product ID.");
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new HttpError(400, "Item quantities must be whole numbers from 1 to 50.");
    return { id: item.id, qty };
  });
}

function validateLocation(input = {}) {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const accuracy = Number(input.accuracy || 0);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, "Invalid latitude.");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, "Invalid longitude.");
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10_000) throw new HttpError(400, "Invalid GPS accuracy.");
  return { lat, lng, accuracy };
}

function validateDeliveryProof(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/jpeg;base64,")) throw new HttpError(400, "Delivery proof must be a JPEG image.");
  const encoded = dataUrl.slice("data:image/jpeg;base64,".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HttpError(400, "Delivery proof contains invalid image data.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new HttpError(400, "Delivery proof must contain a valid JPEG header.");
  }
  if (bytes.length > 500_000) throw new HttpError(413, "Delivery proof must be smaller than 500 KB.");
  return dataUrl;
}

function notification(targetUserId, title, message, values = {}) {
  const createdAt = Date.now();
  return { targetUserId, title, message, createdAt, expiresAt: createdAt + 30 * 24 * 60 * 60 * 1000, readAt: null, ...values };
}

function notificationUpdates(db, recipients, title, message, values = {}) {
  return Object.fromEntries([...new Set(recipients.filter(Boolean))].map((targetUserId) => [
    `notifications/${db.ref("notifications").push().key}`,
    notification(targetUserId, title, message, values)
  ]));
}

async function userIdsForRoles(db, roleValues) {
  const users = (await db.ref("users").once("value")).val() || {};
  return Object.entries(users).filter(([, profile]) => roleValues.includes(profile?.role)).map(([uid]) => uid);
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

function authorizeOrderUpdate(user, order, input = {}) {
  const now = Date.now();
  if (["owner", "staff"].includes(user.role)) {
    const changes = {};
    if (input.cancel === true || input.status === "cancelled") {
      if (!cancellableOrderStatuses.includes(order.status)) throw new HttpError(409, "Only pending or kitchen orders can be cancelled.");
      const reason = cleanText(input.cancelReason, 160);
      if (!reason) throw new HttpError(400, "A cancellation reason is required.");
      return { status: "cancelled", cancelReason: reason, cancelledAt: now, cancelledBy: user.uid, cancelledByRole: user.role, updatedAt: now };
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
      const currentIndex = orderStatusFlow.indexOf(order.status);
      if (currentIndex < 0) throw new HttpError(409, "This order no longer accepts status updates.");
      const nextStatus = orderStatusFlow[currentIndex + 1];
      if (!nextStatus || input.status !== nextStatus) throw new HttpError(409, `The next valid status is ${nextStatus || "none"}.`);
      changes.status = input.status;
      changes.updatedAt = now;
    }
    if (input.riderId !== undefined) {
      if (input.riderId !== null && !validRecordId(input.riderId)) throw new HttpError(400, "Invalid rider ID.");
      if (input.riderId !== null && order.status !== "ready") throw new HttpError(409, "Riders can be assigned only when an order is ready.");
      changes.riderId = input.riderId;
      changes.assignedAt = now;
    }
    if (Object.keys(changes).length === 0) throw new HttpError(400, "No supported order update was provided.");
    return changes;
  }
  if (user.role !== "rider") throw new HttpError(403, "Order updates require an operations role.");
  if (input.deliveryIssue) {
    const reason = cleanText(input.deliveryIssue, 160);
    if (!reason) throw new HttpError(400, "A delivery issue reason is required.");
    if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
    if (!["out-for-delivery", "arrived"].includes(order.status)) throw new HttpError(409, "Delivery issues can be reported only while delivering.");
    return { deliveryIssue: reason, deliveryIssueAt: now, deliveryIssueBy: user.uid, updatedAt: now };
  }
  if (!order.riderId && order.status === "ready" && input.riderId === user.uid && input.status === undefined) {
    return { riderId: user.uid, assignedAt: now };
  }
  if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
  const nextStatus = { ready: "out-for-delivery", "out-for-delivery": "arrived", arrived: "delivered" }[order.status];
  if (!nextStatus || input.status !== nextStatus) throw new HttpError(409, `The next valid rider status is ${nextStatus || "none"}.`);
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
    if (order.paymentMethod === "cod") {
      changes.codCollectedAt = now;
      changes.codCollectedBy = user.uid;
      changes.paymentStatus = "cod-collected";
    }
  }
  return changes;
}

export async function createOrderRecord(db, user, input) {
  if (!roles.includes(user.role) || user.role === "rider") throw new HttpError(403, "This role cannot create orders.");
  const requestedItems = validateOrderItems(input.items);
  if (!paymentMethods.includes(input.paymentMethod)) throw new HttpError(400, "Unsupported payment method.");
  if (user.role === "customer" && !["gcash", "cod"].includes(input.paymentMethod)) throw new HttpError(400, "Customers can pay through GCash or cash on delivery.");
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
  const total = subtotal - discount + (deliveryType === "delivery" ? 49 : 0);
  const cashReceived = isWalkIn && input.paymentMethod === "cash" ? Number(input.cashReceived ?? total) : 0;
  if (isWalkIn && input.paymentMethod === "cash" && (!Number.isFinite(cashReceived) || cashReceived < total)) {
    throw new HttpError(400, "Cash received must cover the order total.");
  }
  const onlinePayment = !isWalkIn && input.paymentMethod === "gcash";
  const orderId = db.ref("orders").push().key;
  const [staffIds, ownerIds] = await Promise.all([userIdsForRoles(db, ["staff"]), userIdsForRoles(db, ["owner"])]);
  const createdAt = Date.now();
  const order = {
    customerId: isWalkIn ? "walk-in" : user.uid,
    customerName: isWalkIn ? "Walk-in Customer" : profile.name || user.name || user.email,
    customerEmail: isWalkIn ? "" : user.email || profile.email || "",
    phone: cleanText(input.phone, 40),
    address: isWalkIn ? "Counter" : deliveryType === "pickup" ? "Store pickup" : cleanText(input.address, 300),
    deliveryType,
    notes: cleanText(input.notes, 300),
    paymentMethod: input.paymentMethod,
    subtotal,
    discount,
    deliveryFee: deliveryType === "delivery" ? 49 : 0,
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
      const stock = Number(inventory[item.id]?.stock);
      if (!Number.isFinite(stock) || stock < item.qty) {
        transactionError = `${item.name} only has ${Number.isFinite(stock) ? stock : 0} item(s) available.`;
        return undefined;
      }
      nextInventory[item.id] = { ...inventory[item.id], stock: stock - item.qty };
    }
    return nextInventory;
  });
  if (!transaction.committed) throw new HttpError(409, transactionError || "The order could not be completed.");

  const committedInventory = transaction.snapshot.val() || {};
  const updates = {
    [`orders/${orderId}`]: order,
    [`auditLogs/AUD-${createdAt}-${orderId}`]: { action: "order_created", orderId, actorId: user.uid, actorRole: user.role, total: order.total, createdAt },
    ...notificationUpdates(db, isWalkIn ? [] : [order.customerId], onlinePayment ? "Payment pending" : "Order confirmed", onlinePayment ? `Order ${orderId} is waiting for GCash payment confirmation.` : `Order ${orderId} was received.`, { type: "order", orderId }),
    ...notificationUpdates(db, onlinePayment ? [] : staffIds, "New order received", `${orderId} from ${order.customerName} is waiting in the queue.`, { type: "order", orderId }),
    ...notificationUpdates(db, onlinePayment ? [] : ownerIds, "New sale recorded", `${orderId} added ${order.total} PHP to the live sales ledger.`, { type: "sale", orderId })
  };
  for (const item of items) updates[`public/menu/${item.id}/stock`] = Number(committedInventory[item.id]?.stock ?? 0);

  try {
    await db.ref().update(updates);
  } catch (error) {
    const rollbackSnapshot = await inventoryRef.once("value");
    const rollback = await transactionWithInitial(inventoryRef, rollbackSnapshot.val(), (inventory) => {
      if (!inventory) return inventory;
      const restored = { ...inventory };
      for (const item of items) {
        const stock = Number(inventory[item.id]?.stock || 0);
        restored[item.id] = { ...inventory[item.id], stock: stock + item.qty };
      }
      return restored;
    });
    const menuRestore = {};
    const restoredInventory = rollback.snapshot?.val() || {};
    for (const item of items) menuRestore[`public/menu/${item.id}/stock`] = Number(restoredInventory[item.id]?.stock ?? 0);
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
    [`auditLogs/AUD-${Date.now()}-${orderId}`]: { action: "order_updated", orderId, status: changes.status || null, actorId: user.uid, actorRole: user.role, createdAt: Date.now() }
  };
  if (changes.status && order.customerId !== "walk-in") {
    Object.assign(updates, notificationUpdates(db, [order.customerId], "Order status updated", `${orderId} is now ${changes.status.replaceAll("-", " ")}.`, { type: "order", orderId }));
  }
  if (changes.riderId && changes.riderId !== previous.riderId) {
    Object.assign(updates, notificationUpdates(db, [changes.riderId], "Delivery assigned", `${orderId} has been assigned to you.`, { type: "delivery", orderId }));
  }
  if (changes.deliveryIssue) {
    const recipients = await userIdsForRoles(db, ["owner", "staff"]);
    Object.assign(updates, notificationUpdates(db, recipients, "Delivery issue reported", `${orderId}: ${changes.deliveryIssue}`, { type: "delivery", orderId }));
  }
  if (changes.status === "cancelled" && previous.status !== "cancelled") {
    const inventory = (await db.ref("inventory").once("value")).val() || {};
    for (const item of previous.items || []) {
      const nextStock = Number(inventory[item.id]?.stock || 0) + Number(item.qty || 0);
      updates[`inventory/${item.id}/stock`] = nextStock;
      updates[`public/menu/${item.id}/stock`] = nextStock;
    }
    if (order.customerId !== "walk-in") Object.assign(updates, notificationUpdates(db, [order.customerId], "Order cancelled", `${orderId} was cancelled: ${changes.cancelReason}.`, { type: "order", orderId }));
  }
  if (changes.codRemittedAt) {
    const ownerIds = await userIdsForRoles(db, ["owner"]);
    Object.assign(updates, notificationUpdates(db, ownerIds, "COD remitted", `${orderId} COD cash was marked as remitted.`, { type: "sale", orderId }));
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
    [`auditLogs/${db.ref("auditLogs").push().key}`]: { action: "menu_item_created", itemId: id, itemName: name, actorId: user.uid, actorRole: user.role, createdAt }
  });
  return { item };
}

export async function updateMenuItemRecord(db, user, itemId, input = {}) {
  if (user.role !== "owner") throw new HttpError(403, "Owner access required.");
  if (!validRecordId(itemId)) throw new HttpError(400, "Invalid menu item ID.");
  const [menuSnapshot, inventorySnapshot] = await Promise.all([db.ref(`public/menu/${itemId}`).once("value"), db.ref(`inventory/${itemId}`).once("value")]);
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
  const updatedAt = Date.now();
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
    updatedAt,
    updatedBy: user.uid
  };
  await db.ref().update({
    [`public/menu/${itemId}`]: item,
    [`inventory/${itemId}`]: { ...currentInventory, name, category, price, stock, reorderPoint, unavailable: item.unavailable, updatedAt },
    [`auditLogs/${db.ref("auditLogs").push().key}`]: { action: "menu_item_updated", itemId, itemName: name, actorId: user.uid, actorRole: user.role, createdAt: updatedAt }
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
    [`auditLogs/${db.ref("auditLogs").push().key}`]: { action: "review_moderated", reviewId, orderId: review.orderId || reviewId, status, actorId: user.uid, actorRole: user.role, createdAt: updatedAt }
  });
  return { review: { id: reviewId, ...review, moderationStatus: status, reply, moderatedAt: updatedAt, moderatedBy: user.uid } };
}

export async function adjustInventoryRecord(db, user, itemId, input) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  if (!validRecordId(itemId)) throw new HttpError(400, "Invalid inventory item ID.");
  const delta = Number(input.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000) throw new HttpError(400, "Inventory adjustment must be a non-zero whole number up to 1000.");
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
    const stock = Number(item.stock || 0) + delta;
    if (stock < 0) {
      failure = `Only ${item.stock || 0} item(s) are available.`;
      return undefined;
    }
    return { ...item, stock };
  });
  if (!result.committed) throw new HttpError(failure === "Inventory item not found." ? 404 : 409, failure || "Inventory was not updated.");
  const item = result.snapshot.val();
  const updates = {
    [`public/menu/${itemId}/stock`]: Number(item.stock || 0),
    [`auditLogs/${db.ref("auditLogs").push().key}`]: { action: delta > 0 ? "inventory_received" : "inventory_adjusted", itemId, itemName: item.name, quantity: delta, reason, actorId: user.uid, actorRole: user.role, createdAt: Date.now() }
  };
  if (Number(item.stock || 0) <= Number(item.reorderPoint || 10)) {
    const ownerIds = await userIdsForRoles(db, ["owner"]);
    Object.assign(updates, notificationUpdates(db, [...ownerIds, user.uid], "Low stock alert", `${item.name} has ${item.stock || 0} item(s) remaining.`, { type: "inventory" }));
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
  return { location };
}

export async function saveDeliveryProofRecord(db, user, orderId, input) {
  if (user.role !== "rider") throw new HttpError(403, "Rider access required.");
  if (!validRecordId(orderId)) throw new HttpError(400, "Invalid order ID.");
  const order = (await db.ref(`orders/${orderId}`).once("value")).val();
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.riderId !== user.uid) throw new HttpError(403, "This delivery is not assigned to you.");
  if (order.status !== "arrived") throw new HttpError(409, "Proof can be captured only after arrival.");
  const proofOfDeliveryRef = `deliveryProofs/${orderId}`;
  await db.ref(proofOfDeliveryRef).set({ dataUrl: validateDeliveryProof(input.dataUrl), riderId: user.uid, createdAt: Date.now() });
  return { proofOfDeliveryRef };
}

export async function saveShiftLogRecord(db, user, input) {
  if (!["owner", "staff"].includes(user.role)) throw new HttpError(403, "Owner or staff access required.");
  const fields = ["startedAt", "endedAt", "openingCash", "cashSales", "expectedCash", "actualCash", "variance", "orderCount", "cashIn", "cashOut", "expenses"];
  const entry = {};
  for (const field of fields) {
    const value = Number(input[field] || 0);
    if (!Number.isFinite(value)) throw new HttpError(400, `Invalid ${field}.`);
    entry[field] = value;
  }
  if (entry.startedAt > entry.endedAt || entry.orderCount < 0 || !Number.isInteger(entry.orderCount)) {
    throw new HttpError(400, "Invalid shift time or order count.");
  }
  const id = db.ref("shiftLogs").push().key;
  const createdAt = Date.now();
  await db.ref().update({
    [`shiftLogs/${id}`]: { ...entry, notes: cleanText(input.notes, 300), staffId: user.uid, staffName: user.name || user.email, createdAt },
    [`auditLogs/AUD-${createdAt}-${id}`]: { action: "shift_closed", shiftLogId: id, actorId: user.uid, actorRole: user.role, createdAt },
    ...notificationUpdates(db, [user.uid], "Shift summary ready", `Your shift summary is ready with ${entry.orderCount} order(s) and a variance of ${entry.variance} PHP.`, { type: "shift" })
  });
  return { id };
}

export async function listOrdersForUser(db, user) {
  const orders = (await db.ref("orders").once("value")).val() || {};
  return Object.entries(orders)
    .map(([id, order]) => ({ id, ...order }))
    .filter((order) => canAccessOrder(user, order, { allowAvailableRiderOrder: true }));
}
