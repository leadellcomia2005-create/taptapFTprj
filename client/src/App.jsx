import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
// erick: lucide icons para mas malinaw ang menu, close, bell, logout, at trash actions.
import { Bell, Bike, Camera, CheckCircle2, Clock, LogOut, MapPin, Menu, Navigation, Package as PackageIcon, Phone, Route, Trash2, Wallet, X } from "lucide-react";
import { BrandMark, ServiceBadge } from "./components/Branding";
import { PageLoader, SectionLoader } from "./components/Loaders";
import MenuPhoto from "./components/MenuPhoto";
import { defaultViewForRole, menuCategoryOptions, roleNavigation, securityMethodLabels, staffPosCategories } from "./config/appConfig";
import { fallbackMenu } from "./data/menu";
import { api } from "./services/api";
import {
  adjustInventory,
  createMenuItem,
  createOrder,
  firebaseEnabled,
  logout,
  moderateReview,
  observeAuth,
  saveShiftLog,
  saveRiderLocation,
  sendSupportMessage,
  subscribeAuditLogs,
  subscribeInventory,
  subscribeMenu,
  subscribeNotifications,
  subscribeOrders,
  subscribeRiderLocation,
  subscribeReviews,
  subscribeShiftLogs,
  subscribeSupportMessages,
  subscribeUserProfile,
  updateOrder,
  updateMenuItem,
  uploadProof
} from "./services/firebase";
import { disconnectSocket, getSocket, joinOrderRoom, sendRiderLocation } from "./services/socket";
import { EmailVerificationPanel, LoginPanel, TwoFactorPanel } from "./features/auth/AuthPanels";
import { assistantSourceLabel, currency, relativeTime, statusLabel } from "./utils/display";

