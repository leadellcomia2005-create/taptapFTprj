import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Bike, Camera, CheckCircle2, Clock, MapPin, Navigation, Package as PackageIcon, Phone, Route, Wallet } from "lucide-react";
import { SectionLoader } from "../../components/Loaders";
import { saveRiderLocation, updateOrder, uploadProof } from "../../services/firebase";
import { getSocket, sendRiderLocation } from "../../services/socket";
import { ReasonModal } from "./SharedWorkspaceModules";
import { currency, isUnremittedCod, setWorkspaceHelpers, statusLabel } from "./workspaceHelpers";

const CameraProof = lazy(() => import("../../components/CameraProof"));
const DeliveryMap = lazy(() => import("../../components/DeliveryMap"));

function RiderWorkspaceContent({ section, user, orders, notify }) {
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

export default function RiderWorkspace({ helpers, ...props }) {
  setWorkspaceHelpers(helpers);
  return <RiderWorkspaceContent {...props} />;
}
