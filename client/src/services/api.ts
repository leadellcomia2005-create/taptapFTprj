import { getAuthToken } from "./authSession";
import { isRecord, requireApiObject } from "../contracts/runtime";
import type {
  ActiveShift,
  Complaint,
  DeliveryLocation,
  DeliveryProofHandoff,
  EntityId,
  InventoryItem,
  MenuItem,
  Notification,
  Order,
  PaymentMethod,
  Review,
  ShiftLog,
  StaffRole,
  SupportConversation,
  SupportMessage,
  UserRole
} from "../types/domain";
import type { ApiErrorResponse } from "../types/records";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue | undefined>;
type JsonRequestInit = Omit<RequestInit, "body" | "headers"> & {
  body?: BodyInit | null;
  headers?: Record<string, string>;
};
type ApiPayload = Partial<ApiErrorResponse> & Record<string, unknown>;
type ApiResult = Record<string, unknown>;

export interface RegisterCustomerRequest extends JsonObject {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  termsAccepted: true;
  privacyAccepted: true;
  botField?: string;
  turnstileToken?: string;
}

export interface RegisterCustomerResponse extends ApiResult {
  uid: EntityId;
  email: string;
  profilePath: string;
  verificationSent: boolean;
  verificationExpiresAt: number;
  cleanupEligibleAt?: number;
}

export interface RegistrationEmailPrecheckResponse extends ApiResult {
  eligible: boolean;
  code: string;
  message: string;
  suggestion?: string;
}

export interface VerificationResendResponse extends ApiResult {
  alreadyVerified: boolean;
  sent?: boolean;
  verificationExpiresAt: number | null;
  cooldownSeconds?: number;
}

export interface TwoFactorStatusResponse extends ApiResult {
  role?: UserRole;
  name?: string;
  emailVerified?: boolean;
  verificationExpiresAt?: number | null;
}

export type TwoFactorPurpose = "setup" | "challenge";
export type TwoFactorMethod = "totp" | "email" | "sms";

export type OrderCreateRequest = Partial<Order> & {
  items: Array<Pick<MenuItem, "id"> & { qty: number }>;
  paymentMethod: PaymentMethod | string;
  idempotencyKey?: string;
};

export type OrderUpdateRequest = Partial<Order> & {
  cancel?: boolean;
  cancelReason?: string;
  codRemitted?: boolean;
  codHandoffRequested?: boolean;
};

export type MenuItemUpdateRequest = Partial<MenuItem>;
export type ReviewUpdateRequest = Partial<Review>;
export type ComplaintUpdateRequest = Partial<Complaint>;
export type ShiftLogRequest = Partial<ShiftLog>;
export type NotificationRequest = Partial<Notification>;
export type HistoryCollection = "audit-logs" | "reports" | "complaints" | "reviews" | "notifications" | "shift-logs";

export interface PaymentCheckoutResponse extends ApiResult {
  id: string;
  checkoutUrl: string | null;
  reused: boolean;
  paid?: boolean;
  reconciled?: boolean;
}

export interface PushNotificationStatusResponse extends ApiResult {
  configured: boolean;
  enabled: boolean;
  tokenCount: number;
}

export interface AssistantResponse extends ApiResult {
  text: string;
  messageId?: EntityId;
  source?: string;
  intent?: string;
  status?: "staff_handling" | "staff_waiting";
  assignedStaffName?: string | null;
  sources?: Array<"Current menu" | "Store information" | "Your order" | "Ordering help" | "General support">;
}

export interface SupportReplyResponse extends ApiResult {
  conversation: SupportConversation;
  message: SupportMessage;
}

export interface InventoryInsightResponse extends ApiResult {
  text: string;
  provider?: "groq" | "openai";
  generatedAt?: number;
  cached?: boolean;
  insight?: {
    summary: string;
    salesTrend: string;
    peakPeriod: string;
    ownerAction: string;
    stockRisks: Array<{ product: string; currentStock: number; reorderPoint: number; severity: "low" | "medium" | "high"; reason: string }>;
    reorderRecommendations: Array<{ product: string; currentStock: number; suggestedQuantity: number; reason: string }>;
    wasteRisks: Array<{ product: string; risk: string; action: string }>;
    dataQuality?: { confidence: "limited" | "moderate" | "strong"; label: string; warnings: string[] };
  };
}

