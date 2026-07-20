import { z } from "zod";
import {
  complaintStatusSchema,
  complaintTypeSchema,
  deliveryTypeSchema,
  notificationTypeSchema,
  orderStatusSchema,
  paymentMethodSchema,
  reviewModerationStatusSchema,
  staffRoleSchema,
  userRoleSchema
} from "./domain.js";

export const recordIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/, "Invalid record ID.");
const text = (maximum) => z.string().max(maximum);
const optionalText = (maximum) => text(maximum).optional();
const finiteNumber = z.coerce.number().finite();
const optionalFiniteNumber = finiteNumber.optional();
const optionalBoolean = z.boolean().optional();

export const orderItemSchema = z.object({
  id: recordIdSchema,
  qty: z.coerce.number().int().min(1).max(50)
}).passthrough();

export const locationSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(10000).optional(),
  address: optionalText(300),
  landmark: optionalText(160),
  source: optionalText(40)
}).passthrough();

export const createOrderSchema = z.object({
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9_-]{12,128}$/).optional(),
  items: z.array(orderItemSchema).min(1).max(50),
  paymentMethod: paymentMethodSchema,
  deliveryType: deliveryTypeSchema.optional(),
  phone: optionalText(40),
  address: optionalText(300),
  landmark: optionalText(160),
  notes: optionalText(300),
  deliveryLocation: locationSchema.nullable().optional(),
  smsNotifications: optionalBoolean,
  discount: optionalFiniteNumber,
  discountReason: optionalText(80),
  cashReceived: optionalFiniteNumber,
  diningOption: optionalText(40)
}).passthrough();

export const updateOrderSchema = z.object({
  status: orderStatusSchema.optional(),
  cancel: optionalBoolean,
  cancelReason: optionalText(160),
  riderId: recordIdSchema.nullable().optional(),
  deliveryIssue: optionalText(160),
  codHandoffRequested: optionalBoolean,
  codRemitted: optionalBoolean,
  proofOfDeliveryUrl: z.string().url().max(2000).optional(),
  proofOfDeliveryRef: optionalText(180),
  proofOfDeliveryMeta: z.object({
    customerName: optionalText(80),
    signature: optionalText(80),
    otpVerified: optionalBoolean,
    capturedAt: optionalFiniteNumber,
    photoQualityWarning: optionalText(160)
  }).passthrough().optional()
}).passthrough();

export const inventoryAdjustmentSchema = z.object({
  delta: z.coerce.number().int().min(-1000).max(1000).refine((value) => value !== 0, "Adjustment cannot be zero."),
  reason: z.string().trim().min(1).max(120)
}).passthrough();

export const complaintCreateSchema = z.object({
  orderId: recordIdSchema,
  type: complaintTypeSchema,
  details: z.string().trim().min(1).max(700),
  requestedResolution: optionalText(220)
}).passthrough();

export const complaintUpdateSchema = z.object({
  status: complaintStatusSchema.optional(),
  resolution: optionalText(700)
}).passthrough();

export const riderLocationSchema = locationSchema.extend({ orderId: recordIdSchema });

export const deliveryProofSchema = z.object({
  dataUrl: z.string().startsWith("data:image/jpeg;base64,").max(700000),
  handoff: z.object({
    otp: optionalText(12),
    customerName: optionalText(80),
    signature: optionalText(80),
    photoQualityWarning: optionalText(160)
  }).passthrough().optional()
}).passthrough();

const shiftAmount = z.coerce.number().finite().min(0).max(1000000).optional();
export const shiftStartSchema = z.object({
  openingCash: shiftAmount,
  notes: optionalText(200)
}).passthrough();

export const shiftCloseSchema = z.object({
  cashIn: shiftAmount,
  cashOut: shiftAmount,
  expenses: shiftAmount,
  actualCash: shiftAmount,
  notes: optionalText(300)
}).passthrough();

