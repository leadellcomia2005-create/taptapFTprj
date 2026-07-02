import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
// erick: lucide icons para mas malinaw ang menu, close, bell, logout, at trash actions.
import { Bell, LogOut, Menu, Trash2, X } from "lucide-react";
import { BrandMark } from "./components/Branding";
import { PageLoader, SectionLoader } from "./components/Loaders";
import MenuPhoto from "./components/MenuPhoto";
import { defaultViewForRole, navigationForUser, staffCanAccess, staffRoleLabels } from "./config/appConfig";
import { fallbackMenu } from "./data/menu";
import { api } from "./services/api";
import {
  firebaseEnabled,
  logout,
  observeAuth,
  subscribeAuditLogs,
  subscribeComplaints,
  subscribeInventory,
  subscribeMenu,
  subscribeNotifications,
  subscribeOrders,
  subscribeRiderLocation,
  subscribeReviews,
  subscribeShiftLogs,
  sendSupportMessage,
  subscribeSupportMessages,
  subscribeUserProfile
} from "./services/firebase";
import { disconnectSocket, getSocket, subscribeSocketRiderLocation } from "./services/socket";
import { EmailVerificationPanel, LoginPanel, TwoFactorPanel } from "./features/auth/AuthPanels";
import { menuAvailability } from "./utils/operations";
import { assistantSourceLabel, currency, relativeTime, statusLabel } from "./utils/display";

const DeliveryMap = lazy(() => import("./components/DeliveryMap"));
const Checkout = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.Checkout })));
const OrdersView = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.OrdersView })));
const CustomerProfile = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.CustomerProfile })));
const ReceiptsView = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.ReceiptsView })));
const ReviewsView = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.ReviewsView })));
const OwnerWorkspace = lazy(() => import("./features/workspaces/OwnerWorkspace"));
const StaffWorkspace = lazy(() => import("./features/workspaces/StaffWorkspace"));
const RiderWorkspace = lazy(() => import("./features/workspaces/RiderWorkspace"));

