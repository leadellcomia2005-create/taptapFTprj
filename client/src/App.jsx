import { useEffect, useMemo, useRef, useState } from "react";
import CameraProof from "./components/CameraProof";
import DeliveryMap from "./components/DeliveryMap";
import SalesChart from "./components/SalesChart";
import { demoAccounts, demoSales, fallbackMenu } from "./data/menu";
import { api } from "./services/api";
import {
  adjustInventory,
  createOrder,
  firebaseEnabled,
  login,
  logout,
  observeAuth,
  registerCustomer,
  resetPassword,
  saveShiftLog,
  saveRiderLocation,
  sendSupportMessage,
  subscribeAuditLogs,
  subscribeInventory,
  subscribeMenu,
  subscribeOrders,
  subscribeRiderLocation,
  subscribeShiftLogs,
  subscribeSupportMessages,
  updateOrder,
  uploadProof
} from "./services/firebase";
import { disconnectSocket, getSocket } from "./services/socket";

const currency = (value) => `₱${Number(value || 0).toLocaleString("en-PH")}`;
const statusLabel = (value) => ({
  received: "Received",
  preparing: "Preparing",
  ready: "Ready",
  "out-for-delivery": "Out for delivery",
  arrived: "Arrived",
  delivered: "Delivered"
}[value] || value);

const roleNavigation = {
  customer: [
    ["store", "Storefront"],
    ["orders", "My orders"]
  ],
  owner: [
    ["owner-overview", "Dashboard"],
    ["owner-sales", "Sales & Orders"],
    ["owner-inventory", "Inventory"],
    ["owner-reports", "Reports"],
    ["owner-users", "Users & Roles"],
    ["owner-audit", "Audit Logs"],
    ["owner-settings", "System Settings"]
  ],
  staff: [
    ["staff-overview", "Dashboard"],
    ["staff-pos", "Walk-in POS"],
    ["staff-orders", "Order Queue"],
    ["staff-inventory", "Inventory"],
    ["staff-shifts", "Shift Logs"],
    ["staff-chat", "Chat Support"],
    ["staff-settings", "Settings"]
  ],
  rider: [
    ["rider-orders", "Assigned Orders"],
    ["rider-cod", "COD Ledger"]
  ]
};

const defaultViewForRole = (role) => ({
  customer: "store",
  owner: "owner-overview",
  staff: "staff-overview",
  rider: "rider-orders"
}[role] || "store");

function ServiceBadge({ name, active, note }) {
  return (
    <div className="service-badge">
      <span className={`service-dot ${active ? "active" : ""}`} />
      <div><strong>{name}</strong><small>{note || (active ? "Configured" : "Demo fallback")}</small></div>
    </div>
  );
}

