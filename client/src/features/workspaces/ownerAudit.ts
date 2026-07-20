import type { AuditLog } from "../../types/domain";

export type AuditEntry = Partial<AuditLog> & {
  emailHash?: string;
  ipHash?: string;
  targetUserId?: string;
  userId?: string;
  uid?: string;
  provider?: string;
  method?: string;
  hostname?: string;
};

export const ownerPlanningStorageKey = "taptap-owner-planning";

export function ownerPlanningDefaults(): { salesGoal: number; activePromotion: string } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ownerPlanningStorageKey) || "{}") as Record<string, unknown>;
    return {
      salesGoal: Math.max(1, Number(saved.salesGoal || 100000)),
      activePromotion: String(saved.activePromotion || "No active promotion")
    };
  } catch {
    return { salesGoal: 100000, activePromotion: "No active promotion" };
  }
}

export const securityAuditActions = new Set([
  "registration_security_check_passed",
  "registration_started",
  "registration_failed",
  "registration_rate_limited",
  "admin_user_created",
  "role_changed",
  "account_suspended",
  "account_reactivated",
  "account_created",
  "2fa_failure",
  "2fa_lockout",
  "2fa_success",
  "2fa_password_reset_unlock",
  "2fa_setup_started",
  "2fa_sms_sent",
  "2fa_email_sent",
  "2fa_enabled",
  "2fa_reset",
  "2fa_unlocked",
  "passkey_registered",
  "passkey_verified"
]);

export function auditActionLabel(action = ""): string {
  return String(action || "audit event")
    .replace(/^2fa_/, "Security ")
    .replace(/^passkey_/, "Passkey ")
    .replace(/^registration_/, "Registration ")
    .replaceAll("_", " ");
}

export function safeAuditIdentifier(entry: AuditEntry = {}): string {
  if (entry.emailHash) return `Email hash ${String(entry.emailHash).slice(0, 12)}`;
  if (entry.ipHash) return `IP hash ${String(entry.ipHash).slice(0, 12)}`;
  if (entry.targetUserId) return `User ${String(entry.targetUserId).slice(0, 12)}`;
  if (entry.userId) return `User ${String(entry.userId).slice(0, 12)}`;
  if (entry.actorId) return `Actor ${String(entry.actorId).slice(0, 12)}`;
  return "Safe identifier unavailable";
}

export function auditDetailText(entry: AuditEntry): string {
  if (entry.details?.before || entry.details?.after) {
    const before = Object.entries(entry.details.before || {}).map(([key, value]) => `${key}: ${value ?? "-"}`).join(", ");
    const after = Object.entries(entry.details.after || {}).map(([key, value]) => `${key}: ${value ?? "-"}`).join(", ");
    return [before && `Before ${before}`, after && `After ${after}`].filter(Boolean).join(" | ") || "-";
  }
  if (entry.provider) return `${entry.provider} check`;
  if (entry.method) return `${entry.method} security`;
  if (entry.hostname) return `Host ${entry.hostname}`;
  return entry.status || entry.reason || (entry.quantity ? `Quantity ${entry.quantity}` : "-");
}

export function auditCategory(entry: AuditEntry = {}): string {
  const action = String(entry.action || "");
  if (securityAuditActions.has(action) || action.startsWith("2fa_") || action.startsWith("passkey_") || action.startsWith("registration_")) return "security";
  if (action === "admin_user_created" || action === "role_changed" || entry.targetUserId || action.includes("user")) return "users";
  if (entry.orderId || action.includes("order") || action.includes("rider") || action.includes("cod")) return "orders";
  if (entry.itemId || entry.itemName || action.includes("inventory") || action.includes("menu_") || action.includes("stock_")) return "inventory";
  if (entry.shiftLogId || action.includes("shift") || action.includes("cash")) return "shifts";
  return "system";
}

export function auditSeverity(entry: AuditEntry = {}): "critical" | "warning" | "info" {
  const action = String(entry.action || "");
  if (["role_changed", "account_suspended", "admin_user_created", "2fa_reset", "2fa_unlocked", "2fa_lockout", "owner_void_restored", "orders_archived"].includes(action)) return "critical";
  if (["registration_failed", "registration_rate_limited", "inventory_adjusted", "order_cancel_restored", "complaint_created", "approval_rejected"].includes(action)) return "warning";
  if (String(entry.reason || "").toLowerCase().includes("too many")) return "warning";
  return "info";
}

export function auditRecordLabel(entry: AuditEntry = {}): string {
  return String(entry.orderId || entry.itemName || entry.itemId || entry.shiftLogId || entry.approvalId || entry.complaintId || entry.reviewId || entry.targetUserId || entry.userId || entry.uid || "-");
}

export function auditFriendlyMessage(entry: AuditEntry = {}): string {
  const action = String(entry.action || "");
  const labels: Record<string, string> = {
    account_created: "Customer account was created",
    account_reactivated: "Owner reactivated an account",
    account_suspended: "Owner suspended an account",
    admin_user_created: "Owner created a team account",
    approval_approved: "Owner approved a request",
    approval_rejected: "Owner rejected a request",
    approval_requested: "Staff requested approval",
    complaint_created: "Customer submitted a complaint",
    complaint_updated: "Complaint was updated",
    inventory_adjusted: "Inventory stock was adjusted",
    inventory_received: "Inventory stock was received",
    menu_item_created: "Menu item was created",
    menu_item_updated: "Menu item was updated",
    menu_stock_updated: "Menu stock was updated",
    order_cancel_restored: "Cancelled order stock was restored",
    order_created: "Order was created",
    order_deducted: "Order stock was deducted",
    order_updated: "Order status was updated",
    orders_archived: "Old orders were archived",
    owner_void_restored: "Owner void restored inventory",
    registration_failed: "Registration attempt was blocked",
    registration_rate_limited: "Registration was temporarily limited",
    registration_security_check_passed: "Registration security check passed",
    registration_started: "Customer registration started",
    review_moderated: "Review moderation was updated",
    rider_auto_assigned: "Rider was auto-assigned",
    role_changed: "Owner changed a user role",
    shift_closed: "Staff shift was closed",
    shift_started: "Staff shift was opened",
    stock_count_approved: "Stock count was approved"
  };
  if (action.startsWith("2fa_")) return `Account security ${action.replace(/^2fa_/, "").replaceAll("_", " ")}`;
  if (action.startsWith("passkey_")) return `Passkey ${action.replace(/^passkey_/, "").replaceAll("_", " ")}`;
  return labels[action] || auditActionLabel(action);
}

export function auditSearchText(entry: AuditEntry = {}): string {
  return [
    auditFriendlyMessage(entry),
    auditActionLabel(entry.action),
    auditRecordLabel(entry),
    safeAuditIdentifier(entry),
    auditDetailText(entry),
    entry.actorName,
    entry.actorRole,
    entry.status,
    entry.reason
  ].filter(Boolean).join(" ").toLowerCase();
}

export const auditCategories = [
  ["all", "All logs"],
  ["security", "Security"],
  ["orders", "Orders"],
  ["inventory", "Inventory"],
  ["users", "Users / Roles"],
  ["shifts", "Shift / Cash"],
  ["system", "System"]
] as const;
