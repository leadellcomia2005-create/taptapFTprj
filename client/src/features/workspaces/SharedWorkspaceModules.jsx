import { useCallback, useEffect, useMemo, useState } from "react";
import { ServiceBadge } from "../../components/Branding";
import { menuCategoryOptions } from "../../config/appConfig";
import { api } from "../../services/api";
import { getDeliveryProof } from "../../services/firebase/delivery";
import { moderateReview, updateComplaintStatus } from "../../services/firebase/feedback";
import { adjustInventory } from "../../services/firebase/inventory";
import { createMenuItem, updateMenuItem } from "../../services/firebase/menu";
import { archiveCompletedOrders, closeActiveShift, createApprovalRequest, resolveApprovalRequest, sendSupportMessage, startShift, subscribeApprovalRequests } from "../../services/firebase/operations";
import { updateOrder } from "../../services/firebase/orders";
import { orderPrepClock } from "../../utils/operations";
import { currency, isRevenueOrder, orderItemText, orderPaymentLabel, statusLabel } from "./workspaceHelpers";

export function ReviewModerationModule({ reviews, user, notify }) {
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

const complaintTypeLabels = {
  "wrong-item": "Wrong item",
  "missing-item": "Missing item",
  "late-order": "Late order",
  "bad-food": "Bad food"
};

const scheduleDays = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"]
];

const isDeliveryOrder = (order) => order?.deliveryType === "delivery";

const orderTypeLabel = (order) => {
  if (order.deliveryType === "delivery") return "Delivery";
  if (order.deliveryType === "pickup") return "Pickup";
  if (order.deliveryType === "walk-in" && order.diningOption === "takeout") return "Takeout";
  if (order.deliveryType === "walk-in" && order.diningOption === "dine-in") return "Dine-in";
  if (order.deliveryType === "walk-in") return "Walk-in";
  return order.diningOption || "Order";
};

const nextStaffStatus = (order) => {
  if (isDeliveryOrder(order)) {
    return ({ received: "preparing", preparing: "ready" })[order.status] || "";
  }
  return ({ received: "preparing", preparing: "ready", ready: "completed" })[order.status] || "";
};

