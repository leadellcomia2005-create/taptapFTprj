import { z } from "zod";

export const userRoleSchema = z.enum(["customer", "owner", "staff", "rider"]);
export const staffRoleSchema = z.enum(["manager", "cashier", "kitchen", "inventory"]);
export const orderStatusSchema = z.enum([
  "pending-payment",
  "received",
  "preparing",
  "ready",
  "out-for-delivery",
  "arrived",
  "delivered",
  "completed",
  "cancelled"
]);
export const paymentMethodSchema = z.enum(["gcash", "cod", "cash"]);
export const paymentStatusSchema = z.enum([
  "pending",
  "paid",
  "cod-pending",
  "cod-collected",
  "failed",
  "refunded"
]);
export const deliveryTypeSchema = z.enum(["delivery", "pickup", "walk-in"]);
export const reviewModerationStatusSchema = z.enum(["pending", "approved", "hidden"]);
export const complaintTypeSchema = z.enum(["wrong-item", "missing-item", "late-order", "bad-food"]);
export const complaintStatusSchema = z.enum(["pending", "reviewed", "resolved"]);
export const notificationTypeSchema = z.enum([
  "order",
  "sale",
  "delivery",
  "inventory",
  "review",
  "complaint",
  "shift",
  "chat",
  "admin",
  "system"
]);
export const notificationEntityTypeSchema = z.enum([
  "order",
  "complaint",
  "delivery",
  "payment",
  "inventory",
  "review",
  "shift",
  "chat",
  "system"
]);
export const notificationActionViewSchema = z.enum([
  "orders",
  "receipts",
  "feedback",
  "owner-sales",
  "owner-inventory",
  "owner-reports",
  "owner-reviews",
  "staff-pos",
  "staff-kitchen",
  "staff-orders",
  "staff-inventory",
  "staff-shifts",
  "staff-chat",
  "staff-reviews",
  "rider-orders",
  "rider-cod"
]);

export const deliveryLocationContractSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(10_000).optional(),
  address: z.string().max(300).optional(),
  landmark: z.string().max(160).optional(),
  source: z.string().max(40).optional()
}).passthrough();

export const userContractSchema = z.object({
  uid: z.string().min(1).max(128),
  role: userRoleSchema,
  staffRole: staffRoleSchema.optional(),
  name: z.string().max(80).optional(),
  email: z.string().email().max(254).optional()
}).passthrough();

export const orderItemContractSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(120).optional(),
  price: z.number().finite().min(0).optional(),
  qty: z.number().int().min(1).max(50)
}).passthrough();

export const orderContractSchema = z.object({
  customerId: z.string().min(1).max(128),
  items: z.array(orderItemContractSchema).min(1).max(50),
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema.optional(),
  deliveryType: deliveryTypeSchema,
  deliveryLocation: deliveryLocationContractSchema.nullable().optional(),
  subtotal: z.number().finite().min(0),
  total: z.number().finite().min(0),
  createdAt: z.number().finite()
}).passthrough();

export const inventoryItemContractSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  price: z.number().finite().min(0),
  stock: z.number().int().min(0),
  reorderPoint: z.number().int().min(0)
}).passthrough();

export const paymentContractSchema = z.object({
  orderId: z.string().min(1).max(128),
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  amount: z.number().finite().min(0),
  createdAt: z.number().finite()
}).passthrough();

export const reviewContractSchema = z.object({
  orderId: z.string().min(1).max(128),
  customerId: z.string().min(1).max(128),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1_000),
  moderationStatus: reviewModerationStatusSchema,
  createdAt: z.number().finite()
}).passthrough();

export const complaintContractSchema = z.object({
  orderId: z.string().min(1).max(128),
  customerId: z.string().min(1).max(128),
  type: complaintTypeSchema,
  status: complaintStatusSchema,
  details: z.string().max(700),
  createdAt: z.number().finite()
}).passthrough();

export const shiftContractSchema = z.object({
  staffId: z.string().min(1).max(128),
  startedAt: z.number().finite(),
  endedAt: z.number().finite().optional(),
  openingCash: z.number().finite().min(0),
  createdAt: z.number().finite()
}).passthrough();

export const notificationContractSchema = z.object({
  targetUserId: z.string().min(1).max(128),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(1_000),
  type: notificationTypeSchema,
  createdAt: z.number().finite(),
  orderId: z.string().min(1).max(128).optional(),
  entityType: notificationEntityTypeSchema.optional(),
  entityId: z.string().min(1).max(128).optional(),
  displayReference: z.string().min(1).max(80).optional(),
  amount: z.number().finite().min(0).max(1_000_000_000).optional(),
  actionView: notificationActionViewSchema.optional()
}).passthrough();

export const apiErrorResponseSchema = z.object({
  error: z.string().min(1),
  code: z.string().optional(),
  details: z.unknown().optional(),
  requestId: z.string().nullable().optional()
}).passthrough();

export const paginationSchema = z.object({
  limit: z.number().int().positive(),
  nextCursor: z.string().nullable()
});
