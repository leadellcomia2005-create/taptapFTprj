import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported, logEvent } from "firebase/analytics";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  browserSessionPersistence,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "firebase/auth";
import {
  connectDatabaseEmulator,
  equalTo,
  get,
  getDatabase,
  onValue,
  orderByChild,
  push,
  query,
  ref,
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
import { api } from "./api";
import { configureAuthTokenProvider } from "./authSession";

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
const firebaseStorageEnabled = import.meta.env.VITE_ENABLE_FIREBASE_STORAGE === "true";

let app;
let auth;
let db;
let storage;
let analytics;
let registrationAuth;
let registrationDb;
let authPersistenceReady = Promise.resolve();

if (firebaseEnabled) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app);
  if (firebaseStorageEnabled) storage = getStorage(app);
  const registrationApp = getApps().some((candidate) => candidate.name === "registration")
    ? getApp("registration")
    : initializeApp(config, "registration");
  registrationAuth = getAuth(registrationApp);
  registrationDb = getDatabase(registrationApp);
  configureAuthTokenProvider(() => auth.currentUser?.getIdToken() || "");
  isSupported().then((supported) => {
    if (supported) analytics = getAnalytics(app);
  });

  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectDatabaseEmulator(db, "127.0.0.1", 9000);
      if (storage) connectStorageEmulator(storage, "127.0.0.1", 9199);
      connectAuthEmulator(registrationAuth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectDatabaseEmulator(registrationDb, "127.0.0.1", 9000);
    } catch {
      // Hot reload may initialize emulators more than once.
    }
  }
  authPersistenceReady = Promise.all([
    setPersistence(auth, browserSessionPersistence),
    setPersistence(registrationAuth, inMemoryPersistence)
  ]);
}

const demoDataKey = "taptap-demo-data";
let demoUser = null;

function readDemoData() {
  const saved = localStorage.getItem(demoDataKey);
  const data = saved ? JSON.parse(saved) : {};
  return {
    orders: {},
    menu: {},
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
    let active = true;
    let unsubscribe = () => {};
    authPersistenceReady.then(() => {
      if (!active) return;
      unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (!user) return callback(null);
        const token = await user.getIdTokenResult(true);
        if (token.claims.mfaSession !== true || token.claims.email_verified !== true) {
          try {
            const status = await api.twoFactorStatus();
            return callback({
              uid: user.uid,
              email: user.email,
              name: status.name || user.displayName || user.email,
              role: status.role || token.claims.role || "customer",
              emailVerified: status.emailVerified,
              mfaVerified: token.claims.mfaSession === true,
              twoFactor: status,
              firebaseUser: user
            });
          } catch {
            await signOut(auth);
            return callback(null);
          }
        }
        const profile = await get(ref(db, `users/${user.uid}`));
        callback({
          uid: user.uid,
          email: user.email,
          name: profile.val()?.name || user.displayName || user.email,
          role: token.claims.role || profile.val()?.role || "customer",
          emailVerified: true,
          mfaVerified: true,
          firebaseUser: user
        });
      });
    }).catch(() => callback(null));
    return () => {
      active = false;
      unsubscribe();
    };
  }
  const emit = () => callback(demoUser);
  emit();
  window.addEventListener("taptap-demo-auth", emit);
  return () => window.removeEventListener("taptap-demo-auth", emit);
}

export async function login(email, password, requestedRole, demoAccounts) {
  if (firebaseEnabled) {
    await authPersistenceReady;
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const status = await api.twoFactorStatus();
    const role = status.role || "customer";
    if (requestedRole && requestedRole !== role) {
      await signOut(auth);
      throw new Error(`This account is registered as ${role}, not ${requestedRole}.`);
    }
    return credential.user;
  }

  const match = Object.entries(demoAccounts).find(
    ([role, account]) => role === requestedRole && account.email === email && account.password === password
  );
  if (!match) throw new Error("Invalid preview account or role.");
  const [role, account] = match;
  const user = { uid: `demo-${role}`, email, name: account.name, role };
  demoUser = user;
  window.dispatchEvent(new Event("taptap-demo-auth"));
  return user;
}

export async function completeTwoFactorSession(customToken) {
  if (!firebaseEnabled) return;
  const credential = await signInWithCustomToken(auth, customToken);
  const token = await credential.user.getIdTokenResult(true);
  if (token.claims.mfaSession !== true) throw new Error("The secure POS session could not be created. Please try again.");
  const profile = await get(ref(db, `users/${credential.user.uid}`));
  return {
    uid: credential.user.uid,
    email: credential.user.email,
    name: profile.val()?.name || credential.user.displayName || credential.user.email,
    role: token.claims.role || profile.val()?.role || "customer",
    emailVerified: token.claims.email_verified === true,
    mfaVerified: true,
    firebaseUser: credential.user
  };
}

