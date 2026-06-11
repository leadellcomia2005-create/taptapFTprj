import { useEffect, useMemo, useRef, useState } from "react";
import CameraProof from "./components/CameraProof";
import DeliveryMap from "./components/DeliveryMap";
import SalesChart from "./components/SalesChart";
import { demoAccounts, demoSales, fallbackMenu } from "./data/menu";
import { api } from "./services/api";
import {
  createOrder,
  firebaseEnabled,
  login,
  logout,
  observeAuth,
  registerCustomer,
  resetPassword,
  saveRiderLocation,
  subscribeMenu,
  subscribeOrders,
  subscribeRiderLocation,
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
  delivered: "Delivered"
}[value] || value);

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

function AppHeader({ user, cartCount, onCart, onNavigate }) {
  return (
    <header className="app-header">
      <button className="brand-lockup border-0 bg-transparent" onClick={() => onNavigate("store")}>
        <span>T</span><div><strong>Taptap</strong><small>FOODTRIP</small></div>
      </button>
      <nav>
        <button onClick={() => onNavigate("store")}>Storefront</button>
        {user.role === "customer" && <button onClick={() => onNavigate("orders")}>My orders</button>}
        {user.role !== "customer" && <button onClick={() => onNavigate("workspace")}>Workspace</button>}
        <button onClick={() => onNavigate("services")}>Integrations</button>
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

function OwnerWorkspace({ orders, menu, serviceStatus, notify }) {
  const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const [insight, setInsight] = useState("Generate a live OpenAI sales and inventory summary.");
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
  return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Super Admin / Owner</p><h2>Operations overview</h2></div><button className="btn btn-outline-dark" onClick={downloadReport}>Export PDF with jsPDF</button></div>
      <div className="row g-3">
        <div className="col-md-3"><div className="metric-card"><small>Gross sales</small><strong>{currency(totalSales)}</strong><span>Firebase transactions</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Orders</small><strong>{orders.length}</strong><span>All channels</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Menu items</small><strong>{menu.length}</strong><span>Recipe mapped</span></div></div>
        <div className="col-md-3"><div className="metric-card"><small>Services online</small><strong>{Object.values(serviceStatus).filter(Boolean).length}</strong><span>Credential dependent</span></div></div>
        <div className="col-lg-8"><div className="dashboard-card chart-card"><h3>Sales performance · Chart.js</h3><SalesChart values={demoSales.map((value, index) => value + (index === 6 ? totalSales : 0))} /></div></div>
        <div className="col-lg-4"><div className="dashboard-card ai-insight"><p className="eyebrow">OpenAI operations insight</p><h3>Decision support</h3><p>{insight}</p><button className="btn btn-warning w-100" onClick={generateInsight}>Generate AI summary</button></div></div>
        <div className="col-12"><OrderManagement orders={orders} canAdvance notify={notify} /></div>
      </div>
    </main>
  );
}

function OrderManagement({ orders, canAdvance, notify }) {
  const flow = ["received", "preparing", "ready", "out-for-delivery", "delivered"];
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
          <tbody>{orders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td>{order.paymentMethod}</td><td>{currency(order.total)}</td><td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td><td>{canAdvance && order.status !== "delivered" && <button className="btn btn-sm btn-outline-danger" onClick={() => advance(order)}>Advance</button>}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function StaffWorkspace({ orders, menu, notify }) {
  const [posCart, setPosCart] = useState([]);
  const posTotal = posCart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const add = (product) => setPosCart((current) => {
    const found = current.find((item) => item.id === product.id);
    return found ? current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item) : [...current, { ...product, qty: 1 }];
  });
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
  return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Staff / Admin</p><h2>Walk-in POS and order queue</h2></div></div>
      <div className="row g-3">
        <div className="col-xl-8">
          <div className="row g-3">{menu.map((product) => <div className="col-md-4" key={product.id}><button className="pos-product" onClick={() => add(product)}><div className="menu-photo" style={{ backgroundPosition: product.imagePosition }} /><strong>{product.name}</strong><span>{currency(product.price)}</span></button></div>)}</div>
        </div>
        <div className="col-xl-4"><div className="dashboard-card sticky-pos"><h3>Current walk-in order</h3>{posCart.map((item) => <div className="d-flex justify-content-between py-2 border-bottom" key={item.id}><span>{item.qty}× {item.name}</span><strong>{currency(item.qty * item.price)}</strong></div>)}<div className="checkout-total"><span>Total</span><strong>{currency(posTotal)}</strong></div><button className="btn btn-danger w-100" disabled={!posCart.length} onClick={complete}>Accept payment and print receipt</button></div></div>
        <div className="col-12"><OrderManagement orders={orders} canAdvance notify={notify} /></div>
      </div>
    </main>
  );
}

function RiderWorkspace({ user, orders, notify }) {
  const active = orders.find((order) => order.status === "ready" || order.status === "out-for-delivery") || orders[0];
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

  return (
    <main className="container-fluid dashboard-page py-4">
      <div className="dashboard-heading"><div><p className="eyebrow text-danger">Delivery Rider</p><h2>Live delivery operations</h2></div><button className={`btn ${online ? "btn-success" : "btn-outline-success"}`} onClick={toggleOnline}>{online ? "Online · sharing GPS" : "Go online"}</button></div>
      <div className="row g-3">
        <div className="col-lg-5"><div className="dashboard-card">
          <h3>{active ? active.id : "No assigned delivery"}</h3>
          {active && <><p><strong>{active.customerName}</strong><br />{active.address}</p><p>{active.items?.map((item) => `${item.qty}× ${item.name}`).join(", ")}</p><div className="d-grid gap-2"><button className="btn btn-danger" onClick={pickup}>Pick up order</button><a className="btn btn-outline-dark" href={googleMapsUrl} target="_blank" rel="noreferrer">Open Google Maps navigation</a><button className="btn btn-success" disabled={active.status !== "out-for-delivery"} onClick={() => setCameraOpen(true)}>Deliver with camera proof</button></div></>}
        </div></div>
        <div className="col-lg-7"><div className="dashboard-card p-0 overflow-hidden"><DeliveryMap rider={location} /></div></div>
        <div className="col-12"><div className="dashboard-card"><h3>COD ledger</h3><div className="table-responsive"><table className="table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Cash due</th></tr></thead><tbody>{orders.filter((order) => order.paymentMethod === "cod").map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td>{statusLabel(order.status)}</td><td>{currency(order.total)}</td></tr>)}</tbody></table></div></div></div>
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
  const send = async (event) => {
    event.preventDefault();
    if (!input.trim()) return;
    const message = input.trim();
    setInput("");
    setMessages((current) => [...current, { from: "user", text: message }]);
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
      {open && <aside className="assistant-panel"><header><div><strong>TapTap Assistant</strong><small>Dialogflow + OpenAI</small></div><button onClick={() => setOpen(false)}>×</button></header><div className="assistant-messages">{messages.map((message, index) => <div key={index} className={message.from}><span>{message.text}</span>{message.source && <small>{message.source}</small>}</div>)}</div><form onSubmit={send}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask anything..." /><button>Send</button></form></aside>}
    </>
  );
}

function ServicesView({ status }) {
  const services = [
    ["ReactJS", true, "Component application"],
    ["Bootstrap", true, "Responsive UI"],
    ["Chart.js", true, "Owner analytics"],
    ["Leaflet + OpenStreetMap", true, "Delivery maps"],
    ["jsPDF", true, "Sales PDF reports"],
    ["Firebase Authentication", firebaseEnabled, "Role-based login"],
    ["Firebase Realtime Database", firebaseEnabled, "Orders, inventory and tracking"],
    ["Firebase Hosting / Functions", firebaseEnabled, "Deployment and secure APIs"],
    ["Socket.IO", status.socket, "Rider location broadcasts"],
    ["Dialogflow", status.dialogflow, "FAQ intent detection"],
    ["OpenAI API", status.openai, "Sales and inventory insights"],
    ["PayMongo", status.paymongo, "GCash checkout"],
    ["Twilio", status.twilio, "SMS notifications"],
    ["Geolocation API", "geolocation" in navigator, "Rider GPS"],
    ["MediaDevices API", Boolean(navigator.mediaDevices), "Proof-of-delivery camera"],
    ["Vibration API", "vibrate" in navigator, "Rider tactile alerts"],
    ["Google Maps URL Scheme", true, "Native navigation handoff"]
  ];
  return (
    <main className="container py-5">
      <div className="section-title"><div><p className="eyebrow text-danger">Technology audit</p><h2>Integration status</h2></div><p>Credential-dependent services report live configuration from the secure server.</p></div>
      <div className="service-grid">{services.map(([name, active, note]) => <ServiceBadge key={name} name={name} active={Boolean(active)} note={note} />)}</div>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [menu, setMenu] = useState(fallbackMenu);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [view, setView] = useState("store");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [trackingOrder, setTrackingOrder] = useState(null);
  const [notice, setNotice] = useState("");
  const [serviceStatus, setServiceStatus] = useState({ firebase: firebaseEnabled, socket: false, openai: false, dialogflow: false, paymongo: false, twilio: false });
  const previousOrderCount = useRef(0);

  useEffect(() => observeAuth(setUser), []);
  useEffect(() => subscribeMenu(fallbackMenu, setMenu), []);
  useEffect(() => subscribeOrders(user, (nextOrders) => {
    if (user?.role === "rider" && nextOrders.length > previousOrderCount.current) navigator.vibrate?.([150, 80, 150]);
    previousOrderCount.current = nextOrders.length;
    setOrders(nextOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }), [user]);
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

  const workspace = user.role === "owner"
    ? <OwnerWorkspace orders={orders} menu={menu} serviceStatus={serviceStatus} notify={setNotice} />
    : user.role === "staff"
      ? <StaffWorkspace orders={orders} menu={menu} notify={setNotice} />
      : user.role === "rider"
        ? <RiderWorkspace user={user} orders={orders} notify={setNotice} />
        : <OrdersView orders={orders} onTrack={setTrackingOrder} />;

  return (
    <div className="app-shell">
      <AppHeader user={user} cartCount={cartCount} onCart={() => setCheckoutOpen(true)} onNavigate={setView} />
      {view === "store" && <Storefront menu={menu} cart={cart} setCart={setCart} onCheckout={() => setCheckoutOpen(true)} />}
      {view === "orders" && <OrdersView orders={orders} onTrack={setTrackingOrder} />}
      {view === "workspace" && workspace}
      {view === "services" && <ServicesView status={serviceStatus} />}
      {checkoutOpen && <Checkout cart={cart} user={user} onClose={() => setCheckoutOpen(false)} notify={setNotice} onComplete={() => { setCart([]); setCheckoutOpen(false); setView("orders"); }} />}
      {trackingOrder && <TrackingView order={trackingOrder} onClose={() => setTrackingOrder(null)} />}
      <Assistant user={user} menu={menu} />
      {notice && <div className="app-toast">{notice}</div>}
    </div>
  );
}
