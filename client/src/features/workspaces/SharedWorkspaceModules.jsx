import { useCallback, useEffect, useMemo, useState } from "react";
import { ServiceBadge } from "../../components/Branding";
import { menuCategoryOptions } from "../../config/appConfig";
import { api } from "../../services/api";
import { adjustInventory, archiveCompletedOrders, closeActiveShift, createApprovalRequest, createMenuItem, moderateReview, resolveApprovalRequest, sendSupportMessage, startShift, subscribeApprovalRequests, updateMenuItem, updateOrder } from "../../services/firebase";
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

export function InventoryModule({ inventory, user, notify }) {
  const [drafts, setDrafts] = useState({});
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
        <span className="module-note">Every adjustment is written to the audit trail.</span>
      </div>
      <div className="table-responsive">
        <table className="table align-middle inventory-table">
          <thead><tr><th>Product</th><th>Current stock</th><th>Reorder point</th><th>Status</th><th>Quantity</th><th>Reason</th><th>Daily count</th><th>Action</th></tr></thead>
          <tbody>{inventory.map((item) => {
            const lowStock = item.stock <= item.reorderPoint;
            const draft = drafts[item.id] || { quantity: 1, reason: "New delivery", countedStock: "" };
            return (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><small>{item.category}</small></td>
                <td>{item.stock}</td>
                <td>{item.reorderPoint}</td>
                <td><span className={`stock-badge ${lowStock ? "low" : "healthy"}`}>{lowStock ? "Low stock" : "Healthy"}</span></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" min="1" value={draft.quantity} onChange={(event) => updateDraft(item.id, "quantity", event.target.value)} /></td>
                <td><select className="form-select form-select-sm" value={draft.reason} onChange={(event) => updateDraft(item.id, "reason", event.target.value)}><option>New delivery</option><option>Physical count correction</option><option>Wastage</option><option>Spoilage</option><option>Staff meal</option></select></td>
                <td><input className="form-control form-control-sm inventory-input" type="number" min="0" placeholder={String(item.stock)} value={draft.countedStock} onChange={(event) => updateDraft(item.id, "countedStock", event.target.value)} /></td>
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

export function ShiftLogsModule({ orders, logs, user, notify, readOnly = false, activeShift = null, onShiftChange = () => {} }) {
  const [openingCash, setOpeningCash] = useState(2000);
  const [cashIn, setCashIn] = useState(0);
  const [cashOut, setCashOut] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [shiftNotes, setShiftNotes] = useState("");
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
          <div className="table-responsive"><table className="table align-middle"><thead><tr><th>Staff</th><th>Closed</th><th>Orders</th><th>Movements</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Notes</th></tr></thead><tbody>
            {logs.length === 0 && <tr><td colSpan="8" className="text-center text-secondary py-4">No closed shifts yet.</td></tr>}
            {logs.map((log) => <tr key={log.id}><td>{log.staffName}</td><td>{new Date(log.endedAt || log.createdAt).toLocaleString("en-PH")}</td><td>{log.orderCount}</td><td>{currency(Number(log.cashIn || 0) - Number(log.cashOut || 0) - Number(log.expenses || 0))}</td><td>{currency(log.expectedCash)}</td><td>{currency(log.actualCash)}</td><td>{currency(log.variance)}</td><td>{log.notes || "-"}</td></tr>)}
          </tbody></table></div>
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
      <div className="table-responsive">
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

export function AdminCleanupModule({ user, orders, notify }) {
  const [olderThanDays, setOlderThanDays] = useState(30);
  const exportCsv = () => {
    const rows = [
      ["Order", "Customer", "Status", "Payment", "Total", "Created"],
      ...orders.map((order) => [order.id, order.customerName || "", order.status || "", order.paymentMethod || "", Number(order.total || 0), order.createdAt ? new Date(order.createdAt).toLocaleString("en-PH") : ""])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `taptap-orders-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Orders CSV exported.");
  };
  const archive = async () => {
    const result = await archiveCompletedOrders(olderThanDays, user);
    notify(`${result.archived || 0} old completed/cancelled order(s) archived.`);
  };
  return (
    <div className="dashboard-card">
      <div className="module-heading">
        <div><p className="eyebrow text-danger">Data cleanup</p><h3>Export and archive tools</h3></div>
        <span className="module-note">Archived orders stay in the archive record and leave the active queues.</span>
      </div>
      <div className="row g-2 align-items-end">
        <label className="form-label col-md-4">Archive completed/cancelled older than<input className="form-control" type="number" min="1" max="365" value={olderThanDays} onChange={(event) => setOlderThanDays(event.target.value)} /></label>
        <div className="col-md-8 d-flex flex-wrap gap-2"><button className="btn btn-outline-dark" onClick={exportCsv}>Export orders CSV</button><button className="btn btn-danger" onClick={archive}>Archive old orders</button></div>
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

export function OrderManagement({ orders, canAdvance, notify, user = null }) {
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
  // erick: dinagdag ang Items column (+ address) para makita ng staff ang in-order.
  return (
    <div className="dashboard-card">
      <h3>Live order ledger</h3>
      <div className="table-responsive">
        <table className="table align-middle">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>{orders.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-4">No orders in the queue.</td></tr>}{orders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td className="order-items-cell"><span>{order.items?.map((item) => `${item.qty}x ${item.name}`).join(", ") || "-"}</span>{order.deliveryType && <small className="d-block text-secondary">{order.deliveryType}</small>}{order.address && order.address !== "Counter" && <small className="d-block text-secondary">{order.address}</small>}{order.notes && <small className="d-block text-secondary">Note: {order.notes}</small>}</td><td>{orderPaymentLabel(order)}</td><td>{currency(order.total)}</td><td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td><td>{canAdvance && <div className="order-action-stack">{flow.includes(order.status) && order.status !== "delivered" && <button className="btn btn-sm btn-outline-danger" onClick={() => advance(order)}>Advance</button>}{cancellableStatuses.includes(order.status) && <button className="btn btn-sm btn-outline-dark" onClick={() => setCancelTarget(order)}>Cancel</button>}{user?.role === "staff" && !cancellableStatuses.includes(order.status) && !["delivered", "cancelled"].includes(order.status) && <button className="btn btn-sm btn-outline-dark" onClick={() => requestVoid(order)}>Request void</button>}</div>}</td></tr>)}</tbody>
        </table>
      </div>
      {cancelTarget && <ReasonModal title={`Cancel ${cancelTarget.id}`} label="Cancellation reason" placeholder="Example: Customer changed order, unavailable item, duplicate order..." confirmText="Cancel order" onClose={() => setCancelTarget(null)} onSubmit={async (reason) => { await cancelOrder(cancelTarget, reason); setCancelTarget(null); }} />}
    </div>
  );
}

export function KitchenQueue({ orders, notify }) {
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