export interface HistoryPage<T extends ApiResult = ApiResult> extends ApiResult {
  records: Array<T & { id: EntityId }>;
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface ApprovalRequest extends JsonObject {
  type: string;
  reason: string;
  targetId?: EntityId;
}

export interface ManagedUserRequest extends JsonObject {
  name?: string;
  email: string;
  temporaryPassword?: string;
  role: UserRole | string;
  staffRole?: StaffRole | string;
}

export type RecoveryIssueType =
  | "incomplete_cancellation"
  | "order_quantity_mismatch"
  | "failed_notification_delivery"
  | "missing_order_aggregate"
  | "unresolved_cod_handoff"
  | "missing_delivery_proof"
  | "stock_projection_mismatch"
  | "stale_idempotency_claim";

export interface RecoveryIssue extends ApiResult {
  id: string;
  type: RecoveryIssueType;
  recordId: EntityId;
  summary: string;
  severity: "warning" | "critical";
  actionable: boolean;
}

export interface RecoveryScanResponse extends ApiResult {
  generatedAt: number;
  issues: RecoveryIssue[];
  summary: Record<string, number>;
  scanned: Record<string, number>;
  truncated: boolean;
}

export interface RecoveryPreviewResponse extends ApiResult {
  issueId: string;
  type: RecoveryIssueType;
  recordId: EntityId;
  previewHash: string;
  changes: string[];
  dryRun: true;
}

export interface RecoveryApplyRequest extends JsonObject {
  issueId: string;
  reason: string;
  requestId: string;
  previewHash: string;
  confirmation: "APPLY_RECOVERY";
}

export interface RecoveryApplyResponse extends ApiResult {
  status: string;
  recordId: EntityId;
  idempotent: boolean;
}

function customerSafeError(message = ""): string {
  const text = String(message || "").trim();
  if (!text) return "";
  if (/server|backend|api|database|token|provider/i.test(text)) {
    return "The app could not finish that action. Please try again.";
  }
  return text;
}

function requestErrorForStatus(status: number, payload: ApiPayload = {}): string {
  if (payload.error) return customerSafeError(payload.error);
  if (status === 404) return "This page needs the latest app update. Restart the app, then try again.";
  if (status === 401) return "Please sign in again before continuing.";
  if (status === 403) return "Your account is not allowed to do that yet.";
  if (status === 413) return "That upload is too large. Try again with a smaller photo.";
  if (status === 429) return "Too many attempts. Please wait a minute, then try again.";
  if (status >= 500) return "The app could not finish that action. Please try again.";
  return "That action could not be completed. Please try again.";
}

async function request<T = ApiResult>(path: string, options: JsonRequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  return requestWithHeaders(path, options, token ? { Authorization: `Bearer ${token}` } : {});
}

async function publicRequest<T = ApiResult>(path: string, options: JsonRequestInit = {}): Promise<T> {
  return requestWithHeaders(path, options);
}

async function requestWithHeaders<T = ApiResult>(path: string, options: JsonRequestInit = {}, authHeaders: Record<string, string> = {}): Promise<T> {
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The email verification service took too long to respond. Please retry.");
    }
    throw new Error("The app could not be reached. Check your connection or restart the app, then try again.");
  }
  const rawPayload: unknown = await response.json().catch(() => ({}));
  const payload = isRecord(rawPayload) ? rawPayload as ApiPayload : {};
  if (!response.ok) {
    const error = new Error(requestErrorForStatus(response.status, payload)) as Error & { code?: string; status?: number };
    error.code = typeof payload.code === "string" ? payload.code : undefined;
    error.status = response.status;
    throw error;
  }
  return requireApiObject(rawPayload) as T;
}

