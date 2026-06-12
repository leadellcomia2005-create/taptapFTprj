import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraProof from "./components/CameraProof";
import DeliveryMap from "./components/DeliveryMap";
import SalesChart from "./components/SalesChart";
import { demoAccounts, demoSales, fallbackMenu } from "./data/menu";
import { api } from "./services/api";
import {
  adjustInventory,
  completeTwoFactorSession,
  createOrder,
  firebaseEnabled,
  friendlyAuthError,
  login,
  logout,
  observeAuth,
  registerCustomer,
  resetPassword,
  saveUserProfile,
  saveShiftLog,
  saveRiderLocation,
  sendSupportMessage,
  submitReview,
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
  uploadProof
} from "./services/firebase";
import { disconnectSocket, getSocket, joinOrderRoom, sendRiderLocation } from "./services/socket";

const currency = (value) => `₱${Number(value || 0).toLocaleString("en-PH")}`;
const statusLabel = (value) => ({
  received: "Received",
  preparing: "Preparing",
  ready: "Ready",
  "out-for-delivery": "Out for delivery",
  arrived: "Arrived",
  delivered: "Delivered"
}[value] || value);

const relativeTime = (timestamp) => {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const roleNavigation = {
  customer: [
    ["store", "Storefront"],
    ["orders", "Order History"],
    ["receipts", "Digital Receipts"],
    ["feedback", "Reviews & Feedback"],
    ["profile", "Personal Info"]
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
  const registrationRequested = new URLSearchParams(window.location.search).get("register") === "true";
  const registrationStepDefaults = [
    { id: "auth", label: "Authentication user", detail: "Waiting to create the secure email/password identity.", status: "pending" },
    { id: "profile", label: "Customer profile", detail: "Waiting to save the profile in Realtime Database.", status: "pending" },
    { id: "verification", label: "Verification email", detail: "Waiting to request the email from Firebase.", status: "pending" },
    { id: "session", label: "Registration session", detail: "Waiting to close the temporary registration session.", status: "pending" }
  ];
  const [role, setRole] = useState("customer");
  const [registering, setRegistering] = useState(registrationRequested);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(registrationRequested ? "" : demoAccounts.customer.email);
  const [password, setPassword] = useState(registrationRequested ? "" : demoAccounts.customer.password);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [registrationSteps, setRegistrationSteps] = useState(registrationStepDefaults);
  const [registrationResult, setRegistrationResult] = useState(null);

  const updateRegistrationStep = (id, status, detail) => {
    setRegistrationSteps((current) => current.map((step) => (
      step.id === id ? { ...step, status, detail } : step
    )));
  };

  const toggleRegistration = () => {
    setRegistering((current) => {
      const next = !current;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("register", "true");
      else url.searchParams.delete("register");
      window.history.replaceState({}, "", url);
      return next;
    });
    setRole("customer");
    setName("");
    setEmail("");
    setPassword("");
    setError("");
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const selectRole = (nextRole) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("register");
    window.history.replaceState({}, "", url);
    setRole(nextRole);
    setEmail(demoAccounts[nextRole].email);
    setPassword(demoAccounts[nextRole].password);
    setRegistering(false);
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (registering) {
      setRegistrationResult(null);
      setRegistrationSteps(registrationStepDefaults);
    }
    try {
      if (registering) {
        const result = await registerCustomer(name, email, password, updateRegistrationStep);
        setRegistrationResult(result);
        setPassword("");
      } else {
        await login(email, password, role, demoAccounts);
        onLoggedIn?.();
      }
    } catch (authError) {
      setError(friendlyAuthError(authError));
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
          {registering && (
            <div className="firebase-registration-flow" aria-live="polite">
              <div className="registration-flow-heading">
                <div><strong>Live Firebase activity</strong><small>Project: taptapftprj-leadell-2026</small></div>
                <span>{registrationResult ? "Complete" : busy ? "Working" : "Ready"}</span>
              </div>
              {registrationSteps.map((step) => (
                <div className={`registration-step registration-${step.status}`} key={step.id}>
                  <span className="registration-step-icon" aria-hidden="true" />
                  <div><strong>{step.label}</strong><small>{step.detail}</small></div>
                </div>
              ))}
              {registrationResult && (
                <div className="registration-result">
                  <strong>Customer account created</strong>
                  <span>UID: <code>{registrationResult.uid}</code></span>
                  <span>Database: <code>{registrationResult.profilePath}</code></span>
                  <span>{registrationResult.verificationSent ? "Verification email requested." : "Verification email still needs to be resent."}</span>
                </div>
              )}
            </div>
          )}
          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          <button className="btn btn-danger w-100" disabled={busy}>
            {busy ? "Registering in Firebase..." : registering ? "Register with Firebase" : `Sign in as ${role}`}
          </button>
          {/* erick: dating plain links, ginawang outline buttons para clickable. */}
          <div className="d-flex justify-content-between gap-2 mt-3">
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={toggleRegistration}>
              {registering ? "Back to sign in" : "Customer registration"}
            </button>
            {!registering && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => resetPassword(email).catch((resetError) => setError(resetError.message))}>Reset password</button>}
          </div>
        </form>
      </div>
    </div>
  );
}

function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] || "");
  const update = (index, nextValue) => {
    const digit = nextValue.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    onChange(next.join(""));
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };
  const paste = (event) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted.length) return;
    event.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 6) - 1]?.focus();
  };
  return (
    <div className="otp-inputs" onPaste={paste}>
      {digits.map((digit, index) => (
        <input
          aria-label={`Digit ${index + 1}`}
          autoComplete="one-time-code"
          disabled={disabled}
          inputMode="numeric"
          key={index}
          maxLength="1"
          onChange={(event) => update(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
          }}
          ref={(element) => { refs.current[index] = element; }}
          value={digit}
        />
      ))}
    </div>
  );
}

