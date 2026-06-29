const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayLabels = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };

const toPoint = (value) => {
  if (!value) return null;
  const lat = Number(Array.isArray(value) ? value[0] : value.lat);
  const lng = Number(Array.isArray(value) ? value[1] : value.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
};

const minutesFromTime = (value) => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : null;
};

export function menuAvailability(item = {}, now = new Date()) {
  if (item.unavailable) return { available: false, label: "Unavailable" };
  const schedule = item.availability || {};
  const mode = schedule.mode || item.availabilityMode || "always";
  if (mode !== "schedule") return { available: true, label: "Available today" };

  const days = Array.isArray(schedule.days) ? schedule.days : [];
  const day = dayKeys[now.getDay()];
  const dayAllowed = days.length === 0 || days.includes(day);
  const start = minutesFromTime(schedule.start || item.availableFrom);
  const end = minutesFromTime(schedule.end || item.availableUntil);
  const current = now.getHours() * 60 + now.getMinutes();
  const timeAllowed = start == null || end == null
    ? true
    : start <= end
      ? current >= start && current <= end
      : current >= start || current <= end;

  const dayText = days.length ? days.map((key) => dayLabels[key] || key).join(", ") : "Daily";
  const timeText = start == null || end == null ? "" : ` ${schedule.start}-${schedule.end}`;
  return {
    available: dayAllowed && timeAllowed,
    label: `${dayText}${timeText}`.trim()
  };
}

export function distanceKm(fromValue, toValue) {
  const from = toPoint(fromValue);
  const to = toPoint(toValue);
  if (!from || !to) return null;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(to[0] - from[0]);
  const dLng = radians(to[1] - from[1]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from[0])) * Math.cos(radians(to[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateDeliveryRoute({ store, rider, customer, speedKph = 22 } = {}) {
  const origin = toPoint(rider) || toPoint(store);
  const destination = toPoint(customer);
  if (!origin || !destination) return null;
  const directKm = distanceKm(origin, destination);
  if (!Number.isFinite(directKm)) return null;
  const routeKm = directKm * 1.35;
  const etaMinutes = Math.max(1, Math.round(routeKm / Math.max(5, speedKph) * 60));
  return {
    points: [origin, destination],
    distanceKm: routeKm,
    etaMinutes,
    label: `${etaMinutes} min ETA`,
    distanceLabel: `${routeKm < 1 ? Math.round(routeKm * 1000) + " m" : routeKm.toFixed(1) + " km"}`
  };
}

export function formatElapsed(ms) {
  const minutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function orderPrepClock(order = {}, now = Date.now()) {
  const start = Number(order.prepStartedAt || order.createdAt || now);
  const waitingMs = Math.max(0, now - start);
  const delayed = ["received", "preparing"].includes(order.status) && waitingMs >= 15 * 60000;
  return {
    waitingMs,
    label: formatElapsed(waitingMs),
    delayed
  };
}

export function itemSalesStats(orders = [], inventory = []) {
  const stats = new Map(inventory.map((item) => [item.id, {
    id: item.id,
    name: item.name,
    stock: Number(item.stock || 0),
    reorderPoint: Number(item.reorderPoint ?? 10),
    qty: 0,
    sales: 0,
    recentQty: 0
  }]));
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const order of orders) {
    if (["cancelled", "pending-payment"].includes(order.status)) continue;
    for (const item of order.items || []) {
      const current = stats.get(item.id) || { id: item.id, name: item.name, stock: 0, reorderPoint: 0, qty: 0, sales: 0, recentQty: 0 };
      const qty = Number(item.qty || 0);
      current.qty += qty;
      current.sales += qty * Number(item.price || 0);
      if (Number(order.createdAt || 0) >= since) current.recentQty += qty;
      stats.set(item.id, current);
    }
  }
  return [...stats.values()].map((item) => {
    const dailyVelocity = item.recentQty / 7;
    return {
      ...item,
      dailyVelocity,
      daysLeft: dailyVelocity > 0 ? item.stock / dailyVelocity : Infinity
    };
  });
}

export const bestSellers = (orders, inventory, count = 5) =>
  itemSalesStats(orders, inventory).filter((item) => item.qty > 0).sort((a, b) => b.qty - a.qty || b.sales - a.sales).slice(0, count);

export const slowMovingItems = (orders, inventory, count = 5) =>
  itemSalesStats(orders, inventory).sort((a, b) => a.qty - b.qty || b.stock - a.stock).slice(0, count);

export const forecastRunouts = (orders, inventory, count = 6) =>
  itemSalesStats(orders, inventory)
    .filter((item) => item.stock > 0 && item.daysLeft !== Infinity)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, count);

export function peakOrderHours(orders = []) {
  const hours = new Map();
  for (const order of orders) {
    const hour = new Date(Number(order.createdAt || 0)).getHours();
    hours.set(hour, (hours.get(hour) || 0) + 1);
  }
  return [...hours.entries()]
    .map(([hour, count]) => ({ hour, count, label: `${String(hour).padStart(2, "0")}:00` }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}
