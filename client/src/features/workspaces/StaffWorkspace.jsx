import { useEffect, useRef, useState } from "react";
import { AlertCircle, Banknote, ChefHat, Clock3, CreditCard, PackageSearch, RefreshCw, Search, ShoppingCart } from "lucide-react";
import MenuPhoto from "../../components/MenuPhoto";
import { staffPosCategories } from "../../config/appConfig";
import { getActiveShift, startShift } from "../../services/firebase/operations";
import { createOrder } from "../../services/firebase/orders";
import { createRequestKey, orderPrepClock } from "../../utils/operations";
import { ComplaintResolutionModule, InventoryModule, KitchenQueue, OrderManagement, ReviewModerationModule, SettingsModule, ShiftLogsModule, SupportChat } from "./SharedWorkspaceModules";
import { currency, inRange, isRevenueOrder, localDateInputValue, printReceipt, reportDateRange, setWorkspaceHelpers } from "./workspaceHelpers";

const staffDashboardProfiles = {
  manager: { eyebrow: "Staff manager", title: "Operations dashboard", detail: "Counter, kitchen, inventory, and shift exceptions for today." },
  cashier: { eyebrow: "Cashier", title: "Counter dashboard", detail: "Walk-in sales, counter handoffs, payments, and your active shift." },
  kitchen: { eyebrow: "Kitchen", title: "Kitchen dashboard", detail: "Preparation order, aging, and ready handoffs." },
  inventory: { eyebrow: "Inventory", title: "Stock dashboard", detail: "Low stock, sold-out products, and receiving priorities." }
};