function TwoFactorPanel({ user }) {
  const status = user.twoFactor || {};
  const setup = !status.enabled;
  const [method, setMethod] = useState(status.method || "totp");
  const [setupData, setSetupData] = useState(null);
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const beginTotp = async () => {
    setBusy(true);
    setError("");
    try {
      setSetupData(await api.beginTotpSetup());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const sendSms = async () => {
    setBusy(true);
    setError("");
    try {
      await api.sendTwoFactorSms(setup ? "setup" : "challenge");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = setup
        ? await api.finishTwoFactorSetup(method, code)
        : await api.verifyTwoFactor(backupMode ? { backupCode } : { code });
      if (response.backupCodes) setResult(response);
      else await completeTwoFactorSession(response.customToken);
    } catch (requestError) {
      setCode("");
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  if (status.locked) {
    return (
      <div className="security-screen"><div className="security-card">
        <p className="eyebrow text-danger">Account locked</p>
        <h2>2FA verification is locked</h2>
        <p>Three consecutive verification attempts failed. An owner must unlock this account from Users & Roles.</p>
        <button className="btn btn-outline-danger" onClick={() => resetPassword(user.email).then(() => window.alert("Password reset email sent. After changing the password, sign in again to unlock 2FA.")).catch((requestError) => window.alert(requestError.message))}>Reset password to unlock</button>
        <button className="btn btn-link text-danger" onClick={logout}>Return to sign in</button>
      </div></div>
    );
  }

  if (result?.backupCodes) {
    return (
      <div className="security-screen"><div className="security-card">
        <p className="eyebrow text-danger">Recovery codes</p>
        <h2>Save these backup codes</h2>
        <p>Each code works once. They cannot be displayed again after you continue.</p>
        <div className="backup-code-grid">{result.backupCodes.map((item) => <code key={item}>{item}</code>)}</div>
        <button className="btn btn-danger w-100" onClick={() => completeTwoFactorSession(result.customToken)}>I saved my codes, continue</button>
      </div></div>
    );
  }

  return (
    <div className="security-screen">
      <form className="security-card" onSubmit={verify}>
        <p className="eyebrow text-danger">{setup ? "Required security setup" : "Second verification step"}</p>
        <h2>{setup ? "Set up two-factor authentication" : "Verify your sign-in"}</h2>
        <p>{setup ? "Choose an authenticator app or SMS. Every POS account must enroll before access is granted." : `Enter the code from your ${status.method === "sms" ? "phone" : "authenticator app"}.`}</p>
        {setup && (
          <div className="security-methods">
            <button type="button" className={method === "totp" ? "active" : ""} onClick={() => { setMethod("totp"); setSetupData(null); setCode(""); }}>
              <strong>Authenticator App</strong><small>Free, offline 30-second codes</small>
            </button>
            <button type="button" disabled={!status.smsAvailable} className={method === "sms" ? "active" : ""} onClick={() => { setMethod("sms"); setSetupData(null); setCode(""); }}>
              <strong>SMS OTP</strong><small>{status.smsAvailable ? `Send to ${status.phoneMasked}` : "Requires a phone number and Twilio"}</small>
            </button>
          </div>
        )}
        {setup && method === "totp" && !setupData && <button type="button" className="btn btn-outline-danger w-100" disabled={busy || !status.totpAvailable} onClick={beginTotp}>Generate authenticator QR code</button>}
        {setupData && method === "totp" && <div className="totp-setup"><img src={setupData.qrDataUrl} alt="Authenticator setup QR code" /><p>Manual key: <code>{setupData.manualKey}</code></p></div>}
        {method === "sms" && !backupMode && <button type="button" className="btn btn-outline-danger w-100 mb-3" disabled={busy || !status.smsAvailable} onClick={sendSms}>Send 6-digit SMS code</button>}
        {!backupMode ? (
          <>
            <label className="form-label">6-digit verification code</label>
            <OtpInput value={code} onChange={setCode} disabled={busy} />
          </>
        ) : (
          <label className="form-label">Single-use backup code<input className="form-control" autoComplete="one-time-code" value={backupCode} onChange={(event) => setBackupCode(event.target.value.toUpperCase())} /></label>
        )}
        {error && <div className="alert alert-danger py-2 small mt-3">{error}</div>}
        <button className="btn btn-danger w-100 mt-3" disabled={busy || (!backupMode && code.length !== 6) || (backupMode && backupCode.length < 8)}>
          {busy ? "Verifying..." : setup ? "Verify and enable 2FA" : "Verify and open POS"}
        </button>
        {!setup && <button type="button" className="btn btn-link text-danger w-100" onClick={() => setBackupMode((current) => !current)}>{backupMode ? "Use verification code" : "Use backup code"}</button>}
        <button type="button" className="btn btn-link text-secondary w-100" onClick={logout}>Cancel and sign out</button>
      </form>
    </div>
  );
}

function AppHeader({ user, cartCount, activeView, unreadCount, onCart, onNavigate, onNotifications }) {
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
        <button className="notification-button" onClick={onNotifications} aria-label="Open notifications"><span className="bell-icon" aria-hidden="true">&#128276;</span>{unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}</button>
        <div className="user-chip"><span>{user.name?.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div>
        {/* erick: ginawang solid red button (dati plain text link). */}
        <button className="btn btn-danger btn-sm" onClick={logout}>Log out</button>
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
        <header><div><p className="eyebrow text-danger">Your realtime updates</p><h3>Notifications</h3></div><div className="notification-tools"><button className="clear-notifications" disabled={!notifications.length} onClick={clearAll}>Clear all</button><button aria-label="Close notifications" onClick={onClose}>X</button></div></header>
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

function Storefront({ menu, cart, setCart, onCheckout }) {
  const [category, setCategory] = useState("All");
  const categories = ["All", ...new Set(menu.map((item) => item.category))];
  const visible = category === "All" ? menu : menu.filter((item) => item.category === category);
  // erick: i-cap ang add-to-cart sa available stock (gaya ng POS) para hindi lumampas.
  const add = (product) => setCart((current) => {
    const existing = current.find((item) => item.id === product.id);
    if (existing) {
      if (existing.qty >= product.stock) return current;
      return current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1, stock: product.stock } : item);
    }
    if (product.stock < 1) return current;
    return [...current, { ...product, qty: 1 }];
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

function Checkout({ cart, user, profile, paymongoEnabled, onClose, onComplete, notify }) {
  const [payment, setPayment] = useState(paymongoEnabled ? "gcash" : "cod");
  const [phone, setPhone] = useState(profile?.phone || "+639171234567");
  const [address, setAddress] = useState(profile?.address || "BF Resort Village, Las Pinas City");
  const [busy, setBusy] = useState(false);
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0) + 49;

  const place = async () => {
    if (!phone.trim() || !address.trim()) {
      notify("Enter a mobile number and delivery address before placing the order.");
      return;
    }
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
      if (payment === "gcash") {
        try {
          const result = await api.createPayment({ orderId, successUrl: window.location.href, cancelUrl: window.location.href });
          if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
          else notify(`Order ${orderId} created. PayMongo is awaiting credentials.`);
        } catch (paymentError) {
          notify(`Order ${orderId} created. ${paymentError.message}`);
        }
      } else {
        notify(`Order ${orderId} was sent to the kitchen.`);
      }
      onComplete(orderId);
    } catch (error) {
      notify(error.message || "The order could not be placed. Please try again.");
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
              <div className="col-6"><button className={`payment-option ${payment === "gcash" ? "active" : ""}`} disabled={!paymongoEnabled} onClick={() => setPayment("gcash")}><strong>GCash</strong><small>{paymongoEnabled ? "via PayMongo" : "Not configured"}</small></button></div>
              <div className="col-6"><button className={`payment-option ${payment === "cod" ? "active" : ""}`} onClick={() => setPayment("cod")}><strong>Cash on delivery</strong><small>Rider ledger</small></button></div>
            </div>
            <div className="checkout-total"><span>Total including delivery</span><strong>{currency(total)}</strong></div>
          </div>
          <div className="modal-footer"><button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={busy || !phone.trim() || !address.trim()} onClick={place}>{busy ? "Processing..." : "Place order"}</button></div>
        </div>
      </div>
    </div>
  );
}

function OrdersView({ orders, onTrack }) {
  return (
    <main className="container py-5">
      <div className="section-title"><div><p className="eyebrow text-danger">Realtime Database</p><h2>Order history</h2></div><p>Review previous and active purchases with live delivery status.</p></div>
      {orders.length === 0 ? <div className="empty-state">No orders yet.</div> : orders.map((order) => (
        <article className="order-card" key={order.id}>
          <div><small>{order.id}</small><h3>{order.items?.map((item) => `${item.qty}× ${item.name}`).join(", ")}</h3><p>{order.address}</p></div>
          <div className="text-end"><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span><strong>{currency(order.total)}</strong><button className="btn btn-link btn-sm" onClick={() => onTrack(order)}>Track live</button></div>
        </article>
      ))}
    </main>
  );
}

function CustomerProfile({ user, profile, notify }) {
  const [form, setForm] = useState(profile || {});
  useEffect(() => setForm(profile || {}), [profile]);
  const save = async (event) => {
    event.preventDefault();
    await saveUserProfile(user, form);
    notify("Personal information and saved address updated.");
  };
  return (
    <main className="container py-5 customer-page">
      <div className="section-title"><div><p className="eyebrow text-danger">Account settings</p><h2>Personal info</h2></div><p>Keep your contact details and preferred delivery address ready for checkout.</p></div>
      <form className="dashboard-card profile-form" onSubmit={save}>
        <div className="row g-3">
          <label className="form-label col-md-6">Full name<input className="form-control" required value={form.name || ""} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="form-label col-md-6">Email<input className="form-control" value={user.email} disabled /></label>
          <label className="form-label col-md-6">Mobile number<input className="form-control" value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+63 917 123 4567" /></label>
          <label className="form-label col-md-6">City<input className="form-control" value={form.city || ""} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} /></label>
          <label className="form-label col-12">Saved delivery address<textarea className="form-control" rows="3" value={form.address || ""} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="House number, street, barangay and landmark" /></label>
        </div>
        <div className="profile-preferences"><strong>Notification preferences</strong><label><input type="checkbox" checked={form.notificationPreferences?.orderUpdates !== false} onChange={(event) => setForm((current) => ({ ...current, notificationPreferences: { ...current.notificationPreferences, orderUpdates: event.target.checked } }))} /> Order status updates</label><label><input type="checkbox" checked={form.notificationPreferences?.promotions !== false} onChange={(event) => setForm((current) => ({ ...current, notificationPreferences: { ...current.notificationPreferences, promotions: event.target.checked } }))} /> Promotions and offers</label></div>
        <button className="btn btn-danger">Save personal information</button>
      </form>
    </main>
  );
}

function ReceiptsView({ orders }) {
  const downloadReceipt = async (order) => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.setFontSize(20);
    pdf.text("Taptap Foodtrip", 18, 20);
    pdf.setFontSize(12);
    pdf.text("Digital Receipt", 18, 29);
    pdf.setFontSize(10);
    pdf.text(`Receipt: ${order.id}`, 18, 40);
    pdf.text(`Date: ${new Date(order.createdAt).toLocaleString("en-PH")}`, 18, 47);
    pdf.text(`Customer: ${order.customerName}`, 18, 54);
    pdf.text(`Payment: ${order.paymentMethod?.toUpperCase()}`, 18, 61);
    order.items?.forEach((item, index) => pdf.text(`${item.qty} x ${item.name} - ${currency(item.qty * item.price)}`, 18, 76 + index * 8));
    pdf.setFontSize(13);
    pdf.text(`Total: ${currency(order.total)}`, 18, 90 + (order.items?.length || 0) * 8);
    pdf.save(`${order.id}-receipt.pdf`);
  };
  return (
    <main className="container py-5 customer-page">
      <div className="section-title"><div><p className="eyebrow text-danger">Paperless records</p><h2>Digital receipts</h2></div><p>View and download itemized receipts for online orders.</p></div>
      <div className="receipt-grid">{orders.length === 0 && <div className="empty-state">No receipts available yet.</div>}{orders.map((order) => <article className="receipt-card" key={order.id}><div className="receipt-brand">T</div><div><small>{new Date(order.createdAt).toLocaleDateString("en-PH")}</small><h3>{order.id}</h3><p>{order.items?.map((item) => `${item.qty}× ${item.name}`).join(", ")}</p><span>{order.paymentMethod?.toUpperCase()} · {statusLabel(order.status)}</span></div><div className="receipt-total"><strong>{currency(order.total)}</strong><button className="btn btn-sm btn-outline-dark" onClick={() => downloadReceipt(order)}>Download PDF</button></div></article>)}</div>
    </main>
  );
}

function ReviewsView({ user, orders, reviews, notify }) {
  const reviewByOrder = new Map(reviews.map((review) => [review.orderId, review]));
  const eligibleOrders = orders.filter((order) => order.status === "delivered" && !reviewByOrder.has(order.id));
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const selectedOrder = eligibleOrders.find((order) => order.id === selectedOrderId) || eligibleOrders[0];
  const submit = async (event) => {
    event.preventDefault();
    if (!selectedOrder) return;
    await submitReview(selectedOrder, user, rating, comment.trim());
    setSelectedOrderId("");
    setRating(5);
    setComment("");
    notify(`Thank you for rating ${selectedOrder.id}.`);
  };
  return (
    <main className="container py-5 customer-page">
      <div className="section-title"><div><p className="eyebrow text-danger">Customer experience</p><h2>Reviews & Feedback</h2></div><p>Rate recent completed orders and revisit your previous reviews.</p></div>
      <div className="row g-4">
        <div className="col-lg-5"><form className="dashboard-card review-form" onSubmit={submit}><h3>Rate your recent orders</h3>{eligibleOrders.length === 0 ? <div className="empty-chat">Delivered orders without reviews will appear here.</div> : <><label className="form-label">Order<select className="form-select" value={selectedOrder?.id || ""} onChange={(event) => setSelectedOrderId(event.target.value)}>{eligibleOrders.map((order) => <option key={order.id} value={order.id}>{order.id} · {new Date(order.createdAt).toLocaleDateString("en-PH")}</option>)}</select></label><div className="rating-picker" aria-label="Rating">{[1,2,3,4,5].map((star) => <button type="button" className={star <= rating ? "active" : ""} key={star} onClick={() => setRating(star)}>★</button>)}</div><label className="form-label">Feedback<textarea className="form-control" rows="4" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Tell us about the food and service..." /></label><button className="btn btn-danger w-100">Submit review</button></>}</form></div>
        <div className="col-lg-7"><div className="dashboard-card"><h3>Previous reviews</h3>{reviews.length === 0 && <div className="empty-chat">You have not submitted a review yet.</div>}{reviews.map((review) => <article className="previous-review" key={review.id}><div><strong>{review.orderId}</strong><span>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></div><p>{review.comment || "No written feedback."}</p><small>{review.items?.join(", ")} · {new Date(review.createdAt).toLocaleDateString("en-PH")}</small></article>)}</div></div>
      </div>
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
  const [managedUsers, setManagedUsers] = useState([]);
  const [adminMessage, setAdminMessage] = useState({ uid: "", title: "Message from administrator", message: "" });
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
      notify(action === "reset" ? "2FA reset. The user must enroll again." : "The account was unlocked.");
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
      <div className="col-12"><div className="dashboard-card"><h3>Project users and 2FA security</h3><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>2FA</th><th>Security controls</th></tr></thead><tbody>{managedUsers.length === 0 && <tr><td colSpan="5" className="text-center text-secondary py-4">No Firebase users were returned.</td></tr>}{managedUsers.map((account) => <tr key={account.uid}><td><strong>{account.name}</strong><small className="d-block text-secondary">{account.uid}</small></td><td>{account.email}</td><td><span className="role-badge">{account.role}</span></td><td><span className={`stock-badge ${account.twoFactorEnabled && !account.twoFactorLocked ? "healthy" : "low"}`}>{account.twoFactorLocked ? "Locked" : account.twoFactorEnabled ? `${account.twoFactorMethod} enabled` : "Not set up"}</span></td><td><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-danger" onClick={() => securityAction(account.uid, "reset")}>Reset 2FA</button>{account.twoFactorLocked && <button className="btn btn-sm btn-dark" onClick={() => securityAction(account.uid, "unlock")}>Unlock</button>}</div></td></tr>)}</tbody></table></div></div></div>
      <div className="col-xl-6"><form className="dashboard-card" onSubmit={updateRole}><h3>Assign Firebase role</h3><p className="module-note">Enter a Firebase Authentication UID. Custom claims are updated securely by the Node.js API.</p><label className="form-label">User UID<input className="form-control" required value={roleForm.uid} onChange={(event) => setRoleForm((current) => ({ ...current, uid: event.target.value }))} /></label><label className="form-label">Role<select className="form-select" value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))}><option>owner</option><option>staff</option><option>rider</option><option>customer</option></select></label><button className="btn btn-danger w-100 mt-3">Update role</button></form></div>
      <div className="col-xl-6"><form className="dashboard-card" onSubmit={sendAdminMessage}><h3>Private admin notification</h3><label className="form-label">Recipient<select className="form-select" required value={adminMessage.uid} onChange={(event) => setAdminMessage((current) => ({ ...current, uid: event.target.value }))}><option value="">Select a user</option>{managedUsers.map((account) => <option key={account.uid} value={account.uid}>{account.name} ({account.role})</option>)}</select></label><label className="form-label">Title<input className="form-control" required value={adminMessage.title} onChange={(event) => setAdminMessage((current) => ({ ...current, title: event.target.value }))} /></label><label className="form-label">Message<textarea className="form-control" required maxLength="1000" rows="3" value={adminMessage.message} onChange={(event) => setAdminMessage((current) => ({ ...current, message: event.target.value }))} /></label><button className="btn btn-dark w-100 mt-3">Send only to this user</button></form></div>
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
  // erick: dinagdag ang Items column (+ address) para makita ng staff ang in-order.
  return (
    <div className="dashboard-card">
      <h3>Live order ledger</h3>
      <div className="table-responsive">
        <table className="table align-middle">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>{orders.length === 0 && <tr><td colSpan="7" className="text-center text-secondary py-4">No orders in the queue.</td></tr>}{orders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customerName}</td><td className="order-items-cell"><span>{order.items?.map((item) => `${item.qty}× ${item.name}`).join(", ") || "—"}</span>{order.address && order.address !== "Counter" && <small className="d-block text-secondary">{order.address}</small>}</td><td>{order.paymentMethod}</td><td>{currency(order.total)}</td><td><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></td><td>{canAdvance && order.status !== "delivered" && <button className="btn btn-sm btn-outline-danger" onClick={() => advance(order)}>Advance</button>}</td></tr>)}</tbody>
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
    joinOrderRoom(order.id).catch(() => {});
    return subscribeRiderLocation(order.id, setRider);
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
    if (activeUser?.role !== "customer") {
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

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.qty, 0), [cart]);
  if (user === undefined) return <div className="loading-screen">Loading Taptap Foodtrip...</div>;
  if (!user) return <LoginPanel />;
  if (!user.mfaVerified) return <TwoFactorPanel user={user} />;

  const currentUser = { ...user, name: profile?.name || user.name };
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const allowedViews = roleNavigation[user.role]?.map(([roleView]) => roleView) || [];
  const navigate = (nextView) => {
    if (allowedViews.includes(nextView)) setView(nextView);
  };
  const workspace = user.role === "owner"
    ? <OwnerWorkspace section={view} user={currentUser} orders={orders} inventory={inventory} serviceStatus={serviceStatus} auditLogs={auditLogs} shiftLogs={shiftLogs} notify={setNotice} />
    : user.role === "staff"
      ? <StaffWorkspace section={view} user={currentUser} orders={orders} inventory={inventory} shiftLogs={shiftLogs} messages={supportMessages} serviceStatus={serviceStatus} notify={setNotice} />
      : user.role === "rider"
        ? <RiderWorkspace section={view} user={currentUser} orders={orders} notify={setNotice} />
        : <OrdersView orders={orders} onTrack={setTrackingOrder} />;

  return (
    <div className="app-shell">
      <AppHeader user={currentUser} cartCount={cartCount} activeView={view} unreadCount={unreadCount} onCart={() => setCheckoutOpen(true)} onNavigate={navigate} onNotifications={() => setNotificationsOpen(true)} />
      {user.role === "customer" && view === "store" && <Storefront menu={menu} cart={cart} setCart={setCart} onCheckout={() => setCheckoutOpen(true)} />}
      {user.role === "customer" && view === "orders" && <OrdersView orders={orders} onTrack={setTrackingOrder} />}
      {user.role === "customer" && view === "receipts" && <ReceiptsView orders={orders} />}
      {user.role === "customer" && view === "feedback" && <ReviewsView user={currentUser} orders={orders} reviews={reviews} notify={setNotice} />}
      {user.role === "customer" && view === "profile" && <CustomerProfile user={currentUser} profile={profile} notify={setNotice} />}
      {user.role !== "customer" && workspace}
      {user.role === "customer" && checkoutOpen && <Checkout cart={cart} user={currentUser} profile={profile} paymongoEnabled={serviceStatus.paymongo} onClose={() => setCheckoutOpen(false)} notify={setNotice} onComplete={() => { setCart([]); setCheckoutOpen(false); setView("orders"); }} />}
      {trackingOrder && <TrackingView order={trackingOrder} onClose={() => setTrackingOrder(null)} />}
      {user.role === "customer" && <Assistant user={currentUser} menu={menu} />}
      {notificationsOpen && <NotificationCenter notifications={notifications} onClose={() => setNotificationsOpen(false)} />}
      {notice && <div className="app-toast">{notice}</div>}
    </div>
  );
}
