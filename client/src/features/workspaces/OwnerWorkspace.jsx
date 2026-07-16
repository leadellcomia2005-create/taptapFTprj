import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ClipboardList, CreditCard, MessageSquareWarning, PackageSearch, WifiOff } from "lucide-react";
import { SectionLoader } from "../../components/Loaders";
import { securityMethodLabels, staffRoleLabels } from "../../config/appConfig";
import { api } from "../../services/api";
import { updateOrder } from "../../services/firebase/orders";
import { bestSellers, forecastRunouts, orderPrepClock, peakOrderHours, slowMovingItems } from "../../utils/operations";
import { AdminCleanupModule, ApprovalQueueModule, ComplaintResolutionModule, InventoryModule, MenuManagementModule, OrderManagement, ReviewModerationModule, SettingsModule, ShiftLogsModule } from "./SharedWorkspaceModules";
import { buildDailyReport, buildLocalDecisionSupport, currency, isRevenueOrder, isUnremittedCod, localDateInputValue, orderItemText, orderPaymentLabel, printOwnerDailyReport, setWorkspaceHelpers, statusLabel, sumByTotal } from "./workspaceHelpers";

const SalesChart = lazy(() => import("../../components/SalesChart"));
const ownerPlanningStorageKey = "taptap-owner-planning";

function ownerPlanningDefaults() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ownerPlanningStorageKey) || "{}");
    return {
      salesGoal: Math.max(1, Number(saved.salesGoal || 100000)),
      activePromotion: String(saved.activePromotion || "No active promotion")
    };
  } catch {
    return { salesGoal: 100000, activePromotion: "No active promotion" };
  }
}

