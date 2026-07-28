import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bike, Camera, CheckCircle2, Clock, LoaderCircle, MapPin, Navigation, Package as PackageIcon, Phone, Route, Wallet } from "lucide-react";
import { SectionLoader } from "../../components/Loaders";
import { saveRiderLocation, uploadProof } from "../../services/firebase/delivery";
import { updateOrder } from "../../services/firebase/orders";
import { getSocket, sendRiderLocation } from "../../services/socket";
import { estimateDeliveryRoute } from "../../utils/operations";
import { ReasonModal } from "./WorkspaceModals";
import { currency, isUnremittedCod, setWorkspaceHelpers, statusLabel } from "./workspaceHelpers";
import { prioritizeAssignedDeliveries, prioritizeAvailableDeliveries } from "./riderWorkflow";

const CameraProof = lazy(() => import("../../components/CameraProof"));
const DeliveryMap = lazy(() => import("../../components/DeliveryMap"));
const storePoint = [
  Number(import.meta.env.VITE_STORE_LATITUDE || 14.4509229),
  Number(import.meta.env.VITE_STORE_LONGITUDE || 120.9764514)
];

function locationToPoint(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function RiderWorkspaceContent({ section, user, orders, notify }) {
  const deliveryOrders = orders.filter((order) => order.deliveryType === "delivery");
  const assignedOrders = prioritizeAssignedDeliveries(deliveryOrders.filter((order) => order.riderId === user.uid));
  const availableOrders = prioritizeAvailableDeliveries(deliveryOrders.filter((order) => order.status === "ready" && !order.riderId));
  const [selectedId, setSelectedId] = useState("");
  const active = assignedOrders.find((order) => order.id === selectedId) || assignedOrders.find((order) => !["delivered", "completed", "cancelled"].includes(order.status)) || assignedOrders[0];
  const [gpsStatus, setGpsStatus] = useState("offline");
  const [gpsError, setGpsError] = useState("");
  const [location, setLocation] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [retryTask, setRetryTask] = useState(null);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const watchRef = useRef(null);
  const activeOrderIdRef = useRef("");
  const online = gpsStatus === "online";

  const runAction = async (label, task) => {
    if (busyAction) return false;
    if (!navigator.onLine) {
      setRetryTask({ label, task });
      notify("You are offline. Reconnect, then retry this delivery action.");
      return false;
    }
    setBusyAction(label);
    try {
      await task();
      setRetryTask(null);
      return true;
    } catch (error) {
      setRetryTask({ label, task });
      notify(error.message || `${label} could not be completed.`);
      return false;
    } finally {
      setBusyAction("");
    }
  };

  useEffect(() => {
    activeOrderIdRef.current = active?.id || "";
  }, [active?.id]);

  useEffect(() => {
    const updateNetworkState = () => setNetworkOnline(navigator.onLine);
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  const toggleOnline = async () => {
    if (["online", "acquiring"].includes(gpsStatus)) {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setGpsStatus("offline");
      setGpsError("");
      return;
    }
    if (!navigator.geolocation) {
      setGpsStatus("error");
      setGpsError("Geolocation is unavailable on this device.");
      notify("Geolocation is unavailable on this device.");
      return;
    }
    setGpsStatus("acquiring");
    setGpsError("");
    const socketPromise = getSocket().catch(() => null);
    watchRef.current = navigator.geolocation.watchPosition(async ({ coords }) => {
      const next = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
      setLocation(next);
      setGpsStatus("online");
      setGpsError("");
      const activeOrderId = activeOrderIdRef.current;
      if (!activeOrderId) return;
      try {
        const socket = await socketPromise;
        if (socket?.connected) await sendRiderLocation(activeOrderId, next);
        else await saveRiderLocation(activeOrderId, next);
      } catch (error) {
        notify(error.message);
      }
    }, (error) => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setGpsStatus("error");
      setGpsError(error.message || "GPS permission or positioning failed.");
      notify(error.message || "GPS permission or positioning failed.");
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  };

  const pickup = async () => {
    if (!active) return;
    await runAction("Recording pickup", async () => {
      await updateOrder(active.id, { status: "out-for-delivery", riderId: user.uid });
      navigator.vibrate?.([120, 70, 120]);
      notify("Pickup recorded. Customer tracking is live.");
    });
  };

  const claimOrder = async (order) => {
    await runAction(`Accepting ${order.id}`, async () => {
      await updateOrder(order.id, { riderId: user.uid, assignedAt: Date.now() });
      setSelectedId(order.id);
      navigator.vibrate?.([150, 80, 150]);
      notify(`${order.id} is now assigned to you.`);
    });
  };

  const markArrived = async () => {
    if (!active) return;
    await runAction("Recording arrival", async () => {
      await updateOrder(active.id, { status: "arrived", arrivedAt: Date.now() });
      navigator.vibrate?.([100, 60, 100]);
      notify("Arrival recorded. You can now capture proof of delivery.");
    });
  };

  const capture = async (blob, handoff) => {
    await runAction("Uploading delivery proof", async () => {
      const proof = await uploadProof(active.id, blob, handoff);
      await updateOrder(active.id, { status: "delivered", ...proof });
      setCameraOpen(false);
      navigator.vibrate?.(180);
      notify("Delivery completed with photo evidence.");
    });
  };

  const firstName = (user.name || "Rider").split(" ")[0];
  const activeDeliveries = assignedOrders.filter((order) => !["delivered", "completed", "cancelled"].includes(order.status));
  const completedDeliveries = assignedOrders.filter((order) => order.status === "delivered");
  const codOrders = assignedOrders.filter((order) => order.paymentMethod === "cod");
  const collectedCod = codOrders.filter((order) => order.status === "delivered").reduce((sum, order) => sum + Number(order.total || 0), 0);
  const remittedCod = codOrders.filter((order) => order.codRemittedAt).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const cashToCollect = codOrders.filter((order) => order.status !== "delivered" && order.status !== "cancelled").reduce((sum, order) => sum + Number(order.total || 0), 0);
  const cashToRemit = codOrders.filter(isUnremittedCod).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const orderItems = (order) => order?.items?.map((item) => `${item.qty}x ${item.name}`).join(", ") || "Foodtrip order";
  const orderCount = (order) => order?.items?.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 0;
  const addressLabel = (value) => value || "Counter pickup";
  const deliveryPin = locationToPoint(active?.deliveryLocation);
  const visibleRiderLocation = location || active?.riderLocation || null;
  const routeEstimate = estimateDeliveryRoute({ store: storePoint, rider: visibleRiderLocation, customer: deliveryPin });
  const hasDeliveryPin = (order) => Boolean(locationToPoint(order?.deliveryLocation));
  const reportDeliveryIssue = async (reason) => {
    if (!active) return;
    return runAction("Sending delivery issue", async () => {
      await updateOrder(active.id, { deliveryIssue: reason });
      notify("Delivery issue sent to owner and staff.");
    });
  };
  const recordCodHandoff = async (order) => {
    await runAction(`Recording ${order.id} cash handoff`, async () => {
      await updateOrder(order.id, { codHandoffRequested: true });
      notify(`${order.id} cash handoff is waiting for owner confirmation.`);
    });
  };
  const codHandoffLabel = (order) => order.codRemittedAt
    ? "Owner confirmed"
    : order.codHandoffRequestedAt
      ? "Awaiting owner confirmation"
      : order.status === "delivered"
        ? "Ready to hand over"
        : "Collection pending";

  const googleMapsUrl = active
    ? `https://www.google.com/maps/dir/?api=1&destination=${deliveryPin ? `${deliveryPin[0]},${deliveryPin[1]}` : encodeURIComponent(active.address)}&travelmode=driving`
    : "#";
  const routeForOrder = (order) => estimateDeliveryRoute({ store: storePoint, customer: locationToPoint(order?.deliveryLocation) });
  const pinQuality = (order) => {
    if (!hasDeliveryPin(order)) return "Address only";
    const accuracy = Number(order.deliveryLocation?.accuracy || 0);
    if (!accuracy) return "Pin confirmed";
    if (accuracy <= 50) return "High-quality pin";
    if (accuracy <= 100) return "Usable pin";
    return "Approximate pin";
  };
  const nextAction = active?.status === "ready"
    ? { label: "Confirm pickup", Icon: PackageIcon, action: pickup, tone: "primary" }
    : active?.status === "out-for-delivery"
      ? { label: "Mark arrived", Icon: MapPin, action: markArrived, tone: "warning" }
      : active?.status === "arrived"
        ? { label: "Capture delivery proof", Icon: Camera, action: () => setCameraOpen(true), tone: "success" }
        : null;
  const NextActionIcon = nextAction?.Icon || CheckCircle2;

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
                <small className="rider-cod-handoff-state">{codHandoffLabel(order)}</small>
                {order.status === "delivered" && !order.codRemittedAt && !order.codHandoffRequestedAt && <button className="rider-ledger-handoff" disabled={Boolean(busyAction)} onClick={() => recordCodHandoff(order)}>{busyAction.includes(order.id) ? "Recording..." : "Record cash handoff"}</button>}
              </div>
            </article>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="rider-page dashboard-page">
      <section className="rider-hero workspace-overview-header rider-workspace-header">
        <div className="rider-hero-top">
          <div className="rider-avatar"><Bike size={27} strokeWidth={2.4} aria-hidden="true" /></div>
          <div>
            <p className="eyebrow">Delivery rider</p>
            <h1>Hi, {firstName}</h1>
              <span><MapPin size={14} aria-hidden="true" /> {gpsStatus === "online" ? "GPS locked" : gpsStatus === "acquiring" ? "Acquiring GPS" : gpsStatus === "error" ? "GPS error" : "GPS standby"}</span>
            </div>
          <button className={`rider-online-toggle ${online ? "online" : ""} ${gpsStatus === "error" ? "error" : ""}`} type="button" onClick={toggleOnline} aria-live="polite" aria-pressed={online}>
            {gpsStatus === "acquiring" ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : gpsStatus === "error" ? <AlertTriangle size={17} aria-hidden="true" /> : <span />}
            {online ? "Online" : gpsStatus === "acquiring" ? "Cancel GPS" : gpsStatus === "error" ? "Retry GPS" : "Go online"}
          </button>
        </div>
        {gpsError && <div className="rider-gps-error" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{gpsError}</span></div>}
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
                <em><MapPin size={13} aria-hidden="true" /> {hasDeliveryPin(order) ? "Pin confirmed" : addressLabel(order.address)}</em>
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
              {availableOrders.map((order) => {
                const estimate = routeForOrder(order);
                return (
                  <article className="rider-job-card" key={order.id}>
                    <div className="rider-order-avatar"><Clock size={18} aria-hidden="true" /></div>
                    <div>
                      <strong>{order.id}</strong>
                      <small>{orderItems(order)}</small>
                      <span><MapPin size={13} aria-hidden="true" /> {addressLabel(order.address)}</span>
                      <div className="rider-job-facts"><em>{estimate ? `${estimate.distanceLabel} - ${estimate.label}` : "Route pending"}</em><em>{pinQuality(order)}</em><em>{order.paymentMethod === "cod" ? `COD ${currency(order.total)}` : String(order.paymentMethod || "paid").toUpperCase()}</em></div>
                    </div>
                    <button type="button" disabled={Boolean(busyAction)} onClick={() => claimOrder(order)}><CheckCircle2 size={16} aria-hidden="true" /> {busyAction === `Accepting ${order.id}` ? "Accepting..." : "Accept"}</button>
                  </article>
                );
              })}
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
                  <p><small>Drop off {deliveryPin ? "with confirmed pin" : "address only"}</small><strong>{addressLabel(active.address)}</strong>{active.landmark && <span>{active.landmark}</span>}</p>
                </div>
              </div>

              <div className="rider-active-details">
                <div><small>Customer</small><strong>{active.customerName}</strong></div>
                <div><small>Items</small><strong>{orderCount(active)} total</strong><span>{orderItems(active)}</span></div>
                <div><small>Payment</small><strong>{active.paymentMethod?.toUpperCase()} - {currency(active.total)}</strong></div>
                <div><small>COD collection</small><strong>{active.paymentMethod === "cod" ? currency(active.total) : "Not COD"}</strong><span>{active.paymentMethod === "cod" ? codHandoffLabel(active) : "No cash collection"}</span></div>
                <div><small>Delivery pin</small><strong>{deliveryPin ? "Confirmed" : "Missing"}</strong><span>{deliveryPin ? `${deliveryPin[0].toFixed(5)}, ${deliveryPin[1].toFixed(5)}` : "Use typed address"}</span></div>
                <div><small>Route ETA</small><strong>{routeEstimate ? routeEstimate.label : "Address only"}</strong><span>{routeEstimate ? routeEstimate.distanceLabel : "Open navigation for route"}</span></div>
              </div>
              {active.status === "arrived" && (
                <div className="rider-proof-note">
                  <strong>Proof required before delivered</strong>
                  <span>Capture a clear handoff photo and enter the receiver name or typed signature.</span>
                </div>
              )}
              {active.deliveryIssue && <div className="rider-issue-note"><strong>Reported issue</strong><span>{active.deliveryIssue}</span></div>}
              {retryTask && <div className="rider-retry-bar" role="alert"><AlertTriangle size={17} aria-hidden="true" /><span><strong>{retryTask.label} failed</strong><small>{networkOnline ? "Retry without repeating completed steps." : "Reconnect to the internet before retrying."}</small></span><button disabled={Boolean(busyAction) || !networkOnline} onClick={() => runAction(retryTask.label, retryTask.task)}>Retry</button></div>}

              {nextAction ? <button className={`rider-next-action ${nextAction.tone}`} disabled={Boolean(busyAction)} onClick={nextAction.action}><NextActionIcon size={19} aria-hidden="true" /> {busyAction || nextAction.label}</button> : <div className="rider-complete-state"><CheckCircle2 size={18} aria-hidden="true" /><span>{["delivered", "completed"].includes(active.status) ? "Delivery completed" : "No rider status action is available"}</span></div>}
              <div className="rider-map-panel"><Suspense fallback={<SectionLoader label="Loading delivery map..." />}><DeliveryMap rider={visibleRiderLocation} customer={deliveryPin} /></Suspense></div>
              <div className="rider-action-grid secondary">
                <a className="rider-action" href={googleMapsUrl} target="_blank" rel="noreferrer"><Navigation size={17} aria-hidden="true" /> Navigate</a>
                {active.phone && <a className="rider-action" href={`tel:${active.phone}`}><Phone size={17} aria-hidden="true" /> Call</a>}
                <button className="rider-action" type="button" disabled={!["out-for-delivery", "arrived"].includes(active.status)} onClick={() => setIssueOpen(true)}><Clock size={17} aria-hidden="true" /> Issue</button>
              </div>
            </>
          ) : <div className="empty-state compact">Assigned delivery details will appear here.</div>}
        </section>
      </div>
      {cameraOpen && <Suspense fallback={<SectionLoader label="Opening camera..." />}><CameraProof onCapture={capture} onClose={() => setCameraOpen(false)} /></Suspense>}
      {issueOpen && active && <ReasonModal title={`Report ${active.id}`} label="Delivery issue" placeholder="Example: Customer not answering, address unclear, heavy traffic..." confirmText="Send issue" onClose={() => setIssueOpen(false)} onSubmit={async (reason) => { if (await reportDeliveryIssue(reason)) setIssueOpen(false); }} />}
    </main>
  );
}

export default function RiderWorkspace({ helpers, ...props }) {
  setWorkspaceHelpers(helpers);
  return <RiderWorkspaceContent {...props} />;
}
