import { getAuthToken } from "./authSession";

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
  createOrder: (order) => request("/orders", {
    method: "POST",
    body: JSON.stringify(order)
  }),
  updateOrder: (orderId, values) => request(`/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: JSON.stringify(values)
  }),
  adjustInventory: (itemId, delta, reason) => request(`/inventory/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify({ delta, reason })
  }),
  updateRiderLocation: (orderId, location) => request("/riders/location", {
    method: "POST",
    body: JSON.stringify({ orderId, ...location })
  }),
  uploadDeliveryProof: (orderId, dataUrl) => request(`/orders/${encodeURIComponent(orderId)}/proof`, {
    method: "POST",
    body: JSON.stringify({ dataUrl })
  }),
  saveShiftLog: (entry) => request("/shift-logs", {
    method: "POST",
    body: JSON.stringify(entry)
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