const securityAuditActions = new Set([
  "registration_security_check_passed",
  "registration_started",
  "registration_failed",
  "registration_rate_limited",
  "admin_user_created",
  "role_changed",
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

function auditActionLabel(action = "") {
  return String(action || "audit event")
    .replace(/^2fa_/, "Security ")
    .replace(/^passkey_/, "Passkey ")
    .replace(/^registration_/, "Registration ")
    .replaceAll("_", " ");
}

function safeAuditIdentifier(entry = {}) {
  if (entry.emailHash) return `Email hash ${String(entry.emailHash).slice(0, 12)}`;
  if (entry.ipHash) return `IP hash ${String(entry.ipHash).slice(0, 12)}`;
  if (entry.targetUserId) return `User ${String(entry.targetUserId).slice(0, 12)}`;
  if (entry.userId) return `User ${String(entry.userId).slice(0, 12)}`;
  if (entry.actorId) return `Actor ${String(entry.actorId).slice(0, 12)}`;
  return "Safe identifier unavailable";
}

function auditDetailText(entry) {
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

function auditCategory(entry = {}) {
  const action = String(entry.action || "");
  if (securityAuditActions.has(action) || action.startsWith("2fa_") || action.startsWith("passkey_") || action.startsWith("registration_")) return "security";
  if (action === "admin_user_created" || action === "role_changed" || entry.targetUserId || action.includes("user")) return "users";
  if (entry.orderId || action.includes("order") || action.includes("rider") || action.includes("cod")) return "orders";
  if (entry.itemId || entry.itemName || action.includes("inventory") || action.includes("menu_") || action.includes("stock_")) return "inventory";
  if (entry.shiftLogId || action.includes("shift") || action.includes("cash")) return "shifts";
  return "system";
}

function auditSeverity(entry = {}) {
  const action = String(entry.action || "");
  if (["role_changed", "admin_user_created", "2fa_reset", "2fa_unlocked", "2fa_lockout", "owner_void_restored", "orders_archived"].includes(action)) return "critical";
  if (["registration_failed", "registration_rate_limited", "inventory_adjusted", "order_cancel_restored", "complaint_created", "approval_rejected"].includes(action)) return "warning";
  if (String(entry.reason || "").toLowerCase().includes("too many")) return "warning";
  return "info";
}

function auditRecordLabel(entry = {}) {
  return entry.orderId || entry.itemName || entry.itemId || entry.shiftLogId || entry.approvalId || entry.complaintId || entry.reviewId || entry.targetUserId || entry.userId || entry.uid || "-";
}

function auditFriendlyMessage(entry = {}) {
  const action = String(entry.action || "");
  const labels = {
    account_created: "Customer account was created",
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

function auditSearchText(entry = {}) {
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

const auditCategories = [
  ["all", "All logs"],
  ["security", "Security"],
  ["orders", "Orders"],
  ["inventory", "Inventory"],
  ["users", "Users / Roles"],
  ["shifts", "Shift / Cash"],
  ["system", "System"]
];

function OwnerWorkspaceContent({ section, user, orders, inventory, reviews, complaints = [], serviceStatus, auditLogs, shiftLogs, notify, onNavigate }) {
  const menu = inventory;
  const revenueOrders = orders.filter(isRevenueOrder);
  const totalSales = revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const bestSellerRows = bestSellers(revenueOrders, inventory, 5);
  const slowMovingRows = slowMovingItems(revenueOrders, inventory, 5);
  const peakHours = peakOrderHours(orders);
  const runoutForecast = forecastRunouts(revenueOrders, inventory, 5);
  const shiftPerformance = [...shiftLogs].sort((a, b) => Number(b.orderCount || 0) - Number(a.orderCount || 0)).slice(0, 5);
  const salesTrend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    const start = day.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return revenueOrders
      .filter((order) => Number(order.createdAt || 0) >= start && Number(order.createdAt || 0) < end)
      .reduce((sum, order) => sum + Number(order.total || 0), 0);
  });
  const [insight, setInsight] = useState("Generate a free best-seller and stock recommendation.");
  const [planning, setPlanning] = useState(ownerPlanningDefaults);
  const salesGoal = planning.salesGoal;
  const [dashboardPeriod, setDashboardPeriod] = useState("today");
  const [roleForm, setRoleForm] = useState({ uid: "", role: "staff", staffRole: "manager" });
  const [createUserForm, setCreateUserForm] = useState({ name: "", email: "", temporaryPassword: "", role: "staff", staffRole: "manager" });
  const [creatingUser, setCreatingUser] = useState(false);
  const [createdUserNotice, setCreatedUserNotice] = useState("");
  const [managedUsers, setManagedUsers] = useState([]);
  const [adminMessage, setAdminMessage] = useState({ uid: "", title: "Message from administrator", message: "" });
  const [reportDate, setReportDate] = useState(localDateInputValue());
  const [auditCategoryFilter, setAuditCategoryFilter] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditDateRange, setAuditDateRange] = useState({ from: "", to: "" });
  const [auditPage, setAuditPage] = useState(1);
  const [selectedAuditEntry, setSelectedAuditEntry] = useState(null);
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const periodStart = dashboardPeriod === "today"
    ? todayStart
    : dashboardPeriod === "7d"
      ? now - 7 * 24 * 60 * 60 * 1000
      : dashboardPeriod === "30d"
        ? now - 30 * 24 * 60 * 60 * 1000
        : 0;
  const dashboardOrders = periodStart ? orders.filter((order) => Number(order.createdAt || 0) >= periodStart) : orders;
  const dashboardRevenueOrders = dashboardOrders.filter(isRevenueOrder);
  const dashboardSales = sumByTotal(dashboardRevenueOrders);
  const dashboardAverageOrder = dashboardRevenueOrders.length ? dashboardSales / dashboardRevenueOrders.length : 0;
  const periodLength = periodStart ? Math.max(1, now - periodStart) : 0;
  const previousSales = periodLength
    ? sumByTotal(orders.filter((order) => isRevenueOrder(order) && Number(order.createdAt || 0) >= periodStart - periodLength && Number(order.createdAt || 0) < periodStart))
    : 0;
  const salesChange = previousSales > 0 ? Math.round((dashboardSales - previousSales) / previousSales * 100) : null;
  const activeWorkload = dashboardOrders.filter((order) => !["delivered", "completed", "cancelled", "pending-payment"].includes(order.status));
  const overdueOrders = activeWorkload.filter((order) => orderPrepClock(order).delayed);
  const pendingPaymentOrders = dashboardOrders.filter((order) => order.status === "pending-payment" || order.paymentStatus === "pending");
  const lowStockItems = inventory.filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0));
  const unremittedCodOrders = dashboardOrders.filter(isUnremittedCod);
  const unresolvedComplaints = complaints.filter((complaint) => !["resolved", "closed"].includes(String(complaint.status || "open").toLowerCase()));
  const unavailableServices = Object.entries(serviceStatus || {}).filter(([, ready]) => ready === false);
  const dataUpdatedAt = Math.max(0, ...orders.map((order) => Number(order.updatedAt || order.createdAt || 0)));
  const dailyReport = useMemo(() => buildDailyReport(orders, inventory, shiftLogs, reportDate), [orders, inventory, shiftLogs, reportDate]);
  const sortedAuditRows = useMemo(() => [...auditLogs].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)), [auditLogs]);
  const securityAuditRows = useMemo(() => sortedAuditRows.filter((entry) => securityAuditActions.has(entry.action)), [sortedAuditRows]);
  const blockedRegistrationRows = useMemo(() => securityAuditRows.filter((entry) => entry.action === "registration_failed" || String(entry.reason || "").toLowerCase().includes("too many")), [securityAuditRows]);
  const attentionAuditRows = useMemo(() => sortedAuditRows.filter((entry) => auditSeverity(entry) !== "info"), [sortedAuditRows]);
  const needsAttentionAuditRows = attentionAuditRows.slice(0, 6);
  const filteredAuditRows = useMemo(() => {
    const from = auditDateRange.from ? new Date(`${auditDateRange.from}T00:00:00`).getTime() : null;
    const to = auditDateRange.to ? new Date(`${auditDateRange.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 : null;
    const query = auditSearch.trim().toLowerCase();
    return sortedAuditRows.filter((entry) => {
      const timestamp = Number(entry.createdAt || 0);
      if (from && timestamp < from) return false;
      if (to && timestamp >= to) return false;
      if (auditCategoryFilter !== "all" && auditCategory(entry) !== auditCategoryFilter) return false;
      if (query && !auditSearchText(entry).includes(query)) return false;
      return true;
    });
  }, [auditCategoryFilter, auditDateRange, auditSearch, sortedAuditRows]);
  const auditPageSize = 25;
  const auditTotalPages = Math.max(1, Math.ceil(filteredAuditRows.length / auditPageSize));
  const pagedAuditRows = filteredAuditRows.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize);
  const refreshUsers = useCallback(async () => {
    try {
      const result = await api.listUsers();
      setManagedUsers(result.users || []);
    } catch (error) {
      if (section === "owner-users") notify(error.message);
    }
  }, [notify, section]);
  useEffect(() => {
    if (section === "owner-users") refreshUsers();
  }, [refreshUsers, section]);
  useEffect(() => {
    setAuditPage(1);
  }, [auditCategoryFilter, auditDateRange.from, auditDateRange.to, auditSearch]);
  useEffect(() => {
    if (auditPage > auditTotalPages) setAuditPage(auditTotalPages);
  }, [auditPage, auditTotalPages]);
  const printDailyReport = () => {
    const opened = printOwnerDailyReport(dailyReport);
    notify(opened ? `Owner daily report for ${dailyReport.dateLabel} is ready to print.` : "Allow pop-ups to print the owner report.");
  };
  const savePlanningStrategy = () => {
    try {
      window.localStorage.setItem(ownerPlanningStorageKey, JSON.stringify(planning));
      notify("Planning settings saved on this browser. Customer pricing was not changed.");
    } catch {
      notify("Planning settings could not be saved on this browser.");
    }
  };
  const markCodRemitted = async (order) => {
    await updateOrder(order.id, { codRemitted: true });
    notify(`${order.id} COD marked as remitted.`);
  };
  const generateInsight = async () => {
    if (!serviceStatus?.openai) {
      setInsight(buildLocalDecisionSupport(orders, menu));
      notify("Free recommendation generated from your local sales and inventory.");
      return;
    }
    try {
      const result = await api.insights(orders, menu);
      setInsight(result.text);
    } catch {
      setInsight(`${buildLocalDecisionSupport(orders, menu)} Online insight is not ready yet.`);
    }
  };
  const updateRole = async (event) => {
    event.preventDefault();
    try {
      await api.assignRole(roleForm.uid, roleForm.role, roleForm.staffRole);
      notify(`User role updated to ${roleForm.role}${roleForm.role === "staff" ? ` / ${staffRoleLabels[roleForm.staffRole]}` : ""}.`);
      setRoleForm({ uid: "", role: "staff", staffRole: "manager" });
      await refreshUsers();
    } catch (error) {
      notify(error.message);
    }
  };
  const createManagedUser = async (event) => {
    event.preventDefault();
    setCreatingUser(true);
    setCreatedUserNotice("");
    try {
      const result = await api.createManagedUser(createUserForm);
      setCreatedUserNotice(`${result.name} was created as ${result.role}. Ask them to verify email and complete security setup on first sign-in.`);
      notify(`Created ${result.role} account for ${result.email}.`);
      setCreateUserForm({ name: "", email: "", temporaryPassword: "", role: "staff", staffRole: "manager" });
      await refreshUsers();
    } catch (error) {
      notify(error.message);
    } finally {
      setCreatingUser(false);
    }
  };
  const securityAction = async (uid, action) => {
    try {
      if (action === "reset") await api.resetUserTwoFactor(uid);
      else await api.unlockUserTwoFactor(uid);
      notify(action === "reset" ? "Security setup reset. The user must enroll again." : "The account was unlocked.");
      await refreshUsers();
    } catch (error) {
      notify(error.message);
    }
  };
  const sendAdminMessage = async (event) => {
    event.preventDefault();
    try {
      await api.sendAdminMessage(adminMessage.uid, adminMessage.title, adminMessage.message);
      notify("Private notification sent.");
      setAdminMessage((current) => ({ ...current, message: "" }));
    } catch (error) {
      notify(error.message);
    }
  };
  const setAuditDatePreset = (preset) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (preset === "all") {
      setAuditDateRange({ from: "", to: "" });
      return;
    }
    if (preset === "today") {
      setAuditDateRange({ from: localDateInputValue(today), to: localDateInputValue(today) });
      return;
    }
    if (preset === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      setAuditDateRange({ from: localDateInputValue(yesterday), to: localDateInputValue(yesterday) });
      return;
    }
    if (preset === "week") {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 6);
      setAuditDateRange({ from: localDateInputValue(weekStart), to: localDateInputValue(today) });
      return;
    }
    if (preset === "month") {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      setAuditDateRange({ from: localDateInputValue(monthStart), to: localDateInputValue(today) });
    }
  };
  if (section === "owner-sales") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Sales strategy and analytics</p><h2>Sales & Orders</h2></div><button className="btn btn-outline-dark" onClick={printDailyReport}>Print daily report</button></div>
      <div className="row g-3">
        <div className="col-md-4"><div className="metric-card"><small>Unified gross sales</small><strong>{currency(totalSales)}</strong><span>Online and walk-in ledger</span></div></div>
        <div className="col-md-4"><div className="metric-card"><small>Revenue target</small><strong>{currency(salesGoal)}</strong><span>{Math.min(100, Math.round(totalSales / salesGoal * 100))}% achieved</span></div></div>
        <div className="col-md-4"><div className="metric-card"><small>Awaiting completion</small><strong>{orders.filter((order) => !["delivered", "completed", "cancelled", "pending-payment"].includes(order.status)).length}</strong><span>Live order workload</span></div></div>
        <div className="col-lg-8"><div className="dashboard-card chart-card"><h3>Sales trends and forecast</h3><Suspense fallback={<SectionLoader label="Loading sales chart..." />}><SalesChart values={salesTrend} /></Suspense></div></div>
        <div className="col-lg-4"><div className="dashboard-card"><h3>Local planning controls</h3><p className="module-note">Saved only on this browser for planning. These values do not change customer pricing.</p><label className="form-label">Sales goal threshold<input className="form-control" type="number" min="1" value={salesGoal} onChange={(event) => setPlanning((current) => ({ ...current, salesGoal: Math.max(1, Number(event.target.value || 1)) }))} /></label><label className="form-label">Promotion scenario<select className="form-select" value={planning.activePromotion} onChange={(event) => setPlanning((current) => ({ ...current, activePromotion: event.target.value }))}><option>Free delivery over PHP 499</option><option>10% off rice meals</option><option>No active promotion</option></select></label><button className="btn btn-danger w-100 mt-3" onClick={savePlanningStrategy}>Save on this browser</button></div></div>
        <div className="col-12"><OrderManagement orders={orders} canAdvance notify={notify} /></div>
        <div className="col-12"><ComplaintResolutionModule complaints={complaints} user={user} notify={notify} /></div>
      </div>
    </main>
  );
  if (section === "owner-inventory") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Stock governance</p><h2>Inventory</h2></div></div><div className="row g-3"><div className="col-12"><MenuManagementModule inventory={inventory} user={user} notify={notify} /></div><div className="col-12"><InventoryModule inventory={inventory} user={user} notify={notify} /></div></div></main>;
  if (section === "owner-reports") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading">
        <div><p className="eyebrow text-danger">Automated reporting</p><h2>Reports & Reconciliation</h2></div>
        <div className="report-actions">
          <label className="report-date-field">Report date<input className="form-control" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></label>
          <button className="btn btn-danger" onClick={printDailyReport}>Print owner report</button>
        </div>
      </div>
      <div className="row g-3">
        <div className="col-md-3"><div className="metric-card"><small>Gross paid sales</small><strong>{currency(dailyReport.grossSales)}</strong><span>{dailyReport.dateLabel}</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Total orders</small><strong>{dailyReport.dailyOrders.length}</strong><span>Created that day</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Pending or unpaid</small><strong>{dailyReport.pendingOrders.length}</strong><span>Not counted as sales</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>COD exposure</small><strong>{currency(dailyReport.paymentBreakdown.codExposure)}</strong><span>Open COD for the day</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Completed</small><strong>{dailyReport.completedOrders.length}</strong><span>Delivered or counter-complete</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Cancelled</small><strong>{dailyReport.cancelledOrders.length}</strong><span>Stock returned</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>COD to remit</small><strong>{currency(sumByTotal(dailyReport.unremittedCodOrders))}</strong><span>Delivered, not handed over</span></div></div>
        <div className="col-lg-4"><div className="dashboard-card report-breakdown-card"><h3>Payment breakdown</h3><dl className="reconciliation-list">
          <div><dt>Cash</dt><dd>{currency(dailyReport.paymentBreakdown.cash)}</dd></div>
          <div><dt>Delivered COD</dt><dd>{currency(dailyReport.paymentBreakdown.cod)}</dd></div>
          <div><dt>Online / GCash</dt><dd>{currency(dailyReport.paymentBreakdown.online)}</dd></div>
          <div><dt>Pending unpaid</dt><dd>{currency(dailyReport.paymentBreakdown.pending)}</dd></div>
        </dl></div></div>
        <div className="col-lg-4"><div className="dashboard-card report-breakdown-card"><h3>Order type breakdown</h3><div className="order-type-grid">
          {Object.entries(dailyReport.orderTypeBreakdown).map(([label, count]) => <div key={label}><small>{label}</small><strong>{count}</strong></div>)}
        </div></div></div>
        <div className="col-lg-4"><div className="dashboard-card"><h3>Top selling items</h3><div className="table-responsive" tabIndex="0"><table className="table align-middle"><thead><tr><th>Item</th><th>Qty sold</th><th>Sales</th></tr></thead><tbody>{dailyReport.topItems.length === 0 && <tr><td colSpan="3" className="text-center text-secondary py-4">No paid sales for this day.</td></tr>}{dailyReport.topItems.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.qty}</td><td>{currency(item.sales)}</td></tr>)}</tbody></table></div></div></div>
        <div className="col-12"><div className="dashboard-card"><h3>COD remittance</h3><div className="table-responsive" tabIndex="0"><table className="table align-middle"><thead><tr><th>Order</th><th>Customer</th><th>Rider</th><th>Total</th><th>Handoff</th><th /></tr></thead><tbody>{dailyReport.unremittedCodOrders.length === 0 && <tr><td colSpan="6" className="text-center text-secondary py-4">No COD collections waiting for owner handoff.</td></tr>}{dailyReport.unremittedCodOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td>{order.riderName || order.riderId || "-"}</td><td>{currency(order.total)}</td><td><span className={`status ${order.codHandoffRequestedAt ? "status-arrived" : "status-ready"}`}>{order.codHandoffRequestedAt ? "Rider handoff logged" : "Collected"}</span></td><td><button className="btn btn-sm btn-danger" onClick={() => markCodRemitted(order)}>Confirm remitted</button></td></tr>)}</tbody></table></div></div></div>
        <div className="col-12"><div className="dashboard-card"><h3>Daily order ledger</h3><div className="table-responsive" tabIndex="0"><table className="table align-middle"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Status</th><th>Sales counted</th><th>Total</th></tr></thead><tbody>{dailyReport.dailyOrders.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-4">No orders for this day.</td></tr>}{dailyReport.dailyOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td className="order-items-cell"><span>{orderItemText(order)}</span></td><td>{orderPaymentLabel(order)}</td><td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td><td>{isRevenueOrder(order) ? "Yes" : "No"}</td><td>{currency(order.total)}</td></tr>)}</tbody></table></div></div></div>
        <div className="col-12"><ShiftLogsModule orders={orders} logs={dailyReport.closedShifts} user={user} notify={notify} readOnly /></div>
      </div>
    </main>
  );
  if (section === "owner-users") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">User access</p><h2>Users & Roles</h2></div></div>
      <div className="row g-3">
        <div className="col-12"><div className="dashboard-card account-control-note"><p className="eyebrow text-danger">Account control</p><h3>Team access is owner-managed</h3><p>Customers register from the public sign-in page. Owner, staff, and rider accounts are created here, then the user verifies email and sets up account security on first sign-in.</p></div></div>

        <div className="col-xl-5">
          <form className="dashboard-card owner-create-user-card" onSubmit={createManagedUser}>
            <div className="module-heading"><div><p className="eyebrow text-danger">Create team account</p><h3>New owner, staff, or rider</h3></div><span className="module-note">Temporary passwords are never shown again after saving.</span></div>
            <label className="form-label">Full name<input className="form-control" required autoComplete="name" value={createUserForm.name} onChange={(event) => setCreateUserForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Mika Reyes" /></label>
            <label className="form-label">Email<input className="form-control" required type="email" autoComplete="email" value={createUserForm.email} onChange={(event) => setCreateUserForm((current) => ({ ...current, email: event.target.value }))} placeholder="team@example.com" /></label>
            <div className="row g-2">
              <label className="form-label col-md-6">Role<select className="form-select" value={createUserForm.role} onChange={(event) => setCreateUserForm((current) => ({ ...current, role: event.target.value }))}><option>staff</option><option>rider</option><option>owner</option></select></label>
              {createUserForm.role === "staff" && <label className="form-label col-md-6">Staff access<select className="form-select" value={createUserForm.staffRole} onChange={(event) => setCreateUserForm((current) => ({ ...current, staffRole: event.target.value }))}>{Object.entries(staffRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            </div>
            <label className="form-label">Temporary password<input className="form-control" required minLength="12" type="password" autoComplete="new-password" value={createUserForm.temporaryPassword} onChange={(event) => setCreateUserForm((current) => ({ ...current, temporaryPassword: event.target.value }))} placeholder="At least 12 characters" /><small>Share this directly with the team member outside the system, then ask them to change it.</small></label>
            {createdUserNotice && <div className="alert alert-success py-2 small">{createdUserNotice}</div>}
            <button className="btn btn-danger w-100 mt-2" disabled={creatingUser}>{creatingUser ? "Creating account..." : "Create team account"}</button>
          </form>
        </div>

        <div className="col-xl-7">
          <div className="dashboard-card">
            <div className="module-heading"><div><p className="eyebrow text-danger">Security status</p><h3>User accounts and security</h3></div><button className="btn btn-sm btn-outline-dark" onClick={refreshUsers}>Refresh list</button></div>
            <div className="table-responsive" tabIndex="0"><table className="table align-middle"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Staff scope</th><th>Security</th><th>Security controls</th></tr></thead><tbody>{managedUsers.length === 0 && <tr><td colSpan="6" className="text-center text-secondary py-4">No users found.</td></tr>}{managedUsers.map((account) => <tr key={account.uid}><td><strong>{account.name}</strong><small className="d-block text-secondary">{account.uid}</small></td><td>{account.email}</td><td><span className="role-badge">{account.role}</span></td><td>{account.role === "staff" ? staffRoleLabels[account.staffRole] || "Manager" : "-"}</td><td><span className={`stock-badge ${account.twoFactorEnabled && !account.twoFactorLocked ? "healthy" : "low"}`}>{account.twoFactorLocked ? "Locked" : account.twoFactorEnabled ? `${securityMethodLabels[account.twoFactorMethod] || "Security"} enabled` : "Not set up"}</span></td><td><div className="d-flex flex-wrap gap-2"><button className="btn btn-sm btn-outline-danger" onClick={() => securityAction(account.uid, "reset")}>Reset security</button>{account.twoFactorLocked && <button className="btn btn-sm btn-dark" onClick={() => securityAction(account.uid, "unlock")}>Unlock</button>}</div></td></tr>)}</tbody></table></div>
          </div>
        </div>

        <div className="col-xl-6"><form className="dashboard-card" onSubmit={updateRole}><h3>Assign existing user role</h3><p className="module-note">Use this when an account already exists and only needs a role correction.</p><label className="form-label">Account ID<input className="form-control" required value={roleForm.uid} onChange={(event) => setRoleForm((current) => ({ ...current, uid: event.target.value }))} /></label><label className="form-label">Role<select className="form-select" value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))}><option>owner</option><option>staff</option><option>rider</option><option>customer</option></select></label>{roleForm.role === "staff" && <label className="form-label">Staff access scope<select className="form-select" value={roleForm.staffRole} onChange={(event) => setRoleForm((current) => ({ ...current, staffRole: event.target.value }))}>{Object.entries(staffRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<button className="btn btn-danger w-100 mt-3">Update role</button></form></div>
        <div className="col-xl-6"><form className="dashboard-card" onSubmit={sendAdminMessage}><h3>Private admin notification</h3><label className="form-label">Recipient<select className="form-select" required value={adminMessage.uid} onChange={(event) => setAdminMessage((current) => ({ ...current, uid: event.target.value }))}><option value="">Select a user</option>{managedUsers.map((account) => <option key={account.uid} value={account.uid}>{account.name} ({account.role})</option>)}</select></label><label className="form-label">Title<input className="form-control" required value={adminMessage.title} onChange={(event) => setAdminMessage((current) => ({ ...current, title: event.target.value }))} /></label><label className="form-label">Message<textarea className="form-control" required maxLength="1000" rows="3" value={adminMessage.message} onChange={(event) => setAdminMessage((current) => ({ ...current, message: event.target.value }))} /></label><button className="btn btn-dark w-100 mt-3">Send only to this user</button></form></div>
      </div>
    </main>
  );
  if (section === "owner-reviews") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Customer voice</p><h2>Reviews & Complaints</h2></div></div><div className="row g-3"><div className="col-12"><ComplaintResolutionModule complaints={complaints} user={user} notify={notify} /></div><div className="col-12"><ReviewModerationModule reviews={reviews} user={user} notify={notify} /></div></div></main>;
  if (section === "owner-audit") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Accountability and integrity</p><h2>Audit Logs</h2></div></div>
      <div className="row g-3 mb-3">
        <div className="col-md-3"><div className="metric-card"><small>Security events</small><strong>{securityAuditRows.length}</strong><span>Registration and login protection</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Blocked attempts</small><strong>{blockedRegistrationRows.length}</strong><span>Failed or limited signups</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Needs attention</small><strong>{attentionAuditRows.length}</strong><span>Warning and critical logs</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Total audit rows</small><strong>{auditLogs.length}</strong><span>Orders, stock, shifts, accounts</span></div></div>
      </div>

      <div className="audit-category-grid">
        {auditCategories.map(([value, label]) => {
          const count = value === "all" ? sortedAuditRows.length : sortedAuditRows.filter((entry) => auditCategory(entry) === value).length;
          return (
            <button className={auditCategoryFilter === value ? "active" : ""} key={value} onClick={() => setAuditCategoryFilter(value)} type="button">
              <span>{label}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      <div className="dashboard-card security-audit-card audit-center-card">
        <div className="module-heading"><div><p className="eyebrow text-danger">Filtered audit center</p><h3>{auditCategories.find(([value]) => value === auditCategoryFilter)?.[1] || "Audit logs"}</h3></div><span className="module-note">Search, filter, then open a row for full details.</span></div>
        <div className="security-audit-filters audit-center-filters">
          <label className="audit-search-field">Search logs<input className="form-control" type="search" value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Order ID, actor, action, item, role..." /></label>
          <div className="audit-filter-buttons audit-date-presets" role="group" aria-label="Audit date presets">
            {[
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["week", "Last 7 days"],
              ["month", "This month"],
              ["all", "All dates"]
            ].map(([value, label]) => <button key={value} onClick={() => setAuditDatePreset(value)} type="button">{label}</button>)}
          </div>
          <label>From<input className="form-control" type="date" value={auditDateRange.from} onChange={(event) => setAuditDateRange((current) => ({ ...current, from: event.target.value }))} /></label>
          <label>To<input className="form-control" type="date" value={auditDateRange.to} onChange={(event) => setAuditDateRange((current) => ({ ...current, to: event.target.value }))} /></label>
        </div>

        <section className="audit-attention-strip" aria-label="Audit rows needing attention">
          <div className="module-heading"><div><p className="eyebrow text-danger">Needs attention</p><h3>Risky account or operations events</h3></div></div>
          <div className="audit-attention-grid">
            {needsAttentionAuditRows.length === 0 && <div className="empty-chat">No warning or critical audit logs right now.</div>}
            {needsAttentionAuditRows.map((entry) => (
              <article className={`audit-attention-card ${auditSeverity(entry)}`} key={entry.id}>
                <span className={`audit-severity ${auditSeverity(entry)}`}>{auditSeverity(entry)}</span>
                <strong>{auditFriendlyMessage(entry)}</strong>
                <small>{new Date(entry.createdAt).toLocaleString("en-PH")} - {auditRecordLabel(entry)}</small>
                <button className="btn btn-sm btn-outline-dark" onClick={() => setSelectedAuditEntry(entry)} type="button">View details</button>
              </article>
            ))}
          </div>
        </section>

        <div className="audit-results-summary">
          <span>{filteredAuditRows.length} result{filteredAuditRows.length === 1 ? "" : "s"}</span>
          <span>Page {auditPage} of {auditTotalPages}</span>
        </div>
        <div className="table-responsive" tabIndex="0">
          <table className="table align-middle audit-table">
            <thead><tr><th>Time</th><th>Severity</th><th>Category</th><th>Action</th><th>Actor</th><th>Record</th><th>Details</th></tr></thead>
            <tbody>
              {pagedAuditRows.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-5">No audit logs match the selected filters.</td></tr>}
              {pagedAuditRows.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString("en-PH")}</td>
                  <td><span className={`audit-severity ${auditSeverity(entry)}`}>{auditSeverity(entry)}</span></td>
                  <td><span className="role-badge">{auditCategory(entry)}</span></td>
                  <td><strong>{auditFriendlyMessage(entry)}</strong><small className="d-block text-secondary">{auditActionLabel(entry.action)}</small></td>
                  <td>{entry.actorName || "System"}<small className="d-block text-secondary">{entry.actorRole || "-"}</small></td>
                  <td><code className="safe-audit-id">{auditRecordLabel(entry)}</code></td>
                  <td><button className="btn btn-sm btn-outline-dark" onClick={() => setSelectedAuditEntry(entry)} type="button">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="audit-pagination">
          <button className="btn btn-outline-dark btn-sm" disabled={auditPage <= 1} onClick={() => setAuditPage((current) => Math.max(1, current - 1))}>Previous</button>
          <span>{Math.min(filteredAuditRows.length, (auditPage - 1) * auditPageSize + 1)}-{Math.min(filteredAuditRows.length, auditPage * auditPageSize)} of {filteredAuditRows.length}</span>
          <button className="btn btn-outline-dark btn-sm" disabled={auditPage >= auditTotalPages} onClick={() => setAuditPage((current) => Math.min(auditTotalPages, current + 1))}>Next</button>
        </div>
      </div>

      {selectedAuditEntry && (
        <div className="modal d-block audit-detail-shell" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAuditEntry(null); }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content audit-detail-modal" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title">
              <div className="modal-header">
                <div><p className="eyebrow text-danger">Audit detail</p><h5 className="modal-title" id="audit-detail-title">{auditFriendlyMessage(selectedAuditEntry)}</h5></div>
                <button className="btn-close" aria-label="Close audit detail" onClick={() => setSelectedAuditEntry(null)} type="button" />
              </div>
              <div className="modal-body">
                <div className="audit-detail-grid">
                  <div><small>Time</small><strong>{new Date(selectedAuditEntry.createdAt).toLocaleString("en-PH")}</strong></div>
                  <div><small>Severity</small><span className={`audit-severity ${auditSeverity(selectedAuditEntry)}`}>{auditSeverity(selectedAuditEntry)}</span></div>
                  <div><small>Category</small><strong>{auditCategory(selectedAuditEntry)}</strong></div>
                  <div><small>Actor</small><strong>{selectedAuditEntry.actorName || "System"}</strong><span>{selectedAuditEntry.actorRole || "-"}</span></div>
                  <div><small>Record</small><strong>{auditRecordLabel(selectedAuditEntry)}</strong></div>
                  <div><small>Safe identifier</small><code className="safe-audit-id">{safeAuditIdentifier(selectedAuditEntry)}</code></div>
                </div>
                <section className="audit-detail-section">
                  <small>Description</small>
                  <p>{auditDetailText(selectedAuditEntry)}</p>
                </section>
                <section className="audit-detail-section">
                  <small>Advanced details</small>
                  <pre>{JSON.stringify(selectedAuditEntry.details || selectedAuditEntry, null, 2)}</pre>
                </section>
              </div>
              <div className="modal-footer"><button className="btn btn-outline-dark" onClick={() => setSelectedAuditEntry(null)} type="button">Close</button></div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
  if (section === "owner-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Business administration</p><h2>System Settings</h2></div></div><div className="row g-3"><div className="col-12"><SettingsModule title="Payments, notifications and system controls" serviceStatus={serviceStatus} notify={notify} /></div><div className="col-12"><ApprovalQueueModule user={user} notify={notify} /></div><div className="col-12"><AdminCleanupModule user={user} orders={orders} inventory={inventory} auditLogs={auditLogs} shiftLogs={shiftLogs} notify={notify} /></div></div></main>;
  return (
    <main className="container-fluid dashboard-page owner-listing-page">
      <section className="owner-listing-hero workspace-overview-header owner-workspace-header">
        <div>
          <p className="eyebrow">Super Admin / Owner</p>
          <h1>Operations control center</h1>
          <p>Start with exceptions that need a decision, then review sales and operating trends.</p>
        </div>
        <div className="owner-hero-actions">
          <label>Dashboard period<select value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value)}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All loaded</option></select></label>
          <button className="btn btn-outline-light" onClick={printDailyReport}>Print daily report</button>
        </div>
      </section>

      <div className="owner-overview-meta"><span>{dashboardOrders.length} orders in scope</span><span>{dataUpdatedAt ? `Latest order update ${new Date(dataUpdatedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}` : "Waiting for live orders"}</span></div>

      <section className="owner-attention-board" aria-label="Items requiring owner attention">
        <div className="module-heading"><div><p className="eyebrow text-danger">Today&apos;s exceptions</p><h2>Needs a decision</h2></div><span className="module-note">Open an item to continue in its operational workspace.</span></div>
        <div className="owner-attention-grid">
          <button className={overdueOrders.length ? "urgent" : ""} type="button" onClick={() => onNavigate?.("owner-sales")}><AlertTriangle aria-hidden="true" /><span><strong>{overdueOrders.length}</strong><b>Overdue orders</b><small>Beyond the 15-minute prep target</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={pendingPaymentOrders.length ? "warning" : ""} type="button" onClick={() => onNavigate?.("owner-sales")}><CreditCard aria-hidden="true" /><span><strong>{pendingPaymentOrders.length}</strong><b>Pending payments</b><small>Not yet counted as revenue</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={lowStockItems.length ? "warning" : ""} type="button" onClick={() => onNavigate?.("owner-inventory")}><PackageSearch aria-hidden="true" /><span><strong>{lowStockItems.length}</strong><b>Low-stock items</b><small>Receiving or reorder action needed</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={unremittedCodOrders.length ? "warning" : ""} type="button" onClick={() => onNavigate?.("owner-reports")}><ClipboardList aria-hidden="true" /><span><strong>{unremittedCodOrders.length}</strong><b>COD to reconcile</b><small>{currency(sumByTotal(unremittedCodOrders))} awaiting owner confirmation</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={unresolvedComplaints.length ? "urgent" : ""} type="button" onClick={() => onNavigate?.("owner-reviews")}><MessageSquareWarning aria-hidden="true" /><span><strong>{unresolvedComplaints.length}</strong><b>Open complaints</b><small>Customer recovery follow-up</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={unavailableServices.length ? "urgent" : ""} type="button" onClick={() => onNavigate?.("owner-settings")}><WifiOff aria-hidden="true" /><span><strong>{unavailableServices.length}</strong><b>Service warnings</b><small>{unavailableServices.length ? unavailableServices.map(([name]) => name).join(", ") : "All checked services ready"}</small></span><ArrowRight aria-hidden="true" /></button>
        </div>
      </section>

      <section className="owner-stat-grid owner-kpi-grid" aria-label="Owner performance metrics">
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-sales")}><small>Paid sales</small><strong>{currency(dashboardSales)}</strong><span>{salesChange == null ? "No previous-period baseline" : `${salesChange >= 0 ? "+" : ""}${salesChange}% vs previous period`}</span></button>
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-sales")}><small>Average paid order</small><strong>{currency(dashboardAverageOrder)}</strong><span>{dashboardRevenueOrders.length} paid order{dashboardRevenueOrders.length === 1 ? "" : "s"}</span></button>
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-sales")}><small>Active workload</small><strong>{activeWorkload.length}</strong><span>{overdueOrders.length} beyond prep target</span></button>
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-inventory")}><small>Low stock</small><strong>{lowStockItems.length}</strong><span>At or below reorder point</span></button>
      </section>

      <section className="owner-panel-grid">
        <div className="dashboard-card chart-card owner-chart-card">
          <div className="module-heading">
            <div><p className="eyebrow text-danger">Sales performance</p><h3>Weekly revenue</h3></div>
            <span className="shift-chip">{Math.min(100, Math.round(dashboardSales / Math.max(1, salesGoal) * 100))}% of local goal</span>
          </div>
          <Suspense fallback={<SectionLoader label="Loading sales chart..." />}><SalesChart values={salesTrend} /></Suspense>
        </div>
        <div className="owner-listing-orders"><OrderManagement orders={activeWorkload.slice(0, 5)} canAdvance notify={notify} /></div>
        <div className="dashboard-card owner-stock-panel">
          <div className="module-heading"><div><p className="eyebrow text-danger">Inventory watch</p><h3>Low-stock alerts</h3></div></div>
          {lowStockItems.slice(0, 6).map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>Reorder point: {item.reorderPoint}</small></span><b>{item.stock}</b></div>)}
          {lowStockItems.length === 0 && <p className="text-secondary small">All products are above their reorder points.</p>}
        </div>
        <div className="dashboard-card"><h3>Best sellers</h3>{bestSellerRows.length === 0 && <div className="empty-chat">Sales will appear here.</div>}{bestSellerRows.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{item.qty} sold</small></span><b>{currency(item.sales)}</b></div>)}</div>
        <div className="dashboard-card"><h3>Slow-moving items</h3>{slowMovingRows.length === 0 && <div className="empty-chat">Inventory activity will appear here.</div>}{slowMovingRows.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{item.qty} sold, {item.stock} in stock</small></span><b>{item.qty}</b></div>)}</div>
        <div className="dashboard-card"><h3>Peak order hours</h3>{peakHours.length === 0 && <div className="empty-chat">No order hour data yet.</div>}{peakHours.map((hour) => <div className="alert-row" key={hour.hour}><span><strong>{hour.label}</strong><small>High order volume</small></span><b>{hour.count}</b></div>)}</div>
        <div className="dashboard-card"><h3>Inventory forecast</h3>{runoutForecast.length === 0 && <div className="empty-chat">Forecast appears after recent sales.</div>}{runoutForecast.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{item.dailyVelocity.toFixed(1)} sold/day</small></span><b>{item.daysLeft.toFixed(1)}d</b></div>)}</div>
        <div className="dashboard-card"><h3>Staff shift performance</h3>{shiftPerformance.length === 0 && <div className="empty-chat">Closed shifts will appear here.</div>}{shiftPerformance.map((shift) => <div className="alert-row" key={shift.id}><span><strong>{shift.staffName}</strong><small>{shift.orderCount} orders - variance {currency(shift.variance)}</small></span><b>{currency(shift.cashSales || shift.expectedCash)}</b></div>)}</div>
        <div className="dashboard-card ai-insight owner-decision-card">
          <p className="eyebrow">{serviceStatus?.openai ? "Business insight" : "Local business insight"}</p>
          <h3>Decision support</h3>
          <p>{insight}</p>
          <button className="btn btn-warning w-100" onClick={generateInsight}>{serviceStatus?.openai ? "Generate business summary" : "Generate local summary"}</button>
        </div>
      </section>
    </main>
  );
}

export default function OwnerWorkspace({ helpers, ...props }) {
  setWorkspaceHelpers(helpers);
  return <OwnerWorkspaceContent {...props} />;
}