function StaffWorkspaceContent({ section, user, orders, inventory: staffInventory, reviews, complaints = [], shiftLogs, messages, serviceStatus, notify, onNavigate }) {
  const orderRequestKeyRef = useRef("");
  const [posCart, setPosCart] = useState([]);
  const [posCategory, setPosCategory] = useState("all");
  const [posSearch, setPosSearch] = useState("");
  const [posDiscount, setPosDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [posPaymentMethod, setPosPaymentMethod] = useState("cash");
  const [posCashReceived, setPosCashReceived] = useState(0);
  const [diningOption, setDiningOption] = useState("dine-in");
  const [lastReceipt, setLastReceipt] = useState(null);
  const [activeShift, setActiveShift] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftError, setShiftError] = useState("");
  const [openingCash, setOpeningCash] = useState(2000);
  const [openingShift, setOpeningShift] = useState(false);
  const [completingPayment, setCompletingPayment] = useState(false);
  const loadActiveShift = async () => {
    setShiftLoading(true);
    setShiftError("");
    try {
      const result = await getActiveShift();
      setActiveShift(result.shift || null);
    } catch (error) {
      setShiftError(error.message || "The active shift could not be loaded.");
    } finally {
      setShiftLoading(false);
    }
  };
  useEffect(() => {
    if (!["staff-overview", "staff-pos", "staff-shifts"].includes(section)) return undefined;
    let mounted = true;
    setShiftLoading(true);
    setShiftError("");
    getActiveShift().then((result) => {
      if (mounted) setActiveShift(result.shift || null);
    }).catch((error) => {
      if (mounted) setShiftError(error.message || "The active shift could not be loaded.");
    }).finally(() => {
      if (mounted) setShiftLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [section]);
  const activePosCategory = staffPosCategories.find((item) => item.id === posCategory) || staffPosCategories[0];
  const visibleInventory = staffInventory.filter((item) => {
    const query = posSearch.trim().toLowerCase();
    return activePosCategory.matches(item) && (!query || `${item.name} ${item.category || ""}`.toLowerCase().includes(query));
  });
  const categoryCount = (category) => staffInventory.filter(category.matches).length;
  const categoryCountLabel = (category) => {
    const count = categoryCount(category);
    return `${count} item${count === 1 ? "" : "s"}`;
  };
  const inventory = section === "staff-pos" ? visibleInventory : staffInventory;
  const posSubtotal = posCart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const posDiscountAmount = Math.max(0, Math.min(posSubtotal, Number(posDiscount || 0)));
  const posTotal = Math.max(0, posSubtotal - posDiscountAmount);
  const posChange = posPaymentMethod === "cash" ? Math.max(0, Number(posCashReceived || 0) - posTotal) : 0;
  const add = (product) => setPosCart((current) => {
    const found = current.find((item) => item.id === product.id);
    if (found?.qty >= product.stock) {
      notify(`Only ${product.stock} ${product.name} item(s) are available.`);
      return current;
    }
    if (!found && Number(product.stock || 0) <= Number(product.reorderPoint || 0)) {
      notify(`${product.name} is low stock. Check inventory after this sale.`);
    }
    return found ? current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item) : [...current, { ...product, qty: 1 }];
  });
  const decrease = (productId) => setPosCart((current) => current
    .map((item) => item.id === productId ? { ...item, qty: item.qty - 1 } : item)
    .filter((item) => item.qty > 0));
  const remove = (productId) => setPosCart((current) => current.filter((item) => item.id !== productId));
  const clearCart = () => {
    if (!posCart.length || window.confirm("Clear the current walk-in order?")) setPosCart([]);
  };
  const complete = async () => {
    if (completingPayment) return;
    if (!activeShift) {
      notify("Start a shift before accepting walk-in payments.");
      return;
    }
    if (!navigator.onLine) {
      notify("You are offline. Reconnect before completing a POS order.");
      return;
    }
    if (posDiscountAmount > 0 && !discountReason) {
      notify("Select a discount reason before accepting payment.");
      return;
    }
    if (posPaymentMethod === "cash" && Number(posCashReceived || 0) < posTotal) {
      notify("Cash received must cover the walk-in order total.");
      return;
    }
    setCompletingPayment(true);
    try {
      const payload = {
        idempotencyKey: orderRequestKeyRef.current || (orderRequestKeyRef.current = createRequestKey("pos-order")),
        customerId: "walk-in",
        customerName: "Walk-in Customer",
        paymentMethod: posPaymentMethod,
        total: posTotal,
        subtotal: posSubtotal,
        discount: posDiscountAmount,
        discountReason: posDiscountAmount > 0 ? discountReason : "",
        cashReceived: posPaymentMethod === "cash" ? Number(posCashReceived || 0) : null,
        changeDue: posPaymentMethod === "cash" ? posChange : 0,
        diningOption,
        cashierName: user.name,
        shiftId: activeShift.id || activeShift.staffId,
        deliveryType: "walk-in",
        address: "Counter",
        phone: "",
        items: posCart
      };
      const orderId = await createOrder(payload);
      orderRequestKeyRef.current = "";
      const receipt = { id: orderId, ...payload, createdAt: Date.now(), status: "received" };
      setPosCart([]);
      setPosDiscount(0);
      setDiscountReason("");
      setPosCashReceived(0);
      setLastReceipt(receipt);
      if (!printReceipt(receipt)) notify("Allow pop-ups to print the receipt.");
      notify(`Walk-in receipt ${orderId} completed.`);
    } catch (error) {
      notify(error.message || "The POS payment could not be completed.");
    } finally {
      setCompletingPayment(false);
    }
  };
  const openShiftFromPos = async () => {
    setOpeningShift(true);
    try {
      const result = await startShift({ openingCash: Number(openingCash || 0) }, user);
      setActiveShift(result.shift);
      notify("Shift opened. Walk-in POS is ready.");
    } catch (error) {
      notify(error.message || "Shift could not be started. Restart the app if this keeps happening.");
    } finally {
      setOpeningShift(false);
    }
  };
  const paymentBlocker = !activeShift
    ? "Start a staff shift to accept payment."
    : !posCart.length
      ? "Add at least one item to the cart."
      : posDiscountAmount > 0 && !discountReason
        ? "Select a discount reason."
        : posPaymentMethod === "cash" && Number(posCashReceived || 0) < posTotal
        ? "Cash received must cover the total."
        : "";

  if (section === "staff-pos") return (
    <main className="container-fluid dashboard-page staff-pos-page">
      <section className="staff-pos-hero">
        <div>
          <p className="eyebrow">Fast counter entry</p>
          <h2>Walk-in POS</h2>
          <span>{activePosCategory.label} - {inventory.length} item{inventory.length === 1 ? "" : "s"}</span>
        </div>
        <div className="staff-pos-total">
          <small>Current total</small>
          <strong>{currency(posTotal)}</strong>
        </div>
      </section>

      <section className="staff-pos-layout">
        <div className="staff-pos-menu">
          <div className="pos-menu-tools">
            <label className="staff-pos-search"><Search size={18} aria-hidden="true" /><span className="visually-hidden">Search POS products</span><input type="search" value={posSearch} onChange={(event) => setPosSearch(event.target.value)} placeholder="Search POS products" /></label>
            <div className="pos-category-rail" aria-label="Staff POS menu categories">
              {staffPosCategories.map((category) => (
                <button key={category.id} className={posCategory === category.id ? "active" : ""} aria-pressed={posCategory === category.id} onClick={() => setPosCategory(category.id)}>
                  <strong>{category.label}</strong>
                  <span>{categoryCountLabel(category)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="staff-product-grid">
            {inventory.length === 0 && <div className="empty-state compact">No POS products match this search and category.</div>}
            {inventory.map((product, index) => (
              <button className="pos-product" key={product.id} disabled={product.stock <= 0} onClick={() => add(product)}>
                <MenuPhoto product={product} priority={index < 6} />
                <strong>{product.name}</strong>
                <span>{currency(product.price)} - {product.stock} available</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="dashboard-card sticky-pos staff-checkout-panel">
          <div className="module-heading"><div><p className="eyebrow text-danger">Order cart</p><h3>Current walk-in order</h3></div>{posCart.length > 0 && <button className="btn btn-link btn-sm text-danger p-0" onClick={clearCart}>Clear cart</button>}</div>
          <div className="staff-cart-list">
            {posCart.length === 0 && <div className="empty-chat">Select products to begin a POS order.</div>}
            {posCart.map((item) => (
              <div className="pos-cart-item" key={item.id}>
                <div><strong>{item.name}</strong><small>{currency(item.price)} each</small></div>
                <div className="pos-quantity"><button onClick={() => decrease(item.id)} aria-label={`Decrease ${item.name}`}>-</button><span>{item.qty}</span><button disabled={item.qty >= item.stock} onClick={() => add(item)} aria-label={`Increase ${item.name}`}>+</button></div>
                <strong>{currency(item.qty * item.price)}</strong>
                <button className="pos-remove" onClick={() => remove(item.id)}>Remove</button>
              </div>
            ))}
          </div>
          <div className="pos-payment-panel">
            {!activeShift && (
              <div className="pos-shift-inline">
                <strong>Shift required</strong>
                <span>Open a staff shift before taking payment.</span>
                <div className="pos-shift-inline-actions">
                  <input className="form-control" type="number" min="0" aria-label="Opening cash" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} />
                  <button className="btn btn-danger btn-sm" disabled={openingShift} onClick={openShiftFromPos}>{openingShift ? "Starting..." : "Start shift"}</button>
                </div>
              </div>
            )}
            <div className="checkout-mode-grid" aria-label="Walk-in type">
              <button className={diningOption === "dine-in" ? "active" : ""} type="button" aria-pressed={diningOption === "dine-in"} onClick={() => setDiningOption("dine-in")}><strong>Dine-in</strong><small>Counter order</small></button>
              <button className={diningOption === "takeout" ? "active" : ""} type="button" aria-pressed={diningOption === "takeout"} onClick={() => setDiningOption("takeout")}><strong>Takeout</strong><small>Pack to go</small></button>
            </div>
            <div className="pos-payment-methods" role="group" aria-label="Payment method">
              <button type="button" className={posPaymentMethod === "cash" ? "active" : ""} aria-pressed={posPaymentMethod === "cash"} onClick={() => setPosPaymentMethod("cash")}><Banknote size={17} aria-hidden="true" /><span><strong>Cash</strong><small>Counter payment</small></span></button>
              <button type="button" className={posPaymentMethod === "gcash" ? "active" : ""} aria-pressed={posPaymentMethod === "gcash"} onClick={() => setPosPaymentMethod("gcash")}><CreditCard size={17} aria-hidden="true" /><span><strong>GCash</strong><small>Confirm received</small></span></button>
            </div>
            <label className="form-label">Discount amount<input className="form-control" type="number" min="0" value={posDiscount} onChange={(event) => setPosDiscount(event.target.value)} /></label>
            {posDiscountAmount > 0 && <label className="form-label">Discount reason<select className="form-select" required value={discountReason} onChange={(event) => setDiscountReason(event.target.value)}><option value="">Select a reason</option><option value="senior-pwd">Senior / PWD</option><option value="promotion">Approved promotion</option><option value="service-recovery">Service recovery</option><option value="manager-approved">Manager approved</option></select></label>}
            {posPaymentMethod === "cash" && <><label className="form-label">Cash received<input className="form-control" type="number" min="0" value={posCashReceived} onChange={(event) => setPosCashReceived(event.target.value)} /></label><div className="pos-cash-shortcuts" aria-label="Cash received shortcuts"><button type="button" onClick={() => setPosCashReceived(posTotal)}>Exact</button><button type="button" onClick={() => setPosCashReceived(Math.ceil(posTotal / 50) * 50)}>Next PHP 50</button><button type="button" onClick={() => setPosCashReceived(Math.ceil(posTotal / 100) * 100)}>Next PHP 100</button></div></>}
          </div>
          <dl className="reconciliation-list pos-totals">
            <div><dt>Subtotal</dt><dd>{currency(posSubtotal)}</dd></div>
            <div><dt>Discount</dt><dd>{currency(posDiscountAmount)}</dd></div>
            <div><dt>Total</dt><dd>{currency(posTotal)}</dd></div>
            <div><dt>Change</dt><dd>{currency(posChange)}</dd></div>
          </dl>
          <button className="btn btn-danger w-100" disabled={Boolean(paymentBlocker) || completingPayment} onClick={complete}>{completingPayment ? "Completing payment..." : `Accept ${posPaymentMethod === "cash" ? "cash" : "GCash"} payment and print`}</button>
          {paymentBlocker && <small className="pos-payment-lock">{paymentBlocker}</small>}
          {lastReceipt && <div className="last-receipt-card receipt-preview-card"><strong>Last receipt preview</strong><span>{lastReceipt.id} - {lastReceipt.items?.map((item) => `${item.qty}x ${item.name}`).join(", ")}</span><b>{currency(lastReceipt.total)}</b><button className="btn btn-sm btn-outline-dark" onClick={() => printReceipt(lastReceipt)}>Print again</button></div>}
        </aside>
      </section>
    </main>
  );
  if (section === "staff-orders") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Online and walk-in fulfillment</p><h2>Order Queue</h2></div></div><div className="row g-3"><div className="col-12"><OrderManagement orders={orders} canAdvance notify={notify} user={user} /></div><div className="col-12"><ComplaintResolutionModule complaints={complaints} user={user} notify={notify} /></div></div></main>;
  if (section === "staff-kitchen") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Kitchen preparation</p><h2>Kitchen Queue</h2></div></div><KitchenQueue orders={orders.filter((order) => ["received", "preparing", "ready"].includes(order.status))} notify={notify} /></main>;
  if (section === "staff-inventory") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Receiving, wastage and availability</p><h2>Inventory</h2></div></div><InventoryModule inventory={inventory} user={user} notify={notify} /></main>;
  if (section === "staff-shifts") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Accountability and cash control</p><h2>Shift Logs</h2></div></div><ShiftLogsModule orders={orders} logs={shiftLogs} user={user} notify={notify} activeShift={activeShift} onShiftChange={setActiveShift} /></main>;
  if (section === "staff-chat") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Live communication</p><h2>Chat Support</h2></div></div><SupportChat messages={messages} user={user} notify={notify} /></main>;
  if (section === "staff-reviews") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Customer voice</p><h2>Reviews & Complaints</h2></div></div><div className="row g-3"><div className="col-12"><ComplaintResolutionModule complaints={complaints} user={user} notify={notify} /></div><div className="col-12"><ReviewModerationModule reviews={reviews} user={user} notify={notify} /></div></div></main>;
  if (section === "staff-settings") return <main className="container-fluid dashboard-page py-4"><div className="dashboard-heading"><div><p className="eyebrow text-danger">Workstation preferences</p><h2>Settings</h2></div></div><SettingsModule title="Staff alerts, receipts and workstation" serviceStatus={serviceStatus} staff notify={notify} /></main>;

  const activeOrders = orders.filter((order) => !["delivered", "completed", "cancelled"].includes(order.status));
  const readyDeliveryOrders = orders.filter((order) => order.status === "ready" && order.deliveryType === "delivery");
  const readyCounterOrders = orders.filter((order) => order.status === "ready" && order.deliveryType !== "delivery");
  const todayRange = reportDateRange(localDateInputValue());
  const todaySales = orders.filter((order) => inRange(order.createdAt, todayRange) && isRevenueOrder(order)).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const lowStock = inventory.filter((item) => item.stock <= item.reorderPoint);
  const soldOut = inventory.filter((item) => Number(item.stock || 0) <= 0);
  const prepOrders = activeOrders.filter((order) => ["received", "preparing"].includes(order.status));
  const delayedOrders = prepOrders.filter((order) => orderPrepClock(order).delayed);
  const prioritizedOrders = [...activeOrders].sort((first, second) => {
    const firstClock = orderPrepClock(first);
    const secondClock = orderPrepClock(second);
    return Number(secondClock.delayed) - Number(firstClock.delayed) || secondClock.waitingMs - firstClock.waitingMs;
  });
  const oldestPrepOrder = prioritizedOrders.find((order) => ["received", "preparing"].includes(order.status));
  const oldestPrepClock = oldestPrepOrder ? orderPrepClock(oldestPrepOrder).label : "-";
  const staffRole = user.staffRole || "manager";
  const dashboardProfile = staffDashboardProfiles[staffRole] || staffDashboardProfiles.manager;
  const dashboardMetrics = staffRole === "kitchen" ? [
    { label: "Prep queue", value: prepOrders.length, detail: "Received and preparing", view: "staff-kitchen" },
    { label: "Over target", value: delayedOrders.length, detail: "Waiting 15 minutes or more", view: "staff-kitchen" },
    { label: "Ready handoffs", value: readyDeliveryOrders.length + readyCounterOrders.length, detail: `${readyDeliveryOrders.length} rider, ${readyCounterOrders.length} counter`, view: "staff-orders" },
    { label: "Oldest prep", value: oldestPrepClock, detail: "Oldest active kitchen order", view: "staff-kitchen" }
  ] : staffRole === "inventory" ? [
    { label: "Low stock", value: lowStock.length, detail: "At or below reorder point", view: "staff-inventory" },
    { label: "Sold out", value: soldOut.length, detail: "Unavailable for new orders", view: "staff-inventory" },
    { label: "Products", value: inventory.length, detail: "Inventory records loaded", view: "staff-inventory" },
    { label: "Active orders", value: activeOrders.length, detail: "Current stock demand", view: "staff-orders" }
  ] : staffRole === "cashier" ? [
    { label: "Today's sales", value: currency(todaySales), detail: "Online and walk-in", view: "staff-pos" },
    { label: "Counter handoffs", value: readyCounterOrders.length, detail: "Ready for customer pickup", view: "staff-orders" },
    { label: "Active orders", value: activeOrders.length, detail: "Current fulfillment workload", view: "staff-orders" },
    { label: "Shift", value: activeShift ? "Open" : "Closed", detail: activeShift ? "Ready to accept payment" : "Start before POS payment", view: "staff-shifts" }
  ] : [
    { label: "Active orders", value: activeOrders.length, detail: "Kitchen and delivery queue", view: "staff-orders" },
    { label: "Today's sales", value: currency(todaySales), detail: "Online and walk-in", view: "staff-pos" },
    { label: "Ready handoffs", value: readyDeliveryOrders.length + readyCounterOrders.length, detail: `${readyDeliveryOrders.length} rider, ${readyCounterOrders.length} counter`, view: "staff-orders" },
    { label: "Low stock", value: lowStock.length, detail: "Requires inventory action", view: "staff-inventory" }
  ];
  const quickActions = staffRole === "kitchen" ? [
    { label: "Open kitchen queue", view: "staff-kitchen", Icon: ChefHat },
    { label: "Review all orders", view: "staff-orders", Icon: Clock3 }
  ] : staffRole === "inventory" ? [
    { label: "Review low stock", view: "staff-inventory", Icon: PackageSearch },
    { label: "Check order demand", view: "staff-orders", Icon: Clock3 }
  ] : [
    { label: "New walk-in order", view: "staff-pos", Icon: ShoppingCart },
    { label: "Open order queue", view: "staff-orders", Icon: Clock3 },
    { label: "Prepare shift close", view: "staff-shifts", Icon: Banknote }
  ];
  const focusRows = staffRole === "kitchen"
    ? delayedOrders.slice(0, 4).map((order) => ({ id: order.id, name: order.id, detail: order.status, value: orderPrepClock(order).label }))
    : staffRole === "cashier"
      ? readyCounterOrders.slice(0, 4).map((order) => ({ id: order.id, name: order.id, detail: order.customerName, value: currency(order.total) }))
      : lowStock.slice(0, 4).map((item) => ({ id: item.id, name: item.name, detail: `Reorder at ${item.reorderPoint}`, value: item.stock }));
  return (
    <main className="container-fluid dashboard-page staff-dashboard-page">
      <section className="staff-dashboard-hero workspace-overview-header staff-workspace-header">
        <div>
          <p className="eyebrow">{dashboardProfile.eyebrow}</p>
          <h1>{dashboardProfile.title}</h1>
          <span>{dashboardProfile.detail}</span>
        </div>
        <span className={`shift-chip ${shiftError ? "shift-error" : ""}`}>{shiftLoading ? "Checking shift..." : shiftError ? "Shift unavailable" : activeShift ? `Active shift - ${new Date(activeShift.startedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}` : "No active shift"}</span>
      </section>
      {shiftError && <div className="staff-shift-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span><strong>Shift status could not be loaded</strong><small>{shiftError}</small></span><button className="btn btn-outline-danger" onClick={loadActiveShift}><RefreshCw size={15} aria-hidden="true" /> Retry</button></div>}
      <div className={`staff-sla-strip ${delayedOrders.length ? "has-delay" : ""}`}><Clock3 size={20} aria-hidden="true" /><div><strong>{delayedOrders.length ? `${delayedOrders.length} order${delayedOrders.length === 1 ? "" : "s"} beyond prep target` : "Preparation is within target"}</strong><span>{prepOrders.length ? `Oldest active prep: ${oldestPrepClock}` : "No orders are currently preparing."}</span></div><button type="button" onClick={() => onNavigate?.("staff-kitchen")}>Open kitchen</button></div>
      <div className="row g-3 staff-priority-grid">
        <div className="col-lg-8"><OrderManagement orders={prioritizedOrders.slice(0, 6)} canAdvance notify={notify} user={user} /></div>
        <div className="col-lg-4"><div className="dashboard-card staff-focus-card"><h3>Quick actions</h3><div className="d-grid gap-2">{quickActions.map(({ label, view, Icon }, index) => <button className={`${index === 0 ? "btn btn-danger" : "btn btn-outline-dark"} staff-quick-action`} type="button" key={view} onClick={() => onNavigate?.(view)}><Icon size={16} aria-hidden="true" /> {label}</button>)}</div><h3 className="mt-4">{staffRole === "kitchen" ? "Overdue preparation" : staffRole === "cashier" ? "Counter handoffs" : "Critical stock"}</h3>{focusRows.length === 0 && <div className="empty-chat">No urgent items for this role.</div>}{focusRows.map((item) => <div className="alert-row" key={item.id}><span><strong>{item.name}</strong><small>{item.detail}</small></span><b>{item.value}</b></div>)}</div></div>
      </div>
      <section className="staff-kpi-grid" aria-label="Staff performance metrics">
        {dashboardMetrics.map((metric) => <button className="metric-card staff-metric-button" type="button" key={metric.label} onClick={() => onNavigate?.(metric.view)}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.detail}</span></button>)}
      </section>
    </main>
  );
}

export default function StaffWorkspace({ helpers, ...props }) {
  setWorkspaceHelpers(helpers);
  return <StaffWorkspaceContent {...props} />;
}
