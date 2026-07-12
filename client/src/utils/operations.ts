import {
  ACTIVE_PREP_ORDER_STATUSES,
  DAY_KEYS,
  DAY_LABELS,
  NON_REVENUE_ORDER_STATUSES
} from "../types/constants";
import type { CartItem, DayKey, DeliveryLocation, InventoryItem, MenuAvailability, MenuItem, Order, TimestampMs } from "../types/domain";

export type Point = [number, number];

export interface MenuAvailabilityResult {
  available: boolean;
  label: string;
}

export interface DeliveryRouteEstimate {
  points: [Point, Point];
  distanceKm: number;
  etaMinutes: number;
  label: string;
  distanceLabel: string;
}

export interface OrderPrepClock {
  waitingMs: number;
  label: string;
  delayed: boolean;
}

export interface ItemSalesStat {
  id: string;
  name: string;
  stock: number;
  reorderPoint: number;
  qty: number;
  sales: number;
  recentQty: number;
  dailyVelocity: number;
  daysLeft: number;
}

export interface PeakOrderHour {
  hour: number;
  count: number;
  label: string;
}

type PointValue = Point | DeliveryLocation | { lat?: number | string; lng?: number | string } | null | undefined;
type SalesOrder = Pick<Order, "status" | "createdAt"> & { items?: Array<Pick<CartItem, "id" | "name" | "price" | "qty">> };
type SalesInventoryItem = Pick<InventoryItem, "id" | "name" | "stock" | "reorderPoint">;

export function createRequestKey(scope = "request"): string {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${scope}_${randomPart}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
}

const toPoint = (value: PointValue): Point | null => {
  if (!value) return null;
  const lat = Number(Array.isArray(value) ? value[0] : value.lat);
  const lng = Number(Array.isArray(value) ? value[1] : value.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
};

const minutesFromTime = (value: unknown): number | null => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : null;
};

export function menuAvailability(item: Partial<MenuItem> = {}, now = new Date()): MenuAvailabilityResult {
  if (item.unavailable) return { available: false, label: "Unavailable" };
  const schedule: Partial<MenuAvailability> = item.availability || {};
  const mode = schedule.mode || item.availabilityMode || "always";
  if (mode !== "schedule") return { available: true, label: "Available today" };

  const days: DayKey[] = Array.isArray(schedule.days) ? schedule.days : [];
  const day = DAY_KEYS[now.getDay()];
  const dayAllowed = days.length === 0 || days.includes(day);
  const start = minutesFromTime(schedule.start || item.availableFrom);
  const end = minutesFromTime(schedule.end || item.availableUntil);
  const current = now.getHours() * 60 + now.getMinutes();
  const timeAllowed = start == null || end == null
    ? true
    : start <= end
      ? current >= start && current <= end
      : current >= start || current <= end;

  const dayText = days.length ? days.map((key) => DAY_LABELS[key] || key).join(", ") : "Daily";
  const timeText = start == null || end == null ? "" : ` ${schedule.start}-${schedule.end}`;
  return {
    available: dayAllowed && timeAllowed,
    label: `${dayText}${timeText}`.trim()
  };
}

export function distanceKm(fromValue: PointValue, toValue: PointValue): number | null {
  const from = toPoint(fromValue);
  const to = toPoint(toValue);
  if (!from || !to) return null;
  const radians = (value: number): number => value * Math.PI / 180;
  const dLat = radians(to[0] - from[0]);
  const dLng = radians(to[1] - from[1]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from[0])) * Math.cos(radians(to[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateDeliveryRoute({
  store,
  rider,
  customer,
  speedKph = 22
}: {
  store?: PointValue;
  rider?: PointValue;
  customer?: PointValue;
  speedKph?: number;
} = {}): DeliveryRouteEstimate | null {
  const origin = toPoint(rider) || toPoint(store);
  const destination = toPoint(customer);
  if (!origin || !destination) return null;
  const directKm = distanceKm(origin, destination);
  if (directKm == null || !Number.isFinite(directKm)) return null;
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

export function formatElapsed(ms: number | string | null | undefined): string {
  const minutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function orderPrepClock(order: Partial<Order> = {}, now: TimestampMs = Date.now()): OrderPrepClock {
  const start = Number(order.prepStartedAt || order.createdAt || now);
  const waitingMs = Math.max(0, now - start);
  const delayed = ACTIVE_PREP_ORDER_STATUSES.includes(order.status as never) && waitingMs >= 15 * 60000;
  return {
    waitingMs,
    label: formatElapsed(waitingMs),
    delayed
  };
}

export function itemSalesStats(orders: SalesOrder[] = [], inventory: SalesInventoryItem[] = []): ItemSalesStat[] {
  const stats = new Map<string, Omit<ItemSalesStat, "dailyVelocity" | "daysLeft">>(inventory.map((item) => [item.id, {
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
    if (NON_REVENUE_ORDER_STATUSES.includes(order.status as never)) continue;
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

export const bestSellers = (orders: SalesOrder[], inventory: SalesInventoryItem[], count = 5): ItemSalesStat[] =>
  itemSalesStats(orders, inventory).filter((item) => item.qty > 0).sort((a, b) => b.qty - a.qty || b.sales - a.sales).slice(0, count);

export const slowMovingItems = (orders: SalesOrder[], inventory: SalesInventoryItem[], count = 5): ItemSalesStat[] =>
  itemSalesStats(orders, inventory).sort((a, b) => a.qty - b.qty || b.stock - a.stock).slice(0, count);

export const forecastRunouts = (orders: SalesOrder[], inventory: SalesInventoryItem[], count = 6): ItemSalesStat[] =>
  itemSalesStats(orders, inventory)
    .filter((item) => item.stock > 0 && item.daysLeft !== Infinity)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, count);

export function peakOrderHours(orders: Array<Pick<Order, "createdAt">> = []): PeakOrderHour[] {
  const hours = new Map<number, number>();
  for (const order of orders) {
    const hour = new Date(Number(order.createdAt || 0)).getHours();
    hours.set(hour, (hours.get(hour) || 0) + 1);
  }
  return [...hours.entries()]
    .map(([hour, count]) => ({ hour, count, label: `${String(hour).padStart(2, "0")}:00` }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}
