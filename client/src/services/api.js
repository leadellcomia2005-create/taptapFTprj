import { getAuthToken } from "./firebase";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const api = {
  status: () => request("/status"),
  assistant: (message, sessionId, context) => request("/assistant", {
    method: "POST",
    body: JSON.stringify({ message, sessionId, context })
  }),
  insights: (sales, inventory) => request("/insights", {
    method: "POST",
    body: JSON.stringify({ sales, inventory })
  }),
  createPayment: (order) => request("/payments/checkout", {
    method: "POST",
    body: JSON.stringify(order)
  }),
  sendNotification: (notification) => request("/notifications/sms", {
    method: "POST",
    body: JSON.stringify(notification)
  }),
  assignRole: (uid, role) => request("/admin/roles", {
    method: "POST",
    body: JSON.stringify({ uid, role })
  })
};