function LoginPanel({ onLoggedIn }) {
  const [role, setRole] = useState("customer");
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(demoAccounts.customer.email);
  const [password, setPassword] = useState(demoAccounts.customer.password);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectRole = (nextRole) => {
    setRole(nextRole);
    setEmail(demoAccounts[nextRole].email);
    setPassword(demoAccounts[nextRole].password);
    setRegistering(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (registering) await registerCustomer(name, email, password);
      else await login(email, password, role, demoAccounts);
      onLoggedIn?.();
    } catch (authError) {
      setError(authError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-visual">
        <div className="brand-lockup"><span>T</span><div><strong>Taptap</strong><small>FOODTRIP</small></div></div>
        <div>
          <p className="eyebrow">Integrated operations platform</p>
          <h1>One system.<br />Every <em>foodtrip.</em></h1>
          <p>Ordering, inventory, payments, delivery, analytics and AI support in one role-based application.</p>
        </div>
      </div>
      <div className="login-form-wrap">
        <form className="login-card" onSubmit={submit}>
          <p className="eyebrow text-danger">Secure access</p>
          <h2>{registering ? "Create customer account" : "Welcome back"}</h2>
          <p className="text-secondary small">{firebaseEnabled ? "Firebase Authentication is active." : "Firebase is not configured. Demo authentication is active."}</p>
          {!registering && (
            <div className="role-tabs">
              {["customer", "owner", "staff", "rider"].map((item) => (
                <button type="button" key={item} className={role === item ? "active" : ""} onClick={() => selectRole(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}
          {registering && (
            <label className="form-label">Full name
              <input className="form-control" required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <label className="form-label">Email
            <input className="form-control" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="form-label">Password
            <input className="form-control" type="password" minLength="8" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          <button className="btn btn-danger w-100" disabled={busy}>{busy ? "Please wait..." : registering ? "Register with Firebase" : `Sign in as ${role}`}</button>
          <div className="d-flex justify-content-between mt-3 small">
            <button type="button" className="btn btn-link p-0" onClick={() => setRegistering(!registering)}>
              {registering ? "Back to sign in" : "Customer registration"}
            </button>
            {!registering && <button type="button" className="btn btn-link p-0" onClick={() => resetPassword(email).catch((resetError) => setError(resetError.message))}>Reset password</button>}
          </div>
        </form>
      </div>
    </div>
  );
}

function AppHeader({ user, cartCount, activeView, onCart, onNavigate }) {
  const navigation = roleNavigation[user.role] || [];
  const homeView = defaultViewForRole(user.role);
  return (
    <header className="app-header">
      <button className="brand-lockup border-0 bg-transparent" onClick={() => onNavigate(homeView)}>
        <span>T</span><div><strong>Taptap</strong><small>FOODTRIP</small></div>
      </button>
      <nav className="role-navigation" aria-label={`${user.role} navigation`}>
        {navigation.map(([view, label]) => (
          <button className={activeView === view ? "active" : ""} key={view} onClick={() => onNavigate(view)}>{label}</button>
        ))}
      </nav>
      <div className="header-actions">
        {user.role === "customer" && <button className="btn btn-outline-dark btn-sm" onClick={onCart}>Cart ({cartCount})</button>}
        <div className="user-chip"><span>{user.name?.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div>
        <button className="btn btn-link text-danger btn-sm" onClick={logout}>Log out</button>
      </div>
    </header>
  );
}

function Storefront({ menu, cart, setCart, onCheckout }) {
  const [category, setCategory] = useState("All");
  const categories = ["All", ...new Set(menu.map((item) => item.category))];
  const visible = category === "All" ? menu : menu.filter((item) => item.category === category);
  const add = (product) => setCart((current) => {
    const existing = current.find((item) => item.id === product.id);
    return existing
      ? current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
      : [...current, { ...product, qty: 1 }];
  });

  return (
    <>
      <section className="integrated-hero">
        <div>
          <p className="eyebrow">Lutong Pinoy, powered by real-time operations</p>
          <h1>Your next foodtrip<br />starts <em>here.</em></h1>
          <p>Live menu availability, secure checkout, AI assistance and delivery tracking from kitchen to doorstep.</p>
          <button className="btn btn-danger btn-lg" onClick={() => document.getElementById("live-menu").scrollIntoView({ behavior: "smooth" })}>Order now</button>
        </div>
      </section>
      <section className="container py-5" id="live-menu">
        <div className="section-title">
          <div><p className="eyebrow text-danger">Firebase live menu</p><h2>Cravings, <em>sorted.</em></h2></div>
          <p>Stock and availability synchronize through Firebase Realtime Database.</p>
        </div>
        <div className="category-pills mb-4">
          {categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
        <div className="row g-4">
          {visible.map((product) => (
            <div className="col-md-6 col-xl-4" key={product.id}>
              <article className="menu-card">
                <div className="menu-photo" style={{ backgroundPosition: product.imagePosition }} />
                <div className="p-4">
                  <div className="d-flex justify-content-between gap-3"><h3>{product.name}</h3><strong>{currency(product.price)}</strong></div>
                  <p>{product.description}</p>
                  <small>Allergens: {product.allergens?.join(", ") || "none listed"}</small>
                  <button className="btn btn-danger w-100 mt-3" disabled={product.stock === 0} onClick={() => add(product)}>Add to cart · {product.stock} available</button>
                </div>
              </article>
            </div>
          ))}
        </div>
        {cart.length > 0 && <button className="floating-checkout btn btn-danger" onClick={onCheckout}>Checkout {cart.reduce((sum, item) => sum + item.qty, 0)} item(s)</button>}
      </section>
    </>
  );
}

function Checkout({ cart, user, onClose, onComplete, notify }) {
  const [payment, setPayment] = useState("gcash");
  const [phone, setPhone] = useState("+639171234567");
  const [address, setAddress] = useState("BF Resort Village, Las Pinas City");
  const [busy, setBusy] = useState(false);
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0) + 49;

  const place = async () => {
    setBusy(true);
    try {
      const orderPayload = {
        customerId: user.uid,
        customerName: user.name,
        customerEmail: user.email,
        phone,
        address,
        paymentMethod: payment,
        total,
        items: cart.map(({ id, name, price, qty, stock }) => ({ id, name, price, qty, stock }))
      };
      const orderId = await createOrder(orderPayload);
      api.sendNotification({ to: phone, orderId, status: "received" }).catch(() => {});
      if (payment === "gcash") {
        try {
          const result = await api.createPayment({ ...orderPayload, orderId, successUrl: window.location.href, cancelUrl: window.location.href });
          if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
          else notify(`Order ${orderId} created. PayMongo is awaiting credentials.`);
        } catch (paymentError) {
          notify(`Order ${orderId} created. ${paymentError.message}`);
        }
      } else {
        notify(`Order ${orderId} was sent to the kitchen.`);
      }
      onComplete(orderId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal d-block">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header"><h5 className="modal-title">Secure checkout</h5><button className="btn-close" onClick={onClose} /></div>
          <div className="modal-body">
            {cart.map((item) => <div className="d-flex justify-content-between border-bottom py-2" key={item.id}><span>{item.qty}× {item.name}</span><strong>{currency(item.price * item.qty)}</strong></div>)}
            <label className="form-label mt-3">Mobile number<input className="form-control" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label className="form-label">Delivery address<textarea className="form-control" value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <div className="row g-2">
              <div className="col-6"><button className={`payment-option ${payment === "gcash" ? "active" : ""}`} onClick={() => setPayment("gcash")}><strong>GCash</strong><small>via PayMongo</small></button></div>
              <div className="col-6"><button className={`payment-option ${payment === "cod" ? "active" : ""}`} onClick={() => setPayment("cod")}><strong>Cash on delivery</strong><small>Rider ledger</small></button></div>
            </div>
            <div className="checkout-total"><span>Total including delivery</span><strong>{currency(total)}</strong></div>
          </div>
          <div className="modal-footer"><button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={busy} onClick={place}>{busy ? "Processing..." : "Place order"}</button></div>
        </div>
      </div>
    </div>
  );
}

function OrdersView({ orders, onTrack }) {
  return (
    <main className="container py-5">
      <div className="section-title"><div><p className="eyebrow text-danger">Realtime Database</p><h2>My purchases</h2></div></div>
      {orders.length === 0 ? <div className="empty-state">No orders yet.</div> : orders.map((order) => (
        <article className="order-card" key={order.id}>
          <div><small>{order.id}</small><h3>{order.items?.map((item) => `${item.qty}× ${item.name}`).join(", ")}</h3><p>{order.address}</p></div>
          <div className="text-end"><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span><strong>{currency(order.total)}</strong><button className="btn btn-link btn-sm" onClick={() => onTrack(order)}>Track live</button></div>
        </article>
      ))}
    </main>
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
        <div><p className="eyebrow text-danger">Recipe-based stock control</p><h3>Inventory levels and adjustments</h3></div>
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

function ShiftLogsModule({ orders, logs, user, notify, readOnly = false }) {
  const [openingCash, setOpeningCash] = useState(2000);
  const [actualCash, setActualCash] = useState(0);
  const cashSales = orders.filter((order) => ["cash", "cod"].includes(order.paymentMethod)).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const expectedCash = Number(openingCash || 0) + cashSales;
  const variance = Number(actualCash || 0) - expectedCash;
  const closeShift = async () => {
    const id = await saveShiftLog({
      startedAt: Date.now() - 8 * 60 * 60 * 1000,
      endedAt: Date.now(),
      openingCash: Number(openingCash),
      cashSales,
      expectedCash,
      actualCash: Number(actualCash),
      variance,
      orderCount: orders.length
    }, user);
    notify(`Shift ${id} closed and sent for owner reconciliation.`);
  };
  return (
    <div className="row g-3">
      {!readOnly && <div className="col-xl-5">
        <div className="dashboard-card">
          <p className="eyebrow text-danger">End-of-shift reconciliation</p>
          <h3>Close current shift</h3>
          <label className="form-label">Opening cash<input className="form-control" type="number" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
          <label className="form-label">Actual cash counted<input className="form-control" type="number" value={actualCash} onChange={(event) => setActualCash(event.target.value)} /></label>
          <dl className="reconciliation-list">
            <div><dt>Cash and COD sales</dt><dd>{currency(cashSales)}</dd></div>
            <div><dt>Expected cash</dt><dd>{currency(expectedCash)}</dd></div>
            <div><dt>Variance</dt><dd className={variance === 0 ? "text-success" : "text-danger"}>{currency(variance)}</dd></div>
          </dl>
          <button className="btn btn-danger w-100" onClick={closeShift}>Close shift and save log</button>
        </div>
      </div>}
      <div className={readOnly ? "col-12" : "col-xl-7"}>
        <div className="dashboard-card">
          <h3>{readOnly ? "Staff shift reconciliation history" : "Shift history"}</h3>
          <div className="table-responsive"><table className="table align-middle"><thead><tr><th>Staff</th><th>Closed</th><th>Orders</th><th>Expected</th><th>Actual</th><th>Variance</th></tr></thead><tbody>
            {logs.length === 0 && <tr><td colSpan="6" className="text-center text-secondary py-4">No closed shifts yet.</td></tr>}
            {logs.map((log) => <tr key={log.id}><td>{log.staffName}</td><td>{new Date(log.endedAt || log.createdAt).toLocaleString("en-PH")}</td><td>{log.orderCount}</td><td>{currency(log.expectedCash)}</td><td>{currency(log.actualCash)}</td><td>{currency(log.variance)}</td></tr>)}
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
      <div className="module-heading"><div><p className="eyebrow text-danger">Firebase message history</p><h3>Customer and internal support</h3></div><span className="module-note">Use this channel for order questions and admin coordination.</span></div>
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
          <header><strong>{selectedConversation?.customerName || "Select a customer"}</strong><small>{selectedConversation ? "Customer chatbot conversation" : "Messages will appear here"}</small></header>
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
      <div className="col-xl-7"><div className="dashboard-card settings-card"><p className="eyebrow text-danger">Configuration</p><h3>{title}</h3>
        {Object.entries(settings).map(([key, enabled]) => <label className="setting-row" key={key}><span><strong>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</strong><small>{staff ? "Staff workstation preference" : "Business-wide operational setting"}</small></span><input type="checkbox" checked={enabled} onChange={() => toggle(key)} /></label>)}
        <button className="btn btn-danger mt-3" onClick={() => notify("Settings saved for this development session.")}>Save settings</button>
      </div></div>
      <div className="col-xl-5"><div className="dashboard-card"><h3>Connected services</h3>{Object.entries(serviceStatus || {}).map(([name, active]) => <ServiceBadge key={name} name={name} active={active} />)}</div></div>
    </div>
  );
}

function OwnerWorkspace({ section, user, orders, inventory, serviceStatus, auditLogs, shiftLogs, notify }) {
  const menu = inventory;
  const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const [insight, setInsight] = useState("Generate a live OpenAI sales and inventory summary.");
  const [salesGoal, setSalesGoal] = useState(100000);
  const [roleForm, setRoleForm] = useState({ uid: "", role: "staff" });
  const downloadReport = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.setFontSize(20);
    pdf.text("Taptap Foodtrip Sales Report", 16, 20);
    pdf.setFontSize(11);
    pdf.text(`Generated: ${new Date().toLocaleString("en-PH")}`, 16, 30);
    pdf.text(`Orders: ${orders.length}`, 16, 42);
    pdf.text(`Gross sales: ${currency(totalSales)}`, 16, 50);
    orders.slice(0, 15).forEach((order, index) => {
      pdf.text(`${order.id}  ${order.customerName}  ${currency(order.total)}  ${statusLabel(order.status)}`, 16, 64 + index * 8);
    });
    pdf.save("taptap-sales-report.pdf");
  };
  const generateInsight = async () => {
    try {
      const result = await api.insights(orders, menu);
      setInsight(result.text);
    } catch (error) {
      setInsight(`Demo insight: Sisig demand is strongest after 6 PM. Reorder pork belly before the next evening shift. (${error.message})`);
    }
  };
  const seededUsers = Object.entries(demoAccounts).map(([role, account]) => ({ role, ...account }));
  const updateRole = async (event) => {
    event.preventDefault();
    try {
      await api.assignRole(roleForm.uid, roleForm.role);
      notify(`User role updated to ${roleForm.role}.`);
      setRoleForm({ uid: "", role: "staff" });
    } catch (error) {
      notify(error.message);
    }
  };
  if (section === "owner-sales") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Sales strategy and analytics</p><h2>Sales & Orders</h2></div><button className="btn btn-outline-dark" onClick={downloadReport}>Export sales PDF</button></div>
      <div className="row g-3">
        <div className="col-md-4"><div className="metric-card"><small>Unified gross sales</small><strong>{currency(totalSales)}</strong><span>Online and walk-in ledger</span></div></div>
        <div className="col-md-4"><div className="metric-card"><small>Revenue target</small><strong>{currency(salesGoal)}</strong><span>{Math.min(100, Math.round(totalSales / salesGoal * 100))}% achieved</span></div></div>
        <div className="col-md-4"><div className="metric-card"><small>Awaiting completion</small><strong>{orders.filter((order) => order.status !== "delivered").length}</strong><span>Live order workload</span></div></div>
        <div className="col-lg-8"><div className="dashboard-card chart-card"><h3>Sales trends and forecast</h3><SalesChart values={demoSales.map((value, index) => value + (index === 6 ? totalSales : 0))} /></div></div>
        <div className="col-lg-4"><div className="dashboard-card"><h3>Strategy controls</h3><label className="form-label">Sales goal threshold<input className="form-control" type="number" value={salesGoal} onChange={(event) => setSalesGoal(Number(event.target.value))} /></label><label className="form-label">Active promotion<select className="form-select"><option>Free delivery over PHP 499</option><option>10% off rice meals</option><option>No active promotion</option></select></label><button className="btn btn-danger w-100 mt-3" onClick={() => notify("Sales strategy saved.")}>Save strategy</button></div></div>
        <div className="col-12"><OrderManagement orders={orders} canAdvance notify={notify} /></div>
      </div>
    </main>
  );
  if (section === "owner-inventory") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Stock governance</p><h2>Inventory</h2></div></div><InventoryModule inventory={inventory} user={user} notify={notify} /></main>;
  if (section === "owner-reports") return (
    <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Automated reporting</p><h2>Reports & Reconciliation</h2></div><button className="btn btn-danger" onClick={downloadReport}>Generate daily sales report</button></div>
      <div className="row g-3"><div className="col-md-4"><div className="metric-card"><small>Completed orders</small><strong>{orders.filter((order) => order.status === "delivered").length}</strong><span>Ready for reconciliation</span></div></div><div className="col-md-4"><div className="metric-card"><small>COD exposure</small><strong>{currency(orders.filter((order) => order.paymentMethod === "cod" && order.status !== "delivered").reduce((sum, order) => sum + Number(order.total || 0), 0))}</strong><span>Outstanding rider cash</span></div></div><div className="col-md-4"><div className="metric-card"><small>Closed shifts</small><strong>{shiftLogs.length}</strong><span>Staff cash logs</span></div></div><div className="col-12"><ShiftLogsModule orders={orders} logs={shiftLogs} user={user} notify={notify} readOnly /></div></div>
    </main>
  );
  if (section === "owner-users") return (
    <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Firebase Authentication</p><h2>Users & Roles</h2></div></div><div className="row g-3">
      <div className="col-xl-8"><div className="dashboard-card"><h3>Configured project accounts</h3><div className="table-responsive"><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th></tr></thead><tbody>{seededUsers.map((account) => <tr key={account.email}><td>{account.name}</td><td>{account.email}</td><td><span className="role-badge">{account.role}</span></td><td>{account.role === "owner" ? "Full system" : account.role === "staff" ? "Operations" : account.role === "rider" ? "Assigned deliveries" : "Storefront"}</td></tr>)}</tbody></table></div></div></div>
      <div className="col-xl-4"><form className="dashboard-card" onSubmit={updateRole}><h3>Assign Firebase role</h3><p className="module-note">Enter a Firebase Authentication UID. Custom claims are updated securely by the Node.js API.</p><label className="form-label">User UID<input className="form-control" required value={roleForm.uid} onChange={(event) => setRoleForm((current) => ({ ...current, uid: event.target.value }))} /></label><label className="form-label">Role<select className="form-select" value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))}><option>owner</option><option>staff</option><option>rider</option><option>customer</option></select></label><button className="btn btn-danger w-100 mt-3">Update role</button></form></div>
    </div></main>
  );
  if (section === "owner-audit") return (
    <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Accountability and integrity</p><h2>Audit Logs</h2></div></div><div className="dashboard-card"><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Record</th><th>Details</th></tr></thead><tbody>{auditLogs.length === 0 && <tr><td colSpan="5" className="text-center text-secondary py-5">Actions will appear here as orders, stock and shifts are updated.</td></tr>}{auditLogs.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("en-PH")}</td><td>{entry.action?.replaceAll("_", " ")}</td><td>{entry.actorName || "System"}</td><td>{entry.orderId || entry.itemName || entry.shiftLogId || "-"}</td><td>{entry.status || entry.reason || (entry.quantity ? `Quantity ${entry.quantity}` : "-")}</td></tr>)}</tbody></table></div></div></main>
  );
  if (section === "owner-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Platform administration</p><h2>System Settings</h2></div></div><SettingsModule title="Payments, notifications and system controls" serviceStatus={serviceStatus} notify={notify} /></main>;
  return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Super Admin / Owner</p><h2>Business dashboard</h2></div><button className="btn btn-outline-dark" onClick={downloadReport}>Export PDF with jsPDF</button></div>
      <div className="row g-3">
        <div className="col-md-3"><div className="metric-card"><small>Gross sales</small><strong>{currency(totalSales)}</strong><span>Firebase transactions</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Orders</small><strong>{orders.length}</strong><span>All channels</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Menu items</small><strong>{menu.length}</strong><span>Recipe mapped</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Services online</small><strong>{Object.values(serviceStatus).filter(Boolean).length}</strong><span>Credential dependent</span></div></div>
        <div className="col-lg-8"><div className="dashboard-card chart-card"><h3>Sales performance · Chart.js</h3><SalesChart values={demoSales.map((value, index) => value + (index === 6 ? totalSales : 0))} /></div></div>
        <div className="col-lg-4"><div className="dashboard-card ai-insight"><p className="eyebrow">OpenAI operations insight</p><h3>Decision support</h3><p>{insight}</p><button className="btn btn-warning w-100" onClick={generateInsight}>Generate AI summary</button></div></div>
        <div className="col-lg-7"><OrderManagement orders={orders.slice(0, 5)} canAdvance notify={notify} /></div>
        <div className="col-lg-5"><div className="dashboard-card"><h3>Low-stock alerts</h3>{inventory.filter((item) => item.stock <= item.reorderPoint).map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>Reorder point: {item.reorderPoint}</small></span><b>{item.stock}</b></div>)}{inventory.every((item) => item.stock > item.reorderPoint) && <p className="text-secondary small">All products are above their reorder points.</p>}</div></div>
      </div>
    </main>
  );
}

function OrderManagement({ orders, canAdvance, notify }) {
  const flow = ["received", "preparing", "ready", "out-for-delivery", "arrived", "delivered"];
  const advance = async (order) => {
    const next = flow[Math.min(flow.indexOf(order.status) + 1, flow.length - 1)];
    await updateOrder(order.id, { status: next, updatedAt: Date.now() });
    api.sendNotification({ to: order.phone, orderId: order.id, status: next }).catch(() => {});
    notify(`${order.id} updated to ${statusLabel(next)}.`);
  };
  return (
    <div className="dashboard-card">
      <h3>Live order ledger</h3>
      <div className="table-responsive">
        <table className="table align-middle">
          <thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>{orders.length === 0 && <tr><td colSpan="6" className="text-center text-secondary py-4">No orders in the queue.</td></tr>}{orders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td>{order.paymentMethod}</td><td>{currency(order.total)}</td><td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td><td>{canAdvance && order.status !== "delivered" && <button className="btn btn-sm btn-outline-danger" onClick={() => advance(order)}>Advance</button>}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function StaffWorkspace({ section, user, orders, inventory, shiftLogs, messages, serviceStatus, notify }) {
  const [posCart, setPosCart] = useState([]);
  const posTotal = posCart.reduce((sum, item) => sum + item.price * item.qty, 0);
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
    const orderId = await createOrder({
      customerId: "walk-in",
      customerName: "Walk-in Customer",
      paymentMethod: "cash",
      total: posTotal,
      address: "Counter",
      phone: "",
      items: posCart
    });
    setPosCart([]);
    notify(`Walk-in receipt ${orderId} completed.`);
  };

  if (section === "staff-pos") return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Fast counter entry</p><h2>Walk-in POS</h2></div></div>
      <div className="row g-3">
        <div className="col-xl-8"><div className="row g-3">{inventory.map((product) => <div className="col-md-4" key={product.id}><button className="pos-product" disabled={product.stock <= 0} onClick={() => add(product)}><div className="menu-photo" style={{ backgroundPosition: product.imagePosition }} /><strong>{product.name}</strong><span>{currency(product.price)} · {product.stock} available</span></button></div>)}</div></div>
        <div className="col-xl-4"><div className="dashboard-card sticky-pos"><div className="module-heading"><h3>Current walk-in order</h3>{posCart.length > 0 && <button className="btn btn-link btn-sm text-danger p-0" onClick={() => setPosCart([])}>Clear cart</button>}</div>{posCart.length === 0 && <div className="empty-chat">Select products to begin a POS order.</div>}{posCart.map((item) => <div className="pos-cart-item" key={item.id}><div><strong>{item.name}</strong><small>{currency(item.price)} each</small></div><div className="pos-quantity"><button onClick={() => decrease(item.id)} aria-label={`Decrease ${item.name}`}>−</button><span>{item.qty}</span><button disabled={item.qty >= item.stock} onClick={() => add(item)} aria-label={`Increase ${item.name}`}>+</button></div><strong>{currency(item.qty * item.price)}</strong><button className="pos-remove" onClick={() => remove(item.id)}>Remove</button></div>)}<div className="checkout-total"><span>Total ({posCart.reduce((sum, item) => sum + item.qty, 0)} items)</span><strong>{currency(posTotal)}</strong></div><button className="btn btn-danger w-100" disabled={!posCart.length} onClick={complete}>Accept payment and print receipt</button></div></div>
      </div>
    </main>
  );
  if (section === "staff-orders") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Online and walk-in fulfillment</p><h2>Order Queue</h2></div></div><OrderManagement orders={orders} canAdvance notify={notify} /></main>;
  if (section === "staff-inventory") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Receiving, wastage and availability</p><h2>Inventory</h2></div></div><InventoryModule inventory={inventory} user={user} notify={notify} /></main>;
  if (section === "staff-shifts") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Accountability and cash control</p><h2>Shift Logs</h2></div></div><ShiftLogsModule orders={orders} logs={shiftLogs} user={user} notify={notify} /></main>;
  if (section === "staff-chat") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Live communication</p><h2>Chat Support</h2></div></div><SupportChat messages={messages} user={user} notify={notify} /></main>;
  if (section === "staff-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Workstation preferences</p><h2>Settings</h2></div></div><SettingsModule title="Staff alerts, receipts and workstation" serviceStatus={serviceStatus} staff notify={notify} /></main>;

  const activeOrders = orders.filter((order) => order.status !== "delivered");
  const todaySales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
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
  const active = assignedOrders.find((order) => order.id === selectedId) || assignedOrders.find((order) => order.status !== "delivered") || assignedOrders[0];
  const [online, setOnline] = useState(false);
  const [location, setLocation] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
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
      await saveRiderLocation(user.uid, next);
      socket?.emit("rider:location", { riderId: user.uid, ...next });
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
    const url = await uploadProof(active.id, blob);
    await updateOrder(active.id, { status: "delivered", proofOfDeliveryUrl: url, deliveredAt: Date.now() });
    setCameraOpen(false);
    navigator.vibrate?.(180);
    notify("Delivery completed with photo evidence.");
  };

  const googleMapsUrl = active
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(active.address)}&travelmode=driving`
    : "#";

  if (section === "rider-cod") {
    const codOrders = assignedOrders.filter((order) => order.paymentMethod === "cod");
    const collected = codOrders.filter((order) => order.status === "delivered").reduce((sum, order) => sum + Number(order.total || 0), 0);
    const outstanding = codOrders.filter((order) => order.status !== "delivered").reduce((sum, order) => sum + Number(order.total || 0), 0);
    return (
      <main className="container-fluid dashboard-page py-4">
        <div className="dashboard-heading"><div><p className="eyebrow text-danger">Rider financials</p><h2>COD Ledger</h2></div></div>
        <div className="row g-3">
          <div className="col-md-4"><div className="metric-card"><small>Cash collected</small><strong>{currency(collected)}</strong><span>Delivered COD orders</span></div></div>
          <div className="col-md-4"><div className="metric-card"><small>Cash outstanding</small><strong>{currency(outstanding)}</strong><span>Active COD deliveries</span></div></div>
          <div className="col-md-4"><div className="metric-card"><small>COD assignments</small><strong>{codOrders.length}</strong><span>Current rider ledger</span></div></div>
          <div className="col-12"><div className="dashboard-card"><div className="table-responsive"><table className="table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Cash due</th></tr></thead><tbody>{codOrders.length === 0 && <tr><td colSpan="4" className="text-center text-secondary py-4">No COD orders assigned.</td></tr>}{codOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td>{statusLabel(order.status)}</td><td>{currency(order.total)}</td></tr>)}</tbody></table></div></div></div>
        </div>
      </main>
    );
  }

  return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Delivery Rider</p><h2>Assigned Orders</h2></div><button className={`btn ${online ? "btn-success" : "btn-outline-success"}`} onClick={toggleOnline}>{online ? "Online · sharing GPS" : "Go online"}</button></div>
      <div className="row g-3">
        <div className="col-xl-4"><div className="dashboard-card assigned-list"><h3>Your deliveries</h3>{assignedOrders.length === 0 && <div className="empty-chat">No orders assigned yet.</div>}{assignedOrders.map((order) => <button className={active?.id === order.id ? "active" : ""} key={order.id} onClick={() => setSelectedId(order.id)}><span><strong>{order.id}</strong><small>{order.customerName} · {order.address}</small></span><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></button>)}
          {availableOrders.length > 0 && <><h3 className="mt-4">Ready for assignment</h3>{availableOrders.map((order) => <div className="available-order" key={order.id}><span><strong>{order.id}</strong><small>{order.address}</small></span><button className="btn btn-sm btn-outline-danger" onClick={() => claimOrder(order)}>Accept</button></div>)}</>}
        </div></div>
        <div className="col-xl-8"><div className="dashboard-card">
          <h3>{active ? `${active.id} · ${statusLabel(active.status)}` : "Select an assigned delivery"}</h3>
          {active ? <div className="row g-3"><div className="col-lg-6"><p><strong>{active.customerName}</strong><br />{active.address}</p><p>{active.items?.map((item) => `${item.qty}× ${item.name}`).join(", ")}</p><p><strong>Payment:</strong> {active.paymentMethod?.toUpperCase()} · {currency(active.total)}</p><div className="d-grid gap-2"><button className="btn btn-danger" disabled={active.status !== "ready"} onClick={pickup}>Pick up order</button><a className="btn btn-outline-dark" href={googleMapsUrl} target="_blank" rel="noreferrer">Open Google Maps navigation</a><button className="btn btn-warning" disabled={active.status !== "out-for-delivery"} onClick={markArrived}>Mark arrived</button><button className="btn btn-success" disabled={active.status !== "arrived"} onClick={() => setCameraOpen(true)}>Deliver with camera proof</button></div></div><div className="col-lg-6"><div className="rider-map"><DeliveryMap rider={location} /></div></div></div> : <div className="empty-state compact">Assigned delivery details will appear here.</div>}
        </div></div>
      </div>
      {cameraOpen && <CameraProof onCapture={capture} onClose={() => setCameraOpen(false)} />}
    </main>
  );
}

function TrackingView({ order, onClose }) {
  const [rider, setRider] = useState(null);
  useEffect(() => {
    if (!order?.riderId) return undefined;
    return subscribeRiderLocation(order.riderId, setRider);
  }, [order]);
  if (!order) return null;
  return (
    <div className="modal d-block">
      <div className="modal-dialog modal-xl modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header"><div><small>{order.id}</small><h5 className="modal-title">{statusLabel(order.status)}</h5></div><button className="btn-close" onClick={onClose} /></div>
          <div className="modal-body p-0"><DeliveryMap rider={rider} /></div>
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
        source: `Staff support · ${message.senderName}`
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
      setMessages((current) => [...current, { from: "bot", text: `Demo answer: Popular choices are ${popular}. Configure Dialogflow and OpenAI to enable live natural-language answers.`, source: "demo" }]);
    }
  };
  return (
    <>
      <button className="assistant-launcher" onClick={() => setOpen(!open)}>AI</button>
      {open && <aside className="assistant-panel"><header><div><strong>TapTap Assistant</strong><small>AI answers + live staff support</small></div><button onClick={() => setOpen(false)}>×</button></header><div className="assistant-messages">{messages.map((message, index) => <div key={index} className={message.from}><span>{message.text}</span>{message.source && <small>{message.source}</small>}</div>)}</div><form onSubmit={send}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask AI or contact staff..." /><button>Send</button></form></aside>}
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [menu, setMenu] = useState(fallbackMenu);
  const [inventory, setInventory] = useState(fallbackMenu.map((item) => ({ ...item, reorderPoint: 10 })));
  const [orders, setOrders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [shiftLogs, setShiftLogs] = useState([]);
  const [supportMessages, setSupportMessages] = useState([]);
  const [cart, setCart] = useState([]);
  const [view, setView] = useState("store");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [trackingOrder, setTrackingOrder] = useState(null);
  const [notice, setNotice] = useState("");
  const [serviceStatus, setServiceStatus] = useState({ firebase: firebaseEnabled, socket: false, openai: false, dialogflow: false, paymongo: false, twilio: false });
  const previousOrderCount = useRef(0);

  useEffect(() => observeAuth(setUser), []);
  useEffect(() => subscribeMenu(fallbackMenu, setMenu), []);
  useEffect(() => {
    if (!user || !["owner", "staff"].includes(user.role)) {
      setInventory(menu.map((item) => ({ ...item, reorderPoint: item.reorderPoint ?? 10 })));
      return undefined;
    }
    return subscribeInventory(menu, setInventory);
  }, [menu, user]);
  useEffect(() => subscribeOrders(user, (nextOrders) => {
    if (user?.role === "rider" && nextOrders.length > previousOrderCount.current) navigator.vibrate?.([150, 80, 150]);
    previousOrderCount.current = nextOrders.length;
    setOrders(nextOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }), [user]);
  useEffect(() => {
    if (user?.role !== "owner") {
      setAuditLogs([]);
      return undefined;
    }
    return subscribeAuditLogs(setAuditLogs);
  }, [user]);
  useEffect(() => {
    if (!user || !["owner", "staff"].includes(user.role)) {
      setShiftLogs([]);
      return undefined;
    }
    return subscribeShiftLogs(setShiftLogs);
  }, [user]);
  useEffect(() => {
    if (user?.role !== "staff") {
      setSupportMessages([]);
      return undefined;
    }
    return subscribeSupportMessages(setSupportMessages);
  }, [user]);
  useEffect(() => {
    if (user) setView(defaultViewForRole(user.role));
  }, [user]);
  useEffect(() => {
    api.status().then((result) => setServiceStatus((current) => ({ ...current, ...result.services }))).catch(() => {});
    getSocket().then((socket) => {
      setServiceStatus((current) => ({ ...current, socket: socket.connected }));
      socket.on("connect", () => setServiceStatus((current) => ({ ...current, socket: true })));
      socket.on("disconnect", () => setServiceStatus((current) => ({ ...current, socket: false })));
    }).catch(() => {});
    return disconnectSocket;
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.qty, 0), [cart]);
  if (user === undefined) return <div className="loading-screen">Loading Taptap Foodtrip...</div>;
  if (!user) return <LoginPanel />;

  const allowedViews = roleNavigation[user.role]?.map(([roleView]) => roleView) || [];
  const navigate = (nextView) => {
    if (allowedViews.includes(nextView)) setView(nextView);
  };
  const workspace = user.role === "owner"
    ? <OwnerWorkspace section={view} user={user} orders={orders} inventory={inventory} serviceStatus={serviceStatus} auditLogs={auditLogs} shiftLogs={shiftLogs} notify={setNotice} />
    : user.role === "staff"
      ? <StaffWorkspace section={view} user={user} orders={orders} inventory={inventory} shiftLogs={shiftLogs} messages={supportMessages} serviceStatus={serviceStatus} notify={setNotice} />
      : user.role === "rider"
        ? <RiderWorkspace section={view} user={user} orders={orders} notify={setNotice} />
        : <OrdersView orders={orders} onTrack={setTrackingOrder} />;

  return (
    <div className="app-shell">
      <AppHeader user={user} cartCount={cartCount} activeView={view} onCart={() => setCheckoutOpen(true)} onNavigate={navigate} />
      {user.role === "customer" && view === "store" && <Storefront menu={menu} cart={cart} setCart={setCart} onCheckout={() => setCheckoutOpen(true)} />}
      {user.role === "customer" && view === "orders" && <OrdersView orders={orders} onTrack={setTrackingOrder} />}
      {user.role !== "customer" && workspace}
      {user.role === "customer" && checkoutOpen && <Checkout cart={cart} user={user} onClose={() => setCheckoutOpen(false)} notify={setNotice} onComplete={() => { setCart([]); setCheckoutOpen(false); setView("orders"); }} />}
      {trackingOrder && <TrackingView order={trackingOrder} onClose={() => setTrackingOrder(null)} />}
      {user.role === "customer" && <Assistant user={user} menu={menu} />}
      {notice && <div className="app-toast">{notice}</div>}
    </div>
  );
}