export async function resendVerificationEmail() {
  if (!firebaseEnabled || !auth.currentUser) throw new Error("Sign in again before requesting a verification email.");
  await reload(auth.currentUser);
  if (auth.currentUser.emailVerified) return { alreadyVerified: true };
  await sendEmailVerification(auth.currentUser);
  return { alreadyVerified: false };
}

export async function refreshEmailVerification() {
  if (!firebaseEnabled || !auth.currentUser) throw new Error("Sign in again before checking verification.");
  await reload(auth.currentUser);
  await auth.currentUser.getIdToken(true);
  const status = await api.twoFactorStatus();
  return {
    verified: status.emailVerified === true,
    status
  };
}

export async function registerCustomer(name, email, password, onProgress = () => {}) {
  if (firebaseEnabled) {
    await authPersistenceReady;
    let user;
    onProgress("auth", "active", "Creating your secure login...");
    try {
      const credential = await createUserWithEmailAndPassword(registrationAuth, email, password);
      user = credential.user;
      await updateProfile(user, { displayName: name });
      onProgress("auth", "success", "Secure login created.");
    } catch (error) {
      if (user) await deleteUser(user).catch(() => {});
      onProgress("auth", "error", friendlyAuthError(error));
      throw error;
    }

    onProgress("profile", "active", "Saving the customer profile...");
    try {
      await set(ref(registrationDb, `users/${user.uid}`), {
        name,
        email,
        role: "customer",
        createdAt: Date.now()
      });
      onProgress("profile", "success", "Customer profile saved.");
    } catch (error) {
      await deleteUser(user).catch(() => {});
      onProgress("profile", "error", "The profile could not be saved, so the incomplete account was removed.");
      throw error;
    }

    let verificationSent = false;
    onProgress("verification", "active", `Requesting a verification email for ${email}...`);
    try {
      await sendEmailVerification(user);
      verificationSent = true;
      onProgress("verification", "success", "Verification email requested.");
    } catch {
      onProgress("verification", "warning", "The account is ready, but the verification email could not be sent. It can be resent after sign-in.");
    }

    onProgress("session", "active", "Finishing registration...");
    await signOut(registrationAuth);
    onProgress("session", "success", "Registration finished. The customer can now sign in.");
    return {
      uid: user.uid,
      email: user.email,
      profilePath: `users/${user.uid}`,
      verificationSent
    };
  }
  const user = { uid: `demo-${crypto.randomUUID()}`, email, name, role: "customer" };
  demoUser = user;
  window.dispatchEvent(new Event("taptap-demo-auth"));
  return { uid: user.uid, email, profilePath: `users/${user.uid}`, verificationSent: false };
}

export function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "This email already has an account. Use sign in or reset the password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Use a stronger password with at least 8 characters.",
    "auth/network-request-failed": "The account service could not be reached. Check the internet connection and try again.",
    "auth/operation-not-allowed": "Email and password registration is not available right now.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-login-credentials": "The email or password is incorrect."
  };
  return messages[error?.code] || error?.message || "The account request could not be completed.";
}

export async function logout() {
  if (firebaseEnabled) {
    await authPersistenceReady;
    return signOut(auth);
  }
  demoUser = null;
  window.dispatchEvent(new Event("taptap-demo-auth"));
}

export async function resetPassword(email) {
  if (!firebaseEnabled) throw new Error("Password reset email is not ready yet.");
  return sendPasswordResetEmail(auth, email);
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
  const normalize = (value = {}) => Object.entries(value)
      .map(([id, notification]) => ({ id, ...notification }))
      .filter((notification) => notification.targetUserId === user.uid && Number(notification.expiresAt || Infinity) > Date.now())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (firebaseEnabled) {
    api.cleanupNotifications().catch(() => {});
    return onValue(
      query(ref(db, "notifications"), orderByChild("targetUserId"), equalTo(user.uid)),
      (snapshot) => callback(normalize(snapshot.val() || {}))
    );
  }
  const emit = () => callback(normalize(readDemoData().notifications));
  emit();
  window.addEventListener("taptap-demo-data", emit);
  window.addEventListener("storage", emit);
  return () => {
    window.removeEventListener("taptap-demo-data", emit);
    window.removeEventListener("storage", emit);
  };
}

export async function createNotification(notification) {
  const entry = { ...notification, createdAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, readAt: null };
  if (firebaseEnabled) return api.createNotification(notification);
  const data = readDemoData();
  data.notifications[`NOTIF-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`] = entry;
  writeDemoData(data);
}