const dayMs = 24 * 60 * 60 * 1000;
const pad2 = (value) => String(value).padStart(2, "0");
const localDateInputValue = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const reportDateRange = (value) => {
  const [year, month, day] = String(value || localDateInputValue()).split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime();
  return { start, end: start + dayMs };
};
const inRange = (timestamp, range) => Number(timestamp || 0) >= range.start && Number(timestamp || 0) < range.end;
const reportMoney = (value) => `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sumByTotal = (orders) => orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
const orderPaymentLabel = (order) => {
  const method = String(order.paymentMethod || "unknown").toUpperCase();
  const paid = order.status === "cancelled"
    ? "cancelled"
    : order.paymentMethod === "cod" && order.status === "delivered" && !order.codRemittedAt
      ? "collected"
      : isRevenueOrder(order) ? "counted" : "pending";
  return `${method} (${paid})`;
};
const isRevenueOrder = (order) => {
  if (!order || order.status === "cancelled" || order.paymentStatus === "pending" || order.status === "pending-payment") return false;
  if (order.paymentStatus === "paid") return true;
  if (order.paymentMethod === "cash") return true;
  if (order.paymentMethod === "cod") return order.status === "delivered" || order.status === "completed" || Boolean(order.deliveredAt || order.completedAt);
  return false;
};
const isOutstandingCod = (order) => order?.paymentMethod === "cod" && order.deliveryType === "delivery" && order.status !== "cancelled" && !isRevenueOrder(order);
const isUnremittedCod = (order) => order?.paymentMethod === "cod" && order.deliveryType === "delivery" && order.status === "delivered" && !order.codRemittedAt;
const locationToPoint = (location) => {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
};
const topSellingItems = (orders) => {
  const items = new Map();
  for (const order of orders) {
    for (const item of order.items || []) {
      const current = items.get(item.name) || { name: item.name, qty: 0, sales: 0 };
      const qty = Number(item.qty || 0);
      current.qty += qty;
      current.sales += qty * Number(item.price || 0);
      items.set(item.name, current);
    }
  }
  return [...items.values()].sort((a, b) => b.qty - a.qty || b.sales - a.sales).slice(0, 8);
};
const peakSalesHour = (orders) => {
  const hours = new Map();
  for (const order of orders) {
    const hour = new Date(Number(order.createdAt || 0)).getHours();
    hours.set(hour, (hours.get(hour) || 0) + 1);
  }
  const [hour, count] = [...hours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [];
  if (hour === undefined) return null;
  const start = new Date();
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(hour + 1, 0, 0, 0);
  return {
    count,
    label: `${start.toLocaleTimeString("en-PH", { hour: "numeric" })}-${end.toLocaleTimeString("en-PH", { hour: "numeric" })}`
  };
};
const buildLocalDecisionSupport = (orders, inventory) => {
  const todayRange = reportDateRange(localDateInputValue());
  const todayOrders = orders.filter((order) => inRange(order.createdAt, todayRange) && isRevenueOrder(order));
  const weekRange = { start: todayRange.start - 6 * dayMs, end: todayRange.end };
  const weekOrders = orders.filter((order) => inRange(order.createdAt, weekRange) && isRevenueOrder(order));
  const allRevenueOrders = orders.filter(isRevenueOrder);
  const scopedOrders = todayOrders.length ? todayOrders : weekOrders.length ? weekOrders : allRevenueOrders;
  const scope = todayOrders.length ? "today" : weekOrders.length ? "in the last 7 days" : "across paid orders";
  const topItems = topSellingItems(scopedOrders);
  const lowStock = [...inventory]
    .filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0))
    .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0) || String(a.name).localeCompare(String(b.name)));
  const soldNames = new Set(scopedOrders.flatMap((order) => (order.items || []).map((item) => item.name)));
  const slowMover = [...inventory]
    .filter((item) => Number(item.stock || 0) > 0 && !soldNames.has(item.name))
    .sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0) || String(a.name).localeCompare(String(b.name)))[0];
  const lowStockText = lowStock.length
    ? `Low stock: ${lowStock.slice(0, 3).map((item) => `${item.name} (${item.stock} left)`).join(", ")}.`
    : "Stock: all tracked items are above reorder point.";

  if (!topItems.length) {
    return `No paid sales ${scope} yet. ${lowStockText} Action: keep inventory counts updated and generate this again after orders are completed.`;
  }

  const best = topItems[0];
  const peak = peakSalesHour(scopedOrders);
  const slowText = slowMover ? `${slowMover.name} has stock but no paid sales ${scope}.` : "No clear slow mover from the current paid orders.";
  const action = lowStock.some((item) => item.name === best.name)
    ? `Prioritize restocking ${best.name} before promoting it again.`
    : lowStock.length
      ? `Restock ${lowStock[0].name} first, then keep ${best.name} visible as the lead offer.`
      : slowMover
        ? `Feature ${best.name} and test a small bundle with ${slowMover.name}.`
        : `Prepare extra ${best.name} portions before ${peak?.label || "the next rush"}.`;

  return `Best seller ${scope}: ${best.name} with ${best.qty} sold (${currency(best.sales)}). Peak hour: ${peak ? `${peak.label} from ${peak.count} paid order(s)` : "not enough timing data"}. Slow mover: ${slowText} ${lowStockText} Action: ${action}`;
};
const htmlEscape = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const orderItemText = (order) => (order.items || []).map((item) => `${item.qty} x ${item.name}`).join(", ") || "No items";
const reportOrderType = (order) => {
  if (order.deliveryType === "delivery") return "Delivery";
  if (order.deliveryType === "pickup") return "Pickup";
  if (order.deliveryType === "walk-in" && order.diningOption === "takeout") return "Takeout";
  if (order.deliveryType === "walk-in" && order.diningOption === "dine-in") return "Dine-in";
  if (order.deliveryType === "walk-in") return "Walk-in";
  return "Other";
};
const buildDailyReport = (orders, inventory, shiftLogs, reportDate) => {
  const range = reportDateRange(reportDate);
  const dailyOrders = orders.filter((order) => inRange(order.createdAt, range));
  const revenueOrders = dailyOrders.filter(isRevenueOrder);
  const cancelledOrders = dailyOrders.filter((order) => order.status === "cancelled");
  const pendingOrders = dailyOrders.filter((order) => !isRevenueOrder(order) && order.status !== "cancelled");
  const codExposureOrders = dailyOrders.filter(isOutstandingCod);
  const unremittedCodOrders = dailyOrders.filter(isUnremittedCod);
  const deliveredOrders = dailyOrders.filter((order) => order.status === "delivered");
  const completedOrders = dailyOrders.filter((order) => ["delivered", "completed"].includes(order.status));
  const closedShifts = shiftLogs.filter((log) => inRange(log.endedAt || log.createdAt, range));
  const lowStockItems = inventory.filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0));
  const orderTypeBreakdown = dailyOrders.reduce((groups, order) => {
    const label = reportOrderType(order);
    groups[label] = (groups[label] || 0) + 1;
    return groups;
  }, { Delivery: 0, Pickup: 0, "Dine-in": 0, Takeout: 0, "Walk-in": 0 });
  const paymentBreakdown = {
    cash: sumByTotal(revenueOrders.filter((order) => order.paymentMethod === "cash")),
    cod: sumByTotal(revenueOrders.filter((order) => order.paymentMethod === "cod")),
    online: sumByTotal(revenueOrders.filter((order) => order.paymentMethod === "gcash")),
    pending: sumByTotal(pendingOrders),
    codExposure: sumByTotal(codExposureOrders)
  };
  return {
    reportDate,
    dateLabel: new Date(range.start).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }),
    generatedAt: new Date().toLocaleString("en-PH"),
    dailyOrders,
    revenueOrders,
    pendingOrders,
    cancelledOrders,
    deliveredOrders,
    completedOrders,
    codExposureOrders,
    unremittedCodOrders,
    orderTypeBreakdown,
    closedShifts,
    lowStockItems,
    topItems: topSellingItems(revenueOrders),
    grossSales: sumByTotal(revenueOrders),
    paymentBreakdown
  };
};
const printableRows = (rows, columns, emptyText) => rows.length
  ? rows.map((row) => `<tr>${columns.map((column) => `<td>${htmlEscape(column.value(row))}</td>`).join("")}</tr>`).join("")
  : `<tr><td colspan="${columns.length}">${htmlEscape(emptyText)}</td></tr>`;
const printableOwnerReportHtml = (report) => {
  const orderColumns = [
    { label: "Order", value: (order) => order.id },
    { label: "Customer", value: (order) => order.customerName || "Customer" },
    { label: "Items", value: orderItemText },
    { label: "Payment", value: orderPaymentLabel },
    { label: "Status", value: (order) => statusLabel(order.status) },
    { label: "Total", value: (order) => reportMoney(order.total) }
  ];
  const itemColumns = [
    { label: "Item", value: (item) => item.name },
    { label: "Qty sold", value: (item) => item.qty },
    { label: "Sales", value: (item) => reportMoney(item.sales) }
  ];
  const shiftColumns = [
    { label: "Staff", value: (log) => log.staffName || "Staff" },
    { label: "Closed", value: (log) => new Date(log.endedAt || log.createdAt).toLocaleString("en-PH") },
    { label: "Orders", value: (log) => log.orderCount || 0 },
    { label: "Cash movements", value: (log) => reportMoney(Number(log.cashIn || 0) - Number(log.cashOut || 0) - Number(log.expenses || 0)) },
    { label: "Expected", value: (log) => reportMoney(log.expectedCash) },
    { label: "Actual", value: (log) => reportMoney(log.actualCash) },
    { label: "Variance", value: (log) => reportMoney(log.variance) },
    { label: "Notes", value: (log) => log.notes || "-" }
  ];
  const stockColumns = [
    { label: "Item", value: (item) => item.name },
    { label: "Stock", value: (item) => item.stock },
    { label: "Reorder point", value: (item) => item.reorderPoint }
  ];
  const codRemittanceColumns = [
    { label: "Order", value: (order) => order.id },
    { label: "Customer", value: (order) => order.customerName || "Customer" },
    { label: "Rider", value: (order) => order.riderName || order.riderId || "-" },
    { label: "Collected total", value: (order) => reportMoney(order.total) }
  ];
  const orderTypeColumns = [
    { label: "Order type", value: (row) => row.type },
    { label: "Count", value: (row) => row.count }
  ];
  const orderTypeRows = Object.entries(report.orderTypeBreakdown || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([type, count]) => ({ type, count }));
  const table = (title, columns, rows, emptyText) => `
    <section>
      <h2>${htmlEscape(title)}</h2>
      <table>
        <thead><tr>${columns.map((column) => `<th>${htmlEscape(column.label)}</th>`).join("")}</tr></thead>
        <tbody>${printableRows(rows, columns, emptyText)}</tbody>
      </table>
    </section>`;
  return `<!doctype html>
