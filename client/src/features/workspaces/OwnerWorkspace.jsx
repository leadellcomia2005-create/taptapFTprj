import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ClipboardList, CreditCard, MessageSquareWarning, PackageSearch, Sparkles, WifiOff } from "lucide-react";
import { SectionLoader } from "../../components/Loaders";
import { securityMethodLabels, staffRoleLabels } from "../../config/appConfig";
import { api } from "../../services/api";
import { updateOrder } from "../../services/firebase/orders";
import { bestSellers, forecastRunouts, orderPrepClock, peakOrderHours, slowMovingItems } from "../../utils/operations";
import { calculateOwnerDecisionSupport, evaluateForecastHistory, recordForecast } from "../../utils/ownerKpis";
import { AdminCleanupModule, ApprovalQueueModule, ComplaintResolutionModule, InventoryModule, MenuManagementModule, OrderManagement, ReviewModerationModule, SettingsModule, ShiftLogsModule } from "./SharedWorkspaceModules";
import RecoveryPanel from "./RecoveryPanel";
import { ReasonModal } from "./WorkspaceModals";
import { buildDailyReport, buildLocalDecisionSupport, currency, isRevenueOrder, isUnremittedCod, localDateInputValue, orderItemText, orderPaymentLabel, printOwnerDailyReport, setWorkspaceHelpers, statusLabel, sumByTotal } from "./workspaceHelpers";
import { auditActionLabel, auditCategories, auditCategory, auditDetailText, auditFriendlyMessage, auditRecordLabel, auditSearchText, auditSeverity, ownerPlanningDefaults, ownerPlanningStorageKey, safeAuditIdentifier, securityAuditActions } from "./ownerAudit";
import "./styles/owner.css";

const SalesChart = lazy(() => import("../../components/SalesChart"));
const countLabel = (value, singular, plural = `${singular}s`) => `${value} ${Number(value) === 1 ? singular : plural}`;
const signedPercent = (value) => `${Number(value) >= 0 ? "+" : ""}${value}%`;
const daysOfStockLabel = (value) => {
  if (value == null) return "No depletion date";
  if (Number(value) < 1) return "Less than 1 day of stock left";
  return `About ${value} ${Number(value) === 1 ? "day" : "days"} of stock left`;
};
const hourLabel = (hour) => new Date(2026, 0, 1, Number(hour || 0)).toLocaleTimeString("en-PH", { hour: "numeric" });

