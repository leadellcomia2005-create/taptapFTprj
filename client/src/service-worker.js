/* global __TAPTAP_BUILD_ID__ */
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

const pwaEnabled = import.meta.env.VITE_ENABLE_PWA !== "false";
const cachePrefix = "taptap-static-";
const staticCacheName = `${cachePrefix}${__TAPTAP_BUILD_ID__}`;
const offlineUrl = "/offline.html";
const appShellResources = [
  offlineUrl,
  "/manifest.webmanifest",
  "/assets/taptap-logo.webp"
];
const validPushOrderId = /^[A-Za-z0-9_-]{1,160}$/;

function safePushText(value, fallback, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

function safePushData(value = {}) {
  const orderId = typeof value.orderId === "string" ? value.orderId.trim() : "";
  return {
    title: safePushText(value.title, "TapTap Foodtrip", 80),
    body: safePushText(value.body, "Your order has an update.", 220),
    event: safePushText(value.event, "order-update", 80),
    destination: value.destination === "orders" ? "orders" : "",
    orderId: validPushOrderId.test(orderId) ? orderId : ""
  };
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

function isPrivateOrMutablePath(pathname) {
  return pathname.startsWith("/api/")
    || pathname.startsWith("/socket.io/")
    || pathname.startsWith("/__/")
    || /(?:checkout|payment|paymongo|delivery-proof|notifications)/i.test(pathname);
}

function isSafeStaticRequest(request, url) {
  if (isPrivateOrMutablePath(url.pathname)) return false;
  if (url.pathname === "/manifest.webmanifest" || url.pathname === offlineUrl) return true;
  return url.pathname.startsWith("/assets/")
    && ["font", "image", "script", "style"].includes(request.destination);
}

if (pwaEnabled) {
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(staticCacheName).then((cache) => cache.addAll(appShellResources))
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(cachePrefix) && name !== staticCacheName)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })());
  });

  self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || isPrivateOrMutablePath(url.pathname)) return;

    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request).catch(async () => (await caches.match(offlineUrl)) || Response.error())
      );
      return;
    }

    if (!isSafeStaticRequest(request, url)) return;
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(staticCacheName);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  });

  self.addEventListener("message", (event) => {
    if (event.data?.type === "TAPTAP_ACTIVATE_UPDATE") self.skipWaiting();
  });
}

const messagingConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
);

if (messagingConfigured) {
  const messaging = getMessaging(initializeApp(firebaseConfig, "taptap-service-worker"));
  onBackgroundMessage(messaging, (payload) => {
    const data = safePushData(payload.data);
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/assets/taptap-logo.png",
      badge: "/assets/taptap-logo.png",
      tag: `taptap-${data.orderId || "order"}-${data.event || "update"}`,
      renotify: false,
      data
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = safePushData(event.notification.data);
  const targetUrl = new URL("/", self.location.origin);
  if (data.destination) targetUrl.searchParams.set("push", data.destination);
  if (data.orderId) targetUrl.searchParams.set("orderId", data.orderId);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const current = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (current) {
      current.postMessage({ type: "TAPTAP_PUSH_OPEN", destination: data.destination, orderId: data.orderId });
      return current.focus();
    }
    return self.clients.openWindow(targetUrl.href);
  })());
});
