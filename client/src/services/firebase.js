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
  return saved ? JSON.parse(saved) : { orders: {}, inventory: {}, riderLocations: {}, users: {} };
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
    return id;
  }
  const data = readDemoData();
  const id = `TAP-${Date.now().toString().slice(-8)}`;
  data.orders[id] = { ...order, createdAt: Date.now(), status: "received" };
  for (const item of order.items) {
    data.inventory[item.id] = { stock: Math.max(0, (data.inventory[item.id]?.stock ?? item.stock) - item.qty) };
  }
  writeDemoData(data);
  return id;
}

export function trackEvent(name, parameters = {}) {
  if (analytics) logEvent(analytics, name, parameters);
}

export async function updateOrder(orderId, values) {
  if (firebaseEnabled) return update(ref(db, `orders/${orderId}`), values);
  const data = readDemoData();
  data.orders[orderId] = { ...data.orders[orderId], ...values };
  writeDemoData(data);
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