export async function markNotificationRead(notificationId, userId) {
  if (firebaseEnabled) return api.markAllNotificationsRead();
  const data = readDemoData();
  if (data.notifications[notificationId]) {
    if (data.notifications[notificationId].targetUserId === userId) data.notifications[notificationId].readAt = Date.now();
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
  if (firebaseEnabled) {
    const reviewsRef = user.role === "customer"
      ? query(ref(db, "reviews"), orderByChild("customerId"), equalTo(user.uid))
      : ref(db, "reviews");
    return onValue(reviewsRef, (snapshot) => normalize(snapshot.val()));
  }
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
    moderationStatus: "pending",
    createdAt: Date.now()
  };
  if (firebaseEnabled) await set(ref(db, `reviews/${order.id}`), review);
  else {
    const data = readDemoData();
    data.reviews[order.id] = review;
    writeDemoData(data);
  }
  await createNotification({
    targetUserId: firebaseEnabled ? undefined : "demo-staff",
    targetRole: firebaseEnabled ? "staff" : undefined,
    title: "New customer review",
    message: `${user.name} rated order ${order.id} ${rating}/5.`,
    type: "review"
  });
}

export async function moderateReview(review, values, actor) {
  if (firebaseEnabled) return api.updateReview(review.id || review.orderId, values);
  const data = readDemoData();
  const id = review.id || review.orderId;
  data.reviews[id] = {
    ...(data.reviews[id] || review),
    moderationStatus: values.moderationStatus,
    reply: values.reply || "",
    moderatedAt: Date.now(),
    moderatedBy: actor.uid
  };
  data.auditLogs[`AUD-${Date.now()}`] = {
    action: "review_moderated",
    reviewId: id,
    orderId: review.orderId || id,
    status: values.moderationStatus,
    actorId: actor.uid,
    actorName: actor.name,
    actorRole: actor.role,
    createdAt: Date.now()
  };
  writeDemoData(data);
  return { review: { id, ...data.reviews[id] } };
}

export function subscribeMenu(fallback, callback) {
  if (firebaseEnabled) {
    return onValue(ref(db, "public/menu"), (snapshot) => {
      const value = snapshot.val();
      callback(value ? Object.values(value) : fallback);
    });
  }
  const emit = () => {
    const menu = readDemoData().menu || {};
    const fallbackIds = new Set(fallback.map((item) => item.id));
    const merged = fallback.map((item) => ({ ...item, ...(menu[item.id] || {}) }));
    const added = Object.values(menu).filter((item) => item?.id && !fallbackIds.has(item.id));
    callback([...merged, ...added]);
  };
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export function subscribeInventory(fallback, callback) {
  const mergeInventory = (inventory = {}, menu = {}) => {
    const fallbackIds = new Set(fallback.map((item) => item.id));
    const merged = fallback.map((item) => ({
      ...item,
      stock: inventory[item.id]?.stock ?? item.stock,
      reorderPoint: inventory[item.id]?.reorderPoint ?? 10
    }));
    const added = Object.entries(inventory)
      .filter(([id]) => !fallbackIds.has(id))
      .map(([id, item]) => ({ id, ...(menu[id] || {}), ...item }));
    callback([...merged, ...added]);
  };
  if (firebaseEnabled) {
    return onValue(ref(db, "inventory"), (snapshot) => mergeInventory(snapshot.val()));
  }
  const emit = () => {
    const data = readDemoData();
    mergeInventory(data.inventory, data.menu);
  };
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
    return api.adjustInventory(item.id, delta, reason);
  }
  const data = readDemoData();
  data.inventory[item.id] = {
    ...data.inventory[item.id],
    name: item.name,
    reorderPoint: item.reorderPoint ?? 10,
    stock: Math.max(0, (data.inventory[item.id]?.stock ?? item.stock) + delta)
  };
  data.menu[item.id] = { ...(data.menu[item.id] || {}), stock: data.inventory[item.id].stock, reorderPoint: data.inventory[item.id].reorderPoint };
  data.auditLogs[`AUD-${Date.now()}`] = auditEntry;
  writeDemoData(data);
}

