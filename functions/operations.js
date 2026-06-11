const roles = ["owner", "staff", "rider", "customer"];
const orderStatusFlow = ["received", "preparing", "ready", "out-for-delivery", "arrived", "delivered"];
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

function notification(title, message, values = {}) {
  return { title, message, createdAt: Date.now(), readBy: {}, ...values };
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
    if (input.status !== undefined) {
      const nextStatus = orderStatusFlow[orderStatusFlow.indexOf(order.status) + 1];
      if (!nextStatus || input.status !== nextStatus) throw new HttpError(409, `The next valid status is ${nextStatus || "none"}.`);
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
    return { id, name: product.name, price: Number(product.price), qty };
  });
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const isWalkIn = user.role !== "customer";
  const orderId = db.ref("orders").push().key;
  const customerNotificationId = db.ref("notifications").push().key;
  const staffNotificationId = db.ref("notifications").push().key;
  const ownerNotificationId = db.ref("notifications").push().key;
  const createdAt = Date.now();
  const order = {
    customerId: isWalkIn ? "walk-in" : user.uid,
    customerName: isWalkIn ? "Walk-in Customer" : profile.name || user.name || user.email,
    customerEmail: isWalkIn ? "" : user.email || profile.email || "",
    phone: cleanText(input.phone, 40),
    address: isWalkIn ? "Counter" : cleanText(input.address, 300),
    paymentMethod: input.paymentMethod,
    subtotal,
    deliveryFee: isWalkIn ? 0 : 49,
    total: subtotal + (isWalkIn ? 0 : 49),
    items,
    createdAt,
    status: "received",
    source: isWalkIn ? "walk-in-pos" : "online"
  };
  if (!isWalkIn && (!order.address || !order.phone)) throw new HttpError(400, "A phone number and delivery address are required.");
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

  const updates = {
    [`orders/${orderId}`]: order,
    [`auditLogs/AUD-${createdAt}-${orderId}`]: { action: "order_created", orderId, actorId: user.uid, actorRole: user.role, total: order.total, createdAt },
    [`notifications/${customerNotificationId}`]: notification("Order confirmed", `Order ${orderId} was received.`, { targetUserId: order.customerId, type: "order", orderId }),
    [`notifications/${staffNotificationId}`]: notification("New order received", `${orderId} from ${order.customerName} is waiting in the queue.`, { targetRole: "staff", type: "order", orderId }),
    [`notifications/${ownerNotificationId}`]: notification("New sale recorded", `${orderId} added ${order.total} PHP to the live sales ledger.`, { targetRole: "owner", type: "sale", orderId })
  };

  try {
    await db.ref().update(updates);
  } catch (error) {
    const rollbackSnapshot = await inventoryRef.once("value");
    await transactionWithInitial(inventoryRef, rollbackSnapshot.val(), (inventory) => {
      if (!inventory) return inventory;
      const restored = { ...inventory };
      for (const item of items) {
        const stock = Number(inventory[item.id]?.stock || 0);
        restored[item.id] = { ...inventory[item.id], stock: stock + item.qty };
      }
      return restored;
    });
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
    updates[`notifications/${db.ref("notifications").push().key}`] = notification("Order status updated", `${orderId} is now ${changes.status.replaceAll("-", " ")}.`, { targetUserId: order.customerId, type: "order", orderId });
  }
  if (changes.riderId && changes.riderId !== previous.riderId) {
    updates[`notifications/${db.ref("notifications").push().key}`] = notification("Delivery assigned", `${orderId} has been assigned to you.`, { targetUserId: changes.riderId, type: "delivery", orderId });
  }
  await db.ref().update(updates);
  return { order, changes };
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
  await db.ref("auditLogs").push({ action: delta > 0 ? "inventory_received" : "inventory_adjusted", itemId, itemName: item.name, quantity: delta, reason, actorId: user.uid, actorRole: user.role, createdAt: Date.now() });
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
  const fields = ["startedAt", "endedAt", "openingCash", "cashSales", "expectedCash", "actualCash", "variance", "orderCount"];
  const entry = {};
  for (const field of fields) {
    const value = Number(input[field]);
    if (!Number.isFinite(value)) throw new HttpError(400, `Invalid ${field}.`);
    entry[field] = value;
  }
  if (entry.startedAt > entry.endedAt || entry.orderCount < 0 || !Number.isInteger(entry.orderCount)) {
    throw new HttpError(400, "Invalid shift time or order count.");
  }
  const id = db.ref("shiftLogs").push().key;
  const createdAt = Date.now();
  await db.ref().update({
    [`shiftLogs/${id}`]: { ...entry, staffId: user.uid, staffName: user.name || user.email, createdAt },
    [`auditLogs/AUD-${createdAt}-${id}`]: { action: "shift_closed", shiftLogId: id, actorId: user.uid, actorRole: user.role, createdAt }
  });
  return { id };
}

export async function listOrdersForUser(db, user) {
  const orders = (await db.ref("orders").once("value")).val() || {};
  return Object.entries(orders)
    .map(([id, order]) => ({ id, ...order }))
    .filter((order) => canAccessOrder(user, order, { allowAvailableRiderOrder: true }));
}
