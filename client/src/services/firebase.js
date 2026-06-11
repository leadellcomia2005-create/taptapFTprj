import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported, logEvent } from "firebase/analytics";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onValue,
  push,
  ref,
  runTransaction,
  set,
  update
} from "firebase/database";
import {
  connectStorageEmulator,
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes
} from "firebase/storage";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId && config.databaseURL);

let app;
let auth;
let db;
let storage;
let analytics;

if (firebaseEnabled) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app);
  storage = getStorage(app);
  isSupported().then((supported) => {
    if (supported) analytics = getAnalytics(app);
  });

  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectDatabaseEmulator(db, "127.0.0.1", 9000);
      connectStorageEmulator(storage, "127.0.0.1", 9199);
    } catch {
      // Hot reload may initialize emulators more than once.
    }
  }
}

const demoUserKey = "taptap-demo-user";
const demoDataKey = "taptap-demo-data";

function readDemoData() {
  const saved = localStorage.getItem(demoDataKey);
  const data = saved ? JSON.parse(saved) : {};
  return {
    orders: {},
    inventory: {},
    riderLocations: {},
    users: {},
    auditLogs: {},
    messages: {},
    shiftLogs: {},
    reviews: {},
    notifications: {},
    ...data
  };
}

function writeDemoData(data) {
  localStorage.setItem(demoDataKey, JSON.stringify(data));
  window.dispatchEvent(new CustomEvent("taptap-demo-data"));
}

export function observeAuth(callback) {
  if (firebaseEnabled) {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return callback(null);
      const token = await user.getIdTokenResult(true);
      const profile = await get(ref(db, `users/${user.uid}`));
      callback({
        uid: user.uid,
        email: user.email,
        name: profile.val()?.name || user.displayName || user.email,
        role: token.claims.role || profile.val()?.role || "customer",
        firebaseUser: user
      });
    });
  }
  const emit = () => callback(JSON.parse(localStorage.getItem(demoUserKey) || "null"));
  emit();
  window.addEventListener("storage", emit);
  return () => window.removeEventListener("storage", emit);
}

export async function login(email, password, requestedRole, demoAccounts) {
  if (firebaseEnabled) {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const token = await credential.user.getIdTokenResult(true);
    const profile = await get(ref(db, `users/${credential.user.uid}`));
    const role = token.claims.role || profile.val()?.role || "customer";
    if (requestedRole && requestedRole !== role) {
      await signOut(auth);
      throw new Error(`This account is registered as ${role}, not ${requestedRole}.`);
    }
    return credential.user;
  }

  const match = Object.entries(demoAccounts).find(
    ([role, account]) => role === requestedRole && account.email === email && account.password === password
  );
  if (!match) throw new Error("Invalid demo account or role.");
  const [role, account] = match;
  const user = { uid: `demo-${role}`, email, name: account.name, role };
  localStorage.setItem(demoUserKey, JSON.stringify(user));
  window.dispatchEvent(new Event("storage"));
  return user;
}

export async function registerCustomer(name, email, password) {
  if (firebaseEnabled) {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await set(ref(db, `users/${credential.user.uid}`), {
      name,
      email,
      role: "customer",
      createdAt: Date.now()
    });
    await sendEmailVerification(credential.user);
    return credential.user;
  }
  const user = { uid: `demo-${crypto.randomUUID()}`, email, name, role: "customer" };
  localStorage.setItem(demoUserKey, JSON.stringify(user));
  window.dispatchEvent(new Event("storage"));
  return user;
}

export async function logout() {
  if (firebaseEnabled) return signOut(auth);
  localStorage.removeItem(demoUserKey);
  window.dispatchEvent(new Event("storage"));
}

export async function resetPassword(email) {
  if (!firebaseEnabled) throw new Error("Firebase must be configured to send reset emails.");
  return sendPasswordResetEmail(auth, email);
}

export async function getAuthToken() {
  if (!firebaseEnabled || !auth.currentUser) return "";
  return auth.currentUser.getIdToken();
}