export async function updateMenuItem(item, values, actor) {
  if (firebaseEnabled) return api.updateMenuItem(item.id, values);
  const data = readDemoData();
  const updated = {
    ...item,
    ...values,
    price: Number(values.price),
    stock: Number(values.stock),
    reorderPoint: Number(values.reorderPoint),
    walkInOnly: Boolean(values.walkInOnly),
    unavailable: Boolean(values.unavailable),
    updatedAt: Date.now(),
    updatedBy: actor.uid
  };
  data.menu[item.id] = updated;
  data.inventory[item.id] = {
    ...(data.inventory[item.id] || {}),
    name: updated.name,
    category: updated.category,
    price: updated.price,
    stock: updated.stock,
    reorderPoint: updated.reorderPoint,
    unavailable: updated.unavailable
  };
  data.auditLogs[`AUD-${Date.now()}`] = {
    action: "menu_item_updated",
    itemId: item.id,
    itemName: updated.name,
    actorId: actor.uid,
    actorName: actor.name,
    actorRole: actor.role,
    createdAt: Date.now()
  };
  writeDemoData(data);
  return { item: updated };
}

const slugifyMenuId = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);

export async function createMenuItem(values, actor) {
  if (firebaseEnabled) return api.createMenuItem(values);
  const data = readDemoData();
  const id = slugifyMenuId(values.id || values.name);
  if (!id) throw new Error("Enter a valid menu item name.");
  if (data.menu[id]) throw new Error("A menu item with this name already exists.");
  const item = {
    id,
    name: values.name,
    category: values.category || "Favorite Meal",
    description: values.description || "Menu item.",
    price: Number(values.price || 0),
    stock: Number(values.stock || 0),
    reorderPoint: Number(values.reorderPoint ?? 10),
    allergens: [],
    featured: Boolean(values.featured),
    walkInOnly: Boolean(values.walkInOnly),
    unavailable: Boolean(values.unavailable),
    image: values.image || "",
    imagePosition: values.imagePosition || "center",
    createdAt: Date.now(),
    createdBy: actor.uid,
    updatedAt: Date.now(),
    updatedBy: actor.uid
  };
  data.menu[id] = item;
  data.inventory[id] = {
    name: item.name,
    category: item.category,
    price: item.price,
    stock: item.stock,
    reorderPoint: item.reorderPoint,
    unavailable: item.unavailable,
    createdAt: item.createdAt
  };
  data.auditLogs[`AUD-${Date.now()}`] = {
    action: "menu_item_created",
    itemId: id,
    itemName: item.name,
    actorId: actor.uid,
    actorName: actor.name,
    actorRole: actor.role,
    createdAt: Date.now()
  };
  writeDemoData(data);
  return { item };
}

