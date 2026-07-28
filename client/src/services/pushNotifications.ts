import { api } from "./api";
import { firebaseApp, firebaseEnabled } from "./firebase";
import { getWebsiteServiceWorker } from "./pwa";

export type PushNotificationState =
  | "unsupported"
  | "unconfigured"
  | "default"
  | "denied"
  | "enabled"
  | "error";

export type PushNotificationSnapshot = {
  state: PushNotificationState;
  permission: NotificationPermission | "unsupported";
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";
const pushConfigured = firebaseEnabled && Boolean(vapidKey);

function browserPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  return Notification.permission;
}

export function currentPushNotificationState(): PushNotificationSnapshot {
  const permission = browserPermission();
  if (permission === "unsupported") return { state: "unsupported", permission };
  if (permission === "denied") return { state: "denied", permission };
  if (!pushConfigured || !import.meta.env.PROD) return { state: "unconfigured", permission };
  return {
    state: permission === "granted" ? "enabled" : "default",
    permission
  };
}

async function messagingModule() {
  if (!pushConfigured || !firebaseApp) return null;
  const module = await import("firebase/messaging");
  if (!(await module.isSupported())) return null;
  return module;
}

async function currentToken(): Promise<string> {
  const module = await messagingModule();
  const registration = await getWebsiteServiceWorker();
  if (!module || !registration || Notification.permission !== "granted") return "";
  return module.getToken(module.getMessaging(firebaseApp), {
    vapidKey,
    serviceWorkerRegistration: registration
  });
}

export async function syncGrantedPushToken(): Promise<PushNotificationSnapshot> {
  const snapshot = currentPushNotificationState();
  if (snapshot.permission !== "granted" || snapshot.state === "unconfigured") return snapshot;
  try {
    const token = await currentToken();
    if (!token) return { state: "unsupported", permission: snapshot.permission };
    await api.registerPushToken(token);
    return { state: "enabled", permission: "granted" };
  } catch {
    return { state: "error", permission: snapshot.permission };
  }
}

export async function enablePushNotifications(): Promise<PushNotificationSnapshot> {
  const snapshot = currentPushNotificationState();
  if (snapshot.state === "unsupported" || snapshot.state === "unconfigured" || snapshot.state === "denied") {
    return snapshot;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { state: permission === "denied" ? "denied" : "default", permission };
    }
    return syncGrantedPushToken();
  } catch {
    return { state: "error", permission: browserPermission() };
  }
}

export async function disablePushNotifications(): Promise<PushNotificationSnapshot> {
  const permission = browserPermission();
  try {
    const module = await messagingModule();
    const token = permission === "granted" ? await currentToken().catch(() => "") : "";
    await api.removePushTokens(token || undefined);
    if (module && firebaseApp) await module.deleteToken(module.getMessaging(firebaseApp)).catch(() => false);
    return {
      state: permission === "denied" ? "denied" : "default",
      permission
    };
  } catch {
    return { state: "error", permission };
  }
}

export async function listenForForegroundPush(
  listener: (message: { title: string; body: string; orderId?: string }) => void
): Promise<() => void> {
  if (browserPermission() !== "granted") return () => {};
  const module = await messagingModule();
  if (!module || !firebaseApp) return () => {};
  return module.onMessage(module.getMessaging(firebaseApp), (payload) => {
    const data = payload.data || {};
    listener({
      title: data.title || "Order update",
      body: data.body || "Open TapTap Foodtrip for the latest update.",
      orderId: data.orderId
    });
  });
}
