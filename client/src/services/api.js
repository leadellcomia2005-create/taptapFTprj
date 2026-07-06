import { getAuthToken } from "./authSession";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

function customerSafeError(message = "") {
  const text = String(message || "").trim();
  if (!text) return "";
  if (/server|backend|api|database|token|provider/i.test(text)) {
    return "The app could not finish that action. Please try again.";
  }
  return text;
}

function requestErrorForStatus(status, payload = {}) {
  if (payload.error) return customerSafeError(payload.error);
  if (status === 404) return "This page needs the latest app update. Restart the app, then try again.";
  if (status === 401) return "Please sign in again before continuing.";
  if (status === 403) return "Your account is not allowed to do that yet.";
  if (status === 413) return "That upload is too large. Try again with a smaller photo.";
  if (status === 429) return "Too many attempts. Please wait a minute, then try again.";
  if (status >= 500) return "The app could not finish that action. Please try again.";
  return "That action could not be completed. Please try again.";
}

async function request(path, options = {}) {
  const token = await getAuthToken();
  return requestWithHeaders(path, options, token ? { Authorization: `Bearer ${token}` } : {});
}

async function publicRequest(path, options = {}) {
  return requestWithHeaders(path, options);
}

async function requestWithHeaders(path, options = {}, authHeaders = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...options.headers,
      },
    });
  } catch {
    throw new Error("The app could not be reached. Check your connection or restart the app, then try again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(requestErrorForStatus(response.status, payload));
  return payload;
}

export const api = {
  status: () => request("/status"),
  registerCustomer: (values) =>
    publicRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify(values),
    }),
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
  beginPasskeyRegistration: () =>
    request("/passkeys/register/options", { method: "POST", body: "{}" }),
  verifyPasskeyRegistration: (credential) =>
    request("/passkeys/register/verify", {
      method: "POST",
      body: JSON.stringify(credential),
    }),
  beginPasskeyAuthentication: () =>
    request("/passkeys/authenticate/options", { method: "POST", body: "{}" }),
  verifyPasskeyAuthentication: (credential) =>
    request("/passkeys/authenticate/verify", {
      method: "POST",
      body: JSON.stringify(credential),
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
  resendReceiptEmail: (orderId) =>
    request(`/orders/${encodeURIComponent(orderId)}/receipt-email`, {
      method: "POST",
      body: "{}",
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
  createMenuItem: (values) =>
    request("/menu", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  updateReview: (reviewId, values) =>
    request(`/reviews/${encodeURIComponent(reviewId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  listComplaints: () => request("/complaints"),
  createComplaint: (values) =>
    request("/complaints", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  updateComplaint: (complaintId, values) =>
    request(`/complaints/${encodeURIComponent(complaintId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  updateRiderLocation: (orderId, location) =>
    request("/riders/location", {
      method: "POST",
      body: JSON.stringify({ orderId, ...location }),
    }),
  uploadDeliveryProof: (orderId, dataUrl, handoff = {}) =>
    request(`/orders/${encodeURIComponent(orderId)}/proof`, {
      method: "POST",
      body: JSON.stringify({ dataUrl, handoff }),
    }),
  saveShiftLog: (entry) =>
    request("/shift-logs", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
  getActiveShift: () => request("/shifts/active"),
  startShift: (values) =>
    request("/shifts/start", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  closeShift: (values) =>
    request("/shifts/close", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  listApprovals: () => request("/approvals"),
  createApproval: (values) =>
    request("/approvals", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  resolveApproval: (requestId, decision, note = "") =>
    request(`/approvals/${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, note }),
    }),
  archiveCompletedOrders: (olderThanDays = 30) =>
    request("/admin/archive-orders", {
      method: "POST",
      body: JSON.stringify({ olderThanDays }),
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
  assignRole: (uid, role, staffRole = "") =>
    request("/admin/roles", {
      method: "POST",
      body: JSON.stringify({ uid, role, staffRole }),
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
