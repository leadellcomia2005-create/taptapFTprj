import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { SectionLoader } from "../../components/Loaders";
import { securityMethodLabels, staffRoleLabels } from "../../config/appConfig";
import { api } from "../../services/api";
import { updateOrder } from "../../services/firebase";
import { bestSellers, forecastRunouts, peakOrderHours, slowMovingItems } from "../../utils/operations";
import { AdminCleanupModule, ApprovalQueueModule, ComplaintResolutionModule, InventoryModule, MenuManagementModule, OrderManagement, ReviewModerationModule, SettingsModule, ShiftLogsModule } from "./SharedWorkspaceModules";
import { buildDailyReport, buildLocalDecisionSupport, currency, isRevenueOrder, localDateInputValue, orderItemText, orderPaymentLabel, printOwnerDailyReport, setWorkspaceHelpers, statusLabel, sumByTotal } from "./workspaceHelpers";

const SalesChart = lazy(() => import("../../components/SalesChart"));

function OwnerWorkspaceContent({ section, user, orders, inventory, reviews, complaints = [], serviceStatus, auditLogs, shiftLogs, notify }) {
  const menu = inventory;
  const revenueOrders = orders.filter(isRevenueOrder);
  const totalSales = revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const estimatedProfit = totalSales * 0.58;
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
  const [salesGoal, setSalesGoal] = useState(100000);
  const [roleForm, setRoleForm] = useState({ uid: "", role: "staff", staffRole: "manager" });
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
      await api.assignRole(roleForm.uid, roleForm.role, roleForm.staffRole);
      notify(`User role updated to ${roleForm.role}${roleForm.role === "staff" ? ` / ${staffRoleLabels[roleForm.staffRole]}` : ""}.`);
      setRoleForm({ uid: "", role: "staff", staffRole: "manager" });
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
  const auditDetailText = (entry) => {
    if (entry.details?.before || entry.details?.after) {
      const before = Object.entries(entry.details.before || {}).map(([key, value]) => `${key}: ${value ?? "-"}`).join(", ");
      const after = Object.entries(entry.details.after || {}).map(([key, value]) => `${key}: ${value ?? "-"}`).join(", ");
      return [before && `Before ${before}`, after && `After ${after}`].filter(Boolean).join(" | ") || "-";
    }
    return entry.status || entry.reason || (entry.quantity ? `Quantity ${entry.quantity}` : "-");
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
      <div className="col-12"><div className="dashboard-card"><h3>User accounts and security</h3><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Staff scope</th><th>Security</th><th>Security controls</th></tr></thead><tbody>{managedUsers.length === 0 && <tr><td colSpan="6" className="text-center text-secondary py-4">No users found.</td></tr>}{managedUsers.map((account) => <tr key={account.uid}><td><strong>{account.name}</strong><small className="d-block text-secondary">{account.uid}</small></td><td>{account.email}</td><td><span className="role-badge">{account.role}</span></td><td>{account.role === "staff" ? staffRoleLabels[account.staffRole] || "Manager" : "-"}</td><td><span className={`stock-badge ${account.twoFactorEnabled && !account.twoFactorLocked ? "healthy" : "low"}`}>{account.twoFactorLocked ? "Locked" : account.twoFactorEnabled ? `${securityMethodLabels[account.twoFactorMethod] || "Security"} enabled` : "Not set up"}</span></td><td><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-danger" onClick={() => securityAction(account.uid, "reset")}>Reset security</button>{account.twoFactorLocked && <button className="btn btn-sm btn-dark" onClick={() => securityAction(account.uid, "unlock")}>Unlock</button>}</div></td></tr>)}</tbody></table></div></div></div>
      <div className="col-xl-6"><form className="dashboard-card" onSubmit={updateRole}><h3>Assign user role</h3><p className="module-note">Enter the user account ID and choose the role.</p><label className="form-label">Account ID<input className="form-control" required value={roleForm.uid} onChange={(event) => setRoleForm((current) => ({ ...current, uid: event.target.value }))} /></label><label className="form-label">Role<select className="form-select" value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))}><option>owner</option><option>staff</option><option>rider</option><option>customer</option></select></label>{roleForm.role === "staff" && <label className="form-label">Staff access scope<select className="form-select" value={roleForm.staffRole} onChange={(event) => setRoleForm((current) => ({ ...current, staffRole: event.target.value }))}>{Object.entries(staffRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<button className="btn btn-danger w-100 mt-3">Update role</button></form></div>
      <div className="col-xl-6"><form className="dashboard-card" onSubmit={sendAdminMessage}><h3>Private admin notification</h3><label className="form-label">Recipient<select className="form-select" required value={adminMessage.uid} onChange={(event) => setAdminMessage((current) => ({ ...current, uid: event.target.value }))}><option value="">Select a user</option>{managedUsers.map((account) => <option key={account.uid} value={account.uid}>{account.name} ({account.role})</option>)}</select></label><label className="form-label">Title<input className="form-control" required value={adminMessage.title} onChange={(event) => setAdminMessage((current) => ({ ...current, title: event.target.value }))} /></label><label className="form-label">Message<textarea className="form-control" required maxLength="1000" rows="3" value={adminMessage.message} onChange={(event) => setAdminMessage((current) => ({ ...current, message: event.target.value }))} /></label><button className="btn btn-dark w-100 mt-3">Send only to this user</button></form></div>
    </div></main>
  );
  if (section === "owner-reviews") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Customer voice</p><h2>Reviews & Complaints</h2></div></div><div className="row g-3"><div className="col-12"><ComplaintResolutionModule complaints={complaints} user={user} notify={notify} /></div><div className="col-12"><ReviewModerationModule reviews={reviews} user={user} notify={notify} /></div></div></main>;
  if (section === "owner-audit") return (
    <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Accountability and integrity</p><h2>Audit Logs</h2></div></div><div className="dashboard-card"><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Record</th><th>Details</th></tr></thead><tbody>{auditLogs.length === 0 && <tr><td colSpan="5" className="text-center text-secondary py-5">Actions will appear here as orders, stock and shifts are updated.</td></tr>}{auditLogs.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("en-PH")}</td><td>{entry.action?.replaceAll("_", " ")}</td><td>{entry.actorName || "System"}</td><td>{entry.orderId || entry.itemName || entry.shiftLogId || entry.approvalId || "-"}</td><td>{auditDetailText(entry)}</td></tr>)}</tbody></table></div></div></main>
  );
  if (section === "owner-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Business administration</p><h2>System Settings</h2></div></div><div className="row g-3"><div className="col-12"><SettingsModule title="Payments, notifications and system controls" serviceStatus={serviceStatus} notify={notify} /></div><div className="col-12"><ApprovalQueueModule user={user} notify={notify} /></div><div className="col-12"><AdminCleanupModule user={user} orders={orders} notify={notify} /></div></div></main>;
  return (
    <main className="container-fluid dashboard-page owner-listing-page">
      <section className="owner-listing-hero">
        <div>
          <p className="eyebrow">Super Admin / Owner</p>
          <h2>TapTap FoodTrip control center</h2>
          <p>Track sales, listing readiness, stock health, and today&apos;s order movement from one owner view.</p>
        </div>
        <button className="btn btn-outline-dark" onClick={printDailyReport}>Print daily report</button>
      </section>

      <section className="owner-listing-grid">
        <article className="owner-listing-card">
          <div className="owner-listing-cover">
            <span>Open</span>
          </div>
          <div className="owner-listing-body">
            <p className="eyebrow text-danger">Restaurant listing</p>
            <h3>TapTap FoodTrip</h3>
            <p>Traditional Pinoy tapsilog, alacarte, drinks, and special meals.</p>
            <div className="owner-listing-stats">
              <span><strong>{menu.length}</strong> menu items</span>
              <span><strong>{orders.length}</strong> orders</span>
              <span><strong>{Object.values(serviceStatus || {}).filter(Boolean).length}</strong> ready tools</span>
            </div>
          </div>
        </article>

        <div className="owner-stat-grid">
          <div className="metric-card owner-metric-card"><small>Gross sales</small><strong>{currency(totalSales)}</strong><span>Paid transactions</span></div>
          <div className="metric-card owner-metric-card"><small>Profit estimate</small><strong>{currency(estimatedProfit)}</strong><span>After estimated food and ops cost</span></div>
          <div className="metric-card owner-metric-card"><small>Awaiting action</small><strong>{orders.filter((order) => !["delivered", "cancelled", "pending-payment"].includes(order.status)).length}</strong><span>Live workload</span></div>
          <div className="metric-card owner-metric-card"><small>Low stock</small><strong>{inventory.filter((item) => item.stock <= item.reorderPoint).length}</strong><span>Needs attention</span></div>
        </div>
      </section>

      <section className="owner-panel-grid">
        <div className="dashboard-card chart-card owner-chart-card">
          <div className="module-heading">
            <div><p className="eyebrow text-danger">Sales performance</p><h3>Weekly revenue</h3></div>
            <span className="shift-chip">{Math.min(100, Math.round(totalSales / salesGoal * 100))}% goal</span>
          </div>
          <Suspense fallback={<SectionLoader label="Loading sales chart..." />}><SalesChart values={salesTrend} /></Suspense>
        </div>
        <div className="dashboard-card ai-insight owner-decision-card">
          <p className="eyebrow">{serviceStatus?.openai ? "Business insight" : "Free business insight"}</p>
          <h3>Decision support</h3>
          <p>{insight}</p>
          <button className="btn btn-warning w-100" onClick={generateInsight}>{serviceStatus?.openai ? "Generate business summary" : "Generate free summary"}</button>
        </div>
        <div className="owner-listing-orders"><OrderManagement orders={orders.slice(0, 5)} canAdvance notify={notify} /></div>
        <div className="dashboard-card owner-stock-panel">
          <div className="module-heading"><div><p className="eyebrow text-danger">Inventory watch</p><h3>Low-stock alerts</h3></div></div>
          {inventory.filter((item) => item.stock <= item.reorderPoint).slice(0, 6).map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>Reorder point: {item.reorderPoint}</small></span><b>{item.stock}</b></div>)}
          {inventory.every((item) => item.stock > item.reorderPoint) && <p className="text-secondary small">All products are above their reorder points.</p>}
        </div>
        <div className="dashboard-card"><h3>Best sellers</h3>{bestSellerRows.length === 0 && <div className="empty-chat">Sales will appear here.</div>}{bestSellerRows.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{item.qty} sold</small></span><b>{currency(item.sales)}</b></div>)}</div>
        <div className="dashboard-card"><h3>Slow-moving items</h3>{slowMovingRows.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{item.qty} sold, {item.stock} in stock</small></span><b>{item.qty}</b></div>)}</div>
        <div className="dashboard-card"><h3>Peak order hours</h3>{peakHours.length === 0 && <div className="empty-chat">No order hour data yet.</div>}{peakHours.map((hour) => <div className="alert-row" key={hour.hour}><span><strong>{hour.label}</strong><small>High order volume</small></span><b>{hour.count}</b></div>)}</div>
        <div className="dashboard-card"><h3>Inventory forecast</h3>{runoutForecast.length === 0 && <div className="empty-chat">Forecast appears after recent sales.</div>}{runoutForecast.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{item.dailyVelocity.toFixed(1)} sold/day</small></span><b>{item.daysLeft.toFixed(1)}d</b></div>)}</div>
        <div className="dashboard-card"><h3>Staff shift performance</h3>{shiftPerformance.length === 0 && <div className="empty-chat">Closed shifts will appear here.</div>}{shiftPerformance.map((shift) => <div className="alert-row" key={shift.id}><span><strong>{shift.staffName}</strong><small>{shift.orderCount} orders - variance {currency(shift.variance)}</small></span><b>{currency(shift.cashSales || shift.expectedCash)}</b></div>)}</div>
      </section>
    </main>
  );
}

export default function OwnerWorkspace({ helpers, ...props }) {
  setWorkspaceHelpers(helpers);
  return <OwnerWorkspaceContent {...props} />;
}