<html>
<head>
  <title>TapTap Owner Daily Report - ${htmlEscape(report.dateLabel)}</title>
  <style>
    body { margin: 32px; color: #201914; font-family: Arial, sans-serif; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #e33d2e; padding-bottom: 16px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    h2 { margin: 26px 0 10px; font-size: 17px; }
    p { margin: 3px 0; color: #70685d; font-size: 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 22px 0; }
    .box { border: 1px solid #eadfce; border-radius: 8px; padding: 12px; }
    .box span { display: block; color: #70685d; font-size: 10px; text-transform: uppercase; }
    .box strong { display: block; margin-top: 6px; font-size: 17px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { padding: 8px; border: 1px solid #eadfce; text-align: left; vertical-align: top; }
    th { background: #fbf4e8; text-transform: uppercase; font-size: 9px; letter-spacing: .05em; }
    @media print { body { margin: 18mm; } .summary { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>TapTap Foodtrip Owner Daily Report</h1>
      <p>Report date: ${htmlEscape(report.dateLabel)}</p>
      <p>Generated: ${htmlEscape(report.generatedAt)}</p>
    </div>
    <div>
      <p>Prepared for owner role</p>
      <p>Sales count only paid cash, paid online, and delivered COD.</p>
    </div>
  </header>
  <div class="summary">
    <div class="box"><span>Gross paid sales</span><strong>${htmlEscape(reportMoney(report.grossSales))}</strong></div>
    <div class="box"><span>Total orders</span><strong>${report.dailyOrders.length}</strong></div>
    <div class="box"><span>Completed orders</span><strong>${(report.completedOrders || report.deliveredOrders).length}</strong></div>
    <div class="box"><span>Pending or unpaid</span><strong>${report.pendingOrders.length}</strong></div>
    <div class="box"><span>Cancelled</span><strong>${report.cancelledOrders.length}</strong></div>
    <div class="box"><span>Cash</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.cash))}</strong></div>
    <div class="box"><span>Delivered COD</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.cod))}</strong></div>
    <div class="box"><span>Online/GCash</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.online))}</strong></div>
    <div class="box"><span>Open COD exposure</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.codExposure))}</strong></div>
    <div class="box"><span>COD to remit</span><strong>${htmlEscape(reportMoney(sumByTotal(report.unremittedCodOrders)))}</strong></div>
  </div>
  ${table("Top selling items", itemColumns, report.topItems, "No paid sales for this day.")}
  ${table("Order type breakdown", orderTypeColumns, orderTypeRows, "No orders for this day.")}
  ${table("COD waiting for owner handoff", codRemittanceColumns, report.unremittedCodOrders, "No COD collections waiting for owner handoff.")}
  ${table("Daily order ledger", orderColumns, report.dailyOrders, "No orders for this day.")}
  ${table("Closed shift reconciliation", shiftColumns, report.closedShifts, "No closed shifts for this day.")}
  ${table("Low stock snapshot", stockColumns, report.lowStockItems, "No low stock items.")}
</body>
</html>`;
};
const printOwnerDailyReport = (report) => {
  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(printableOwnerReportHtml(report));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 350);
  return true;
};

const printableReceiptHtml = (order) => {
  const receiptNo = order.receiptNo || order.id;
  const rows = (order.items || []).map((item) => `
    <tr>
      <td>${htmlEscape(`${item.qty} x ${item.name}`)}</td>
      <td>${htmlEscape(reportMoney(item.price))}</td>
      <td>${htmlEscape(reportMoney(Number(item.qty || 0) * Number(item.price || 0)))}</td>
    </tr>`).join("");
  return `<!doctype html>
