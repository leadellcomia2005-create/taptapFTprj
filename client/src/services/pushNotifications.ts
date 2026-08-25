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
const validPushOrderId = /^[A-Za-z0-9_-]{1,160}$/;

function safePushText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

function safePushOrderId(value: unknown): string | undefined {
  const orderId = typeof value === "string" ? value.trim() : "";
  return validPushOrderId.test(orderId) ? orderId : undefined;
}

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

async function removeCurrentBrowserToken(): Promise<void> {
  const module = await messagingModule();
  if (!module || !firebaseApp || browserPermission() !== "granted") return;

  const messaging = module.getMessaging(firebaseApp);
  const token = await currentToken();
  let removalError: unknown;

  if (token) {
    try {
      await api.removePushTokens(token);
    } catch (error) {
      removalError = error;
    }
  }

  try {
    await module.deleteToken(messaging);
  } catch (error) {
    removalError ||= error;
  }

  if (removalError) throw removalError;
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
    await removeCurrentBrowserToken();
    return {
      state: permission === "denied" ? "denied" : "default",
      permission
    };
  } catch {
    return { state: "error", permission };
  }
}

export async function detachCurrentPushTokenForSignOut(): Promise<void> {
  try {
    await removeCurrentBrowserToken();
  } catch {
    // Signing out must still succeed. Invalid or unreachable tokens are cleaned up server-side.
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
      title: safePushText(data.title, "Order update", 80),
      body: safePushText(data.body, "Open TapTap Foodtrip for the latest update.", 220),
      orderId: safePushOrderId(data.orderId)
    });
  });
}
