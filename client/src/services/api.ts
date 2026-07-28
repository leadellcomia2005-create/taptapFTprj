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

export interface TwoFactorStatusResponse extends ApiResult {
  role?: UserRole;
  name?: string;
  emailVerified?: boolean;
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
  checkoutUrl: string;
  reused: boolean;
}

export interface PushNotificationStatusResponse extends ApiResult {
  configured: boolean;
  enabled: boolean;
  tokenCount: number;
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
  } catch {
    throw new Error("The app could not be reached. Check your connection or restart the app, then try again.");
  }
  const rawPayload: unknown = await response.json().catch(() => ({}));
  const payload = isRecord(rawPayload) ? rawPayload as ApiPayload : {};
  if (!response.ok)
    throw new Error(requestErrorForStatus(response.status, payload));
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
    publicRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  twoFactorStatus: () => request<TwoFactorStatusResponse>("/2fa/status"),
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
  assistant: (message: string, sessionId: string, context: JsonObject) =>
    request("/assistant", {
      method: "POST",
      body: JSON.stringify({ message, sessionId, context }),
    }),
  insights: (sales: JsonValue, inventory: InventoryItem[]) =>
    request("/insights", {
      method: "POST",
      body: JSON.stringify({ sales, inventory }),
    }),
  createPayment: (order: Partial<Order>) =>
    request<PaymentCheckoutResponse>("/payments/checkout", {
      method: "POST",
      body: JSON.stringify(order),
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