<html>
<head>
  <title>TapTap Receipt - ${htmlEscape(receiptNo)}</title>
  <style>
    body { width: 320px; margin: 0 auto; padding: 18px; color: #201914; font-family: Arial, sans-serif; }
    h1 { margin: 0; font-size: 21px; text-align: center; }
    p { margin: 4px 0; color: #555; font-size: 11px; }
    .center { text-align: center; }
    .meta { margin: 14px 0; border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 10px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { padding: 6px 0; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
    th:nth-child(2), th:nth-child(3), td:nth-child(2), td:nth-child(3) { text-align: right; }
    .totals { margin-top: 12px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
    .totals strong { font-size: 15px; }
    @media print { body { width: auto; } }
  </style>
</head>
<body>
  <h1>TapTap Foodtrip</h1>
  <p class="center">Digital receipt</p>
  <div class="meta">
    <p>Receipt: ${htmlEscape(receiptNo)}</p>
    <p>Order: ${htmlEscape(order.id)}</p>
    <p>Date: ${htmlEscape(new Date(order.createdAt || Date.now()).toLocaleString("en-PH"))}</p>
    <p>Customer: ${htmlEscape(order.customerName || "Walk-in Customer")}</p>
    <p>Cashier: ${htmlEscape(order.cashierName || "-")}</p>
    <p>Type: ${htmlEscape(order.diningOption || order.deliveryType || "-")}</p>
  </div>
  <table>
    <thead><tr><th>Item</th><th>Each</th><th>Total</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="3">No items</td></tr>`}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${htmlEscape(reportMoney(order.subtotal ?? (Number(order.total || 0) + Number(order.discount || 0) - Number(order.deliveryFee || 0))))}</span></div>
    <div><span>Discount</span><span>${htmlEscape(reportMoney(order.discount || 0))}</span></div>
    <div><span>Delivery</span><span>${htmlEscape(reportMoney(order.deliveryFee || 0))}</span></div>
    <div><strong>Total</strong><strong>${htmlEscape(reportMoney(order.total))}</strong></div>
    ${order.cashReceived != null ? `<div><span>Cash</span><span>${htmlEscape(reportMoney(order.cashReceived))}</span></div>` : ""}
    ${order.cashReceived != null ? `<div><span>Change</span><span>${htmlEscape(reportMoney(order.changeDue || 0))}</span></div>` : ""}
  </div>
  <p class="center" style="margin-top:18px">Thank you for your order.</p>
</body>
</html>`;
};

const printReceipt = (order) => {
  const printWindow = window.open("", "_blank", "width=420,height=720");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(printableReceiptHtml(order));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
  return true;
};

function AppHeader({ user, activeView, unreadCount, onNavigate, onNotifications }) {
  const navigation = navigationForUser(user);
  const homeView = defaultViewForRole(user.role);
  const customerNavigation = user.role === "customer";
  const workspaceDrawerNavigation = user.role === "owner" || user.role === "staff";
  // erick: drawer state ito para hiwalay ang mobile menu sa masikip na header.
  const [drawerMenuOpen, setDrawerMenuOpen] = useState(false);
  useEffect(() => setDrawerMenuOpen(false), [activeView, user.role]);
  const navigateFromHeader = (nextView) => {
    onNavigate(nextView);
    setDrawerMenuOpen(false);
  };
  const drawerTitle = customerNavigation ? "Foodtrip pages" : `${user.role} pages`;
  const drawerEyebrow = customerNavigation ? "Customer menu" : "Workspace menu";

  return (
    <header className={`app-header ${customerNavigation ? "customer-header" : ""} ${workspaceDrawerNavigation ? "workspace-header" : ""}`}>
      {(customerNavigation || workspaceDrawerNavigation) && (
        /* erick: icon button ang menu para hindi na mag-overlap ang X at logo sa maliit na screen. */
        <button className={`customer-menu-toggle ${workspaceDrawerNavigation ? "workspace-menu-toggle" : ""} ${drawerMenuOpen ? "active" : ""}`} aria-expanded={drawerMenuOpen} aria-label={drawerMenuOpen ? "Close navigation menu" : "Open navigation menu"} onClick={() => setDrawerMenuOpen((current) => !current)}>
          {drawerMenuOpen ? <X size={24} strokeWidth={2.7} aria-hidden="true" /> : <Menu size={24} strokeWidth={2.7} aria-hidden="true" />}
        </button>
      )}
      <button className="brand-lockup border-0 bg-transparent" onClick={() => navigateFromHeader(homeView)}>
        <BrandMark /><div><strong>Taptap</strong><small>FOODTRIP</small></div>
      </button>
      {customerNavigation ? (
        <>
          {drawerMenuOpen && <button className="customer-menu-backdrop" aria-label="Close navigation menu" onClick={() => setDrawerMenuOpen(false)} />}
          <nav className={`customer-menu-drawer ${drawerMenuOpen ? "open" : ""}`} aria-label="Customer navigation">
            <div className="customer-menu-title"><p className="eyebrow text-danger">{drawerEyebrow}</p><strong>{drawerTitle}</strong></div>
            {navigation.map(([view, label]) => (
              <button className={activeView === view ? "active" : ""} aria-current={activeView === view ? "page" : undefined} key={view} onClick={() => navigateFromHeader(view)}>{label}</button>
            ))}
          </nav>
        </>
      ) : (
        <>
          <nav className="role-navigation" aria-label={`${user.role} navigation`}>
            {navigation.map(([view, label]) => (
              <button className={activeView === view ? "active" : ""} aria-current={activeView === view ? "page" : undefined} key={view} onClick={() => navigateFromHeader(view)}>{label}</button>
            ))}
          </nav>
          {workspaceDrawerNavigation && (
            <>
              {drawerMenuOpen && <button className="customer-menu-backdrop workspace-menu-backdrop" aria-label="Close navigation menu" onClick={() => setDrawerMenuOpen(false)} />}
              <nav className={`customer-menu-drawer workspace-menu-drawer ${drawerMenuOpen ? "open" : ""}`} aria-label={`${user.role} mobile navigation`}>
                <div className="customer-menu-title"><p className="eyebrow text-danger">{drawerEyebrow}</p><strong>{drawerTitle}</strong></div>
                {navigation.map(([view, label]) => (
                  <button className={activeView === view ? "active" : ""} aria-current={activeView === view ? "page" : undefined} key={view} onClick={() => navigateFromHeader(view)}>{label}</button>
                ))}
              </nav>
            </>
          )}
        </>
      )}
      <div className="header-actions">
        {/* erick: icon controls para compact pero malinaw pa rin ang notification at logout. */}
        <button className="notification-button" onClick={onNotifications} aria-label="Open notifications"><Bell size={17} strokeWidth={2.5} aria-hidden="true" />{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}</button>
        <div className="user-chip"><span>{user.name?.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{user.name}</strong><small>{user.role === "staff" ? staffRoleLabels[user.staffRole] || "Staff" : user.role}</small></div></div>
        {/* erick: ginawang solid red button (dati plain text link). */}
        <button className="btn btn-danger btn-sm logout-button" onClick={logout}><LogOut size={14} strokeWidth={2.5} aria-hidden="true" /><span>Log out</span></button>
      </div>
    </header>
  );
}

function NotificationCenter({ notifications, onClose }) {
  useEffect(() => {
    api.markAllNotificationsRead().catch(() => {});
  }, []);
  const clearAll = async () => {
    if (!window.confirm("Clear all notifications? This cannot be undone.")) return;
    await api.clearNotifications();
  };
  const dismiss = async (notificationId) => {
    await api.dismissNotification(notificationId);
  };
  return (
    <>
      <button className="notification-backdrop" aria-label="Close notifications" onClick={onClose} />
      <aside className="notification-center">
        <header><div><p className="eyebrow text-danger">Your updates</p><h3>Notifications</h3></div><div className="notification-tools"><button className="clear-notifications" disabled={!notifications.length} onClick={clearAll}>Clear all</button><button aria-label="Close notifications" onClick={onClose}><X size={18} strokeWidth={2.5} aria-hidden="true" /></button></div></header>
        <div className="notification-list">
          {notifications.length === 0 && <div className="empty-chat">No notifications yet.</div>}
          {notifications.map((notification) => {
            const unread = !notification.readAt;
            return <article className={unread ? "unread" : ""} key={notification.id}><span className={`notification-icon ${notification.type || "system"}`}>{notification.type?.slice(0, 1).toUpperCase() || "N"}</span><div><strong>{notification.title}</strong><p>{notification.message}</p><time title={new Date(notification.createdAt).toLocaleString("en-PH")}>{relativeTime(notification.createdAt)}</time></div>{unread && <i />}<button className="notification-dismiss" aria-label={`Dismiss ${notification.title}`} onClick={() => dismiss(notification.id)}>X</button></article>;
          })}
        </div>
      </aside>
    </>
  );
}

const Storefront = memo(function Storefront({ menu, cart, setCart, onCheckout, notify }) {
  const [category, setCategory] = useState("All");
  const customerMenu = useMemo(() => menu.filter((item) => !item.walkInOnly && menuAvailability(item).available), [menu]);
  const categories = useMemo(() => ["All", ...new Set(customerMenu.map((item) => item.category))], [customerMenu]);
  const visible = useMemo(() => (
    category === "All" ? customerMenu : customerMenu.filter((item) => item.category === category)
  ), [category, customerMenu]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.qty, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.qty, 0), [cart]);
  const deliveryFee = cart.length > 0 ? 49 : 0;
  // erick: i-cap ang add-to-cart sa available stock (gaya ng POS) para hindi lumampas.
  const add = useCallback((product) => setCart((current) => {
    const availableStock = Number(product.stock ?? 0);
    const existing = current.find((item) => item.id === product.id);
    if (existing) {
      if (existing.qty >= availableStock) {
        notify?.(`Only ${availableStock} ${product.name} left.`);
        return current;
      }
      return current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1, stock: availableStock } : item);
    }
    if (availableStock < 1) return current;
    return [...current, { ...product, stock: availableStock, qty: 1 }];
  }), [notify, setCart]);
  const decrease = useCallback((productId) => setCart((current) => current
    .map((item) => item.id === productId ? { ...item, qty: item.qty - 1 } : item)
    .filter((item) => item.qty > 0)), [setCart]);
  // erick: buong item ang tinatanggal kapag nagkamali ang customer sa cart.
  const remove = useCallback((productId) => setCart((current) => current.filter((item) => item.id !== productId)), [setCart]);

  return (
    <main className="storefront-page" id="live-menu">
      <section className="storefront-shell">
        <section className="storefront-menu-panel" aria-label="Live menu">
          <div className="storefront-toolbar">
            <div>
              <p className="eyebrow text-danger">Today's menu</p>
              <h1>Choose your foodtrip</h1>
              <p>Menu availability updates live while you build your order.</p>
            </div>
            <span>{visible.length} item{visible.length === 1 ? "" : "s"}</span>
          </div>

          <div className="category-rail category-topbar" aria-label="Food categories">
            {categories.map((item) => (
              <button key={item} className={category === item ? "active" : ""} aria-pressed={category === item} onClick={() => setCategory(item)}>
                {item}
              </button>
            ))}
          </div>

          <div className="menu-list">
            {visible.map((product, index) => {
              const stock = Number(product.stock ?? 0);
              return (
                <article className="menu-list-card" key={product.id}>
                  <MenuPhoto product={product} priority={index < 4} />
                  <div className="menu-item-copy">
                    <div>
                      <h3>{product.name}</h3>
                      <p>{product.description}</p>
                    </div>
                    <small>Allergens: {product.allergens?.join(", ") || "none listed"} - {menuAvailability(product).label}</small>
                  </div>
                  <div className="menu-item-action">
                    <strong>{currency(product.price)}</strong>
                    <span className={stock <= 7 ? "stock-note low" : "stock-note"}>{stock} available</span>
                    <button className="add-item-button" disabled={stock === 0} onClick={() => add(product)} aria-label={`Add ${product.name} to cart`}>+</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="store-cart-column">
          <div className="store-cart-panel" aria-label="Current order">
            <div className="cart-panel-heading">
              <div>
                <p className="eyebrow text-danger">Your order</p>
                <h2>{cartCount} item{cartCount === 1 ? "" : "s"}</h2>
              </div>
              <span>{cart.length ? "Ready" : "Empty"}</span>
            </div>
            <div className="cart-summary-list">
              {cart.length === 0 && <div className="empty-cart-note">Add menu items to start an order.</div>}
              {cart.map((item) => (
                <div className="cart-summary-item" key={item.id}>
                  <span>{item.qty}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{currency(item.price)} each</small>
                  </div>
                  <div className="pos-quantity cart-quantity">
                    <button type="button" onClick={() => decrease(item.id)} aria-label={`Decrease ${item.name}`}>-</button>
                    <span>{item.qty}</span>
                    <button type="button" disabled={item.qty >= Number(item.stock || 0)} onClick={() => add(item)} aria-label={`Increase ${item.name}`}>+</button>
                  </div>
                  <b>{currency(item.price * item.qty)}</b>
                  {/* erick: trash icon ang delete action para madaling makita sa cart row. */}
                  <button className="cart-remove-button" type="button" aria-label={`Remove ${item.name} from cart`} onClick={() => remove(item.id)}>
                    <Trash2 size={16} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <div className="store-cart-totals">
              <div><span>Subtotal</span><strong>{currency(cartSubtotal)}</strong></div>
              <div><span>Delivery</span><strong>{cart.length ? currency(deliveryFee) : "-"}</strong></div>
              <div><span>Total</span><strong>{currency(cartSubtotal + deliveryFee)}</strong></div>
            </div>
            <button className="btn btn-danger w-100" disabled={!cart.length} onClick={onCheckout}>Checkout</button>
          </div>

          <div className="storefront-brand-card checkout-brand-card">
            <BrandMark />
            <div>
              <p className="eyebrow text-danger">TapTap FoodTrip</p>
              <strong>Fresh orders, fast checkout</strong>
            </div>
          </div>
        </aside>
      </section>
      {cart.length > 0 && <button className="floating-checkout btn btn-danger" onClick={onCheckout}>Checkout {cartCount} item{cartCount === 1 ? "" : "s"}</button>}
    </main>
  );
});

function TrackingView({ order, onClose }) {
  const [rider, setRider] = useState(null);
  const customerPin = locationToPoint(order?.deliveryLocation);
  const riderPin = locationToPoint(rider);
  const trackingOrderId = order?.id;
  const orderRiderLocation = order?.riderLocation || null;
  const trackingStatus = riderPin
    ? "Rider location is live"
    : order?.riderId
      ? "Waiting for rider GPS"
      : order?.deliveryType === "delivery"
        ? "Waiting for rider assignment"
        : "Store pickup order";
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    setRider(orderRiderLocation);
  }, [trackingOrderId, orderRiderLocation]);
  useEffect(() => {
    if (!trackingOrderId || order?.deliveryType !== "delivery") {
      setRider(null);
      return undefined;
    }
    let stopped = false;
    let stopSocket = () => {};
    const stopDatabase = subscribeRiderLocation(trackingOrderId, (location) => {
      if (!stopped) setRider(location || null);
    });
    subscribeSocketRiderLocation(trackingOrderId, (location) => {
      if (!stopped) setRider(location || null);
    }).then((cleanup) => {
      if (stopped) cleanup();
      else stopSocket = cleanup;
    }).catch(() => {});
    return () => {
      stopped = true;
      stopDatabase?.();
      stopSocket();
    };
  }, [trackingOrderId, order?.deliveryType]);
  if (!order) return null;
  return (
    <div className="modal d-block" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-xl modal-dialog-centered">
        <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="tracking-title">
          <div className="modal-header"><div><small>{order.id}</small><h5 className="modal-title" id="tracking-title">{statusLabel(order.status)}</h5><span className="tracking-status-text">{trackingStatus}{order.handoffOtp && ["out-for-delivery", "arrived"].includes(order.status) ? ` - Delivery OTP ${order.handoffOtp}` : ""}</span></div><button className="btn-close" aria-label="Close tracking" onClick={onClose} /></div>
          <div className="modal-body p-0"><Suspense fallback={<SectionLoader label="Loading delivery map..." />}><DeliveryMap rider={riderPin} customer={customerPin} /></Suspense></div>
        </div>
      </div>
    </div>
  );
}

function Assistant({ user, menu }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([{ from: "bot", text: "Hi! Ask about menu items, allergens, store details or your order." }]);
  const receivedSupportReplies = useRef(new Set());

  useEffect(() => {
    if (!open) return undefined;
    return subscribeSupportMessages((supportMessages) => {
      const newReplies = supportMessages.filter((message) =>
        message.senderRole === "staff" && !receivedSupportReplies.current.has(message.id)
      );
      if (newReplies.length === 0) return;
      newReplies.forEach((message) => receivedSupportReplies.current.add(message.id));
      setMessages((current) => [
        ...current,
        ...newReplies.map((message) => ({
          from: "bot",
          text: message.text,
          source: `Staff support - ${message.senderName}`
        }))
      ]);
    }, user.uid);
  }, [open, user.uid]);

  const send = async (event) => {
    event.preventDefault();
    if (!input.trim()) return;
    const message = input.trim();
    setInput("");
    setMessages((current) => [...current, { from: "user", text: message }]);
    await sendSupportMessage(message, user, {
      customerId: user.uid,
      customerName: user.name,
      conversationId: user.uid
    });
    try {
      const response = await api.assistant(message, user.uid, { menu: menu.map(({ name, description, allergens, stock }) => ({ name, description, allergens, stock })) });
      setMessages((current) => [...current, { from: "bot", text: response.text, source: response.source }]);
    } catch {
      const popular = menu.filter((item) => item.featured).map((item) => item.name).join(", ");
      setMessages((current) => [...current, { from: "bot", text: `Popular choices are ${popular}. Live assistant answers are not ready yet.`, source: "" }]);
    }
  };
  return (
    <>
      <button className="assistant-launcher" aria-label={open ? "Close assistant" : "Open assistant"} aria-expanded={open} aria-controls="assistant-panel" onClick={() => setOpen(!open)}>AI</button>
      {open && <aside className="assistant-panel" id="assistant-panel"><header><div><strong>TapTap Assistant</strong><small>Live answers + staff support</small></div><button aria-label="Close assistant" onClick={() => setOpen(false)}><X size={18} strokeWidth={2.5} aria-hidden="true" /></button></header><div className="assistant-messages">{messages.map((message, index) => { const sourceLabel = assistantSourceLabel(message.source); return <div key={index} className={message.from}><span>{message.text}</span>{sourceLabel && <small>{sourceLabel}</small>}</div>; })}</div><form onSubmit={send}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask or contact staff..." /><button>Send</button></form></aside>}
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [menu, setMenu] = useState(fallbackMenu);
  const [inventory, setInventory] = useState(fallbackMenu.map((item) => ({ ...item, reorderPoint: 10 })));
  const [orders, setOrders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [shiftLogs, setShiftLogs] = useState([]);
  const [supportMessages, setSupportMessages] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [cart, setCart] = useState([]);
  const [view, setView] = useState("store");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [trackingOrder, setTrackingOrder] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [serviceStatus, setServiceStatus] = useState({ api: true, firebase: firebaseEnabled, socket: false, openai: false, dialogflow: false, paymongo: false, twilio: false });
  const previousOrderCount = useRef(0);
  const activeUser = user?.mfaVerified ? user : null;

  useEffect(() => observeAuth(setUser), []);
  useEffect(() => {
    const updateOnlineState = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);
  useEffect(() => {
    if (!activeUser) {
      setProfile(null);
      return undefined;
    }
    return subscribeUserProfile(activeUser, setProfile);
  }, [activeUser]);
  useEffect(() => {
    if (!activeUser || activeUser.role === "rider") {
      setMenu(fallbackMenu);
      return undefined;
    }
    return subscribeMenu(fallbackMenu, setMenu);
  }, [activeUser]);
  useEffect(() => {
    const staffInventoryView = activeUser?.role === "staff" && ["staff-overview", "staff-pos", "staff-inventory"].includes(view);
    const shouldLoadInventory = activeUser?.role === "owner" || staffInventoryView;
    if (!shouldLoadInventory) {
      setInventory(menu.map((item) => ({ ...item, reorderPoint: item.reorderPoint ?? 10 })));
      return undefined;
    }
    return subscribeInventory(menu, setInventory);
  }, [menu, activeUser, view]);
  useEffect(() => {
    const shouldLoadOrders = Boolean(activeUser) && (
      activeUser.role === "rider" ||
      (activeUser.role === "customer" && (["orders", "receipts", "feedback"].includes(view) || checkoutOpen || trackingOrder)) ||
      (activeUser.role === "owner" && ["owner-overview", "owner-sales", "owner-reports", "owner-settings"].includes(view)) ||
      (activeUser.role === "staff" && ["staff-overview", "staff-pos", "staff-orders", "staff-kitchen", "staff-shifts"].includes(view))
    );
    if (!shouldLoadOrders) {
      previousOrderCount.current = 0;
      setOrders([]);
      return undefined;
    }
    return subscribeOrders(activeUser, (nextOrders) => {
    if (activeUser?.role === "rider" && nextOrders.length > previousOrderCount.current) navigator.vibrate?.([150, 80, 150]);
    previousOrderCount.current = nextOrders.length;
    setOrders(nextOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    });
  }, [activeUser, checkoutOpen, trackingOrder, view]);
  useEffect(() => {
    const shouldLoadComplaints = Boolean(activeUser) && (
      activeUser.role === "owner" ||
      activeUser.role === "staff" ||
      (activeUser.role === "customer" && view === "orders")
    );
    if (!shouldLoadComplaints) {
      setComplaints([]);
      return undefined;
    }
    return subscribeComplaints(activeUser, setComplaints);
  }, [activeUser, view]);
  useEffect(() => {
    if (activeUser?.role !== "owner" || view !== "owner-audit") {
      setAuditLogs([]);
      return undefined;
    }
    return subscribeAuditLogs(setAuditLogs);
  }, [activeUser, view]);
  useEffect(() => {
    const shouldLoadShiftLogs = (
      (activeUser?.role === "owner" && view === "owner-reports") ||
      (activeUser?.role === "staff" && view === "staff-shifts")
    );
    if (!shouldLoadShiftLogs) {
      setShiftLogs([]);
      return undefined;
    }
    return subscribeShiftLogs(setShiftLogs);
  }, [activeUser, view]);
  useEffect(() => {
    if (activeUser?.role !== "staff" || view !== "staff-chat") {
      setSupportMessages([]);
      return undefined;
    }
    return subscribeSupportMessages(setSupportMessages);
  }, [activeUser, view]);
  useEffect(() => {
    if (!activeUser) {
      setNotifications([]);
      return undefined;
    }
    return subscribeNotifications(activeUser, setNotifications);
  }, [activeUser]);
  useEffect(() => {
    const shouldLoadReviews = (
      (activeUser?.role === "customer" && view === "feedback") ||
      (activeUser?.role === "owner" && view === "owner-reviews") ||
      (activeUser?.role === "staff" && view === "staff-reviews")
    );
    if (!shouldLoadReviews) {
      setReviews([]);
      return undefined;
    }
    return subscribeReviews(activeUser, setReviews);
  }, [activeUser, view]);
  useEffect(() => {
    if (activeUser) setView(defaultViewForRole(activeUser.role));
  }, [activeUser]);
  useEffect(() => {
    if (!activeUser) return undefined;
    api.status()
      .then((result) => setServiceStatus((current) => ({ ...current, api: true, ...result.services })))
      .catch(() => setServiceStatus((current) => ({ ...current, api: false })));
    return undefined;
  }, [activeUser]);
  useEffect(() => {
    if (!trackingOrder) {
      disconnectSocket();
      setServiceStatus((current) => ({ ...current, socket: false }));
      return undefined;
    }
    let activeSocket;
    getSocket().then((socket) => {
      activeSocket = socket;
      setServiceStatus((current) => ({ ...current, socket: socket.connected }));
      socket.on("connect", () => setServiceStatus((current) => ({ ...current, socket: true })));
      socket.on("disconnect", () => setServiceStatus((current) => ({ ...current, socket: false })));
    }).catch(() => {});
    return () => {
      activeSocket?.off("connect");
      activeSocket?.off("disconnect");
      disconnectSocket();
    };
  }, [activeUser?.uid, trackingOrder]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  if (user === undefined) return <PageLoader />;
  if (!user) return <LoginPanel />;
  if (user.emailVerified !== true) {
    return <EmailVerificationPanel user={user} onVerified={(status) => setUser((current) => ({
      ...current,
      emailVerified: true,
      twoFactor: status
    }))} />;
  }
  if (!user.mfaVerified) return <TwoFactorPanel user={user} onComplete={setUser} />;

  const currentUser = { ...user, name: profile?.name || user.name, staffRole: profile?.staffRole || user.staffRole || (user.role === "staff" ? "manager" : undefined) };
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const allowedViews = navigationForUser(currentUser).map(([roleView]) => roleView);
  const navigate = (nextView) => {
    if (allowedViews.includes(nextView)) setView(nextView);
  };
  const reorder = (order) => {
    const nextCart = (order.items || []).map((item) => {
      const product = menu.find((candidate) => candidate.id === item.id);
      if (!product || product.walkInOnly || !menuAvailability(product).available) return null;
      const stock = Number(product.stock ?? item.stock ?? 0);
      const qty = Math.min(Number(item.qty || 1), stock);
      return qty > 0 ? { ...product, stock, qty } : null;
    }).filter(Boolean);
    if (nextCart.length === 0) {
      setNotice("Those items are not available right now.");
      return;
    }
    setCart(nextCart);
    setView("store");
    setNotice(`${order.id} added back to your cart.`);
  };
  const workspaceHelpers = {
    buildDailyReport,
    buildLocalDecisionSupport,
    currency,
    inRange,
    isRevenueOrder,
    isUnremittedCod,
    localDateInputValue,
    orderItemText,
    orderPaymentLabel,
    printOwnerDailyReport,
    printReceipt,
    reportDateRange,
    statusLabel,
    sumByTotal
  };
  const workspace = user.role === "owner"
    ? <OwnerWorkspace helpers={workspaceHelpers} section={view} user={currentUser} orders={orders} inventory={inventory} reviews={reviews} complaints={complaints} serviceStatus={serviceStatus} auditLogs={auditLogs} shiftLogs={shiftLogs} notify={setNotice} />
    : user.role === "staff"
      ? <StaffWorkspace helpers={workspaceHelpers} section={staffCanAccess(currentUser, view) ? view : defaultViewForRole("staff")} user={currentUser} orders={orders} inventory={inventory} reviews={reviews} complaints={complaints} shiftLogs={shiftLogs} messages={supportMessages} serviceStatus={serviceStatus} notify={setNotice} />
      : user.role === "rider"
        ? <RiderWorkspace helpers={workspaceHelpers} section={view} user={currentUser} orders={orders} notify={setNotice} />
        : null;
  const activeTrackingOrder = trackingOrder
    ? orders.find((order) => order.id === trackingOrder.id) || trackingOrder
    : null;

  return (
    <div className="app-shell">
      <AppHeader user={currentUser} activeView={view} unreadCount={unreadCount} onNavigate={navigate} onNotifications={() => setNotificationsOpen(true)} />
      {!online && <div className="offline-banner" role="status">Connection lost. Ordering, POS, and live tracking will resume after reconnecting.</div>}
      {serviceStatus.api === false && <div className="offline-banner" role="status">App server is unreachable. Restart the backend server, then refresh this page.</div>}
      {user.role === "customer" && view === "store" && <Storefront menu={menu} cart={cart} setCart={setCart} onCheckout={() => setCheckoutOpen(true)} notify={setNotice} />}
      {user.role === "customer" && view === "orders" && (
        <Suspense fallback={<SectionLoader label="Loading customer section..." />}>
          <OrdersView orders={orders} onTrack={setTrackingOrder} isRevenueOrder={isRevenueOrder} notify={setNotice} user={currentUser} complaints={complaints} onReorder={reorder} />
        </Suspense>
      )}
      {user.role === "customer" && view === "receipts" && (
        <Suspense fallback={<SectionLoader label="Loading receipts..." />}>
          <ReceiptsView orders={orders} printReceipt={printReceipt} notify={setNotice} />
        </Suspense>
      )}
      {user.role === "customer" && view === "feedback" && (
        <Suspense fallback={<SectionLoader label="Loading feedback..." />}>
          <ReviewsView user={currentUser} orders={orders} reviews={reviews} notify={setNotice} />
        </Suspense>
      )}
      {user.role === "customer" && view === "profile" && (
        <Suspense fallback={<SectionLoader label="Loading profile..." />}>
          <CustomerProfile user={currentUser} profile={profile} notify={setNotice} smsProviderEnabled={serviceStatus.twilio} />
        </Suspense>
      )}
      {user.role !== "customer" && (
        <Suspense fallback={<SectionLoader label="Loading workspace..." />}>
          {workspace}
        </Suspense>
      )}
      {user.role === "customer" && checkoutOpen && (
        <Suspense fallback={<SectionLoader label="Opening checkout..." />}>
          <Checkout cart={cart} user={currentUser} profile={profile} paymongoEnabled={serviceStatus.paymongo} smsProviderEnabled={serviceStatus.twilio} onClose={() => setCheckoutOpen(false)} notify={setNotice} onComplete={() => { setCart([]); setCheckoutOpen(false); setView("orders"); }} />
        </Suspense>
      )}
      {activeTrackingOrder && <TrackingView order={activeTrackingOrder} onClose={() => setTrackingOrder(null)} />}
      {user.role === "customer" && <Assistant user={currentUser} menu={menu.filter((item) => !item.walkInOnly)} />}
      {notificationsOpen && <NotificationCenter notifications={notifications} onClose={() => setNotificationsOpen(false)} />}
      {notice && <div className="app-toast" role="status" aria-live="polite" aria-atomic="true">{notice}</div>}
    </div>
  );
}
