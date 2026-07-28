import {
  DELIVERY_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  STAFF_ROLES,
  USER_ROLES
} from "../types/constants";
import type {
  AuditLog,
  Complaint,
  DeliveryType,
  InventoryItem,
  MenuItem,
  Notification,
  Order,
  OrderStatus,
  PaymentMethod,
  PublicReview,
  Review,
  ShiftLog,
  StaffRole,
  UserRole
} from "../types/domain";
import type { RuntimeGuard } from "../types/records";

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAllowedValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

export const isUserRole = (value: unknown): value is UserRole => isAllowedValue(USER_ROLES, value);
export const isStaffRole = (value: unknown): value is StaffRole => isAllowedValue(STAFF_ROLES, value);
export const isOrderStatus = (value: unknown): value is OrderStatus => isAllowedValue(ORDER_STATUSES, value);
export const isPaymentMethod = (value: unknown): value is PaymentMethod => isAllowedValue(PAYMENT_METHODS, value);
export const isDeliveryType = (value: unknown): value is DeliveryType => isAllowedValue(DELIVERY_TYPES, value);

export const isMenuItem: RuntimeGuard<MenuItem> = (value): value is MenuItem =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.name) &&
  isText(value.category) &&
  isFiniteNumber(value.price) &&
  value.price >= 0;

export const isInventoryItem: RuntimeGuard<InventoryItem> = (value): value is InventoryItem =>
  isMenuItem(value) &&
  isFiniteNumber(value.stock) &&
  isFiniteNumber(value.reorderPoint);

export const isOrder: RuntimeGuard<Order> = (value): value is Order =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.customerId) &&
  Array.isArray(value.items) &&
  isOrderStatus(value.status) &&
  isPaymentMethod(value.paymentMethod) &&
  isDeliveryType(value.deliveryType) &&
  isFiniteNumber(value.total) &&
  isFiniteNumber(value.createdAt);

export const isReview: RuntimeGuard<Review> = (value): value is Review =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.orderId) &&
  isText(value.customerId) &&
  isFiniteNumber(value.rating) &&
  value.rating >= 1 &&
  value.rating <= 5 &&
  isFiniteNumber(value.createdAt);

export const isPublicReview: RuntimeGuard<PublicReview> = (value): value is PublicReview =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.orderId) &&
  isText(value.customerLabel) &&
  isFiniteNumber(value.rating) &&
  value.rating >= 1 &&
  value.rating <= 5 &&
  isText(value.comment) &&
  value.moderationStatus === "approved" &&
  isFiniteNumber(value.createdAt);

export const isComplaint: RuntimeGuard<Complaint> = (value): value is Complaint =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.orderId) &&
  isText(value.customerId) &&
  isText(value.status) &&
  isFiniteNumber(value.createdAt);

export const isNotification: RuntimeGuard<Notification> = (value): value is Notification =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.title) &&
  isText(value.message) &&
  isFiniteNumber(value.createdAt) &&
  (value.orderId === undefined || isText(value.orderId)) &&
  (value.entityId === undefined || isText(value.entityId)) &&
  (value.displayReference === undefined || isText(value.displayReference)) &&
  (value.amount === undefined || (isFiniteNumber(value.amount) && value.amount >= 0)) &&
  (value.actionView === undefined || isText(value.actionView)) &&
  (value.readAt === undefined || value.readAt === null || isFiniteNumber(value.readAt)) &&
  (value.expiresAt === undefined || isFiniteNumber(value.expiresAt));

export const isAuditLog: RuntimeGuard<AuditLog> = (value): value is AuditLog =>
  isRecord(value) && isText(value.id) && isText(value.action) && isFiniteNumber(value.createdAt);

export const isShiftLog: RuntimeGuard<ShiftLog> = (value): value is ShiftLog =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.staffId) &&
  isFiniteNumber(value.startedAt) &&
  isFiniteNumber(value.endedAt);

export function firebaseRecordList<T>(value: unknown, guard: RuntimeGuard<T>): T[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([id, entry]) => {
    if (!isRecord(entry)) return [];
    const candidate = { id, ...entry };
    return guard(candidate) ? [candidate] : [];
  });
}

export function requireApiObject(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new Error("The website received an invalid server response. Please try again.");
  return value;
}