export const shiftLogSchema = z.object({
  startedAt: optionalFiniteNumber,
  endedAt: optionalFiniteNumber,
  openingCash: optionalFiniteNumber,
  cashSales: optionalFiniteNumber,
  expectedCash: optionalFiniteNumber,
  actualCash: optionalFiniteNumber,
  variance: optionalFiniteNumber,
  orderCount: z.coerce.number().int().min(0).optional(),
  cashIn: optionalFiniteNumber,
  cashOut: optionalFiniteNumber,
  expenses: optionalFiniteNumber,
  notes: optionalText(300)
}).passthrough();

export const managedAccountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  role: userRoleSchema.exclude(["customer"]),
  staffRole: staffRoleSchema.optional(),
  temporaryPassword: z.string().min(12).max(128)
}).passthrough();

export const roleChangeSchema = z.object({
  uid: recordIdSchema,
  role: userRoleSchema,
  staffRole: staffRoleSchema.optional()
}).passthrough();

export const registrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  confirmPassword: z.string().min(12).max(128),
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  botField: optionalText(200),
  turnstileToken: optionalText(4096)
}).passthrough();

export const twoFactorSendSchema = z.object({
  purpose: z.enum(["setup", "challenge"]).optional()
}).passthrough();

export const twoFactorVerifySchema = z.object({
  method: z.enum(["totp", "email", "sms"]),
  code: z.string().trim().min(6).max(64)
}).passthrough();

export const twoFactorChallengeSchema = z.object({
  code: z.string().trim().max(64).optional(),
  backupCode: z.string().trim().max(64).optional()
}).passthrough().refine((input) => Boolean(input.code || input.backupCode), "Enter a verification or backup code.");

export const notificationCreateSchema = z.object({
  targetUserId: recordIdSchema.optional(),
  targetRole: z.enum(["staff"]).optional(),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
  type: notificationTypeSchema.optional(),
  orderId: recordIdSchema.optional()
}).passthrough();

export const orderIdBodySchema = z.object({ orderId: recordIdSchema }).passthrough();

const availabilitySchema = z.object({
  mode: z.enum(["always", "schedule"]).optional(),
  days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).max(7).optional(),
  start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end: z.string().regex(/^\d{2}:\d{2}$/).optional()
}).passthrough();

export const menuItemCreateSchema = z.object({
  id: recordIdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  description: optionalText(220),
  price: z.coerce.number().finite().min(0).max(100000),
  stock: z.coerce.number().int().min(0).max(100000),
  reorderPoint: z.coerce.number().int().min(0).max(10000).optional(),
  availability: availabilitySchema.optional(),
  allergens: z.array(text(40)).max(8).optional(),
  featured: optionalBoolean,
  walkInOnly: optionalBoolean,
  unavailable: optionalBoolean,
  image: optionalText(300),
  imagePosition: optionalText(40)
}).passthrough();

export const menuItemUpdateSchema = menuItemCreateSchema.partial().passthrough();

export const reviewUpdateSchema = z.object({
  moderationStatus: reviewModerationStatusSchema,
  reply: optionalText(500)
}).passthrough();

export const approvalCreateSchema = z.object({
  type: z.enum(["stock_correction", "void_order", "menu_price_change", "menu_visibility", "role_change"]),
  reason: z.string().trim().min(1).max(300),
  targetId: optionalText(128),
  payload: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export const approvalResolutionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: optionalText(240)
}).passthrough();

export const archiveOrdersSchema = z.object({
  olderThanDays: z.coerce.number().int().min(1).max(365).optional()
}).passthrough();

export const orderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: recordIdSchema.optional()
}).passthrough();

export const adminMessageSchema = z.object({
  title: optionalText(120),
  message: z.string().trim().min(1).max(1000)
}).passthrough();

export const accountSuspensionSchema = z.object({
  suspended: z.boolean(),
  reason: optionalText(240)
}).passthrough();

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000).optional(),
  text: z.string().trim().min(1).max(2000).optional(),
  sessionId: optionalText(128)
}).passthrough().refine((input) => Boolean(input.message || input.text), "Enter an assistant message.");

export const recordIdParams = (name) => z.object({ [name]: recordIdSchema }).passthrough();