const downloadCsv = (filename, rows) => {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export function ComplaintResolutionModule({ complaints = [], user, notify }) {
  const [drafts, setDrafts] = useState({});
  const grouped = {
    pending: complaints.filter((complaint) => (complaint.status || "pending") === "pending"),
    reviewed: complaints.filter((complaint) => complaint.status === "reviewed"),
    resolved: complaints.filter((complaint) => complaint.status === "resolved")
  };
  const updateDraft = (complaint, field, value) => setDrafts((current) => ({
    ...current,
    [complaint.id]: { status: complaint.status || "pending", resolution: complaint.resolution || "", ...(current[complaint.id] || {}), [field]: value }
  }));
  const save = async (complaint, status = null) => {
    const draft = { status: complaint.status || "pending", resolution: complaint.resolution || "", ...(drafts[complaint.id] || {}) };
    await updateComplaintStatus(complaint.id, {
      status: status || draft.status,
      resolution: draft.resolution
    }, user);
    notify(`${complaint.orderId} complaint marked ${status || draft.status}.`);
  };
  return (
    <div className="dashboard-card complaint-module">
      <div className="module-heading">
        <div><p className="eyebrow text-danger">Customer care</p><h3>Order returns and complaints</h3></div>
        <span className="module-note">{grouped.pending.length} pending, {grouped.reviewed.length} reviewed, {grouped.resolved.length} resolved</span>
      </div>
      <div className="complaint-list">
        {complaints.length === 0 && <div className="empty-chat">No order complaints yet.</div>}
        {complaints.map((complaint) => {
          const draft = { status: complaint.status || "pending", resolution: complaint.resolution || "", ...(drafts[complaint.id] || {}) };
          return (
            <article className="complaint-card" key={complaint.id}>
              <div>
                <strong>{complaint.orderId} - {complaintTypeLabels[complaint.type] || complaint.type}</strong>
                <small>{complaint.customerName} - {(complaint.items || []).join(", ")}</small>
                <p>{complaint.details}</p>
                {complaint.requestedResolution && <em>Requested: {complaint.requestedResolution}</em>}
              </div>
              <label className="form-label">Status<select className="form-select form-select-sm" value={draft.status} onChange={(event) => updateDraft(complaint, "status", event.target.value)}><option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></label>
              <label className="form-label">Resolution<textarea className="form-control" rows="2" value={draft.resolution} onChange={(event) => updateDraft(complaint, "resolution", event.target.value)} placeholder="Replacement, refund review, staff note..." /></label>
              <div className="review-actions">
                <button className="btn btn-sm btn-outline-dark" onClick={() => save(complaint, "reviewed")}>Mark reviewed</button>
                <button className="btn btn-sm btn-success" onClick={() => save(complaint, "resolved")}>Resolve</button>
                <button className="btn btn-sm btn-danger" onClick={() => save(complaint)}>Save</button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function InventoryModule({ inventory, user, notify }) {
  const [drafts, setDrafts] = useState({});
  const lowStockCount = inventory.filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0)).length;
  const updateDraft = (id, field, value) => setDrafts((current) => ({
    ...current,
    [id]: { quantity: 1, reason: "New delivery", countedStock: "", ...(current[id] || {}), [field]: value }
  }));
  const applyAdjustment = async (item, direction) => {
    const draft = { quantity: 1, reason: direction > 0 ? "New delivery" : "Wastage", ...(drafts[item.id] || {}) };
    const quantity = Math.max(1, Number(draft.quantity || 1)) * direction;
    await adjustInventory(item, quantity, draft.reason, user);
    notify(`${item.name} stock ${direction > 0 ? "received" : "adjusted"} by ${Math.abs(quantity)}.`);
  };
  const requestCountApproval = async (item) => {
    const draft = { countedStock: item.stock, ...(drafts[item.id] || {}) };
    const countedStock = Number(draft.countedStock);
    if (!Number.isInteger(countedStock) || countedStock < 0) {
      notify("Enter a valid counted stock number.");
      return;
    }
    await createApprovalRequest({
      type: "stock_correction",
      targetId: item.id,
      reason: `Daily stock audit for ${item.name}`,
      payload: { itemId: item.id, countedStock }
    }, user);
    notify(`${item.name} stock count sent for owner approval.`);
  };
  return (
    <div className="dashboard-card">
      <div className="module-heading">
        <div><p className="eyebrow text-danger">Menu item stock control</p><h3>Inventory levels and adjustments</h3></div>
        <span className="module-note">{lowStockCount} low-stock item(s). Daily count corrections go to owner approval.</span>
      </div>
      <div className="inventory-guardrail">
        <strong>Inventory control</strong>
        <span>Use Receive/Deduct for normal movement. Use Request count for physical count corrections, shortages, or major stock fixes.</span>
      </div>
      <div className="table-responsive" tabIndex="0">
        <table className="table align-middle inventory-table">
          <thead><tr><th>Product</th><th>Current stock</th><th>Reorder point</th><th>Status</th><th>Quantity</th><th>Reason</th><th>Daily count</th><th>Action</th></tr></thead>
          <tbody>{inventory.map((item) => {
            const lowStock = item.stock <= item.reorderPoint;
            const draft = drafts[item.id] || { quantity: 1, reason: "New delivery", countedStock: "" };
            return (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><small>{item.category}</small>{item.lastAdjustedAt && <small>Last movement: {new Date(item.lastAdjustedAt).toLocaleString("en-PH")}</small>}</td>
                <td>{item.stock}</td>
                <td>{item.reorderPoint}</td>
                <td><span className={`stock-badge ${lowStock ? "low" : "healthy"}`}>{lowStock ? "Low stock" : "Healthy"}</span></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" inputMode="numeric" min="1" value={draft.quantity} onChange={(event) => updateDraft(item.id, "quantity", event.target.value)} /></td>
                <td><select className="form-select form-select-sm" value={draft.reason} onChange={(event) => updateDraft(item.id, "reason", event.target.value)}><option>New delivery</option><option>Physical count correction</option><option>Wastage</option><option>Spoilage</option><option>Staff meal</option></select></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" inputMode="numeric" min="0" placeholder={String(item.stock)} value={draft.countedStock} onChange={(event) => updateDraft(item.id, "countedStock", event.target.value)} /></td>
                <td><div className="d-flex flex-wrap gap-1"><button className="btn btn-sm btn-success" onClick={() => applyAdjustment(item, 1)}>Receive</button><button className="btn btn-sm btn-outline-danger" onClick={() => applyAdjustment(item, -1)}>Deduct</button><button className="btn btn-sm btn-dark" onClick={() => requestCountApproval(item)}>Request count</button></div></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

export function MenuManagementModule({ inventory, user, notify }) {
  const blankItem = {
    name: "",
    category: "Favorite Meal",
    description: "Menu item.",
    price: 0,
    stock: 0,
    reorderPoint: 10,
    availability: { mode: "always", days: [], start: "00:00", end: "23:59" },
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
    availability: {
      mode: item.availability?.mode || "always",
      days: Array.isArray(item.availability?.days) ? item.availability.days : [],
      start: item.availability?.start || "00:00",
      end: item.availability?.end || "23:59"
    },
    unavailable: Boolean(item.unavailable),
    walkInOnly: Boolean(item.walkInOnly),
    featured: Boolean(item.featured)
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
      availability: draft.availability,
      unavailable: Boolean(draft.unavailable),
      walkInOnly: Boolean(draft.walkInOnly),
      featured: Boolean(draft.featured)
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
  const updateAvailability = (item, field, value) => updateDraft(item, "availability", {
    ...(drafts[item.id]?.availability || draftFor(item).availability),
    [field]: value
  });
  const updateNewAvailability = (field, value) => setNewItem((current) => ({
    ...current,
    availability: { ...(current.availability || blankItem.availability), [field]: value }
  }));
  const toggleDay = (item, day) => {
    const availability = drafts[item.id]?.availability || draftFor(item).availability;
    const days = availability.days.includes(day) ? availability.days.filter((value) => value !== day) : [...availability.days, day];
    updateAvailability(item, "days", days);
  };
  const toggleNewDay = (day) => {
    const days = newItem.availability.days.includes(day) ? newItem.availability.days.filter((value) => value !== day) : [...newItem.availability.days, day];
    updateNewAvailability("days", days);
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
            <label className="form-label col-md-3">Availability<select className="form-select" value={newItem.availability.mode} onChange={(event) => updateNewAvailability("mode", event.target.value)}><option value="always">Always</option><option value="schedule">Scheduled</option></select></label>
            <label className="form-label col-md-2">From<input className="form-control" type="time" value={newItem.availability.start} onChange={(event) => updateNewAvailability("start", event.target.value)} /></label>
            <label className="form-label col-md-2">Until<input className="form-control" type="time" value={newItem.availability.end} onChange={(event) => updateNewAvailability("end", event.target.value)} /></label>
            <div className="col-md-5 availability-days">{scheduleDays.map(([day, label]) => <label key={day}><input type="checkbox" checked={newItem.availability.days.includes(day)} onChange={() => toggleNewDay(day)} /> {label}</label>)}</div>
          </div>
        </form>
      )}
      <div className="table-responsive" tabIndex="0">
        <table className="table align-middle menu-admin-table">
          <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Reorder</th><th>Schedule</th><th>Visible</th><th>Walk-in only</th><th /></tr></thead>
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
                <td className="menu-schedule-cell"><select className="form-select form-select-sm" value={draft.availability.mode} onChange={(event) => updateAvailability(item, "mode", event.target.value)}><option value="always">Always</option><option value="schedule">Scheduled</option></select><div className="schedule-time-row"><input className="form-control form-control-sm" type="time" value={draft.availability.start} onChange={(event) => updateAvailability(item, "start", event.target.value)} /><input className="form-control form-control-sm" type="time" value={draft.availability.end} onChange={(event) => updateAvailability(item, "end", event.target.value)} /></div><div className="availability-days compact">{scheduleDays.map(([day, label]) => <label key={day}><input type="checkbox" checked={draft.availability.days.includes(day)} onChange={() => toggleDay(item, day)} /> {label}</label>)}</div></td>
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

export function ShiftLogsModule({ orders, logs, user, notify, readOnly = false, activeShift = null, onShiftChange = () => {} }) {
  const [openingCash, setOpeningCash] = useState(2000);
  const [cashIn, setCashIn] = useState(0);
  const [cashOut, setCashOut] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [shiftNotes, setShiftNotes] = useState("");
  const [visibleLogCount, setVisibleLogCount] = useState(20);
  const visibleLogs = logs.slice(0, visibleLogCount);
  const shiftStartedAt = Number(activeShift?.startedAt || 0);
  const shiftOrders = orders.filter((order) => Number(order.createdAt || 0) >= shiftStartedAt && Number(order.createdAt || 0) <= Date.now());
  const cashSales = shiftOrders
    .filter((order) => order.paymentMethod === "cash" || (order.paymentMethod === "cod" && isRevenueOrder(order)))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const expectedCash = Number(activeShift?.openingCash || openingCash || 0) + cashSales + Number(cashIn || 0) - Number(cashOut || 0) - Number(expenses || 0);
  const variance = Number(actualCash || 0) - expectedCash;
  const beginShift = async () => {
    const result = await startShift({ openingCash: Number(openingCash || 0), notes: shiftNotes }, user);
    onShiftChange(result.shift);
    setShiftNotes("");
    notify("Shift opened. POS is now available for walk-in orders.");
  };
  const closeShift = async () => {
    if (!activeShift) {
      notify("Start a shift before closing.");
      return;
    }
    const result = await closeActiveShift({
      cashIn: Number(cashIn),
      cashOut: Number(cashOut),
      expenses: Number(expenses),
      actualCash: Number(actualCash),
      notes: shiftNotes
    }, user);
    onShiftChange(null);
    notify(`Shift ${result.id} closed and sent for owner reconciliation.`);
    setShiftNotes("");
    setCashIn(0);
    setCashOut(0);
    setExpenses(0);
    setActualCash(0);
  };
  return (
    <div className="row g-3">
      {!readOnly && <div className="col-xl-5">
        <div className="dashboard-card">
          <p className="eyebrow text-danger">{activeShift ? "End-of-shift reconciliation" : "Shift start"}</p>
          <h3>{activeShift ? "Close current shift" : "Open current shift"}</h3>
          <p className="module-note">{activeShift ? `Counting ${shiftOrders.length} order(s) since ${new Date(shiftStartedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}.` : "Open a shift before using the walk-in POS."}</p>
          <label className="form-label">Opening cash<input className="form-control" type="number" disabled={Boolean(activeShift)} value={activeShift?.openingCash ?? openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
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
          {activeShift
            ? <button className="btn btn-danger w-100" onClick={closeShift}>Close shift and save log</button>
            : <button className="btn btn-danger w-100" onClick={beginShift}>Start shift</button>}
        </div>
      </div>}
      <div className={readOnly ? "col-12" : "col-xl-7"}>
        <div className="dashboard-card">
          <h3>{readOnly ? "Staff shift reconciliation history" : "Shift history"}</h3>
          <div className="table-responsive" tabIndex="0"><table className="table align-middle"><thead><tr><th>Staff</th><th>Closed</th><th>Orders</th><th>Movements</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Notes</th></tr></thead><tbody>
            {logs.length === 0 && <tr><td colSpan="8" className="text-center text-secondary py-4">No closed shifts yet.</td></tr>}
            {visibleLogs.map((log) => <tr key={log.id}><td>{log.staffName}</td><td>{new Date(log.endedAt || log.createdAt).toLocaleString("en-PH")}</td><td>{log.orderCount}</td><td>{currency(Number(log.cashIn || 0) - Number(log.cashOut || 0) - Number(log.expenses || 0))}</td><td>{currency(log.expectedCash)}</td><td>{currency(log.actualCash)}</td><td>{currency(log.variance)}</td><td>{log.notes || "-"}</td></tr>)}
          </tbody></table></div>
          {logs.length > visibleLogCount && <button className="btn btn-outline-dark mt-3" type="button" onClick={() => setVisibleLogCount((count) => count + 20)}>Load more shift logs</button>}
        </div>
      </div>
    </div>
  );
}

export function SupportChat({ messages, user, notify }) {
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

export function ApprovalQueueModule({ user, notify }) {
  const [requests, setRequests] = useState([]);
  useEffect(() => subscribeApprovalRequests(user, setRequests), [user]);
  const decide = async (request, decision) => {
    await resolveApprovalRequest(request.id, decision, user);
    setRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: decision } : item));
    notify(`Approval request ${decision}.`);
  };
  return (
    <div className="dashboard-card">
      <div className="module-heading">
        <div><p className="eyebrow text-danger">Owner approval flow</p><h3>Sensitive action requests</h3></div>
        <span className="module-note">Stock counts, voids, menu changes, and role requests appear here.</span>
      </div>
      <div className="table-responsive" tabIndex="0">
        <table className="table align-middle">
          <thead><tr><th>Request</th><th>Requester</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>
            {requests.length === 0 && <tr><td colSpan="5" className="text-center text-secondary py-4">No approval requests yet.</td></tr>}
            {requests.map((request) => (
              <tr key={request.id}>
                <td><strong>{String(request.type || "request").replaceAll("_", " ")}</strong><small className="d-block text-secondary">{request.targetId || request.id}</small></td>
                <td>{request.requesterName || "Staff"}<small className="d-block text-secondary">{request.requesterRole}</small></td>
                <td>{request.reason || "-"}</td>
                <td><span className={`stock-badge ${request.status === "pending" ? "low" : "healthy"}`}>{request.status}</span></td>
                <td>{user.role === "owner" && request.status === "pending" && <div className="d-flex gap-1"><button className="btn btn-sm btn-success" onClick={() => decide(request, "approved")}>Approve</button><button className="btn btn-sm btn-outline-danger" onClick={() => decide(request, "rejected")}>Reject</button></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminCleanupModule({ user, orders, inventory = [], auditLogs = [], shiftLogs = [], notify }) {
  const [olderThanDays, setOlderThanDays] = useState(30);
  const exportOrdersCsv = () => {
    downloadCsv(`taptap-orders-${Date.now()}.csv`, [
      ["Order", "Customer", "Status", "Payment", "Total", "Created"],
      ...orders.map((order) => [order.id, order.customerName || "", order.status || "", order.paymentMethod || "", Number(order.total || 0), order.createdAt ? new Date(order.createdAt).toLocaleString("en-PH") : ""])
    ]);
    notify("Orders CSV exported.");
  };
  const exportInventoryCsv = () => {
    downloadCsv(`taptap-inventory-${Date.now()}.csv`, [
      ["Item", "Category", "Price", "Stock", "Reorder point", "Unavailable", "Walk-in only"],
      ...inventory.map((item) => [item.name, item.category, Number(item.price || 0), Number(item.stock || 0), Number(item.reorderPoint || 0), item.unavailable ? "Yes" : "No", item.walkInOnly ? "Yes" : "No"])
    ]);
    notify("Inventory CSV exported.");
  };
  const exportProofIndexCsv = () => {
    downloadCsv(`taptap-proof-index-${Date.now()}.csv`, [
      ["Order", "Customer", "Status", "Rider", "Captured", "Storage", "Quality warning"],
      ...orders.filter((order) => order.proofOfDeliveryRef || order.proofOfDeliveryUrl || order.proofOfDeliveryMeta).map((order) => [
        order.id,
        order.customerName || "",
        order.status || "",
        order.riderName || order.riderId || "",
        order.proofOfDeliveryMeta?.capturedAt ? new Date(order.proofOfDeliveryMeta.capturedAt).toLocaleString("en-PH") : "",
        order.proofOfDeliveryRef || order.proofOfDeliveryUrl || "",
        order.proofOfDeliveryMeta?.photoQualityWarning || ""
      ])
    ]);
    notify("Delivery proof index exported.");
  };
  const exportAuditCsv = () => {
    downloadCsv(`taptap-audit-log-${Date.now()}.csv`, [
      ["Time", "Action", "Actor", "Role", "Record", "Reason"],
      ...auditLogs.map((entry) => [entry.createdAt ? new Date(entry.createdAt).toLocaleString("en-PH") : "", entry.action || "", entry.actorName || "", entry.actorRole || "", entry.orderId || entry.itemName || entry.shiftLogId || entry.approvalId || "", entry.reason || entry.status || ""])
    ]);
    notify("Audit log CSV exported.");
  };
  const exportShiftCsv = () => {
    downloadCsv(`taptap-shift-logs-${Date.now()}.csv`, [
      ["Staff", "Started", "Closed", "Opening cash", "Cash sales", "Expected", "Actual", "Variance", "Notes"],
      ...shiftLogs.map((log) => [log.staffName || "Staff", log.startedAt ? new Date(log.startedAt).toLocaleString("en-PH") : "", log.endedAt ? new Date(log.endedAt).toLocaleString("en-PH") : "", Number(log.openingCash || 0), Number(log.cashSales || 0), Number(log.expectedCash || 0), Number(log.actualCash || 0), Number(log.variance || 0), log.notes || ""])
    ]);
    notify("Shift logs CSV exported.");
  };
  const archive = async () => {
    const result = await archiveCompletedOrders(olderThanDays, user);
    notify(`${result.archived || 0} old completed/cancelled order(s) archived. ${result.proofsPreserved || 0} proof record(s) preserved.`);
  };
  return (
    <div className="dashboard-card">
      <div className="module-heading">
        <div><p className="eyebrow text-danger">Data cleanup</p><h3>Export and archive tools</h3></div>
        <span className="module-note">Exports exclude passwords and app secrets. Delivery proof records are preserved when orders are archived.</span>
      </div>
      <div className="backup-export-grid">
        <button className="btn btn-outline-dark" onClick={exportOrdersCsv}>Export orders</button>
        <button className="btn btn-outline-dark" onClick={exportInventoryCsv}>Export inventory</button>
        <button className="btn btn-outline-dark" onClick={exportProofIndexCsv}>Export proof index</button>
        <button className="btn btn-outline-dark" onClick={exportAuditCsv}>Export audit logs</button>
        <button className="btn btn-outline-dark" onClick={exportShiftCsv}>Export shift logs</button>
      </div>
      <div className="row g-2 align-items-end mt-2">
        <label className="form-label col-md-4">Archive completed/cancelled older than<input className="form-control" type="number" min="1" max="365" value={olderThanDays} onChange={(event) => setOlderThanDays(event.target.value)} /></label>
        <div className="col-md-8 d-flex flex-wrap gap-2"><button className="btn btn-danger" onClick={archive}>Archive old orders</button></div>
      </div>
    </div>
  );
}

export function SettingsModule({ title, serviceStatus, staff = false, notify }) {
  const [settings, setSettings] = useState({
    gcash: true,
    cod: true,
    sms: true,
    lowStockAlerts: true,
    autoPrint: staff,
    emailReceipts: staff
  });
  const toggle = (key) => setSettings((current) => ({ ...current, [key]: !current[key] }));
  const readinessRows = [
    { key: "firebase", label: "Account and records connection", detail: "Required for secure accounts and records.", fix: "Restart the app server and confirm the store account service credentials are available.", required: true },
    { key: "emailOtp", label: "Email sending", detail: "Used for email codes, verification, and receipts.", fix: "Add the Gmail sender account and app password, then restart the app server.", required: true },
    { key: "turnstile", label: "Registration protection", detail: "Protects customer registration from automated abuse.", fix: "Add the public site key and secret key, then restart the app server.", required: true },
    { key: "twilio", label: "SMS provider", detail: "Optional phone texts for verified customers.", fix: "Connect an SMS sender before enabling paid text updates.", optional: true },
    { key: "paymongo", label: "Online payments", detail: "Optional online payment checkout.", fix: "Add payment credentials when online checkout is ready to launch.", optional: true },
    { key: "openai", label: "Owner recommendations", detail: "Optional owner decision support.", fix: "Add an AI key only when owner recommendation summaries are needed.", optional: true }
  ].map((item) => {
    const ready = Boolean(serviceStatus?.[item.key]);
    const status = ready ? "Ready" : item.optional ? "Optional" : "Needs attention";
    return { ...item, ready, status, tone: ready ? "ready" : item.optional ? "optional" : "attention" };
  });
  return (
    <div className="row g-3">
      <div className="col-xl-7"><div className="dashboard-card settings-card"><p className="eyebrow text-danger">Preferences</p><h3>{title}</h3>
        {Object.entries(settings).map(([key, enabled]) => <label className="setting-row" key={key}><span><strong>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</strong><small>{staff ? "Staff workstation preference" : "Business-wide operational setting"}</small></span><input type="checkbox" checked={enabled} onChange={() => toggle(key)} /></label>)}
        <button className="btn btn-danger mt-3" onClick={() => notify("Settings saved for this session.")}>Save settings</button>
      </div></div>
      <div className="col-xl-5"><div className="dashboard-card">
        <h3>{staff ? "App features" : "Security readiness"}</h3>
        {!staff && <div className="security-readiness-list">
          {readinessRows.map((item) => (
            <article className="security-readiness-row" key={item.key}>
              <span className={`readiness-dot ${item.tone}`} />
              <div><strong>{item.label}</strong><small>{item.detail}</small>{!item.ready && <small className="readiness-fix"><b>How to fix:</b> {item.fix}</small>}</div>
              <b className={item.tone}>{item.status}</b>
            </article>
          ))}
        </div>}
        <div className={staff ? "" : "service-badge-list"}>
          {Object.entries(serviceStatus || {}).map(([name, active]) => <ServiceBadge key={name} name={name} active={active} />)}
        </div>
      </div></div>
    </div>
  );
}

export function ReasonModal({ title, label, placeholder, confirmText, onClose, onSubmit }) {
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

export function DeliveryProofModal({ order, onClose }) {
  const [proof, setProof] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getDeliveryProof(order)
      .then((result) => {
        if (active) setProof(result);
      })
      .catch((proofError) => {
        if (active) setError(proofError.message || "The delivery proof could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [order]);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const handoff = proof?.handoff || order.proofOfDeliveryMeta || {};
  const proofImage = proof?.imageUrl || proof?.downloadUrl || proof?.dataUrl || "";
  const proofStorageLabel = proof?.storageMode === "storage" ? "Optimized storage" : proof?.downloadUrl || order.proofOfDeliveryUrl ? "Photo link" : "Database fallback";
  const capturedAt = handoff.capturedAt || proof?.createdAt || order.deliveredAt || order.updatedAt;
  const riderLabel = order.riderName || proof?.riderName || "Assigned rider";
  const qualityWarning = handoff.photoQualityWarning || proof?.photoQualityWarning || "";
  const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  const printProof = () => {
    if (!proofImage) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=920,height=720");
    if (!printWindow) {
      setError("Allow popups so the proof can open for printing.");
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>Proof ${escapeText(order.id)}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#211d19}h1{margin:0 0 4px;font-size:28px}.meta{display:grid;grid-template-columns:140px 1fr;gap:8px;margin:22px 0}.meta strong{color:#6d6258}.photo{max-width:100%;max-height:680px;border:1px solid #ddd;border-radius:10px}</style></head><body><h1>Proof of Delivery</h1><p>Order ${escapeText(order.id)}</p><img class="photo" src="${proofImage}" alt="Delivery proof" /><div class="meta"><strong>Customer</strong><span>${escapeText(order.customerName || "Customer")}</span><strong>Receiver</strong><span>${escapeText(handoff.customerName || "Not recorded")}</span><strong>Signature</strong><span>${escapeText(handoff.signature || "Not recorded")}</span><strong>OTP</strong><span>${handoff.otpVerified ? "Verified" : "Not required / not used"}</span><strong>Captured</strong><span>${capturedAt ? escapeText(new Date(capturedAt).toLocaleString("en-PH")) : "No timestamp"}</span><strong>Rider</strong><span>${escapeText(riderLabel)}</span><strong>Total</strong><span>${escapeText(currency(order.total))}</span><strong>Drop-off</strong><span>${escapeText(order.address || "Address not recorded")}</span><strong>Photo check</strong><span>${escapeText(qualityWarning || "No warning")}</span></div><script>window.onload=()=>{window.print();}</script></body></html>`);
    printWindow.document.close();
  };

  return (
    <div className="modal d-block" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content proof-viewer-modal" role="dialog" aria-modal="true" aria-labelledby="proof-viewer-title">
          <div className="modal-header">
            <div>
              <p className="eyebrow text-danger">Delivery evidence</p>
              <h5 className="modal-title" id="proof-viewer-title">Proof of Delivery</h5>
              <small className="proof-order-id">Order {order.id}</small>
            </div>
            <button className="btn-close" type="button" aria-label="Close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {loading && <div className="empty-chat proof-loading">Loading delivery proof...</div>}
            {error && <div className="alert alert-danger">{error}</div>}
            {!loading && !error && (
              <div className="proof-viewer-layout">
                <figure className="proof-photo-frame">
                  <img src={proofImage} alt={`Delivery proof for ${order.id}`} loading="lazy" />
                </figure>
                <dl className="proof-detail-grid">
                  <div><dt>Order ID</dt><dd>{order.id}</dd></div>
                  <div><dt>Customer</dt><dd>{order.customerName || handoff.customerName || "Customer"}</dd></div>
                  <div><dt>Order total</dt><dd>{currency(order.total)}</dd></div>
                  <div><dt>Drop-off</dt><dd>{order.address || "Address not recorded"}{order.landmark ? ` - ${order.landmark}` : ""}</dd></div>
                  <div><dt>Receiver</dt><dd>{handoff.customerName || "Not recorded"}</dd></div>
                  <div><dt>Typed signature</dt><dd>{handoff.signature || "Not recorded"}</dd></div>
                  <div><dt>OTP check</dt><dd>{handoff.otpVerified ? "Verified" : "Not required / not used"}</dd></div>
                  <div><dt>Captured</dt><dd>{capturedAt ? new Date(capturedAt).toLocaleString("en-PH") : "No timestamp"}</dd></div>
                  <div><dt>Rider</dt><dd>{riderLabel}</dd></div>
                  <div><dt>Photo storage</dt><dd>{proofStorageLabel}</dd></div>
                  {qualityWarning && <div className="proof-quality-card"><dt>Photo check</dt><dd>{qualityWarning}</dd></div>}
                </dl>
              </div>
            )}
          </div>
          <div className="modal-footer">
            {proofImage && <a className="btn btn-outline-dark" href={proofImage} download={`${order.id}-delivery-proof.jpg`}>Download photo</a>}
            <button className="btn btn-dark" type="button" disabled={!proofImage} onClick={printProof}>Print proof</button>
            <button className="btn btn-outline-dark" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OrderManagement({ orders, canAdvance, notify, user = null }) {
  const [cancelTarget, setCancelTarget] = useState(null);
  const [proofTarget, setProofTarget] = useState(null);
  const [visibleOrderCount, setVisibleOrderCount] = useState(30);
  const [orderDateFilter, setOrderDateFilter] = useState("");
  const cancellableStatuses = ["pending-payment", "received", "preparing"];
  const localDateKey = (timestamp) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  };
  const filteredOrders = orderDateFilter
    ? orders.filter((order) => order.createdAt && localDateKey(order.createdAt) === orderDateFilter)
    : orders;
  const visibleOrders = filteredOrders.slice(0, visibleOrderCount);
  const advance = async (order) => {
    const next = nextStaffStatus(order);
    if (!next) {
      notify(isDeliveryOrder(order) && order.status === "ready" ? "This delivery is ready for rider pickup." : "This order has no next counter action.");
      return;
    }
    await updateOrder(order.id, { status: next, updatedAt: Date.now() });
    if (order.phoneVerified && order.smsNotifications) api.sendNotification({ to: order.phone, orderId: order.id, status: next }).catch(() => {});
    notify(`${order.id} updated to ${statusLabel(next)}.`);
  };
  const cancelOrder = async (order, reason) => {
    await updateOrder(order.id, { cancel: true, cancelReason: reason });
    notify(`${order.id} cancelled and stock restored.`);
  };
  const requestVoid = async (order) => {
    const reason = window.prompt(`Why should ${order.id} be voided?`);
    if (!reason?.trim() || !user) return;
    await createApprovalRequest({
      type: "void_order",
      targetId: order.id,
      reason: reason.trim(),
      payload: { orderId: order.id }
    }, user);
    notify(`${order.id} void request sent to owner approval.`);
  };
  const hasProof = (order) => Boolean(order.proofOfDeliveryRef || order.proofOfDeliveryUrl);
  const pinStatus = (order) => order.deliveryLocation?.lat && order.deliveryLocation?.lng ? "Pin confirmed" : order.deliveryType === "delivery" ? "No pin" : "No pin needed";

  return (
    <div className="dashboard-card">
      <div className="module-heading">
        <div><h3>Live order ledger</h3><span className="module-note">{filteredOrders.length} order(s) shown</span></div>
        <label className="form-label compact-date-filter">Order date<input className="form-control" type="date" value={orderDateFilter} onChange={(event) => { setOrderDateFilter(event.target.value); setVisibleOrderCount(30); }} /></label>
      </div>
      {orderDateFilter && <button className="btn btn-sm btn-outline-dark mb-3" type="button" onClick={() => setOrderDateFilter("")}>Clear date filter</button>}
      <div className="table-responsive" tabIndex="0">
        <table className="table align-middle">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>
            {filteredOrders.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-4">No orders in the queue.</td></tr>}
            {visibleOrders.map((order) => {
              const next = nextStaffStatus(order);
              const waitingForRider = isDeliveryOrder(order) && order.status === "ready";
              return (
                <tr key={order.id}>
                <td>{order.id}</td>
                <td>
                  {order.customerName}
                  <small className="d-block text-secondary">{order.phone || "No phone"}</small>
                  {order.smsNotifications ? <small className="d-block text-success">SMS ready</small> : <small className="d-block text-secondary">SMS not verified</small>}
                </td>
                <td className="order-items-cell">
                  <span>{order.items?.map((item) => `${item.qty}x ${item.name}`).join(", ") || "-"}</span>
                  {order.deliveryType && <small className="d-block text-secondary">{orderTypeLabel(order)} - {pinStatus(order)}</small>}
                  {waitingForRider && <small className="d-block text-danger">Ready for rider assignment</small>}
                  {hasProof(order) && <small className="d-block text-success">Proof of delivery saved</small>}
                  {order.address && order.address !== "Counter" && <small className="d-block text-secondary">{order.address}</small>}
                  {order.landmark && <small className="d-block text-secondary">Landmark: {order.landmark}</small>}
                  {order.notes && <small className="d-block text-secondary">Note: {order.notes}</small>}
                </td>
                <td>{orderPaymentLabel(order)}</td>
                <td>{currency(order.total)}</td>
                <td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td>
                <td>
                  {(canAdvance || hasProof(order)) && (
                    <div className="order-action-stack">
                      {canAdvance && next && <button className="btn btn-sm btn-outline-danger" onClick={() => advance(order)}>Advance to {statusLabel(next)}</button>}
                      {canAdvance && cancellableStatuses.includes(order.status) && <button className="btn btn-sm btn-outline-dark" onClick={() => setCancelTarget(order)}>Cancel</button>}
                      {canAdvance && user?.role === "staff" && !cancellableStatuses.includes(order.status) && !["delivered", "completed", "cancelled"].includes(order.status) && <button className="btn btn-sm btn-outline-dark" onClick={() => requestVoid(order)}>Request void</button>}
                      {hasProof(order) && <button className="btn btn-sm btn-dark" type="button" onClick={() => setProofTarget(order)}>View proof</button>}
                    </div>
                  )}
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filteredOrders.length > visibleOrderCount && <button className="btn btn-outline-dark mt-3" type="button" onClick={() => setVisibleOrderCount((count) => count + 30)}>Load more orders</button>}
      {cancelTarget && <ReasonModal title={`Cancel ${cancelTarget.id}`} label="Cancellation reason" placeholder="Example: Customer changed order, unavailable item, duplicate order..." confirmText="Cancel order" onClose={() => setCancelTarget(null)} onSubmit={async (reason) => { await cancelOrder(cancelTarget, reason); setCancelTarget(null); }} />}
      {proofTarget && <DeliveryProofModal order={proofTarget} onClose={() => setProofTarget(null)} />}
    </div>
  );
}

export function KitchenQueue({ orders, notify }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
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
    await updateOrder(order.id, { status: next, updatedAt: Date.now(), ...(next === "preparing" ? { prepStartedAt: Date.now() } : {}), ...(next === "ready" ? { readyAt: Date.now() } : {}) });
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
              <article className={`kitchen-ticket ${orderPrepClock(order, now).delayed ? "delayed" : ""}`} key={order.id}>
                <div><strong>{order.id}</strong><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></div>
                <b className="prep-timer">{orderPrepClock(order, now).label}{orderPrepClock(order, now).delayed ? " waiting - delayed" : " waiting"}</b>
                <small>{order.customerName} - {orderServiceLabel(order)}</small>
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