const CameraProof = lazy(() => import("./components/CameraProof"));
const DeliveryMap = lazy(() => import("./components/DeliveryMap"));
const SalesChart = lazy(() => import("./components/SalesChart"));
const Checkout = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.Checkout })));
const OrdersView = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.OrdersView })));
const CustomerProfile = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.CustomerProfile })));
const ReceiptsView = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.ReceiptsView })));
const ReviewsView = lazy(() => import("./features/customer/CustomerScreens").then((module) => ({ default: module.ReviewsView })));

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
  if (order.paymentMethod === "cod") return order.status === "delivered" || Boolean(order.deliveredAt);
  return false;
};
const isOutstandingCod = (order) => order?.paymentMethod === "cod" && order.status !== "cancelled" && !isRevenueOrder(order);
const isUnremittedCod = (order) => order?.paymentMethod === "cod" && order.status === "delivered" && !order.codRemittedAt;
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
const buildDailyReport = (orders, inventory, shiftLogs, reportDate) => {
  const range = reportDateRange(reportDate);
  const dailyOrders = orders.filter((order) => inRange(order.createdAt, range));
  const revenueOrders = dailyOrders.filter(isRevenueOrder);
  const cancelledOrders = dailyOrders.filter((order) => order.status === "cancelled");
  const pendingOrders = dailyOrders.filter((order) => !isRevenueOrder(order) && order.status !== "cancelled");
  const codExposureOrders = dailyOrders.filter(isOutstandingCod);
  const unremittedCodOrders = dailyOrders.filter(isUnremittedCod);
  const deliveredOrders = dailyOrders.filter((order) => order.status === "delivered");
  const closedShifts = shiftLogs.filter((log) => inRange(log.endedAt || log.createdAt, range));
  const lowStockItems = inventory.filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0));
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
    codExposureOrders,
    unremittedCodOrders,
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
    <div class="box"><span>Completed orders</span><strong>${report.deliveredOrders.length}</strong></div>
    <div class="box"><span>Pending or unpaid</span><strong>${report.pendingOrders.length}</strong></div>
    <div class="box"><span>Cancelled</span><strong>${report.cancelledOrders.length}</strong></div>
    <div class="box"><span>Cash</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.cash))}</strong></div>
    <div class="box"><span>Delivered COD</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.cod))}</strong></div>
    <div class="box"><span>Online/GCash</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.online))}</strong></div>
    <div class="box"><span>Open COD exposure</span><strong>${htmlEscape(reportMoney(report.paymentBreakdown.codExposure))}</strong></div>
    <div class="box"><span>COD to remit</span><strong>${htmlEscape(reportMoney(sumByTotal(report.unremittedCodOrders)))}</strong></div>
  </div>
  ${table("Top selling items", itemColumns, report.topItems, "No paid sales for this day.")}
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
  const navigation = roleNavigation[user.role] || [];
  const homeView = defaultViewForRole(user.role);
  const customerNavigation = user.role === "customer";
  // erick: drawer state ito para hiwalay ang customer menu sa masikip na mobile header.
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);
  useEffect(() => setCustomerMenuOpen(false), [activeView, user.role]);
  const navigateFromHeader = (nextView) => {
    onNavigate(nextView);
    setCustomerMenuOpen(false);
  };

  return (
    <header className={`app-header ${customerNavigation ? "customer-header" : ""}`}>
      {customerNavigation && (
        /* erick: icon button ang menu para hindi na mag-overlap ang X at logo sa maliit na screen. */
        <button className={`customer-menu-toggle ${customerMenuOpen ? "active" : ""}`} aria-expanded={customerMenuOpen} aria-label={customerMenuOpen ? "Close customer menu" : "Open customer menu"} onClick={() => setCustomerMenuOpen((current) => !current)}>
          {customerMenuOpen ? <X size={24} strokeWidth={2.7} aria-hidden="true" /> : <Menu size={24} strokeWidth={2.7} aria-hidden="true" />}
        </button>
      )}
      <button className="brand-lockup border-0 bg-transparent" onClick={() => navigateFromHeader(homeView)}>
        <BrandMark /><div><strong>Taptap</strong><small>FOODTRIP</small></div>
      </button>
      {customerNavigation ? (
        <>
          {customerMenuOpen && <button className="customer-menu-backdrop" aria-label="Close customer menu" onClick={() => setCustomerMenuOpen(false)} />}
          <nav className={`customer-menu-drawer ${customerMenuOpen ? "open" : ""}`} aria-label="Customer navigation">
            <div className="customer-menu-title"><p className="eyebrow text-danger">Customer menu</p><strong>Foodtrip pages</strong></div>
            {navigation.map(([view, label]) => (
              <button className={activeView === view ? "active" : ""} aria-current={activeView === view ? "page" : undefined} key={view} onClick={() => navigateFromHeader(view)}>{label}</button>
            ))}
          </nav>
        </>
      ) : (
        <nav className="role-navigation" aria-label={`${user.role} navigation`}>
          {navigation.map(([view, label]) => (
            <button className={activeView === view ? "active" : ""} aria-current={activeView === view ? "page" : undefined} key={view} onClick={() => navigateFromHeader(view)}>{label}</button>
          ))}
        </nav>
      )}
      <div className="header-actions">
        {/* erick: icon controls para compact pero malinaw pa rin ang notification at logout. */}
        <button className="notification-button" onClick={onNotifications} aria-label="Open notifications"><Bell size={17} strokeWidth={2.5} aria-hidden="true" />{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}</button>
        <div className="user-chip"><span>{user.name?.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div>
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
  const customerMenu = useMemo(() => menu.filter((item) => !item.walkInOnly && !item.unavailable), [menu]);
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
                    <small>Allergens: {product.allergens?.join(", ") || "none listed"}</small>
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

function ReviewModerationModule({ reviews, user, notify }) {
  const [drafts, setDrafts] = useState({});
  const updateDraft = (review, field, value) => setDrafts((current) => ({
    ...current,
    [review.id]: { reply: review.reply || "", moderationStatus: review.moderationStatus || "pending", ...(current[review.id] || {}), [field]: value }
  }));
  const save = async (review, status = null) => {
    const draft = { reply: review.reply || "", moderationStatus: review.moderationStatus || "pending", ...(drafts[review.id] || {}) };
    const nextStatus = status || draft.moderationStatus;
    await moderateReview(review, { moderationStatus: nextStatus, reply: draft.reply }, user);
    notify(`Review for ${review.orderId || review.id} marked ${nextStatus}.`);
  };
  const groups = {
    pending: reviews.filter((review) => (review.moderationStatus || "pending") === "pending"),
    approved: reviews.filter((review) => review.moderationStatus === "approved"),
    hidden: reviews.filter((review) => review.moderationStatus === "hidden")
  };
  return (
    <div className="row g-3">
      <div className="col-md-4"><div className="metric-card"><small>Pending reviews</small><strong>{groups.pending.length}</strong><span>Needs decision</span></div></div>
      <div className="col-md-4"><div className="metric-card"><small>Approved</small><strong>{groups.approved.length}</strong><span>Visible feedback</span></div></div>
      <div className="col-md-4"><div className="metric-card"><small>Hidden</small><strong>{groups.hidden.length}</strong><span>Kept internal</span></div></div>
      <div className="col-12"><div className="dashboard-card"><h3>Customer review moderation</h3>
        <div className="review-moderation-list">
          {reviews.length === 0 && <div className="empty-chat">No customer reviews yet.</div>}
          {reviews.map((review) => {
            const draft = { reply: review.reply || "", moderationStatus: review.moderationStatus || "pending", ...(drafts[review.id] || {}) };
            return (
              <article className="review-moderation-card" key={review.id}>
                <div>
                  <strong>{review.customerName || "Customer"} <span>{"★".repeat(Number(review.rating || 0))}{"☆".repeat(5 - Number(review.rating || 0))}</span></strong>
                  <small>{review.orderId} · {(review.items || []).join(", ")}</small>
                  <p>{review.comment || "No written feedback."}</p>
                </div>
                <label className="form-label">Staff reply<textarea className="form-control" rows="2" value={draft.reply} onChange={(event) => updateDraft(review, "reply", event.target.value)} /></label>
                <div className="review-actions">
                  <select className="form-select form-select-sm" value={draft.moderationStatus} onChange={(event) => updateDraft(review, "moderationStatus", event.target.value)}>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="hidden">Hidden</option>
                  </select>
                  <button className="btn btn-sm btn-success" onClick={() => save(review, "approved")}>Approve</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => save(review, "hidden")}>Hide</button>
                  <button className="btn btn-sm btn-dark" onClick={() => save(review)}>Save reply</button>
                </div>
              </article>
            );
          })}
        </div>
      </div></div>
    </div>
  );
}

function InventoryModule({ inventory, user, notify }) {
  const [drafts, setDrafts] = useState({});
  const updateDraft = (id, field, value) => setDrafts((current) => ({
    ...current,
    [id]: { quantity: 1, reason: "New delivery", ...(current[id] || {}), [field]: value }
  }));
  const applyAdjustment = async (item, direction) => {
    const draft = { quantity: 1, reason: direction > 0 ? "New delivery" : "Wastage", ...(drafts[item.id] || {}) };
    const quantity = Math.max(1, Number(draft.quantity || 1)) * direction;
    await adjustInventory(item, quantity, draft.reason, user);
    notify(`${item.name} stock ${direction > 0 ? "received" : "adjusted"} by ${Math.abs(quantity)}.`);
  };
  return (
    <div className="dashboard-card">
      <div className="module-heading">
        <div><p className="eyebrow text-danger">Menu item stock control</p><h3>Inventory levels and adjustments</h3></div>
        <span className="module-note">Every adjustment is written to the audit trail.</span>
      </div>
      <div className="table-responsive">
        <table className="table align-middle inventory-table">
          <thead><tr><th>Product</th><th>Current stock</th><th>Reorder point</th><th>Status</th><th>Quantity</th><th>Reason</th><th>Action</th></tr></thead>
          <tbody>{inventory.map((item) => {
            const lowStock = item.stock <= item.reorderPoint;
            const draft = drafts[item.id] || { quantity: 1, reason: "New delivery" };
            return (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><small>{item.category}</small></td>
                <td>{item.stock}</td>
                <td>{item.reorderPoint}</td>
                <td><span className={`stock-badge ${lowStock ? "low" : "healthy"}`}>{lowStock ? "Low stock" : "Healthy"}</span></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" min="1" value={draft.quantity} onChange={(event) => updateDraft(item.id, "quantity", event.target.value)} /></td>
                <td><select className="form-select form-select-sm" value={draft.reason} onChange={(event) => updateDraft(item.id, "reason", event.target.value)}><option>New delivery</option><option>Physical count correction</option><option>Wastage</option><option>Spoilage</option><option>Staff meal</option></select></td>
                <td><div className="d-flex gap-1"><button className="btn btn-sm btn-success" onClick={() => applyAdjustment(item, 1)}>Receive</button><button className="btn btn-sm btn-outline-danger" onClick={() => applyAdjustment(item, -1)}>Deduct</button></div></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function MenuManagementModule({ inventory, user, notify }) {
  const blankItem = {
    name: "",
    category: "Favorite Meal",
    description: "Menu item.",
    price: 0,
    stock: 0,
    reorderPoint: 10,
    unavailable: false,
    walkInOnly: false,
    featured: false
  };
  const draftFor = useCallback((item) => ({
    name: item.name || "",
    category: item.category || "Favorite Meal",
    description: item.description || "",
    price: Number(item.price || 0),
    stock: Number(item.stock || 0),
    reorderPoint: Number(item.reorderPoint ?? 10),
    unavailable: Boolean(item.unavailable),
    walkInOnly: Boolean(item.walkInOnly)
  }), []);
  const [drafts, setDrafts] = useState({});
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState(blankItem);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const item of inventory) {
        if (!next[item.id]) next[item.id] = draftFor(item);
      }
      return next;
    });
  }, [inventory, draftFor]);

  const updateDraft = (item, field, value) => setDrafts((current) => ({
    ...current,
    [item.id]: { ...draftFor(item), ...(current[item.id] || {}), [field]: value }
  }));

  const save = async (item) => {
    const draft = { ...draftFor(item), ...(drafts[item.id] || {}) };
    await updateMenuItem(item, {
      name: draft.name.trim(),
      category: draft.category,
      description: draft.description,
      price: Number(draft.price || 0),
      stock: Number(draft.stock || 0),
      reorderPoint: Number(draft.reorderPoint || 0),
      unavailable: Boolean(draft.unavailable),
      walkInOnly: Boolean(draft.walkInOnly)
    }, user);
    notify(`${draft.name || item.name} menu settings saved.`);
  };
  const addItem = async (event) => {
    event.preventDefault();
    const result = await createMenuItem({
      ...newItem,
      name: newItem.name.trim(),
      price: Number(newItem.price || 0),
      stock: Number(newItem.stock || 0),
      reorderPoint: Number(newItem.reorderPoint || 0)
    }, user);
    notify(`${result.item.name} added to the menu inventory.`);
    setNewItem(blankItem);
    setAdding(false);
  };

  return (
    <div className="dashboard-card">
      <div className="module-heading">
        <div><p className="eyebrow text-danger">Owner menu control</p><h3>Menu prices, categories and visibility</h3></div>
        <div className="module-actions"><span className="module-note">Changes update the customer menu and staff POS menu.</span><button className="btn btn-sm btn-danger" type="button" onClick={() => setAdding((value) => !value)}>{adding ? "Close" : "Add menu item"}</button></div>
      </div>
      {adding && (
        <form className="menu-add-panel" onSubmit={addItem}>
          <div className="row g-2">
            <label className="form-label col-md-3">Name<input className="form-control" required value={newItem.name} onChange={(event) => setNewItem((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="form-label col-md-2">Category<select className="form-select" value={newItem.category} onChange={(event) => setNewItem((current) => ({ ...current, category: event.target.value }))}>{menuCategoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label className="form-label col-md-2">Price<input className="form-control" type="number" min="0" required value={newItem.price} onChange={(event) => setNewItem((current) => ({ ...current, price: event.target.value }))} /></label>
            <label className="form-label col-md-2">Stock<input className="form-control" type="number" min="0" required value={newItem.stock} onChange={(event) => setNewItem((current) => ({ ...current, stock: event.target.value }))} /></label>
            <label className="form-label col-md-2">Reorder<input className="form-control" type="number" min="0" required value={newItem.reorderPoint} onChange={(event) => setNewItem((current) => ({ ...current, reorderPoint: event.target.value }))} /></label>
            <div className="col-md-1 d-grid align-items-end"><button className="btn btn-dark" type="submit">Add</button></div>
            <label className="form-label col-12">Description<textarea className="form-control" rows="2" value={newItem.description} onChange={(event) => setNewItem((current) => ({ ...current, description: event.target.value }))} /></label>
            <div className="col-12 d-flex flex-wrap gap-3">
              <label className="menu-admin-check"><input type="checkbox" checked={!newItem.unavailable} onChange={(event) => setNewItem((current) => ({ ...current, unavailable: !event.target.checked }))} /><span>Show on menu</span></label>
              <label className="menu-admin-check"><input type="checkbox" checked={newItem.walkInOnly} onChange={(event) => setNewItem((current) => ({ ...current, walkInOnly: event.target.checked }))} /><span>Walk-in only</span></label>
              <label className="menu-admin-check"><input type="checkbox" checked={newItem.featured} onChange={(event) => setNewItem((current) => ({ ...current, featured: event.target.checked }))} /><span>Featured</span></label>
            </div>
          </div>
        </form>
      )}
      <div className="table-responsive">
        <table className="table align-middle menu-admin-table">
          <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Reorder</th><th>Visible</th><th>Walk-in only</th><th /></tr></thead>
          <tbody>{inventory.map((item) => {
            const draft = drafts[item.id] || draftFor(item);
            const categories = menuCategoryOptions.includes(draft.category) ? menuCategoryOptions : [draft.category, ...menuCategoryOptions];
            return (
              <tr key={item.id}>
                <td><input className="form-control form-control-sm" value={draft.name} onChange={(event) => updateDraft(item, "name", event.target.value)} /><small className="d-block text-secondary mt-1">{item.id}</small></td>
                <td><select className="form-select form-select-sm" value={draft.category} onChange={(event) => updateDraft(item, "category", event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" min="0" value={draft.price} onChange={(event) => updateDraft(item, "price", event.target.value)} /></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" min="0" value={draft.stock} onChange={(event) => updateDraft(item, "stock", event.target.value)} /></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" min="0" value={draft.reorderPoint} onChange={(event) => updateDraft(item, "reorderPoint", event.target.value)} /></td>
                <td><label className="menu-admin-check"><input type="checkbox" checked={!draft.unavailable} onChange={(event) => updateDraft(item, "unavailable", !event.target.checked)} /><span>Show</span></label></td>
                <td><label className="menu-admin-check"><input type="checkbox" checked={draft.walkInOnly} onChange={(event) => updateDraft(item, "walkInOnly", event.target.checked)} /><span>POS</span></label></td>
                <td><button className="btn btn-sm btn-danger" onClick={() => save(item)}>Save</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftLogsModule({ orders, logs, user, notify, readOnly = false }) {
  const [openingCash, setOpeningCash] = useState(2000);
  const [cashIn, setCashIn] = useState(0);
  const [cashOut, setCashOut] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [shiftNotes, setShiftNotes] = useState("");
  const [shiftStartedAt] = useState(() => Date.now() - 8 * 60 * 60 * 1000);
  const shiftOrders = orders.filter((order) => Number(order.createdAt || 0) >= shiftStartedAt && Number(order.createdAt || 0) <= Date.now());
  const cashSales = shiftOrders
    .filter((order) => order.paymentMethod === "cash" || (order.paymentMethod === "cod" && isRevenueOrder(order)))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const expectedCash = Number(openingCash || 0) + cashSales + Number(cashIn || 0) - Number(cashOut || 0) - Number(expenses || 0);
  const variance = Number(actualCash || 0) - expectedCash;
  const closeShift = async () => {
    const id = await saveShiftLog({
      startedAt: shiftStartedAt,
      endedAt: Date.now(),
      openingCash: Number(openingCash),
      cashIn: Number(cashIn),
      cashOut: Number(cashOut),
      expenses: Number(expenses),
      cashSales,
      expectedCash,
      actualCash: Number(actualCash),
      variance,
      orderCount: shiftOrders.length,
      notes: shiftNotes
    }, user);
    notify(`Shift ${id} closed and sent for owner reconciliation.`);
    setShiftNotes("");
  };
  return (
    <div className="row g-3">
      {!readOnly && <div className="col-xl-5">
        <div className="dashboard-card">
          <p className="eyebrow text-danger">End-of-shift reconciliation</p>
          <h3>Close current shift</h3>
          <p className="module-note">Counting {shiftOrders.length} order(s) since {new Date(shiftStartedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}.</p>
          <label className="form-label">Opening cash<input className="form-control" type="number" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
          <div className="row g-2">
            <label className="form-label col-sm-4">Cash in<input className="form-control" type="number" value={cashIn} onChange={(event) => setCashIn(event.target.value)} /></label>
            <label className="form-label col-sm-4">Cash out<input className="form-control" type="number" value={cashOut} onChange={(event) => setCashOut(event.target.value)} /></label>
            <label className="form-label col-sm-4">Expenses<input className="form-control" type="number" value={expenses} onChange={(event) => setExpenses(event.target.value)} /></label>
          </div>
          <label className="form-label">Actual cash counted<input className="form-control" type="number" value={actualCash} onChange={(event) => setActualCash(event.target.value)} /></label>
          <label className="form-label">Shift notes<textarea className="form-control" rows="2" value={shiftNotes} onChange={(event) => setShiftNotes(event.target.value)} placeholder="Optional: payouts, shortages, or handoff notes" /></label>
          <dl className="reconciliation-list">
            <div><dt>Cash and COD sales</dt><dd>{currency(cashSales)}</dd></div>
            <div><dt>Cash movements</dt><dd>{currency(Number(cashIn || 0) - Number(cashOut || 0) - Number(expenses || 0))}</dd></div>
            <div><dt>Expected cash</dt><dd>{currency(expectedCash)}</dd></div>
            <div><dt>Variance</dt><dd className={variance === 0 ? "text-success" : "text-danger"}>{currency(variance)}</dd></div>
          </dl>
          <button className="btn btn-danger w-100" onClick={closeShift}>Close shift and save log</button>
        </div>
      </div>}
      <div className={readOnly ? "col-12" : "col-xl-7"}>
        <div className="dashboard-card">
          <h3>{readOnly ? "Staff shift reconciliation history" : "Shift history"}</h3>
          <div className="table-responsive"><table className="table align-middle"><thead><tr><th>Staff</th><th>Closed</th><th>Orders</th><th>Movements</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Notes</th></tr></thead><tbody>
            {logs.length === 0 && <tr><td colSpan="8" className="text-center text-secondary py-4">No closed shifts yet.</td></tr>}
            {logs.map((log) => <tr key={log.id}><td>{log.staffName}</td><td>{new Date(log.endedAt || log.createdAt).toLocaleString("en-PH")}</td><td>{log.orderCount}</td><td>{currency(Number(log.cashIn || 0) - Number(log.cashOut || 0) - Number(log.expenses || 0))}</td><td>{currency(log.expectedCash)}</td><td>{currency(log.actualCash)}</td><td>{currency(log.variance)}</td><td>{log.notes || "-"}</td></tr>)}
          </tbody></table></div>
        </div>
      </div>
    </div>
  );
}

function SupportChat({ messages, user, notify }) {
  const [text, setText] = useState("");
  const conversations = useMemo(() => {
    const grouped = new Map();
    for (const message of messages) {
      if (!message.customerId) continue;
      const current = grouped.get(message.customerId) || {
        customerId: message.customerId,
        customerName: message.customerName || "Customer",
        messages: []
      };
      current.messages.push(message);
      if (message.customerName) current.customerName = message.customerName;
      grouped.set(message.customerId, current);
    }
    return [...grouped.values()].sort((a, b) => {
      const aTime = a.messages.at(-1)?.createdAt || 0;
      const bTime = b.messages.at(-1)?.createdAt || 0;
      return bTime - aTime;
    });
  }, [messages]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const selectedConversation = conversations.find((conversation) => conversation.customerId === selectedCustomerId) || conversations[0];
  const visibleMessages = selectedConversation?.messages || [];

  useEffect(() => {
    if (!selectedCustomerId && conversations[0]) setSelectedCustomerId(conversations[0].customerId);
    if (selectedCustomerId && !conversations.some((conversation) => conversation.customerId === selectedCustomerId)) {
      setSelectedCustomerId(conversations[0]?.customerId || "");
    }
  }, [conversations, selectedCustomerId]);

  const send = async (event) => {
    event.preventDefault();
    if (!text.trim() || !selectedConversation) return;
    await sendSupportMessage(text.trim(), user, {
      customerId: selectedConversation.customerId,
      customerName: selectedConversation.customerName,
      conversationId: selectedConversation.customerId
    });
    setText("");
    notify(`Reply sent to ${selectedConversation.customerName}.`);
  };
  return (
    <div className="dashboard-card support-chat">
      <div className="module-heading"><div><p className="eyebrow text-danger">Message history</p><h3>Customer and internal support</h3></div><span className="module-note">Use this channel for order questions and admin coordination.</span></div>
      <div className="support-layout">
        <aside className="support-conversations">
          <strong>Customer conversations</strong>
          {conversations.length === 0 && <div className="empty-chat">No customer chats yet.</div>}
          {conversations.map((conversation) => {
            const latest = conversation.messages.at(-1);
            return <button className={selectedConversation?.customerId === conversation.customerId ? "active" : ""} key={conversation.customerId} onClick={() => setSelectedCustomerId(conversation.customerId)}><span>{conversation.customerName.slice(0, 1).toUpperCase()}</span><div><strong>{conversation.customerName}</strong><small>{latest?.text}</small></div><time>{latest ? new Date(latest.createdAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) : ""}</time></button>;
          })}
        </aside>
        <div className="support-thread">
          <header><strong>{selectedConversation?.customerName || "Select a customer"}</strong><small>{selectedConversation ? "Customer conversation" : "Messages will appear here"}</small></header>
          <div className="support-message-list">
            {visibleMessages.length === 0 && <div className="empty-chat">No support messages yet.</div>}
            {visibleMessages.map((message) => <div className={message.senderId === user.uid ? "message-own" : "message-other"} key={message.id}><strong>{message.senderName} <small>{message.senderRole}</small></strong><p>{message.text}</p><time>{new Date(message.createdAt).toLocaleString("en-PH")}</time></div>)}
          </div>
          <form className="support-compose" onSubmit={send}><input className="form-control" disabled={!selectedConversation} value={text} onChange={(event) => setText(event.target.value)} placeholder={selectedConversation ? `Reply to ${selectedConversation.customerName}...` : "Select a customer conversation"} /><button className="btn btn-danger" disabled={!selectedConversation}>Send</button></form>
        </div>
      </div>
    </div>
  );
}

function SettingsModule({ title, serviceStatus, staff = false, notify }) {
  const [settings, setSettings] = useState({
    gcash: true,
    cod: true,
    sms: true,
    lowStockAlerts: true,
    autoPrint: staff,
    emailReceipts: staff
  });
  const toggle = (key) => setSettings((current) => ({ ...current, [key]: !current[key] }));
  return (
    <div className="row g-3">
      <div className="col-xl-7"><div className="dashboard-card settings-card"><p className="eyebrow text-danger">Preferences</p><h3>{title}</h3>
        {Object.entries(settings).map(([key, enabled]) => <label className="setting-row" key={key}><span><strong>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</strong><small>{staff ? "Staff workstation preference" : "Business-wide operational setting"}</small></span><input type="checkbox" checked={enabled} onChange={() => toggle(key)} /></label>)}
        <button className="btn btn-danger mt-3" onClick={() => notify("Settings saved for this session.")}>Save settings</button>
      </div></div>
      <div className="col-xl-5"><div className="dashboard-card"><h3>App features</h3>{Object.entries(serviceStatus || {}).map(([name, active]) => <ServiceBadge key={name} name={name} active={active} />)}</div></div>
    </div>
  );
}

function OwnerWorkspace({ section, user, orders, inventory, reviews, serviceStatus, auditLogs, shiftLogs, notify }) {
  const menu = inventory;
  const revenueOrders = orders.filter(isRevenueOrder);
  const totalSales = revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
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
  const [salesGoal, setSalesGoal] = useState(100000);
  const [roleForm, setRoleForm] = useState({ uid: "", role: "staff" });
  const [managedUsers, setManagedUsers] = useState([]);
  const [adminMessage, setAdminMessage] = useState({ uid: "", title: "Message from administrator", message: "" });
  const [reportDate, setReportDate] = useState(localDateInputValue());
  const dailyReport = useMemo(() => buildDailyReport(orders, inventory, shiftLogs, reportDate), [orders, inventory, shiftLogs, reportDate]);
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
  const printDailyReport = () => {
    const opened = printOwnerDailyReport(dailyReport);
    notify(opened ? `Owner daily report for ${dailyReport.dateLabel} is ready to print.` : "Allow pop-ups to print the owner report.");
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
      await api.assignRole(roleForm.uid, roleForm.role);
      notify(`User role updated to ${roleForm.role}.`);
      setRoleForm({ uid: "", role: "staff" });
      await refreshUsers();
    } catch (error) {
      notify(error.message);
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
  if (section === "owner-sales") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Sales strategy and analytics</p><h2>Sales & Orders</h2></div><button className="btn btn-outline-dark" onClick={printDailyReport}>Print daily report</button></div>
      <div className="row g-3">
        <div className="col-md-4"><div className="metric-card"><small>Unified gross sales</small><strong>{currency(totalSales)}</strong><span>Online and walk-in ledger</span></div></div>
        <div className="col-md-4"><div className="metric-card"><small>Revenue target</small><strong>{currency(salesGoal)}</strong><span>{Math.min(100, Math.round(totalSales / salesGoal * 100))}% achieved</span></div></div>
        <div className="col-md-4"><div className="metric-card"><small>Awaiting completion</small><strong>{orders.filter((order) => !["delivered", "cancelled", "pending-payment"].includes(order.status)).length}</strong><span>Live order workload</span></div></div>
        <div className="col-lg-8"><div className="dashboard-card chart-card"><h3>Sales trends and forecast</h3><Suspense fallback={<SectionLoader label="Loading sales chart..." />}><SalesChart values={salesTrend} /></Suspense></div></div>
        <div className="col-lg-4"><div className="dashboard-card"><h3>Strategy controls</h3><label className="form-label">Sales goal threshold<input className="form-control" type="number" value={salesGoal} onChange={(event) => setSalesGoal(Number(event.target.value))} /></label><label className="form-label">Active promotion<select className="form-select"><option>Free delivery over PHP 499</option><option>10% off rice meals</option><option>No active promotion</option></select></label><button className="btn btn-danger w-100 mt-3" onClick={() => notify("Sales strategy saved.")}>Save strategy</button></div></div>
        <div className="col-12"><OrderManagement orders={orders} canAdvance notify={notify} /></div>
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
        <div className="col-md-3"><div className="metric-card"><small>Cancelled</small><strong>{dailyReport.cancelledOrders.length}</strong><span>Stock returned</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>COD to remit</small><strong>{currency(sumByTotal(dailyReport.unremittedCodOrders))}</strong><span>Delivered, not handed over</span></div></div>
        <div className="col-lg-4"><div className="dashboard-card report-breakdown-card"><h3>Payment breakdown</h3><dl className="reconciliation-list">
          <div><dt>Cash</dt><dd>{currency(dailyReport.paymentBreakdown.cash)}</dd></div>
          <div><dt>Delivered COD</dt><dd>{currency(dailyReport.paymentBreakdown.cod)}</dd></div>
          <div><dt>Online / GCash</dt><dd>{currency(dailyReport.paymentBreakdown.online)}</dd></div>
          <div><dt>Pending unpaid</dt><dd>{currency(dailyReport.paymentBreakdown.pending)}</dd></div>
        </dl></div></div>
        <div className="col-lg-8"><div className="dashboard-card"><h3>Top selling items</h3><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Item</th><th>Qty sold</th><th>Sales</th></tr></thead><tbody>{dailyReport.topItems.length === 0 && <tr><td colSpan="3" className="text-center text-secondary py-4">No paid sales for this day.</td></tr>}{dailyReport.topItems.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.qty}</td><td>{currency(item.sales)}</td></tr>)}</tbody></table></div></div></div>
        <div className="col-12"><div className="dashboard-card"><h3>COD remittance</h3><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Order</th><th>Customer</th><th>Rider</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>{dailyReport.unremittedCodOrders.length === 0 && <tr><td colSpan="6" className="text-center text-secondary py-4">No COD collections waiting for owner handoff.</td></tr>}{dailyReport.unremittedCodOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td>{order.riderName || order.riderId || "-"}</td><td>{currency(order.total)}</td><td><span className="status status-arrived">Collected</span></td><td><button className="btn btn-sm btn-danger" onClick={() => markCodRemitted(order)}>Mark remitted</button></td></tr>)}</tbody></table></div></div></div>
        <div className="col-12"><div className="dashboard-card"><h3>Daily order ledger</h3><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Status</th><th>Sales counted</th><th>Total</th></tr></thead><tbody>{dailyReport.dailyOrders.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-4">No orders for this day.</td></tr>}{dailyReport.dailyOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td className="order-items-cell"><span>{orderItemText(order)}</span></td><td>{orderPaymentLabel(order)}</td><td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td><td>{isRevenueOrder(order) ? "Yes" : "No"}</td><td>{currency(order.total)}</td></tr>)}</tbody></table></div></div></div>
        <div className="col-12"><ShiftLogsModule orders={orders} logs={dailyReport.closedShifts} user={user} notify={notify} readOnly /></div>
      </div>
    </main>
  );
  if (section === "owner-users") return (
    <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">User access</p><h2>Users & Roles</h2></div></div><div className="row g-3">
      <div className="col-12"><div className="dashboard-card"><h3>User accounts and security</h3><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Security</th><th>Security controls</th></tr></thead><tbody>{managedUsers.length === 0 && <tr><td colSpan="5" className="text-center text-secondary py-4">No users found.</td></tr>}{managedUsers.map((account) => <tr key={account.uid}><td><strong>{account.name}</strong><small className="d-block text-secondary">{account.uid}</small></td><td>{account.email}</td><td><span className="role-badge">{account.role}</span></td><td><span className={`stock-badge ${account.twoFactorEnabled && !account.twoFactorLocked ? "healthy" : "low"}`}>{account.twoFactorLocked ? "Locked" : account.twoFactorEnabled ? `${securityMethodLabels[account.twoFactorMethod] || "Security"} enabled` : "Not set up"}</span></td><td><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-danger" onClick={() => securityAction(account.uid, "reset")}>Reset security</button>{account.twoFactorLocked && <button className="btn btn-sm btn-dark" onClick={() => securityAction(account.uid, "unlock")}>Unlock</button>}</div></td></tr>)}</tbody></table></div></div></div>
      <div className="col-xl-6"><form className="dashboard-card" onSubmit={updateRole}><h3>Assign user role</h3><p className="module-note">Enter the user account ID and choose the role.</p><label className="form-label">Account ID<input className="form-control" required value={roleForm.uid} onChange={(event) => setRoleForm((current) => ({ ...current, uid: event.target.value }))} /></label><label className="form-label">Role<select className="form-select" value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))}><option>owner</option><option>staff</option><option>rider</option><option>customer</option></select></label><button className="btn btn-danger w-100 mt-3">Update role</button></form></div>
      <div className="col-xl-6"><form className="dashboard-card" onSubmit={sendAdminMessage}><h3>Private admin notification</h3><label className="form-label">Recipient<select className="form-select" required value={adminMessage.uid} onChange={(event) => setAdminMessage((current) => ({ ...current, uid: event.target.value }))}><option value="">Select a user</option>{managedUsers.map((account) => <option key={account.uid} value={account.uid}>{account.name} ({account.role})</option>)}</select></label><label className="form-label">Title<input className="form-control" required value={adminMessage.title} onChange={(event) => setAdminMessage((current) => ({ ...current, title: event.target.value }))} /></label><label className="form-label">Message<textarea className="form-control" required maxLength="1000" rows="3" value={adminMessage.message} onChange={(event) => setAdminMessage((current) => ({ ...current, message: event.target.value }))} /></label><button className="btn btn-dark w-100 mt-3">Send only to this user</button></form></div>
    </div></main>
  );
  if (section === "owner-reviews") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Customer voice</p><h2>Reviews</h2></div></div><ReviewModerationModule reviews={reviews} user={user} notify={notify} /></main>;
  if (section === "owner-audit") return (
    <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Accountability and integrity</p><h2>Audit Logs</h2></div></div><div className="dashboard-card"><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Record</th><th>Details</th></tr></thead><tbody>{auditLogs.length === 0 && <tr><td colSpan="5" className="text-center text-secondary py-5">Actions will appear here as orders, stock and shifts are updated.</td></tr>}{auditLogs.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("en-PH")}</td><td>{entry.action?.replaceAll("_", " ")}</td><td>{entry.actorName || "System"}</td><td>{entry.orderId || entry.itemName || entry.shiftLogId || "-"}</td><td>{entry.status || entry.reason || (entry.quantity ? `Quantity ${entry.quantity}` : "-")}</td></tr>)}</tbody></table></div></div></main>
  );
  if (section === "owner-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Business administration</p><h2>System Settings</h2></div></div><SettingsModule title="Payments, notifications and system controls" serviceStatus={serviceStatus} notify={notify} /></main>;
  return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Super Admin / Owner</p><h2>Business dashboard</h2></div><button className="btn btn-outline-dark" onClick={printDailyReport}>Print daily report</button></div>
      <div className="row g-3">
        <div className="col-md-3"><div className="metric-card"><small>Gross sales</small><strong>{currency(totalSales)}</strong><span>Paid transactions</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Orders</small><strong>{orders.length}</strong><span>All channels</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Menu items</small><strong>{menu.length}</strong><span>Ready to sell</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Ready features</small><strong>{Object.values(serviceStatus).filter(Boolean).length}</strong><span>Some features need setup</span></div></div>
        <div className="col-lg-8"><div className="dashboard-card chart-card"><h3>Sales performance</h3><Suspense fallback={<SectionLoader label="Loading sales chart..." />}><SalesChart values={salesTrend} /></Suspense></div></div>
        <div className="col-lg-4"><div className="dashboard-card ai-insight"><p className="eyebrow">{serviceStatus?.openai ? "Business insight" : "Free business insight"}</p><h3>Decision support</h3><p>{insight}</p><button className="btn btn-warning w-100" onClick={generateInsight}>{serviceStatus?.openai ? "Generate business summary" : "Generate free summary"}</button></div></div>
        <div className="col-lg-7"><OrderManagement orders={orders.slice(0, 5)} canAdvance notify={notify} /></div>
        <div className="col-lg-5"><div className="dashboard-card"><h3>Low-stock alerts</h3>{inventory.filter((item) => item.stock <= item.reorderPoint).map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>Reorder point: {item.reorderPoint}</small></span><b>{item.stock}</b></div>)}{inventory.every((item) => item.stock > item.reorderPoint) && <p className="text-secondary small">All products are above their reorder points.</p>}</div></div>
      </div>
    </main>
  );
}

function ReasonModal({ title, label, placeholder, confirmText, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) return;
    await onSubmit(reason.trim());
  };
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="modal d-block" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-dialog-centered">
        <form className="modal-content reason-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="reason-modal-title">
          <div className="modal-header"><h5 className="modal-title" id="reason-modal-title">{title}</h5><button className="btn-close" type="button" aria-label="Close" onClick={onClose} /></div>
          <div className="modal-body">
            <label className="form-label">{label}<textarea className="form-control" rows="4" autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder={placeholder} /></label>
          </div>
          <div className="modal-footer"><button className="btn btn-outline-dark" type="button" onClick={onClose}>Close</button><button className="btn btn-danger" disabled={!reason.trim()}>{confirmText}</button></div>
        </form>
      </div>
    </div>
  );
}

function OrderManagement({ orders, canAdvance, notify }) {
  const [cancelTarget, setCancelTarget] = useState(null);
  const flow = ["received", "preparing", "ready", "out-for-delivery", "arrived", "delivered"];
  const cancellableStatuses = ["pending-payment", "received", "preparing"];
  const advance = async (order) => {
    if (!flow.includes(order.status)) {
      notify("This order is waiting for payment confirmation.");
      return;
    }
    const next = flow[Math.min(flow.indexOf(order.status) + 1, flow.length - 1)];
    await updateOrder(order.id, { status: next, updatedAt: Date.now() });
    api.sendNotification({ to: order.phone, orderId: order.id, status: next }).catch(() => {});
    notify(`${order.id} updated to ${statusLabel(next)}.`);
  };
  const cancelOrder = async (order, reason) => {
    await updateOrder(order.id, { cancel: true, cancelReason: reason });
    notify(`${order.id} cancelled and stock restored.`);
  };
  // erick: dinagdag ang Items column (+ address) para makita ng staff ang in-order.
  return (
    <div className="dashboard-card">
      <h3>Live order ledger</h3>
      <div className="table-responsive">
        <table className="table align-middle">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>{orders.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-4">No orders in the queue.</td></tr>}{orders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td className="order-items-cell"><span>{order.items?.map((item) => `${item.qty}x ${item.name}`).join(", ") || "-"}</span>{order.deliveryType && <small className="d-block text-secondary">{order.deliveryType}</small>}{order.address && order.address !== "Counter" && <small className="d-block text-secondary">{order.address}</small>}{order.notes && <small className="d-block text-secondary">Note: {order.notes}</small>}</td><td>{orderPaymentLabel(order)}</td><td>{currency(order.total)}</td><td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td><td>{canAdvance && <div className="order-action-stack">{flow.includes(order.status) && order.status !== "delivered" && <button className="btn btn-sm btn-outline-danger" onClick={() => advance(order)}>Advance</button>}{cancellableStatuses.includes(order.status) && <button className="btn btn-sm btn-outline-dark" onClick={() => setCancelTarget(order)}>Cancel</button>}</div>}</td></tr>)}</tbody>
        </table>
      </div>
      {cancelTarget && <ReasonModal title={`Cancel ${cancelTarget.id}`} label="Cancellation reason" placeholder="Example: Customer changed order, unavailable item, duplicate order..." confirmText="Cancel order" onClose={() => setCancelTarget(null)} onSubmit={async (reason) => { await cancelOrder(cancelTarget, reason); setCancelTarget(null); }} />}
    </div>
  );
}

function KitchenQueue({ orders, notify }) {
  const lanes = [
    { status: "received", title: "New orders", next: "preparing", action: "Start prep" },
    { status: "preparing", title: "Preparing", next: "ready", action: "Mark ready" },
    { status: "ready", title: "Ready", next: null }
  ];
  const orderServiceLabel = (order) => {
    if (order.deliveryType === "delivery") return "Delivery order";
    if (order.deliveryType === "pickup") return "Customer pickup";
    if (order.diningOption === "takeout") return "Takeout";
    if (order.diningOption === "dine-in") return "Dine-in";
    if (order.deliveryType === "walk-in") return "Walk-in";
    return "Order";
  };
  const readyActionLabel = (order) => {
    if (order.deliveryType === "delivery") return "Waiting for rider";
    if (order.deliveryType === "pickup") return "Ready for pickup";
    if (order.diningOption === "takeout") return "Ready for handoff";
    if (order.diningOption === "dine-in") return "Ready to serve";
    return "Ready at counter";
  };
  const move = async (order, next) => {
    if (!next) return;
    await updateOrder(order.id, { status: next, updatedAt: Date.now() });
    notify(`${order.id} moved to ${statusLabel(next)}.`);
  };
  return (
    <div className="kitchen-board">
      {lanes.map((lane) => {
        const laneOrders = orders.filter((order) => order.status === lane.status);
        return (
          <section className="kitchen-lane" key={lane.status}>
            <header><div><p className="eyebrow text-danger">Kitchen</p><h3>{lane.title}</h3></div><span>{laneOrders.length}</span></header>
            {laneOrders.length === 0 && <div className="empty-chat">No orders here.</div>}
            {laneOrders.map((order) => (
              <article className="kitchen-ticket" key={order.id}>
                <div><strong>{order.id}</strong><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></div>
                <small>{order.customerName} · {orderServiceLabel(order)}</small>
                <p>{orderItemText(order)}</p>
                {order.notes && <em>Note: {order.notes}</em>}
                <button className={lane.next ? "btn btn-sm btn-danger" : "btn btn-sm btn-outline-dark"} disabled={!lane.next} onClick={() => move(order, lane.next)}>{lane.next ? lane.action : readyActionLabel(order)}</button>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function StaffWorkspace({ section, user, orders, inventory: staffInventory, reviews, shiftLogs, messages, serviceStatus, notify }) {
  const [posCart, setPosCart] = useState([]);
  const [posCategory, setPosCategory] = useState("all");
  const [posDiscount, setPosDiscount] = useState(0);
  const [posCashReceived, setPosCashReceived] = useState(0);
  const [diningOption, setDiningOption] = useState("dine-in");
  const [lastReceipt, setLastReceipt] = useState(null);
  const activePosCategory = staffPosCategories.find((item) => item.id === posCategory) || staffPosCategories[0];
  const visibleInventory = staffInventory.filter(activePosCategory.matches);
  const categoryCount = (category) => staffInventory.filter(category.matches).length;
  const categoryCountLabel = (category) => {
    const count = categoryCount(category);
    return `${count} item${count === 1 ? "" : "s"}`;
  };
  const inventory = section === "staff-pos" ? visibleInventory : staffInventory;
  const posSubtotal = posCart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const posDiscountAmount = Math.max(0, Math.min(posSubtotal, Number(posDiscount || 0)));
  const posTotal = Math.max(0, posSubtotal - posDiscountAmount);
  const posChange = Math.max(0, Number(posCashReceived || 0) - posTotal);
  const add = (product) => setPosCart((current) => {
    const found = current.find((item) => item.id === product.id);
    if (found?.qty >= product.stock) {
      notify(`Only ${product.stock} ${product.name} item(s) are available.`);
      return current;
    }
    return found ? current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item) : [...current, { ...product, qty: 1 }];
  });
  const decrease = (productId) => setPosCart((current) => current
    .map((item) => item.id === productId ? { ...item, qty: item.qty - 1 } : item)
    .filter((item) => item.qty > 0));
  const remove = (productId) => setPosCart((current) => current.filter((item) => item.id !== productId));
  const complete = async () => {
    if (Number(posCashReceived || 0) < posTotal) {
      notify("Cash received must cover the walk-in order total.");
      return;
    }
    const payload = {
      customerId: "walk-in",
      customerName: "Walk-in Customer",
      paymentMethod: "cash",
      total: posTotal,
      subtotal: posSubtotal,
      discount: posDiscountAmount,
      cashReceived: Number(posCashReceived || 0),
      changeDue: posChange,
      diningOption,
      cashierName: user.name,
      deliveryType: "walk-in",
      address: "Counter",
      phone: "",
      items: posCart
    };
    const orderId = await createOrder(payload);
    const receipt = { id: orderId, ...payload, createdAt: Date.now(), status: "received" };
    setPosCart([]);
    setPosDiscount(0);
    setPosCashReceived(0);
    setLastReceipt(receipt);
    if (!printReceipt(receipt)) notify("Allow pop-ups to print the receipt.");
    notify(`Walk-in receipt ${orderId} completed.`);
  };

  if (section === "staff-pos") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Fast counter entry</p><h2>Walk-in POS</h2></div></div>
      <div className="row g-3">
        <div className="col-12">
          <div className="pos-menu-tools">
            <div className="pos-category-rail" aria-label="Staff POS menu categories">
              {staffPosCategories.map((category) => (
                <button key={category.id} className={posCategory === category.id ? "active" : ""} aria-pressed={posCategory === category.id} onClick={() => setPosCategory(category.id)}>
                  <strong>{category.label}</strong>
                  <span>{categoryCountLabel(category)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="col-xl-8"><div className="row g-3">{inventory.map((product, index) => <div className="col-md-4" key={product.id}><button className="pos-product" disabled={product.stock <= 0} onClick={() => add(product)}><MenuPhoto product={product} priority={index < 6} /><strong>{product.name}</strong><span>{currency(product.price)} - {product.stock} available</span></button></div>)}</div></div>
        <div className="col-xl-4">
          <div className="dashboard-card sticky-pos">
            <div className="module-heading"><h3>Current walk-in order</h3>{posCart.length > 0 && <button className="btn btn-link btn-sm text-danger p-0" onClick={() => setPosCart([])}>Clear cart</button>}</div>
            {posCart.length === 0 && <div className="empty-chat">Select products to begin a POS order.</div>}
            {posCart.map((item) => (
              <div className="pos-cart-item" key={item.id}>
                <div><strong>{item.name}</strong><small>{currency(item.price)} each</small></div>
                <div className="pos-quantity"><button onClick={() => decrease(item.id)} aria-label={`Decrease ${item.name}`}>-</button><span>{item.qty}</span><button disabled={item.qty >= item.stock} onClick={() => add(item)} aria-label={`Increase ${item.name}`}>+</button></div>
                <strong>{currency(item.qty * item.price)}</strong>
                <button className="pos-remove" onClick={() => remove(item.id)}>Remove</button>
              </div>
            ))}
            <div className="pos-payment-panel">
              <div className="checkout-mode-grid" aria-label="Walk-in type">
                <button className={diningOption === "dine-in" ? "active" : ""} type="button" aria-pressed={diningOption === "dine-in"} onClick={() => setDiningOption("dine-in")}><strong>Dine-in</strong><small>Counter order</small></button>
                <button className={diningOption === "takeout" ? "active" : ""} type="button" aria-pressed={diningOption === "takeout"} onClick={() => setDiningOption("takeout")}><strong>Takeout</strong><small>Pack to go</small></button>
              </div>
              <label className="form-label">Discount<input className="form-control" type="number" min="0" value={posDiscount} onChange={(event) => setPosDiscount(event.target.value)} /></label>
              <label className="form-label">Cash received<input className="form-control" type="number" min="0" value={posCashReceived} onChange={(event) => setPosCashReceived(event.target.value)} /></label>
            </div>
            <dl className="reconciliation-list pos-totals">
              <div><dt>Subtotal</dt><dd>{currency(posSubtotal)}</dd></div>
              <div><dt>Discount</dt><dd>{currency(posDiscountAmount)}</dd></div>
              <div><dt>Total</dt><dd>{currency(posTotal)}</dd></div>
              <div><dt>Change</dt><dd>{currency(posChange)}</dd></div>
            </dl>
            <button className="btn btn-danger w-100" disabled={!posCart.length || Number(posCashReceived || 0) < posTotal} onClick={complete}>Accept payment and print receipt</button>
            {lastReceipt && <div className="last-receipt-card"><strong>Last receipt</strong><span>{lastReceipt.id} · {currency(lastReceipt.total)}</span><button className="btn btn-sm btn-outline-dark" onClick={() => printReceipt(lastReceipt)}>Print again</button></div>}
          </div>
        </div>
      </div>
    </main>
  );
  if (section === "staff-orders") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Online and walk-in fulfillment</p><h2>Order Queue</h2></div></div><OrderManagement orders={orders} canAdvance notify={notify} /></main>;
  if (section === "staff-kitchen") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Kitchen preparation</p><h2>Kitchen Queue</h2></div></div><KitchenQueue orders={orders.filter((order) => ["received", "preparing", "ready"].includes(order.status))} notify={notify} /></main>;
  if (section === "staff-inventory") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Receiving, wastage and availability</p><h2>Inventory</h2></div></div><InventoryModule inventory={inventory} user={user} notify={notify} /></main>;
  if (section === "staff-shifts") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Accountability and cash control</p><h2>Shift Logs</h2></div></div><ShiftLogsModule orders={orders} logs={shiftLogs} user={user} notify={notify} /></main>;
  if (section === "staff-chat") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Live communication</p><h2>Chat Support</h2></div></div><SupportChat messages={messages} user={user} notify={notify} /></main>;
  if (section === "staff-reviews") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Customer voice</p><h2>Reviews</h2></div></div><ReviewModerationModule reviews={reviews} user={user} notify={notify} /></main>;
  if (section === "staff-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Workstation preferences</p><h2>Settings</h2></div></div><SettingsModule title="Staff alerts, receipts and workstation" serviceStatus={serviceStatus} staff notify={notify} /></main>;

  const activeOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const todayRange = reportDateRange(localDateInputValue());
  const todaySales = orders.filter((order) => inRange(order.createdAt, todayRange) && isRevenueOrder(order)).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const lowStock = inventory.filter((item) => item.stock <= item.reorderPoint);
  return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Staff / Admin</p><h2>Shift Dashboard</h2></div><span className="shift-chip">Active shift · {new Date().toLocaleDateString("en-PH")}</span></div>
      <div className="row g-3">
        <div className="col-md-3"><div className="metric-card"><small>Active orders</small><strong>{activeOrders.length}</strong><span>Kitchen and delivery queue</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Today's sales</small><strong>{currency(todaySales)}</strong><span>Online and walk-in</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Pending pickup</small><strong>{orders.filter((order) => order.status === "ready").length}</strong><span>Waiting for rider</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Low stock alerts</small><strong>{lowStock.length}</strong><span>Requires staff action</span></div></div>
        <div className="col-lg-8"><OrderManagement orders={activeOrders.slice(0, 6)} canAdvance notify={notify} /></div>
        <div className="col-lg-4"><div className="dashboard-card"><h3>Quick actions</h3><div className="d-grid gap-2"><button className="btn btn-danger" onClick={() => notify("Open Walk-in POS from the navigation.")}>New walk-in order</button><button className="btn btn-outline-dark" onClick={() => notify(`${lowStock.length} product(s) need inventory attention.`)}>Review low stock</button><button className="btn btn-outline-dark" onClick={() => notify("Shift reconciliation is available in Shift Logs.")}>Prepare shift close</button></div><h3 className="mt-4">Critical stock</h3>{lowStock.slice(0, 4).map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>Reorder at {item.reorderPoint}</small></span><b>{item.stock}</b></div>)}</div></div>
      </div>
    </main>
  );
}

function RiderWorkspace({ section, user, orders, notify }) {
  const assignedOrders = orders.filter((order) => order.riderId === user.uid);
  const availableOrders = orders.filter((order) => order.status === "ready" && !order.riderId);
  const [selectedId, setSelectedId] = useState("");
  const active = assignedOrders.find((order) => order.id === selectedId) || assignedOrders.find((order) => !["delivered", "cancelled"].includes(order.status)) || assignedOrders[0];
  const [online, setOnline] = useState(false);
  const [location, setLocation] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const watchRef = useRef(null);

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  const toggleOnline = async () => {
    if (online) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setOnline(false);
      return;
    }
    if (!navigator.geolocation) return notify("Geolocation is unavailable on this device.");
    const socket = await getSocket().catch(() => null);
    watchRef.current = navigator.geolocation.watchPosition(async ({ coords }) => {
      const next = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
      setLocation(next);
      if (!active?.id) return;
      try {
        if (socket?.connected) await sendRiderLocation(active.id, next);
        else await saveRiderLocation(active.id, next);
      } catch (error) {
        notify(error.message);
      }
    }, (error) => notify(error.message), { enableHighAccuracy: true, maximumAge: 5000 });
    setOnline(true);
  };

  const pickup = async () => {
    if (!active) return;
    await updateOrder(active.id, { status: "out-for-delivery", riderId: user.uid });
    navigator.vibrate?.([120, 70, 120]);
    notify("Pickup recorded. Customer tracking is live.");
  };

  const claimOrder = async (order) => {
    await updateOrder(order.id, { riderId: user.uid, assignedAt: Date.now() });
    setSelectedId(order.id);
    navigator.vibrate?.([150, 80, 150]);
    notify(`${order.id} is now assigned to you.`);
  };

  const markArrived = async () => {
    if (!active) return;
    await updateOrder(active.id, { status: "arrived", arrivedAt: Date.now() });
    navigator.vibrate?.([100, 60, 100]);
    notify("Arrival recorded. You can now capture proof of delivery.");
  };

  const capture = async (blob) => {
    const proof = await uploadProof(active.id, blob);
    await updateOrder(active.id, { status: "delivered", ...proof });
    setCameraOpen(false);
    navigator.vibrate?.(180);
    notify("Delivery completed with photo evidence.");
  };

  const firstName = (user.name || "Rider").split(" ")[0];
  const activeDeliveries = assignedOrders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const completedDeliveries = assignedOrders.filter((order) => order.status === "delivered");
  const codOrders = assignedOrders.filter((order) => order.paymentMethod === "cod");
  const collectedCod = codOrders.filter((order) => order.status === "delivered").reduce((sum, order) => sum + Number(order.total || 0), 0);
  const remittedCod = codOrders.filter((order) => order.codRemittedAt).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const cashToCollect = codOrders.filter((order) => order.status !== "delivered" && order.status !== "cancelled").reduce((sum, order) => sum + Number(order.total || 0), 0);
  const cashToRemit = codOrders.filter(isUnremittedCod).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const orderItems = (order) => order?.items?.map((item) => `${item.qty}x ${item.name}`).join(", ") || "Foodtrip order";
  const orderCount = (order) => order?.items?.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 0;
  const addressLabel = (value) => value || "Counter pickup";
  const reportDeliveryIssue = async (reason) => {
    if (!active) return;
    await updateOrder(active.id, { deliveryIssue: reason });
    notify("Delivery issue sent to owner and staff.");
  };

  const googleMapsUrl = active
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(active.address)}&travelmode=driving`
    : "#";

  if (section === "rider-cod") {
    return (
      <main className="rider-page dashboard-page">
        <section className="rider-hero rider-ledger-hero">
          <div className="rider-hero-top">
            <div className="rider-avatar"><Wallet size={26} strokeWidth={2.4} aria-hidden="true" /></div>
            <div>
              <p className="eyebrow">Rider financials</p>
              <h1>COD Ledger</h1>
              <span><CheckCircle2 size={14} aria-hidden="true" /> {completedDeliveries.length} completed drops</span>
            </div>
          </div>
          <div className="rider-earnings">
            <small>Cash to remit</small>
            <strong>{currency(cashToRemit)}</strong>
            <span>{currency(collectedCod)} collected from completed COD orders</span>
          </div>
          <div className="rider-hero-metrics">
            <div><small>COD orders</small><strong>{codOrders.length}</strong></div>
            <div><small>Collected</small><strong>{currency(collectedCod)}</strong></div>
            <div><small>Remitted</small><strong>{currency(remittedCod)}</strong></div>
          </div>
        </section>

        <section className="rider-ledger-list" aria-label="COD order ledger">
          <div className="rider-section-heading">
            <div><p className="eyebrow text-danger">Cash delivery list</p><h2>Payment handoff</h2></div>
            <span>{codOrders.filter(isUnremittedCod).length} to remit</span>
          </div>
          {codOrders.length === 0 && <div className="empty-state compact">No COD orders assigned.</div>}
          {codOrders.map((order) => (
            <article className="rider-ledger-row" key={order.id}>
              <div className="rider-order-avatar"><Wallet size={18} aria-hidden="true" /></div>
              <div>
                <strong>{order.id}</strong>
                <small>{order.customerName}</small>
                <span><MapPin size={13} aria-hidden="true" /> {addressLabel(order.address)}</span>
              </div>
              <div className="rider-ledger-total">
                <strong>{currency(order.total)}</strong>
                <span className={`status status-${order.status}`}>{statusLabel(order.status)}</span>
              </div>
            </article>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="rider-page dashboard-page">
      <section className="rider-hero">
        <div className="rider-hero-top">
          <div className="rider-avatar"><Bike size={27} strokeWidth={2.4} aria-hidden="true" /></div>
          <div>
            <p className="eyebrow">Delivery rider</p>
            <h1>Hi, {firstName}</h1>
            <span><MapPin size={14} aria-hidden="true" /> {location ? "GPS locked" : "GPS standby"}</span>
          </div>
          <button className={`rider-online-toggle ${online ? "online" : ""}`} onClick={toggleOnline}>
            <span />
            {online ? "Online" : "Go online"}
          </button>
        </div>
        <div className="rider-earnings">
          <small>Cash to collect</small>
          <strong>{currency(cashToCollect)}</strong>
          <span>{activeDeliveries.length} active deliveries today</span>
        </div>
        <div className="rider-hero-metrics">
          <div><small>Assigned</small><strong>{assignedOrders.length}</strong></div>
          <div><small>Open jobs</small><strong>{availableOrders.length}</strong></div>
          <div><small>Completed</small><strong>{completedDeliveries.length}</strong></div>
        </div>
      </section>

      <div className="rider-shell">
        <section className="rider-order-feed" aria-label="Rider orders">
          <div className="rider-section-heading">
            <div><p className="eyebrow text-danger">Driver queue</p><h2>Your deliveries</h2></div>
            <span>{activeDeliveries.length} active</span>
          </div>
          {assignedOrders.length === 0 && <div className="empty-state compact">No orders assigned yet.</div>}
          {assignedOrders.map((order) => (
            <button className={`rider-order-card ${active?.id === order.id ? "active" : ""}`} key={order.id} onClick={() => setSelectedId(order.id)}>
              <span className="rider-order-avatar"><PackageIcon size={18} aria-hidden="true" /></span>
              <span className="rider-order-copy">
                <span><strong>{order.id}</strong><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></span>
                <small>{order.customerName}</small>
                <em><MapPin size={13} aria-hidden="true" /> {addressLabel(order.address)}</em>
              </span>
              <span className="rider-order-total">{currency(order.total)}</span>
            </button>
          ))}

          {availableOrders.length > 0 && (
            <>
              <div className="rider-section-heading compact">
                <div><p className="eyebrow text-danger">Ready for assignment</p><h2>New jobs</h2></div>
                <span>{availableOrders.length} ready</span>
              </div>
              {availableOrders.map((order) => (
                <article className="rider-job-card" key={order.id}>
                  <div className="rider-order-avatar"><Clock size={18} aria-hidden="true" /></div>
                  <div>
                    <strong>{order.id}</strong>
                    <small>{orderItems(order)}</small>
                    <span><MapPin size={13} aria-hidden="true" /> {addressLabel(order.address)}</span>
                  </div>
                  <button onClick={() => claimOrder(order)}><CheckCircle2 size={16} aria-hidden="true" /> Accept</button>
                </article>
              ))}
            </>
          )}
        </section>

        <section className="rider-active-panel" aria-label="Active delivery">
          <div className="rider-active-header">
            <div><p className="eyebrow text-danger">Current route</p><h2>{active ? active.id : "No active order"}</h2></div>
            {active && <span className={`status status-${active.status}`}>{statusLabel(active.status)}</span>}
          </div>
          {active ? (
            <>
              <div className="rider-route-card">
                <div>
                  <span className="rider-route-dot pickup"><Route size={15} aria-hidden="true" /></span>
                  <p><small>Pickup</small><strong>TapTap FoodTrip</strong></p>
                </div>
                <i />
                <div>
                  <span className="rider-route-dot drop"><MapPin size={15} aria-hidden="true" /></span>
                  <p><small>Drop off</small><strong>{addressLabel(active.address)}</strong></p>
                </div>
              </div>

              <div className="rider-active-details">
                <div><small>Customer</small><strong>{active.customerName}</strong></div>
                <div><small>Items</small><strong>{orderCount(active)} total</strong><span>{orderItems(active)}</span></div>
                <div><small>Payment</small><strong>{active.paymentMethod?.toUpperCase()} - {currency(active.total)}</strong></div>
              </div>

              <div className="rider-map-panel"><Suspense fallback={<SectionLoader label="Loading delivery map..." />}><DeliveryMap rider={location} /></Suspense></div>

              <div className="rider-action-grid">
                <button className="rider-action primary" disabled={active.status !== "ready"} onClick={pickup}><PackageIcon size={17} aria-hidden="true" /> Pick up</button>
                <a className="rider-action" href={googleMapsUrl} target="_blank" rel="noreferrer"><Navigation size={17} aria-hidden="true" /> Navigate</a>
                {active.phone && <a className="rider-action" href={`tel:${active.phone}`}><Phone size={17} aria-hidden="true" /> Call</a>}
                <button className="rider-action" disabled={!["out-for-delivery", "arrived"].includes(active.status)} onClick={() => setIssueOpen(true)}><Clock size={17} aria-hidden="true" /> Issue</button>
                <button className="rider-action warning" disabled={active.status !== "out-for-delivery"} onClick={markArrived}><MapPin size={17} aria-hidden="true" /> Arrived</button>
                <button className="rider-action success" disabled={active.status !== "arrived"} onClick={() => setCameraOpen(true)}><Camera size={17} aria-hidden="true" /> Proof</button>
              </div>
            </>
          ) : <div className="empty-state compact">Assigned delivery details will appear here.</div>}
        </section>
      </div>
      {cameraOpen && <Suspense fallback={<SectionLoader label="Opening camera..." />}><CameraProof onCapture={capture} onClose={() => setCameraOpen(false)} /></Suspense>}
      {issueOpen && active && <ReasonModal title={`Report ${active.id}`} label="Delivery issue" placeholder="Example: Customer not answering, address unclear, heavy traffic..." confirmText="Send issue" onClose={() => setIssueOpen(false)} onSubmit={async (reason) => { await reportDeliveryIssue(reason); setIssueOpen(false); }} />}
    </main>
  );
}

function TrackingView({ order, onClose }) {
  const [rider, setRider] = useState(null);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    if (!order?.riderId) return undefined;
    joinOrderRoom(order.id).catch(() => {});
    return subscribeRiderLocation(order.id, setRider);
  }, [order]);
  if (!order) return null;
  return (
    <div className="modal d-block" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-xl modal-dialog-centered">
        <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="tracking-title">
          <div className="modal-header"><div><small>{order.id}</small><h5 className="modal-title" id="tracking-title">{statusLabel(order.status)}</h5></div><button className="btn-close" aria-label="Close tracking" onClick={onClose} /></div>
          <div className="modal-body p-0"><Suspense fallback={<SectionLoader label="Loading delivery map..." />}><DeliveryMap rider={rider} /></Suspense></div>
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

  useEffect(() => subscribeSupportMessages((supportMessages) => {
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
  }, user.uid), [user.uid]);

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
  const [notifications, setNotifications] = useState([]);
  const [cart, setCart] = useState([]);
  const [view, setView] = useState("store");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [trackingOrder, setTrackingOrder] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [serviceStatus, setServiceStatus] = useState({ firebase: firebaseEnabled, socket: false, openai: false, dialogflow: false, paymongo: false, twilio: false });
  const previousOrderCount = useRef(0);
  const activeUser = user?.mfaVerified ? user : null;

  useEffect(() => observeAuth(setUser), []);
  useEffect(() => {
    if (!activeUser) {
      setProfile(null);
      return undefined;
    }
    return subscribeUserProfile(activeUser, setProfile);
  }, [activeUser]);
  useEffect(() => subscribeMenu(fallbackMenu, setMenu), []);
  useEffect(() => {
    if (!activeUser || !["owner", "staff"].includes(activeUser.role)) {
      setInventory(menu.map((item) => ({ ...item, reorderPoint: item.reorderPoint ?? 10 })));
      return undefined;
    }
    return subscribeInventory(menu, setInventory);
  }, [menu, activeUser]);
  useEffect(() => subscribeOrders(activeUser, (nextOrders) => {
    if (activeUser?.role === "rider" && nextOrders.length > previousOrderCount.current) navigator.vibrate?.([150, 80, 150]);
    previousOrderCount.current = nextOrders.length;
    setOrders(nextOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }), [activeUser]);
  useEffect(() => {
    if (activeUser?.role !== "owner") {
      setAuditLogs([]);
      return undefined;
    }
    return subscribeAuditLogs(setAuditLogs);
  }, [activeUser]);
  useEffect(() => {
    if (!activeUser || !["owner", "staff"].includes(activeUser.role)) {
      setShiftLogs([]);
      return undefined;
    }
    return subscribeShiftLogs(setShiftLogs);
  }, [activeUser]);
  useEffect(() => {
    if (activeUser?.role !== "staff") {
      setSupportMessages([]);
      return undefined;
    }
    return subscribeSupportMessages(setSupportMessages);
  }, [activeUser]);
  useEffect(() => {
    if (!activeUser) {
      setNotifications([]);
      return undefined;
    }
    return subscribeNotifications(activeUser, setNotifications);
  }, [activeUser]);
  useEffect(() => {
    if (!activeUser || !["customer", "owner", "staff"].includes(activeUser.role)) {
      setReviews([]);
      return undefined;
    }
    return subscribeReviews(activeUser, setReviews);
  }, [activeUser]);
  useEffect(() => {
    if (activeUser) setView(defaultViewForRole(activeUser.role));
  }, [activeUser]);
  useEffect(() => {
    api.status().then((result) => setServiceStatus((current) => ({ ...current, ...result.services }))).catch(() => {});
  }, []);
  useEffect(() => {
    if (!activeUser) {
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
  }, [activeUser]);
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

  const currentUser = { ...user, name: profile?.name || user.name };
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const allowedViews = roleNavigation[user.role]?.map(([roleView]) => roleView) || [];
  const navigate = (nextView) => {
    if (allowedViews.includes(nextView)) setView(nextView);
  };
  const workspace = user.role === "owner"
    ? <OwnerWorkspace section={view} user={currentUser} orders={orders} inventory={inventory} reviews={reviews} serviceStatus={serviceStatus} auditLogs={auditLogs} shiftLogs={shiftLogs} notify={setNotice} />
    : user.role === "staff"
      ? <StaffWorkspace section={view} user={currentUser} orders={orders} inventory={inventory} reviews={reviews} shiftLogs={shiftLogs} messages={supportMessages} serviceStatus={serviceStatus} notify={setNotice} />
      : user.role === "rider"
        ? <RiderWorkspace section={view} user={currentUser} orders={orders} notify={setNotice} />
        : null;

  return (
    <div className="app-shell">
      <AppHeader user={currentUser} activeView={view} unreadCount={unreadCount} onNavigate={navigate} onNotifications={() => setNotificationsOpen(true)} />
      {user.role === "customer" && view === "store" && <Storefront menu={menu} cart={cart} setCart={setCart} onCheckout={() => setCheckoutOpen(true)} notify={setNotice} />}
      {user.role === "customer" && view === "orders" && (
        <Suspense fallback={<SectionLoader label="Loading customer section..." />}>
          <OrdersView orders={orders} onTrack={setTrackingOrder} isRevenueOrder={isRevenueOrder} />
        </Suspense>
      )}
      {user.role === "customer" && view === "receipts" && (
        <Suspense fallback={<SectionLoader label="Loading receipts..." />}>
          <ReceiptsView orders={orders} printReceipt={printReceipt} />
        </Suspense>
      )}
      {user.role === "customer" && view === "feedback" && (
        <Suspense fallback={<SectionLoader label="Loading feedback..." />}>
          <ReviewsView user={currentUser} orders={orders} reviews={reviews} notify={setNotice} />
        </Suspense>
      )}
      {user.role === "customer" && view === "profile" && (
        <Suspense fallback={<SectionLoader label="Loading profile..." />}>
          <CustomerProfile user={currentUser} profile={profile} notify={setNotice} />
        </Suspense>
      )}
      {user.role !== "customer" && workspace}
      {user.role === "customer" && checkoutOpen && (
        <Suspense fallback={<SectionLoader label="Opening checkout..." />}>
          <Checkout cart={cart} user={currentUser} profile={profile} paymongoEnabled={serviceStatus.paymongo} onClose={() => setCheckoutOpen(false)} notify={setNotice} onComplete={() => { setCart([]); setCheckoutOpen(false); setView("orders"); }} />
        </Suspense>
      )}
      {trackingOrder && <TrackingView order={trackingOrder} onClose={() => setTrackingOrder(null)} />}
      {user.role === "customer" && <Assistant user={currentUser} menu={menu.filter((item) => !item.walkInOnly)} />}
      {notificationsOpen && <NotificationCenter notifications={notifications} onClose={() => setNotificationsOpen(false)} />}
      {notice && <div className="app-toast" role="status" aria-live="polite" aria-atomic="true">{notice}</div>}
    </div>
  );
}
