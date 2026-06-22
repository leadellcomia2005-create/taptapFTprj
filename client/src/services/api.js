import { getAuthToken } from "./authSession";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const api = {
  status: () => request("/status"),
  twoFactorStatus: () => request("/2fa/status"),
  beginTotpSetup: () =>
    request("/2fa/setup/totp", { method: "POST", body: "{}" }),
  sendTwoFactorSms: (purpose) =>
    request("/2fa/sms/send", {
      method: "POST",
      body: JSON.stringify({ purpose }),
    }),
  sendTwoFactorEmail: (purpose) =>
    request("/2fa/email/send", {
      method: "POST",
      body: JSON.stringify({ purpose }),
    }),
  finishTwoFactorSetup: (method, code) =>
    request("/2fa/setup/verify", {
      method: "POST",
      body: JSON.stringify({ method, code }),
    }),
  verifyTwoFactor: (values) =>
    request("/2fa/challenge", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  assistant: (message, sessionId, context) =>
    request("/assistant", {
      method: "POST",
      body: JSON.stringify({ message, sessionId, context }),
    }),
  insights: (sales, inventory) =>
    request("/insights", {
      method: "POST",
      body: JSON.stringify({ sales, inventory }),
    }),
  createPayment: (order) =>
    request("/payments/checkout", {
      method: "POST",
      body: JSON.stringify(order),
    }),
  createOrder: (order) =>
    request("/orders", {
      method: "POST",
      body: JSON.stringify(order),
    }),
  updateOrder: (orderId, values) =>
    request(`/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  adjustInventory: (itemId, delta, reason) =>
    request(`/inventory/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify({ delta, reason }),
    }),
  updateMenuItem: (itemId, values) =>
    request(`/menu/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  updateRiderLocation: (orderId, location) =>
    request("/riders/location", {
      method: "POST",
      body: JSON.stringify({ orderId, ...location }),
    }),
  uploadDeliveryProof: (orderId, dataUrl) =>
    request(`/orders/${encodeURIComponent(orderId)}/proof`, {
      method: "POST",
      body: JSON.stringify({ dataUrl }),
    }),
  saveShiftLog: (entry) =>
    request("/shift-logs", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
  sendNotification: (notification) =>
    request("/notifications/sms", {
      method: "POST",
      body: JSON.stringify(notification),
    }),
  createNotification: (notification) =>
    request("/notifications", {
      method: "POST",
      body: JSON.stringify(notification),
    }),
  markAllNotificationsRead: () =>
    request("/notifications/read-all", { method: "POST", body: "{}" }),
  cleanupNotifications: () =>
    request("/notifications/cleanup", { method: "POST", body: "{}" }),
  dismissNotification: (notificationId) =>
    request(`/notifications/${encodeURIComponent(notificationId)}`, {
      method: "DELETE",
    }),
  clearNotifications: () => request("/notifications", { method: "DELETE" }),
  assignRole: (uid, role) =>
    request("/admin/roles", {
      method: "POST",
      body: JSON.stringify({ uid, role }),
    }),
  listUsers: () => request("/admin/users"),
  resetUserTwoFactor: (uid) =>
    request(`/admin/users/${encodeURIComponent(uid)}/2fa/reset`, {
      method: "POST",
      body: "{}",
    }),
  unlockUserTwoFactor: (uid) =>
    request(`/admin/users/${encodeURIComponent(uid)}/2fa/unlock`, {
      method: "POST",
      body: "{}",
    }),
  sendAdminMessage: (uid, title, message) =>
    request(`/admin/users/${encodeURIComponent(uid)}/message`, {
      method: "POST",
      body: JSON.stringify({ title, message }),
    }),
};