export function subscribeOrders(user, callback) {
  if (!user) {
    callback([]);
    return () => {};
  }
  if (firebaseEnabled) {
    const normalize = (snapshot) => Object.entries(snapshot.val() || {}).map(([id, order]) => ({ id, ...order }));
    if (["owner", "staff"].includes(user.role)) {
      return onValue(ref(db, "orders"), (snapshot) => callback(normalize(snapshot)));
    }
    if (user.role === "customer") {
      const customerOrders = query(ref(db, "orders"), orderByChild("customerId"), equalTo(user.uid));
      return onValue(customerOrders, (snapshot) => callback(normalize(snapshot)));
    }
    if (user.role === "rider") {
      let assigned = [];
      let available = [];
      const emit = () => callback([...new Map([...assigned, ...available].map((order) => [order.id, order])).values()]);
      const assignedOrders = query(ref(db, "orders"), orderByChild("riderId"), equalTo(user.uid));
      const readyOrders = query(ref(db, "orders"), orderByChild("status"), equalTo("ready"));
      const stopAssigned = onValue(assignedOrders, (snapshot) => {
        assigned = normalize(snapshot);
        emit();
      });
      const stopAvailable = onValue(readyOrders, (snapshot) => {
        available = normalize(snapshot).filter((order) => !order.riderId);
        emit();
      });
      return () => {
        stopAssigned();
        stopAvailable();
      };
    }
    callback([]);
    return () => {};
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
    const result = await api.createOrder({
      phone: order.phone,
      address: order.address,
      deliveryType: order.deliveryType,
      notes: order.notes,
      discount: order.discount,
      cashReceived: order.cashReceived,
      diningOption: order.diningOption,
      paymentMethod: order.paymentMethod,
      items: order.items.map(({ id, qty }) => ({ id, qty }))
    });
    trackEvent("purchase", { transaction_id: result.id, value: result.order.total, currency: "PHP" });
    return result.id;
  }
  const data = readDemoData();
  const id = `TAP-${Date.now().toString().slice(-8)}`;
  const onlinePayment = order.paymentMethod === "gcash";
  data.orders[id] = {
    ...order,
    deliveryType: order.deliveryType || (order.customerId === "walk-in" ? "walk-in" : "delivery"),
    notes: order.notes || "",
    createdAt: Date.now(),
    status: onlinePayment ? "pending-payment" : "received",
    paymentStatus: onlinePayment ? "pending" : order.paymentMethod === "cod" ? "cod-pending" : "paid",
    paymentProvider: onlinePayment ? "paymongo" : order.paymentMethod,
    paymentRequiredAt: onlinePayment ? Date.now() : null,
    paymentConfirmedAt: onlinePayment ? null : Date.now()
  };
  for (const item of order.items) {
    const nextStock = Math.max(0, (data.inventory[item.id]?.stock ?? item.stock) - item.qty);
    data.inventory[item.id] = { ...(data.inventory[item.id] || {}), stock: nextStock };
    data.menu[item.id] = { ...(data.menu[item.id] || {}), stock: nextStock };
  }
  writeDemoData(data);
  const notifications = [
    createNotification({ targetUserId: order.customerId, title: onlinePayment ? "Payment pending" : "Order confirmed", message: onlinePayment ? `Order ${id} is waiting for GCash payment confirmation.` : `Order ${id} was received.`, type: "order", orderId: id })
  ];
  if (!onlinePayment) {
    notifications.push(
      createNotification({ targetUserId: "demo-staff", title: "New order received", message: `${id} from ${order.customerName} is waiting in the queue.`, type: "order", orderId: id }),
      createNotification({ targetUserId: "demo-owner", title: "New sale recorded", message: `${id} added ${order.total} PHP to the live sales ledger.`, type: "sale", orderId: id })
    );
  }
  await Promise.all(notifications);
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
    return api.updateOrder(orderId, values);
  }
  const data = readDemoData();
  const currentOrder = data.orders[orderId];
  const nextValues = { ...values };
  if (values.status === "delivered" && currentOrder?.paymentMethod === "cod") {
    nextValues.paymentStatus = "cod-collected";
    nextValues.codCollectedAt = Date.now();
  }
  if (values.codRemitted && currentOrder?.paymentMethod === "cod") {
    nextValues.paymentStatus = "paid";
    nextValues.paymentConfirmedAt = Date.now();
    nextValues.codRemittedAt = Date.now();
  }
  if ((values.cancel || values.status === "cancelled") && currentOrder && currentOrder.status !== "cancelled") {
    nextValues.status = "cancelled";
    nextValues.cancelReason = values.cancelReason || "Cancelled";
    nextValues.cancelledAt = Date.now();
    for (const item of currentOrder.items || []) {
      const currentStock = Number(data.inventory[item.id]?.stock || 0) + Number(item.qty || 0);
      data.inventory[item.id] = { ...(data.inventory[item.id] || {}), stock: currentStock };
      data.menu[item.id] = { ...(data.menu[item.id] || {}), stock: currentStock };
    }
  }
  data.orders[orderId] = { ...data.orders[orderId], ...nextValues };
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
  if (firebaseEnabled) {
    const messagesRef = customerId
      ? query(ref(db, "messages/support"), orderByChild("customerId"), equalTo(customerId))
      : ref(db, "messages/support");
    return onValue(messagesRef, (snapshot) => normalize(snapshot.val()));
  }
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
    ? { targetUserId: firebaseEnabled ? undefined : "demo-staff", targetRole: firebaseEnabled ? "staff" : undefined, title: "New support message", message: `${actor.name}: ${text}`, type: "chat" }
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
    const result = await api.saveShiftLog(entry);
    return result.id;
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

export async function saveRiderLocation(orderId, location) {
  if (firebaseEnabled) {
    return api.updateRiderLocation(orderId, location);
  }
  const data = readDemoData();
  data.riderLocations[orderId] = { ...location, updatedAt: Date.now() };
  writeDemoData(data);
}

export function subscribeRiderLocation(orderId, callback) {
  if (firebaseEnabled) return onValue(ref(db, `orders/${orderId}/riderLocation`), (snapshot) => callback(snapshot.val()));
  const emit = () => callback(readDemoData().riderLocations[orderId] || null);
  emit();
  window.addEventListener("taptap-demo-data", emit);
  return () => window.removeEventListener("taptap-demo-data", emit);
}

export async function uploadProof(orderId, blob) {
  if (!firebaseEnabled) return { proofOfDeliveryUrl: URL.createObjectURL(blob) };
  if (firebaseStorageEnabled) {
    const fileRef = storageRef(storage, `proof-of-delivery/${orderId}/${Date.now()}.jpg`);
    await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
    return { proofOfDeliveryUrl: await getDownloadURL(fileRef) };
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The delivery photo could not be read."));
    reader.readAsDataURL(blob);
  });
  return api.uploadDeliveryProof(orderId, dataUrl);
}

export { auth, db, storage, ref, set, push, update };
