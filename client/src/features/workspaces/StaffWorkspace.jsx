import { useState } from "react";
import MenuPhoto from "../../components/MenuPhoto";
import { staffPosCategories } from "../../config/appConfig";
import { createOrder } from "../../services/firebase";
import { InventoryModule, KitchenQueue, OrderManagement, ReviewModerationModule, SettingsModule, ShiftLogsModule, SupportChat } from "./SharedWorkspaceModules";
import { currency, inRange, isRevenueOrder, localDateInputValue, printReceipt, reportDateRange, setWorkspaceHelpers } from "./workspaceHelpers";

function StaffWorkspaceContent({ section, user, orders, inventory: staffInventory, reviews, shiftLogs, messages, serviceStatus, notify }) {
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

export default function StaffWorkspace({ helpers, ...props }) {
  setWorkspaceHelpers(helpers);
  return <StaffWorkspaceContent {...props} />;
}