export function subscribeUserProfile(user, callback) {
  if (!user) {
    callback(null);
    return () => {};
  }
  const fallback = {
    name: user.name,
    email: user.email,
    phone: "",
    address: "",
    city: "Las Pinas City",
    notificationPreferences: { orderUpdates: true, promotions: true }
  };
  if (firebaseEnabled) {
    return onValue(ref(db, `users/${user.uid}`), (snapshot) => callback({ ...fallback, ...(snapshot.val() || {}) }));
  }
  const emit = () => callback({ ...fallback, ...(readDemoData().users[user.uid] || {}) });
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export async function saveUserProfile(user, profile) {
  const values = { ...profile, email: user.email, role: user.role, updatedAt: Date.now() };
  if (firebaseEnabled) return update(ref(db, `users/${user.uid}`), values);
  const data = readDemoData();
  data.users[user.uid] = { ...data.users[user.uid], ...values };
  writeDemoData(data);
}

export function subscribeNotifications(user, callback) {
  if (!user) {
    callback([]);
    return () => {};
  }
  const normalize = (value = {}) => callback(
    Object.entries(value)
      .map(([id, notification]) => ({ id, ...notification }))
      .filter((notification) =>
        notification.targetUserId === user.uid ||
        notification.targetRole === user.role ||
        notification.targetRole === "all"
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  );
  if (firebaseEnabled) return onValue(ref(db, "notifications"), (snapshot) => normalize(snapshot.val()));
  const emit = () => normalize(readDemoData().notifications);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  window.addEventListener("storage", emit);
  return () => {
    window.removeEventListener("taptap-demo-data", emit);
    window.removeEventListener("storage", emit);
  };
}

export async function createNotification(notification) {
  const entry = { ...notification, createdAt: Date.now(), readBy: {} };
  if (firebaseEnabled) return push(ref(db, "notifications"), entry);
  const data = readDemoData();
  data.notifications[`NOTIF-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`] = entry;
  writeDemoData(data);
}

export async function markNotificationRead(notificationId, userId) {
  if (firebaseEnabled) return set(ref(db, `notifications/${notificationId}/readBy/${userId}`), true);
  const data = readDemoData();
  if (data.notifications[notificationId]) {
    data.notifications[notificationId].readBy ||= {};
    data.notifications[notificationId].readBy[userId] = true;
    writeDemoData(data);
  }
}

export function subscribeReviews(user, callback) {
  if (!user) {
    callback([]);
    return () => {};
  }
  const normalize = (value = {}) => callback(
    Object.entries(value)
      .map(([id, review]) => ({ id, ...review }))
      .filter((review) => user.role !== "customer" || review.customerId === user.uid)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  );
  if (firebaseEnabled) return onValue(ref(db, "reviews"), (snapshot) => normalize(snapshot.val()));
  const emit = () => normalize(readDemoData().reviews);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export async function submitReview(order, user, rating, comment) {
  const review = {
    orderId: order.id,
    customerId: user.uid,
    customerName: user.name,
    rating: Number(rating),
    comment,
    items: order.items?.map((item) => item.name) || [],
    createdAt: Date.now()
  };
  if (firebaseEnabled) await set(ref(db, `reviews/${order.id}`), review);
  else {
    const data = readDemoData();
    data.reviews[order.id] = review;
    writeDemoData(data);
  }
  await createNotification({
    targetRole: "staff",
    title: "New customer review",
    message: `${user.name} rated order ${order.id} ${rating}/5.`,
    type: "review"
  });
}

export function subscribeMenu(fallback, callback) {
  if (firebaseEnabled) {
    return onValue(ref(db, "public/menu"), (snapshot) => {
      const value = snapshot.val();
      callback(value ? Object.values(value) : fallback);
    });
  }
  callback(fallback);
  return () => {};
}

export function subscribeInventory(fallback, callback) {
  const mergeInventory = (inventory = {}) => callback(
    fallback.map((item) => ({
      ...item,
      stock: inventory[item.id]?.stock ?? item.stock,
      reorderPoint: inventory[item.id]?.reorderPoint ?? 10
    }))
  );
  if (firebaseEnabled) {
    return onValue(ref(db, "inventory"), (snapshot) => mergeInventory(snapshot.val()));
  }
  const emit = () => mergeInventory(readDemoData().inventory);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export async function adjustInventory(item, delta, reason, actor) {
  const auditEntry = {
    action: delta > 0 ? "inventory_received" : "inventory_adjusted",
    itemId: item.id,
    itemName: item.name,
    quantity: delta,
    reason,
    actorId: actor.uid,
    actorName: actor.name,
    actorRole: actor.role,
    createdAt: Date.now()
  };
  if (firebaseEnabled) {
    await runTransaction(ref(db, `inventory/${item.id}/stock`), (current) => Math.max(0, (current ?? item.stock) + delta));
    await push(ref(db, "auditLogs"), auditEntry);
    return;
  }
  const data = readDemoData();
  data.inventory[item.id] = {
    ...data.inventory[item.id],
    name: item.name,
    reorderPoint: item.reorderPoint ?? 10,
    stock: Math.max(0, (data.inventory[item.id]?.stock ?? item.stock) + delta)
  };
  data.auditLogs[`AUD-${Date.now()}`] = auditEntry;
  writeDemoData(data);
}

export function subscribeOrders(user, callback) {
  if (!user) {
    callback([]);
    return () => {};
  }
  if (firebaseEnabled) {
    return onValue(ref(db, "orders"), (snapshot) => {
      const orders = Object.entries(snapshot.val() || {}).map(([id, order]) => ({ id, ...order }));
      callback(user.role === "customer" ? orders.filter((order) => order.customerId === user.uid) : orders);
    });
  }
  const emit = () => {
    const data = readDemoData();
    const orders = Object.entries(data.orders).map(([id, order]) => ({ id, ...order }));
    callback(user.role === "customer" ? orders.filter((order) => order.customerId === user.uid) : orders);
  };
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export async function createOrder(order) {
  if (firebaseEnabled) {
    const orderRef = push(ref(db, "orders"));
    const id = orderRef.key;
    await set(orderRef, { ...order, createdAt: Date.now(), status: "received" });
    await Promise.all(order.items.map((item) =>
      runTransaction(ref(db, `inventory/${item.id}/stock`), (current) => Math.max(0, (current ?? item.stock) - item.qty))
    ));
    trackEvent("purchase", { transaction_id: id, value: order.total, currency: "PHP" });
    await Promise.all([
      createNotification({ targetUserId: order.customerId, title: "Order confirmed", message: `Order ${id} was received.`, type: "order", orderId: id }),
      createNotification({ targetRole: "staff", title: "New order received", message: `${id} from ${order.customerName} is waiting in the queue.`, type: "order", orderId: id }),
      createNotification({ targetRole: "owner", title: "New sale recorded", message: `${id} added ${order.total} PHP to the live sales ledger.`, type: "sale", orderId: id })
    ]);
    return id;
  }
  const data = readDemoData();
  const id = `TAP-${Date.now().toString().slice(-8)}`;
  data.orders[id] = { ...order, createdAt: Date.now(), status: "received" };
  for (const item of order.items) {
    data.inventory[item.id] = { stock: Math.max(0, (data.inventory[item.id]?.stock ?? item.stock) - item.qty) };
  }
  writeDemoData(data);
  await Promise.all([
    createNotification({ targetUserId: order.customerId, title: "Order confirmed", message: `Order ${id} was received.`, type: "order", orderId: id }),
    createNotification({ targetRole: "staff", title: "New order received", message: `${id} from ${order.customerName} is waiting in the queue.`, type: "order", orderId: id }),
    createNotification({ targetRole: "owner", title: "New sale recorded", message: `${id} added ${order.total} PHP to the live sales ledger.`, type: "sale", orderId: id })
  ]);
  return id;
}

export function trackEvent(name, parameters = {}) {
  if (analytics) logEvent(analytics, name, parameters);
}

export async function updateOrder(orderId, values) {
  const auditEntry = {
    action: "order_updated",
    orderId,
    status: values.status || null,
    createdAt: Date.now()
  };
  if (firebaseEnabled) {
    const currentOrder = (await get(ref(db, `orders/${orderId}`))).val();
    await update(ref(db, `orders/${orderId}`), values);
    await push(ref(db, "auditLogs"), auditEntry);
    if (values.status && currentOrder?.customerId) {
      await createNotification({
        targetUserId: currentOrder.customerId,
        title: "Order status updated",
        message: `${orderId} is now ${values.status.replaceAll("-", " ")}.`,
        type: "order",
        orderId
      });
    }
    if (values.riderId && values.riderId !== currentOrder?.riderId) {
      await createNotification({ targetUserId: values.riderId, title: "Delivery assigned", message: `${orderId} has been assigned to you.`, type: "delivery", orderId });
    }
    return;
  }
  const data = readDemoData();
  const currentOrder = data.orders[orderId];
  data.orders[orderId] = { ...data.orders[orderId], ...values };
  data.auditLogs[`AUD-${Date.now()}`] = auditEntry;
  writeDemoData(data);
  if (values.status && currentOrder?.customerId) {
    await createNotification({ targetUserId: currentOrder.customerId, title: "Order status updated", message: `${orderId} is now ${values.status.replaceAll("-", " ")}.`, type: "order", orderId });
  }
  if (values.riderId && values.riderId !== currentOrder?.riderId) {
    await createNotification({ targetUserId: values.riderId, title: "Delivery assigned", message: `${orderId} has been assigned to you.`, type: "delivery", orderId });
  }
}

export function subscribeAuditLogs(callback) {
  const normalize = (value = {}) => callback(
    Object.entries(value)
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  );
  if (firebaseEnabled) return onValue(ref(db, "auditLogs"), (snapshot) => normalize(snapshot.val()));
  const emit = () => normalize(readDemoData().auditLogs);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export function subscribeSupportMessages(callback, customerId = null) {
  const normalize = (value = {}) => {
    const messages = Object.entries(value)
      .map(([id, message]) => ({ id, ...message }))
      .filter((message) => !customerId || message.customerId === customerId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    callback(messages);
  };
  if (firebaseEnabled) return onValue(ref(db, "messages/support"), (snapshot) => normalize(snapshot.val()));
  const emit = () => normalize(readDemoData().messages.support);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  window.addEventListener("storage", emit);
  return () => {
    window.removeEventListener("taptap-demo-data", emit);
    window.removeEventListener("storage", emit);
  };
}

export async function sendSupportMessage(text, actor, conversation = {}) {
  const customerId = conversation.customerId || (actor.role === "customer" ? actor.uid : null);
  const message = {
    text,
    senderId: actor.uid,
    senderName: actor.name,
    senderRole: actor.role,
    customerId,
    customerName: conversation.customerName || (actor.role === "customer" ? actor.name : null),
    conversationId: conversation.conversationId || customerId,
    channel: "support",
    createdAt: Date.now()
  };
  if (firebaseEnabled) await push(ref(db, "messages/support"), message);
  else {
    const data = readDemoData();
    data.messages.support ||= {};
    data.messages.support[`MSG-${Date.now()}`] = message;
    writeDemoData(data);
  }
  await createNotification(actor.role === "customer"
    ? { targetRole: "staff", title: "New support message", message: `${actor.name}: ${text}`, type: "chat" }
    : { targetUserId: customerId, title: "Staff replied", message: `${actor.name}: ${text}`, type: "chat" });
}

export function subscribeShiftLogs(callback) {
  const normalize = (value = {}) => callback(
    Object.entries(value)
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  );
  if (firebaseEnabled) return onValue(ref(db, "shiftLogs"), (snapshot) => normalize(snapshot.val()));
  const emit = () => normalize(readDemoData().shiftLogs);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export async function saveShiftLog(entry, actor) {
  const shiftEntry = {
    ...entry,
    staffId: actor.uid,
    staffName: actor.name,
    createdAt: Date.now()
  };
  if (firebaseEnabled) {
    const saved = await push(ref(db, "shiftLogs"), shiftEntry);
    await push(ref(db, "auditLogs"), {
      action: "shift_closed",
      shiftLogId: saved.key,
      actorId: actor.uid,
      actorName: actor.name,
      createdAt: Date.now()
    });
    return saved.key;
  }
  const data = readDemoData();
  const id = `SHIFT-${Date.now()}`;
  data.shiftLogs[id] = shiftEntry;
  data.auditLogs[`AUD-${Date.now()}`] = {
    action: "shift_closed",
    shiftLogId: id,
    actorId: actor.uid,
    actorName: actor.name,
    createdAt: Date.now()
  };
  writeDemoData(data);
  return id;
}

export async function saveRiderLocation(riderId, location) {
  if (firebaseEnabled) return set(ref(db, `riderLocations/${riderId}`), { ...location, updatedAt: Date.now() });
  const data = readDemoData();
  data.riderLocations[riderId] = { ...location, updatedAt: Date.now() };
  writeDemoData(data);
}

export function subscribeRiderLocation(riderId, callback) {
  if (firebaseEnabled) return onValue(ref(db, `riderLocations/${riderId}`), (snapshot) => callback(snapshot.val()));
  const emit = () => callback(readDemoData().riderLocations[riderId] || null);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export async function uploadProof(orderId, blob) {
  if (!firebaseEnabled) return URL.createObjectURL(blob);
  const fileRef = storageRef(storage, `proof-of-delivery/${orderId}/${Date.now()}.jpg`);
  await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
  return getDownloadURL(fileRef);
}

export { auth, db, storage, ref, set, push, update };