function OwnerWorkspaceContent({ section, user, orders, inventory, reviews, complaints = [], serviceStatus, auditLogs, shiftLogs, notify, onNavigate }) {
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
  const [insight, setInsight] = useState(null);
  const [insightStatus, setInsightStatus] = useState("idle");
  const [insightError, setInsightError] = useState("");
  const [insightPeriod, setInsightPeriod] = useState("30d");
  const [insightCategory, setInsightCategory] = useState("all");
  const [planning, setPlanning] = useState(ownerPlanningDefaults);
  const [forecastAccuracy, setForecastAccuracy] = useState({ completedCount: 0, latest: null, recent: [] });
  const [recommendationStatuses, setRecommendationStatuses] = useState({});
  const salesGoal = planning.salesGoal;
  const [dashboardPeriod, setDashboardPeriod] = useState("today");
  const [roleForm, setRoleForm] = useState({ uid: "", role: "staff", staffRole: "manager" });
  const [createUserForm, setCreateUserForm] = useState({ name: "", email: "", temporaryPassword: "", role: "staff", staffRole: "manager" });
  const [creatingUser, setCreatingUser] = useState(false);
  const [createdUserNotice, setCreatedUserNotice] = useState("");
  const [managedUsers, setManagedUsers] = useState([]);
  const [suspensionTarget, setSuspensionTarget] = useState(null);
  const [suspensionBusy, setSuspensionBusy] = useState(false);
  const [suspensionError, setSuspensionError] = useState("");
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
  const aiReady = Boolean(serviceStatus?.groq || serviceStatus?.openai);
  const insightCategories = [...new Set(inventory.map((item) => item.category).filter(Boolean))].sort();
  const insightPeriodStart = insightPeriod === "today"
    ? todayStart
    : insightPeriod === "7d"
      ? now - 7 * 24 * 60 * 60 * 1000
      : insightPeriod === "30d"
        ? now - 30 * 24 * 60 * 60 * 1000
        : 0;
  const insightOrders = (insightPeriodStart ? orders.filter((order) => Number(order.createdAt || 0) >= insightPeriodStart) : orders).slice(-500);
  const insightInventory = (insightCategory === "all" ? inventory : inventory.filter((item) => item.category === insightCategory)).slice(0, 250);
  const decisionSupport = useMemo(() => calculateOwnerDecisionSupport({
    orders,
    inventory,
    complaints,
    shiftLogs,
    targets: planning,
    isRevenueOrder
  }), [complaints, inventory, orders, planning, shiftLogs]);
  useEffect(() => {
    try {
      const storageKey = "taptap-owner-forecast-history";
      const history = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      setForecastAccuracy(evaluateForecastHistory(history, orders, Date.now(), isRevenueOrder));
      window.localStorage.setItem(storageKey, JSON.stringify(recordForecast(history, decisionSupport.forecast)));
    } catch {
      setForecastAccuracy({ completedCount: 0, latest: null, recent: [] });
    }
  }, [decisionSupport.forecast, orders]);
  useEffect(() => {
    try {
      setRecommendationStatuses(JSON.parse(window.localStorage.getItem("taptap-owner-recommendation-statuses") || "{}"));
    } catch {
      setRecommendationStatuses({});
    }
  }, []);
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
  const updateRecommendationStatus = (id, status) => {
    const next = { ...recommendationStatuses, [id]: { status, updatedAt: Date.now() } };
    setRecommendationStatuses(next);
    try {
      window.localStorage.setItem("taptap-owner-recommendation-statuses", JSON.stringify(next));
      notify(`Recommendation marked ${status.toLowerCase()}.`);
    } catch {
      notify("Recommendation status could not be saved on this browser.");
    }
  };
  const scrollToOwnerSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const markCodRemitted = async (order) => {
    await updateOrder(order.id, { codRemitted: true });
    notify(`${order.id} COD marked as remitted.`);
  };
  const generateInsight = async () => {
    setInsightError("");
    if (!aiReady) {
      setInsight({ text: buildLocalDecisionSupport(insightOrders, insightInventory), generatedAt: Date.now(), provider: "local" });
      setInsightStatus("local");
      notify("Free recommendation generated from your local sales and inventory.");
      return;
    }
    setInsightStatus("loading");
    try {
      const scopedDecisionSupport = calculateOwnerDecisionSupport({
        orders: insightOrders,
        inventory: insightInventory,
        complaints,
        shiftLogs,
        targets: planning,
        isRevenueOrder
      });
      const result = await api.insights(insightOrders, insightInventory, insightPeriod, insightCategory, scopedDecisionSupport);
      setInsight(result);
      setInsightStatus("success");
    } catch (error) {
      setInsight({ text: buildLocalDecisionSupport(insightOrders, insightInventory), generatedAt: Date.now(), provider: "local" });
      setInsightError(error.message || "Groq could not generate an analysis. The local recommendation is shown instead.");
      setInsightStatus("error");
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
  const openSuspensionAction = (account) => {
    setSuspensionError("");
    setSuspensionTarget(account);
  };
  const closeSuspensionAction = () => {
    if (suspensionBusy) return;
    setSuspensionTarget(null);
    setSuspensionError("");
  };
  const updateSuspension = async (reason) => {
    if (!suspensionTarget || suspensionBusy) return;
    const nextSuspended = !suspensionTarget.suspended;
    setSuspensionBusy(true);
    setSuspensionError("");
    try {
      await api.setUserSuspension(suspensionTarget.uid, nextSuspended, reason);
      notify(nextSuspended
        ? `${suspensionTarget.name}'s account was suspended and active sessions were revoked.`
        : `${suspensionTarget.name}'s account was reactivated. They can sign in again.`);
      await refreshUsers();
      setSuspensionTarget(null);
    } catch (error) {
      setSuspensionError(error.message);
    } finally {
      setSuspensionBusy(false);
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
        <div className="col-lg-4"><div className="dashboard-card"><h3>Local planning controls</h3><p className="module-note">Saved only on this browser for planning. These values do not change customer pricing.</p><label className="form-label">Sales goal threshold<input className="form-control" type="number" min="1" value={salesGoal} onChange={(event) => setPlanning((current) => ({ ...current, salesGoal: Math.max(1, Number(event.target.value || 1)) }))} /></label><label className="form-label">Preparation target (minutes)<input className="form-control" type="number" min="1" value={planning.prepTargetMinutes} onChange={(event) => setPlanning((current) => ({ ...current, prepTargetMinutes: Math.max(1, Number(event.target.value || 1)) }))} /></label><label className="form-label">Delivery target (minutes)<input className="form-control" type="number" min="1" value={planning.deliveryTargetMinutes} onChange={(event) => setPlanning((current) => ({ ...current, deliveryTargetMinutes: Math.max(1, Number(event.target.value || 1)) }))} /></label><label className="form-label">Acceptable cash variance<input className="form-control" type="number" min="0" value={planning.cashVarianceLimit} onChange={(event) => setPlanning((current) => ({ ...current, cashVarianceLimit: Math.max(0, Number(event.target.value || 0)) }))} /></label><label className="form-label">Cancellation rate limit (%)<input className="form-control" type="number" min="0.1" step="0.1" value={planning.cancellationRateLimit} onChange={(event) => setPlanning((current) => ({ ...current, cancellationRateLimit: Math.max(.1, Number(event.target.value || .1)) }))} /></label><label className="form-label">Open complaint limit<input className="form-control" type="number" min="1" value={planning.complaintLimit} onChange={(event) => setPlanning((current) => ({ ...current, complaintLimit: Math.max(1, Number(event.target.value || 1)) }))} /></label><label className="form-label">Promotion scenario<select className="form-select" value={planning.activePromotion} onChange={(event) => setPlanning((current) => ({ ...current, activePromotion: event.target.value }))}><option>Free delivery over PHP 499</option><option>10% off rice meals</option><option>No active promotion</option></select></label><button className="btn btn-danger w-100 mt-3" onClick={savePlanningStrategy}>Save on this browser</button></div></div>
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
        <div className="col-12"><div className="dashboard-card account-control-note"><p className="eyebrow text-danger">Account control</p><h3>Team access is owner-managed</h3><p>Customers register publicly. Owner, staff, and rider accounts are created here, then use the same sign-in form. Their verified account role opens the correct workspace automatically.</p></div></div>

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
            <div className="table-responsive" tabIndex="0"><table className="table align-middle"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Staff scope</th><th>Account</th><th>Security</th><th>Controls</th></tr></thead><tbody>{managedUsers.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-4">No users found.</td></tr>}{managedUsers.map((account) => <tr key={account.uid}><td><strong>{account.name}</strong><small className="d-block text-secondary">{account.uid}</small></td><td>{account.email}</td><td><span className="role-badge">{account.role}</span></td><td>{account.role === "staff" ? staffRoleLabels[account.staffRole] || "Manager" : "-"}</td><td><span className={`stock-badge ${account.suspended ? "low" : "healthy"}`}>{account.suspended ? "Suspended" : "Active"}</span></td><td><span className={`stock-badge ${account.twoFactorEnabled && !account.twoFactorLocked ? "healthy" : "low"}`}>{account.twoFactorLocked ? "Locked" : account.twoFactorEnabled ? `${securityMethodLabels[account.twoFactorMethod] || "Security"} enabled` : "Not set up"}</span></td><td><div className="d-flex flex-wrap gap-2"><button className="btn btn-sm btn-outline-danger" type="button" onClick={() => securityAction(account.uid, "reset")}>Reset security</button>{account.twoFactorLocked && <button className="btn btn-sm btn-dark" type="button" onClick={() => securityAction(account.uid, "unlock")}>Unlock</button>}<button className={`btn btn-sm ${account.suspended ? "btn-outline-dark" : "btn-danger"}`} type="button" disabled={!account.suspended && account.uid === user.uid} title={!account.suspended && account.uid === user.uid ? "You cannot suspend the account you are currently using." : undefined} onClick={() => openSuspensionAction(account)}>{account.suspended ? "Reactivate" : "Suspend"}</button></div></td></tr>)}</tbody></table></div>
          </div>
        </div>

        <div className="col-xl-6"><form className="dashboard-card" onSubmit={updateRole}><h3>Assign existing user role</h3><p className="module-note">Use this when an account already exists and only needs a role correction.</p><label className="form-label">Account ID<input className="form-control" required value={roleForm.uid} onChange={(event) => setRoleForm((current) => ({ ...current, uid: event.target.value }))} /></label><label className="form-label">Role<select className="form-select" value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))}><option>owner</option><option>staff</option><option>rider</option><option>customer</option></select></label>{roleForm.role === "staff" && <label className="form-label">Staff access scope<select className="form-select" value={roleForm.staffRole} onChange={(event) => setRoleForm((current) => ({ ...current, staffRole: event.target.value }))}>{Object.entries(staffRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<button className="btn btn-danger w-100 mt-3">Update role</button></form></div>
        <div className="col-xl-6"><form className="dashboard-card" onSubmit={sendAdminMessage}><h3>Private admin notification</h3><label className="form-label">Recipient<select className="form-select" required value={adminMessage.uid} onChange={(event) => setAdminMessage((current) => ({ ...current, uid: event.target.value }))}><option value="">Select a user</option>{managedUsers.map((account) => <option key={account.uid} value={account.uid}>{account.name} ({account.role})</option>)}</select></label><label className="form-label">Title<input className="form-control" required value={adminMessage.title} onChange={(event) => setAdminMessage((current) => ({ ...current, title: event.target.value }))} /></label><label className="form-label">Message<textarea className="form-control" required maxLength="1000" rows="3" value={adminMessage.message} onChange={(event) => setAdminMessage((current) => ({ ...current, message: event.target.value }))} /></label><button className="btn btn-dark w-100 mt-3">Send only to this user</button></form></div>
      </div>
      {suspensionTarget && <ReasonModal title={`${suspensionTarget.suspended ? "Reactivate" : "Suspend"} ${suspensionTarget.name}`} label="Account action reason" placeholder={suspensionTarget.suspended ? "Example: Review completed and access can be restored..." : "Example: Access review, team departure, or suspected compromise..."} confirmText={suspensionTarget.suspended ? "Reactivate account" : "Suspend account"} submitting={suspensionBusy} error={suspensionError} onClose={closeSuspensionAction} onSubmit={updateSuspension} />}
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
  if (section === "owner-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Business administration</p><h2>System Settings</h2></div></div><div className="row g-3"><div className="col-12"><SettingsModule title="Payments, notifications and system controls" serviceStatus={serviceStatus} notify={notify} /></div><div className="col-12"><ApprovalQueueModule user={user} notify={notify} /></div><div className="col-12"><RecoveryPanel notify={notify} /></div><div className="col-12"><AdminCleanupModule user={user} orders={orders} inventory={inventory} auditLogs={auditLogs} shiftLogs={shiftLogs} notify={notify} /></div></div></main>;
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

      <div className="owner-overview-meta"><span>{dashboardOrders.length} orders in scope</span><span>{dataUpdatedAt ? `Source data updated ${new Date(dataUpdatedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}` : "Waiting for live orders"}</span><span className={decisionSupport.freshness.stale ? "freshness-stale" : "freshness-current"}>{decisionSupport.freshness.stale ? "Historical data" : "Live data"}</span></div>

      <nav className="owner-section-nav" aria-label="Owner dashboard sections">
        <button type="button" onClick={() => scrollToOwnerSection("owner-attention")}>Needs attention</button>
        <button type="button" onClick={() => scrollToOwnerSection("owner-performance")}>Performance</button>
        <button type="button" onClick={() => scrollToOwnerSection("owner-intelligence")}>Business intelligence</button>
        <button type="button" onClick={() => scrollToOwnerSection("owner-forecast")}>Forecast</button>
        <button type="button" onClick={() => scrollToOwnerSection("owner-ai-advisor")}>AI analysis</button>
      </nav>

      <section className="owner-attention-board" id="owner-attention" aria-label="Items requiring owner attention">
        <div className="module-heading"><div><p className="eyebrow text-danger">Today&apos;s exceptions</p><h2>Needs a decision</h2></div><span className="module-note">Open an item to continue in its operational workspace.</span></div>
        <div className="owner-attention-grid">
          <button className={overdueOrders.length ? "urgent" : ""} type="button" onClick={() => onNavigate?.("owner-sales")}><AlertTriangle aria-hidden="true" /><span><strong>{overdueOrders.length}</strong><b>Overdue orders</b><small>Beyond the {planning.prepTargetMinutes}-minute preparation target</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={pendingPaymentOrders.length ? "warning" : ""} type="button" onClick={() => onNavigate?.("owner-sales")}><CreditCard aria-hidden="true" /><span><strong>{pendingPaymentOrders.length}</strong><b>Pending payments</b><small>Not yet counted as revenue</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={lowStockItems.length ? "warning" : ""} type="button" onClick={() => onNavigate?.("owner-inventory")}><PackageSearch aria-hidden="true" /><span><strong>{lowStockItems.length}</strong><b>Low-stock items</b><small>Receiving or reorder action needed</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={unremittedCodOrders.length ? "warning" : ""} type="button" onClick={() => onNavigate?.("owner-reports")}><ClipboardList aria-hidden="true" /><span><strong>{unremittedCodOrders.length}</strong><b>COD to reconcile</b><small>{currency(sumByTotal(unremittedCodOrders))} awaiting owner confirmation</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={unresolvedComplaints.length ? "urgent" : ""} type="button" onClick={() => onNavigate?.("owner-reviews")}><MessageSquareWarning aria-hidden="true" /><span><strong>{unresolvedComplaints.length}</strong><b>Open complaints</b><small>Customer recovery follow-up</small></span><ArrowRight aria-hidden="true" /></button>
          <button className={unavailableServices.length ? "urgent" : ""} type="button" onClick={() => onNavigate?.("owner-settings")}><WifiOff aria-hidden="true" /><span><strong>{unavailableServices.length}</strong><b>Service warnings</b><small>{unavailableServices.length ? unavailableServices.map(([name]) => name).join(", ") : "All checked services ready"}</small></span><ArrowRight aria-hidden="true" /></button>
        </div>
      </section>

      <section className="owner-stat-grid owner-kpi-grid" id="owner-performance" aria-label="Owner performance metrics">
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-sales")}><small>Paid sales</small><strong>{currency(dashboardSales)}</strong><span>{salesChange == null ? "No previous-period sales to compare" : `${signedPercent(salesChange)} compared with the previous period`}</span></button>
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-sales")}><small>Average paid order</small><strong>{currency(dashboardAverageOrder)}</strong><span>{dashboardRevenueOrders.length} paid order{dashboardRevenueOrders.length === 1 ? "" : "s"}</span></button>
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-sales")}><small>Active workload</small><strong>{countLabel(activeWorkload.length, "active order")}</strong><span>{countLabel(overdueOrders.length, "order")} beyond the preparation target</span></button>
        <button className="metric-card owner-metric-card" type="button" onClick={() => onNavigate?.("owner-inventory")}><small>Low stock</small><strong>{countLabel(lowStockItems.length, "product")}</strong><span>At or below the configured reorder point</span></button>
      </section>

      <section className="owner-decision-dashboard" aria-label="Priority KPI dashboard">
        <div className="owner-dashboard-section">
          <div className="module-heading"><div><p className="eyebrow text-danger">Current performance</p><h2>Operational KPIs</h2></div><span className="module-note">Calculated from loaded system records</span></div>
          <div className="owner-decision-metrics">
            <button type="button" onClick={() => onNavigate?.("owner-reports")}><small>Payment success rate</small><strong>{decisionSupport.kpis.paymentSuccessRate}% successful</strong><span>{countLabel(decisionSupport.kpis.paymentFailureCount, "failed payment attempt")}</span></button>
            <button type="button" onClick={() => onNavigate?.("owner-sales")}><small>Cancellation rate</small><strong>{decisionSupport.kpis.cancellationRate}% cancelled</strong><span>{countLabel(decisionSupport.kpis.cancellationCount, "cancelled order")} worth {currency(decisionSupport.kpis.cancelledOrderValue)}</span></button>
            <button type="button" onClick={() => onNavigate?.("owner-reports")} className={decisionSupport.kpis.paidCancellationReviewCount ? "needs-review" : ""}><small>Payment review required</small><strong>{countLabel(decisionSupport.kpis.paidCancellationReviewCount, "order")}</strong><span>Paid cancellations requiring owner review</span></button>
            <button type="button" onClick={() => onNavigate?.("owner-reviews")}><small>Open complaints</small><strong>{countLabel(decisionSupport.kpis.openComplaintCount, "complaint")}</strong><span>Unresolved customer cases</span></button>
            <button type="button" onClick={() => onNavigate?.("owner-sales")}><small>Average delivery time</small><strong>{decisionSupport.kpis.averageDeliveryMinutes ? countLabel(decisionSupport.kpis.averageDeliveryMinutes, "minute") : "No completed deliveries"}</strong><span>Target: {countLabel(planning.deliveryTargetMinutes, "minute")}</span></button>
            <button type="button" onClick={() => onNavigate?.("owner-reports")}><small>Absolute cash variance</small><strong>{currency(decisionSupport.kpis.cashVariance)}</strong><span>Limit {currency(planning.cashVarianceLimit)}</span></button>
            <button type="button" onClick={() => onNavigate?.("owner-sales")}><small>Delivery delays</small><strong>{countLabel(decisionSupport.kpis.delayedDeliveryCount, "delayed order")}</strong><span>Beyond the {countLabel(planning.deliveryTargetMinutes, "minute")} target</span></button>
            <button type="button" onClick={() => onNavigate?.("owner-reports")}><small>Staff productivity</small><strong>{decisionSupport.kpis.averageOrdersPerShift} orders per shift</strong><span>Average across closed shifts</span></button>
          </div>
        </div>

        <div className="owner-dashboard-section">
          <div className="module-heading"><div><p className="eyebrow text-danger">Period comparison</p><h2>Performance change</h2></div><span className="module-note">Paid sales only</span></div>
          <div className="owner-comparison-grid">
            {decisionSupport.comparisons.map((row) => <button type="button" key={row.label} onClick={() => onNavigate?.(row.destination)}><span>{row.label}</span><strong>{currency(row.currentSales)} in paid sales</strong><small>{row.salesChangePercent == null ? "No previous sales to compare" : `${signedPercent(row.salesChangePercent)}; ${countLabel(row.currentOrders, "current order")} compared with ${countLabel(row.previousOrders, "previous order")}`}</small><ArrowRight size={17} aria-hidden="true" /></button>)}
          </div>
        </div>

        <div className="owner-dashboard-section" id="owner-intelligence">
          <div className="module-heading"><div><p className="eyebrow text-danger">Business intelligence</p><h2>Sales and inventory patterns</h2></div><span className="module-note">Latest 30 completed days unless stated otherwise</span></div>
          <div className="owner-intelligence-grid">
            <section aria-labelledby="sales-pattern-heading">
              <div className="owner-intelligence-heading"><h3 id="sales-pattern-heading">Sales patterns</h3><button type="button" onClick={() => onNavigate?.("owner-sales")}>View sales</button></div>
              <dl>
                <div><dt>Average daily sales</dt><dd>{currency(decisionSupport.businessPatterns.sales.dailyAverageSales)} per day</dd></div>
                <div><dt>Order volume</dt><dd>{countLabel(decisionSupport.businessPatterns.sales.orderVolume, "paid order")} in 30 days</dd></div>
                <div><dt>Average order value</dt><dd>{currency(decisionSupport.businessPatterns.sales.averageOrderValue)} per paid order</dd></div>
                <div><dt>Seven-day sales</dt><dd>{currency(decisionSupport.businessPatterns.sales.sevenDaySales)}{decisionSupport.businessPatterns.sales.sevenDayGrowthPercent == null ? "; no prior baseline" : `; ${signedPercent(decisionSupport.businessPatterns.sales.sevenDayGrowthPercent)} from the prior 7 days`}</dd></div>
                <div><dt>Highest demand</dt><dd>{decisionSupport.businessPatterns.sales.highestDemandProduct ? `${decisionSupport.businessPatterns.sales.highestDemandProduct.name}; ${countLabel(decisionSupport.businessPatterns.sales.highestDemandProduct.units, "unit")} sold` : "Not enough paid sales data"}</dd></div>
                <div><dt>Highest product revenue</dt><dd>{decisionSupport.businessPatterns.sales.highestRevenueProduct ? `${decisionSupport.businessPatterns.sales.highestRevenueProduct.name}; ${currency(decisionSupport.businessPatterns.sales.highestRevenueProduct.sales)}` : "Not enough paid sales data"}</dd></div>
                <div><dt>Peak order hour</dt><dd>{decisionSupport.businessPatterns.sales.peakHour ? `${hourLabel(decisionSupport.businessPatterns.sales.peakHour.hour)}; ${countLabel(decisionSupport.businessPatterns.sales.peakHour.orders, "order")}` : "Not enough paid order data"}</dd></div>
                <div><dt>Strongest weekday</dt><dd>{decisionSupport.businessPatterns.sales.strongestWeekday ? `${decisionSupport.businessPatterns.sales.strongestWeekday.day}; ${currency(decisionSupport.businessPatterns.sales.strongestWeekday.sales)} from ${countLabel(decisionSupport.businessPatterns.sales.strongestWeekday.orders, "order")}` : "Not enough paid order data"}</dd></div>
              </dl>
            </section>
            <section aria-labelledby="inventory-health-heading">
              <div className="owner-intelligence-heading"><h3 id="inventory-health-heading">Inventory health</h3><button type="button" onClick={() => onNavigate?.("owner-inventory")}>View inventory</button></div>
              <dl>
                <div><dt>Current stock</dt><dd>{countLabel(decisionSupport.businessPatterns.inventory.currentStockUnits, "unit")} across {countLabel(decisionSupport.businessPatterns.inventory.productsTracked, "product")}</dd></div>
                <div><dt>Units sold</dt><dd>{countLabel(decisionSupport.businessPatterns.inventory.thirtyDayUnitsSold, "unit")} in 30 days</dd></div>
                <div><dt>Sell-through estimate</dt><dd>{decisionSupport.businessPatterns.inventory.sellThroughPercent}% of sold plus remaining units</dd></div>
                <div><dt>Low stock</dt><dd>{countLabel(decisionSupport.businessPatterns.inventory.lowStockCount, "product")} at or below reorder point</dd></div>
                <div><dt>Out of stock</dt><dd>{countLabel(decisionSupport.businessPatterns.inventory.outOfStockCount, "product")}</dd></div>
              </dl>
              <details className="owner-data-availability"><summary>Metrics waiting for source data</summary><ul>{decisionSupport.businessPatterns.unavailable.map((item) => <li key={item.metric}><strong>{item.metric}</strong><span>{item.reason}</span></li>)}</ul></details>
            </section>
          </div>
        </div>

        <div className="owner-dashboard-section owner-forecast-section" id="owner-forecast">
          <div className="module-heading"><div><p className="eyebrow text-danger">Forecast</p><h2>Demand outlook</h2></div><span className={`forecast-confidence ${decisionSupport.forecast.confidence}`}>{decisionSupport.forecast.confidence} confidence</span></div>
          {!decisionSupport.forecast.available ? <div className="owner-forecast-empty"><strong>Reliable forecast not available</strong><p>{decisionSupport.forecast.reason}</p><small>{decisionSupport.forecast.analyzedOrders} paid orders across {decisionSupport.forecast.historyDays} day{decisionSupport.forecast.historyDays === 1 ? "" : "s"}.</small></div> : <>
            <div className="owner-forecast-metrics">
              <div><small>Tomorrow's forecast</small><strong>{currency(decisionSupport.forecast.tomorrow.sales)} in sales</strong><span>{countLabel(decisionSupport.forecast.tomorrow.orders, "expected order")}</span></div>
              <div><small>Next 7 days forecast</small><strong>{currency(decisionSupport.forecast.sevenDays.sales)} in sales</strong><span>{countLabel(decisionSupport.forecast.sevenDays.orders, "expected order")}</span></div>
              <div><small>Forecast accuracy</small><strong>{forecastAccuracy.latest ? `${forecastAccuracy.latest.accuracyPercent}%` : "Pending"}</strong><span>{forecastAccuracy.latest ? `${forecastAccuracy.latest.targetDate} actual comparison` : "Available after one forecast cycle"}</span></div>
              {decisionSupport.forecast.staffing.map((shift) => <div key={shift.label}><small>{shift.label} staffing</small><strong>{countLabel(shift.suggestedStaff, "staff member")} suggested</strong><span>{countLabel(shift.expectedOrders, "expected order")} per day</span></div>)}
            </div>
            <details className="owner-forecast-details"><summary>Product demand and stock depletion</summary><div>{decisionSupport.forecast.products.length === 0 ? <p>No product forecast is available.</p> : decisionSupport.forecast.products.map((item) => <button type="button" key={item.id} onClick={() => onNavigate?.("owner-inventory")}><span><strong>{item.name}</strong><small>{countLabel(item.sevenDayDemand, "unit")} expected to sell in the next 7 days</small></span><b>{daysOfStockLabel(item.daysToDepletion)}</b><em>{item.suggestedReorder ? `Suggested reorder: ${countLabel(item.suggestedReorder, "unit")}` : "Current stock should be sufficient"}</em></button>)}</div></details>
          </>}
          <p className="owner-forecast-method">{decisionSupport.forecast.reason} Forecasts are advisory and never change stock or staffing automatically.</p>
        </div>

        <div className="owner-dashboard-section">
          <div className="module-heading"><div><p className="eyebrow text-danger">Recommended actions</p><h2>Ranked priorities</h2></div><span className="module-note">Scores are calculated before Groq analysis</span></div>
          {decisionSupport.priorities.length === 0 ? <div className="owner-priority-empty">No KPI has crossed its configured action threshold.</div> : <div className="owner-priority-list">{decisionSupport.priorities.map((item) => <article key={item.id}><button className="owner-priority-open" type="button" onClick={() => onNavigate?.(item.destination)}><span className={`priority-level ${item.level}`}>{item.level}<small>{item.score}/100</small></span><span><strong>{item.title}</strong><small>{item.detail}</small><em>{item.action}</em></span><span><b>{item.role}</b><small>{item.deadline}</small></span><ArrowRight size={18} aria-hidden="true" /></button><label>Status<select aria-label={`${item.title} recommendation status`} value={recommendationStatuses[item.id]?.status || "Not reviewed"} onChange={(event) => updateRecommendationStatus(item.id, event.target.value)}><option>Not reviewed</option><option>Accepted</option><option>Completed</option><option>Dismissed</option></select></label></article>)}</div>}
          <p className="owner-tracking-note">Recommendation decisions are saved on this browser and do not change orders or inventory automatically.</p>
        </div>
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
          {lowStockItems.slice(0, 6).map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>Reorder when stock reaches {countLabel(item.reorderPoint, "unit")}</small></span><b>{countLabel(item.stock, "unit")} currently in stock</b></div>)}
          {lowStockItems.length === 0 && <p className="text-secondary small">All products are above their reorder points.</p>}
        </div>
        <div className="dashboard-card"><h3>Best sellers</h3>{bestSellerRows.length === 0 && <div className="empty-chat">Sales will appear here.</div>}{bestSellerRows.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{countLabel(item.qty, "unit")} sold</small></span><b>{currency(item.sales)} in sales</b></div>)}</div>
        <div className="dashboard-card"><h3>Slow-moving items</h3>{slowMovingRows.length === 0 && <div className="empty-chat">Inventory activity will appear here.</div>}{slowMovingRows.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{countLabel(item.qty, "unit")} sold; {countLabel(item.stock, "unit")} currently in stock</small></span><b>{countLabel(item.qty, "unit")} sold</b></div>)}</div>
        <div className="dashboard-card"><h3>Peak order hours</h3>{peakHours.length === 0 && <div className="empty-chat">No order hour data yet.</div>}{peakHours.map((hour) => <div className="alert-row" key={hour.hour}><span><strong>{hour.label}</strong><small>High order volume</small></span><b>{countLabel(hour.count, "order")}</b></div>)}</div>
        <div className="dashboard-card"><h3>Inventory forecast</h3>{runoutForecast.length === 0 && <div className="empty-chat">Forecast appears after recent sales.</div>}{runoutForecast.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>Average: {item.dailyVelocity.toFixed(1)} units sold per day</small></span><b>{daysOfStockLabel(Number(item.daysLeft.toFixed(1)))}</b></div>)}</div>
        <div className="dashboard-card"><h3>Staff shift performance</h3>{shiftPerformance.length === 0 && <div className="empty-chat">Closed shifts will appear here.</div>}{shiftPerformance.map((shift) => <div className="alert-row" key={shift.id}><span><strong>{shift.staffName}</strong><small>{countLabel(shift.orderCount, "order")} handled; cash variance {currency(shift.variance)}</small></span><b>{currency(shift.cashSales || shift.expectedCash)} in cash sales</b></div>)}</div>
        <div className="dashboard-card ai-insight owner-decision-card" id="owner-ai-advisor" aria-live="polite">
          <div className="owner-ai-heading">
            <div><p className="eyebrow">Decision intelligence</p><h3>AI KPI Advisor</h3><small>Groq explains calculated KPIs and forecasts. Recommendations require owner review.</small></div>
          </div>
          <div className="owner-ai-controls">
            <label>Analysis period<select value={insightPeriod} onChange={(event) => { setInsightPeriod(event.target.value); setInsight(null); setInsightStatus("idle"); setInsightError(""); }} disabled={insightStatus === "loading"}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All records</option></select></label>
            <label>Product category<select value={insightCategory} onChange={(event) => { setInsightCategory(event.target.value); setInsight(null); setInsightStatus("idle"); setInsightError(""); }} disabled={insightStatus === "loading"}><option value="all">All categories</option>{insightCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          </div>
          {insightStatus === "idle" && <div className="owner-ai-empty"><Sparkles aria-hidden="true" /><div><strong>Generate a KPI analysis</strong><p>Groq will explain the calculated performance, forecast confidence, risks, and ranked owner actions.</p></div></div>}
          {insightStatus === "loading" && <div className="owner-ai-empty loading" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true" /><div><strong>Analyzing calculated KPIs...</strong><p>This normally takes only a few seconds.</p></div></div>}
          {insightError && <div className="owner-ai-error" role="alert"><strong>Groq analysis unavailable</strong><span>{insightError} The local analysis is shown below.</span></div>}
          {insight && <div className="owner-ai-result">
            {insight.insight?.dataQuality && <section className={`owner-ai-quality ${insight.insight.dataQuality.confidence}`}>
              <div><span>Data quality</span><strong>{insight.insight.dataQuality.label}</strong></div>
              {insight.insight.dataQuality.warnings.length > 0
                ? <ul>{insight.insight.dataQuality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                : <p>The selected records are sufficient for cautious trend analysis.</p>}
            </section>}
            <section className="owner-ai-summary"><span>Summary</span><p>{insight.insight?.summary || insight.text}</p></section>
            {insight.insight && <>
              <section className="owner-ai-section owner-ai-top-actions"><div><span>What to do today</span><small>Calculated priorities with accountable roles and deadlines</small></div>{decisionSupport.priorities.length === 0 ? <p>No configured KPI threshold currently requires action.</p> : decisionSupport.priorities.slice(0, 3).map((item) => <article key={item.id}><div><strong>{item.action}</strong><small>{item.detail}</small></div><span className={`owner-ai-severity ${item.level}`}>{item.level}</span><b>{item.role}; {item.deadline}</b></article>)}</section>
              <div className="owner-ai-counts"><span><strong>{insight.insight.stockRisks.length}</strong> stock risks</span><span><strong>{insight.insight.reorderRecommendations.length}</strong> reorder priorities</span><span><strong>{insight.insight.wasteRisks.length}</strong> waste risks</span></div>
              <div className="owner-ai-observations"><section><span>Sales trend</span><p>{insight.insight.salesTrend}</p></section><section><span>Peak period</span><p>{insight.insight.peakPeriod}</p></section></div>
              <section className="owner-ai-section"><div><span>Stock risks</span><small>Based on current stock and reorder points</small></div>{insight.insight.stockRisks.length === 0 ? <p>No immediate stock risk in the selected records.</p> : insight.insight.stockRisks.map((item) => <article key={item.product}><div><strong>{item.product}</strong><small>{item.reason}</small></div><span className={`owner-ai-severity ${item.severity}`}>{item.severity}</span><b>{item.currentStock} / {item.reorderPoint}</b></article>)}</section>
              <section className="owner-ai-section"><div><span>Reorder priorities</span><small>Suggested additions only</small></div>{insight.insight.reorderRecommendations.length === 0 ? <p>No reorder recommendation from the selected records.</p> : insight.insight.reorderRecommendations.map((item) => <article key={item.product}><div><strong>{item.product}</strong><small>{item.reason}</small></div><span>{item.currentStock} now</span><b>+{item.suggestedQuantity}</b></article>)}</section>
              <section className="owner-ai-section"><div><span>Waste watch</span><small>Products needing owner attention</small></div>{insight.insight.wasteRisks.length === 0 ? <p>No clear waste risk in the selected records.</p> : insight.insight.wasteRisks.map((item) => <article key={item.product}><div><strong>{item.product}</strong><small>{item.risk}</small></div><span>{item.action}</span></article>)}</section>
              <section className="owner-ai-action"><span>Recommended owner action</span><p>{insight.insight.ownerAction}</p></section>
            </>}
          </div>}
          <div className="owner-ai-footer">
            <small>{insight?.generatedAt ? `${insight.cached ? "Reused recent analysis from" : "Last generated"} ${new Date(insight.generatedAt).toLocaleString("en-PH")}${insight.provider === "groq" ? " with Groq" : " using local analysis"}.` : "No analysis generated yet."}</small>
            <button className="btn btn-warning" onClick={generateInsight} disabled={insightStatus === "loading"}><Sparkles size={16} aria-hidden="true" />{insightStatus === "loading" ? "Analyzing..." : insightStatus === "error" ? "Retry Groq" : aiReady ? "Generate analysis" : "Generate local analysis"}</button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function OwnerWorkspace({ helpers, ...props }) {
  setWorkspaceHelpers(helpers);
  return <OwnerWorkspaceContent {...props} />;
}