export const api = {
  status: () => request("/status"),
  listHistory: <T extends ApiResult = ApiResult>(collection: HistoryCollection, options: { limit?: number; before?: string } = {}) => {
    const search = new URLSearchParams();
    if (options.limit) search.set("limit", String(options.limit));
    if (options.before) search.set("before", options.before);
    const query = search.size ? `?${search.toString()}` : "";
    return request<HistoryPage<T>>(`/history/${encodeURIComponent(collection)}${query}`);
  },
  registerCustomer: (values: RegisterCustomerRequest) =>
    publicRequest<RegisterCustomerResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  precheckRegistrationEmail: (email: string, signal?: AbortSignal) =>
    publicRequest<RegistrationEmailPrecheckResponse>("/auth/registration-email", {
      method: "POST",
      body: JSON.stringify({ email }),
      signal,
    }),
  resendRegistrationVerification: () =>
    request<VerificationResendResponse>("/auth/verification-email/resend", {
      method: "POST",
      body: "{}",
    }),
  twoFactorStatus: (expectedRole?: UserRole) => request<TwoFactorStatusResponse>(
    expectedRole ? `/2fa/status?expectedRole=${encodeURIComponent(expectedRole)}` : "/2fa/status"
  ),
  beginTotpSetup: () =>
    request("/2fa/setup/totp", { method: "POST", body: "{}" }),
  sendTwoFactorSms: (purpose: TwoFactorPurpose) =>
    request("/2fa/sms/send", {
      method: "POST",
      body: JSON.stringify({ purpose }),
    }),
  sendTwoFactorEmail: (purpose: TwoFactorPurpose) =>
    request("/2fa/email/send", {
      method: "POST",
      body: JSON.stringify({ purpose }),
    }),
  finishTwoFactorSetup: (method: TwoFactorMethod, code: string) =>
    request("/2fa/setup/verify", {
      method: "POST",
      body: JSON.stringify({ method, code }),
    }),
  verifyTwoFactor: (values: JsonObject) =>
    request("/2fa/challenge", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  beginPasskeyRegistration: () =>
    request("/passkeys/register/options", { method: "POST", body: "{}" }),
  verifyPasskeyRegistration: (credential: JsonObject) =>
    request("/passkeys/register/verify", {
      method: "POST",
      body: JSON.stringify(credential),
    }),
  beginPasskeyAuthentication: () =>
    request("/passkeys/authenticate/options", { method: "POST", body: "{}" }),
  verifyPasskeyAuthentication: (credential: JsonObject) =>
    request("/passkeys/authenticate/verify", {
      method: "POST",
      body: JSON.stringify(credential),
    }),
  assistant: (message: string, sessionId: string, context: JsonObject, history: Array<{ role: "user" | "assistant"; text: string }> = []) =>
    request<AssistantResponse>("/assistant", {
      method: "POST",
      body: JSON.stringify({ message, sessionId, context, history }),
    }),
  rateAssistantMessage: (messageId: EntityId, rating: "helpful" | "unhelpful", source: "local" | "groq" | "openai" | "assistant") =>
    request<{ rating: "helpful" | "unhelpful" }>(`/assistant/feedback/${encodeURIComponent(messageId)}`, {
      method: "PUT",
      body: JSON.stringify({ rating, source }),
    }),
  removeAssistantMessageRating: (messageId: EntityId) =>
    request<{ removed: boolean }>(`/assistant/feedback/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
  requestSupportStaff: (customerId: EntityId, reason = "") =>
    request<{ conversation: SupportConversation; duplicate: boolean }>(`/support/conversations/${encodeURIComponent(customerId)}/request-staff`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  replyToSupportConversation: (customerId: EntityId, text: string, customerName: string) =>
    request<SupportReplyResponse>(`/support/conversations/${encodeURIComponent(customerId)}/reply`, {
      method: "POST",
      body: JSON.stringify({ text, customerName }),
    }),
  resumeSupportAssistant: (customerId: EntityId) =>
    request<{ conversation: SupportConversation }>(`/support/conversations/${encodeURIComponent(customerId)}/resume-assistant`, {
      method: "POST",
      body: "{}",
    }),
  insights: (sales: JsonValue, inventory: InventoryItem[], period: "today" | "7d" | "30d" | "all" = "all", category = "all") =>
    request<InventoryInsightResponse>("/insights", {
      method: "POST",
      body: JSON.stringify({ sales, inventory, period, category }),
    }),
  createPayment: (orderId: EntityId) =>
    request<PaymentCheckoutResponse>(`/payments/checkout/${encodeURIComponent(orderId)}`, {
      method: "POST",
      body: "{}",
    }),
  createOrder: (order: OrderCreateRequest) =>
    request("/orders", {
      method: "POST",
      headers: order.idempotencyKey ? { "Idempotency-Key": order.idempotencyKey } : undefined,
      body: JSON.stringify(order),
    }),
  updateOrder: (orderId: EntityId, values: OrderUpdateRequest) =>
    request(`/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  resendReceiptEmail: (orderId: EntityId) =>
    request(`/orders/${encodeURIComponent(orderId)}/receipt-email`, {
      method: "POST",
      body: "{}",
    }),
  adjustInventory: (itemId: EntityId, delta: number, reason: string) =>
    request(`/inventory/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify({ delta, reason }),
    }),
  updateMenuItem: (itemId: EntityId, values: MenuItemUpdateRequest) =>
    request(`/menu/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  createMenuItem: (values: MenuItemUpdateRequest) =>
    request("/menu", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  updateReview: (reviewId: EntityId, values: ReviewUpdateRequest) =>
    request(`/reviews/${encodeURIComponent(reviewId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  listComplaints: () => request("/complaints"),
  createComplaint: (values: Partial<Complaint>) =>
    request("/complaints", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  updateComplaint: (complaintId: EntityId, values: ComplaintUpdateRequest) =>
    request(`/complaints/${encodeURIComponent(complaintId)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  updateRiderLocation: (orderId: EntityId, location: Partial<DeliveryLocation>) =>
    request("/riders/location", {
      method: "POST",
      body: JSON.stringify({ orderId, ...location }),
    }),
  uploadDeliveryProof: (orderId: EntityId, dataUrl: string, handoff: DeliveryProofHandoff = {}) =>
    request(`/orders/${encodeURIComponent(orderId)}/proof`, {
      method: "POST",
      body: JSON.stringify({ dataUrl, handoff }),
    }),
  saveShiftLog: (entry: ShiftLogRequest) =>
    request("/shift-logs", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
  getActiveShift: () => request("/shifts/active"),
  startShift: (values: Partial<ActiveShift>) =>
    request("/shifts/start", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  closeShift: (values: ShiftLogRequest) =>
    request("/shifts/close", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  listApprovals: () => request("/approvals"),
  createApproval: (values: ApprovalRequest) =>
    request("/approvals", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  resolveApproval: (requestId: EntityId, decision: "approved" | "rejected" | string, note = "") =>
    request(`/approvals/${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, note }),
    }),
  archiveCompletedOrders: (olderThanDays = 30) =>
    request("/admin/archive-orders", {
      method: "POST",
      body: JSON.stringify({ olderThanDays }),
    }),
  scanRecoveryIssues: (limit = 200) => request<RecoveryScanResponse>(`/admin/recovery/scan?limit=${encodeURIComponent(limit)}`),
  operationalMetrics: () => request("/admin/metrics"),
  previewRecoveryAction: (issueId: string, reason: string) =>
    request<RecoveryPreviewResponse>("/admin/recovery/preview", {
      method: "POST",
      body: JSON.stringify({ issueId, reason }),
    }),
  applyRecoveryAction: (values: RecoveryApplyRequest) =>
    request<RecoveryApplyResponse>("/admin/recovery/apply", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  sendNotification: (notification: NotificationRequest) =>
    request("/notifications/sms", {
      method: "POST",
      body: JSON.stringify(notification),
    }),
  createNotification: (notification: NotificationRequest) =>
    request("/notifications", {
      method: "POST",
      body: JSON.stringify(notification),
    }),
  pushNotificationStatus: () =>
    request<PushNotificationStatusResponse>("/notifications/push/status"),
  registerPushToken: (token: string) =>
    request("/notifications/push-tokens", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  removePushTokens: (token?: string) =>
    request("/notifications/push-tokens", {
      method: "DELETE",
      body: JSON.stringify(token ? { token } : { all: true }),
    }),
  markAllNotificationsRead: () =>
    request("/notifications/read-all", { method: "POST", body: "{}" }),
  markNotificationRead: (notificationId: EntityId) =>
    request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST", body: "{}" }),
  cleanupNotifications: () =>
    request("/notifications/cleanup", { method: "POST", body: "{}" }),
  dismissNotification: (notificationId: EntityId) =>
    request(`/notifications/${encodeURIComponent(notificationId)}`, {
      method: "DELETE",
    }),
  clearReadNotifications: () => request("/notifications/read", { method: "DELETE" }),
  clearNotifications: () => request("/notifications", { method: "DELETE" }),
  assignRole: (uid: EntityId, role: UserRole | string, staffRole: StaffRole | string = "") =>
    request("/admin/roles", {
      method: "POST",
      body: JSON.stringify({ uid, role, staffRole }),
    }),
  listUsers: () => request("/admin/users"),
  createManagedUser: (account: ManagedUserRequest) =>
    request("/admin/users", {
      method: "POST",
      body: JSON.stringify(account),
    }),
  resetUserTwoFactor: (uid: EntityId) =>
    request(`/admin/users/${encodeURIComponent(uid)}/2fa/reset`, {
      method: "POST",
      body: "{}",
    }),
  unlockUserTwoFactor: (uid: EntityId) =>
    request(`/admin/users/${encodeURIComponent(uid)}/2fa/unlock`, {
      method: "POST",
      body: "{}",
    }),
  setUserSuspension: (uid: EntityId, suspended: boolean, reason = "") =>
    request(`/admin/users/${encodeURIComponent(uid)}/suspension`, {
      method: "PATCH",
      body: JSON.stringify({ suspended, reason }),
    }),
  sendAdminMessage: (uid: EntityId, title: string, message: string) =>
    request(`/admin/users/${encodeURIComponent(uid)}/message`, {
      method: "POST",
      body: JSON.stringify({ title, message }),
    }),
};
