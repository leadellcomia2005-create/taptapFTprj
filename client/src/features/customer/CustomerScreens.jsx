import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BrandMark } from "../../components/Branding";
import { SectionLoader } from "../../components/Loaders";
import { api } from "../../services/api";
import { createOrder, resendReceiptEmail, saveUserProfile, submitReview, updateOrder } from "../../services/firebase";
import { currency, statusLabel } from "../../utils/display";

const DeliveryMap = lazy(() => import("../../components/DeliveryMap"));

const defaultStorePin = {
  lat: Number(import.meta.env.VITE_STORE_LATITUDE || 14.4509229),
  lng: Number(import.meta.env.VITE_STORE_LONGITUDE || 120.9764514),
  accuracy: 0,
  source: "map-picker"
};

function normalizePhilippinePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.startsWith("639") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("9") && digits.length === 10) return `+63${digits}`;
  return value.trim();
}

function isValidPhilippineMobile(value = "") {
  return /^\+639\d{9}$/.test(value);
}

function locationToMarker(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function phoneIsVerified(profile, phone) {
  const normalized = normalizePhilippinePhone(phone);
  return Boolean(profile?.phoneVerified && normalizePhilippinePhone(profile?.phone || "") === normalized);
}

export function Checkout({ cart, user, profile, paymongoEnabled, smsProviderEnabled = false, onClose, onComplete, notify }) {
  const [payment, setPayment] = useState(paymongoEnabled ? "gcash" : "cod");
  const [deliveryType, setDeliveryType] = useState("delivery");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [address, setAddress] = useState(profile?.address || "");
  const [landmark, setLandmark] = useState(profile?.landmark || "");
  const [deliveryLocation, setDeliveryLocation] = useState(profile?.deliveryLocation || null);
  const [smsOptIn, setSmsOptIn] = useState(Boolean(profile?.smsNotifications || profile?.smsNotificationsRequested));
  const [locating, setLocating] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const deliveryFee = deliveryType === "delivery" && cart.length > 0 ? 49 : 0;
  const total = subtotal + deliveryFee;
  const normalizedPhone = useMemo(() => normalizePhilippinePhone(phone), [phone]);
  const validPhone = isValidPhilippineMobile(normalizedPhone);
  const verifiedPhone = phoneIsVerified(profile, normalizedPhone);
  const deliveryMarker = locationToMarker(deliveryLocation);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      notify("Location is unavailable on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setDeliveryLocation({
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy,
        source: "gps"
      });
      setLocating(false);
      notify("Delivery pin captured. You can drag the pin to adjust it.");
    }, (error) => {
      setLocating(false);
      notify(error.message || "Location permission was not allowed.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
  };
  const confirmManualPin = () => {
    const current = deliveryLocation || defaultStorePin;
    setDeliveryLocation({ ...current, source: current.source || "map-picker", accuracy: Number(current.accuracy || 0) });
    notify("Delivery pin confirmed.");
  };
  const updatePin = ({ lat, lng }) => {
    setDeliveryLocation((current) => ({
      ...(current || defaultStorePin),
      lat,
      lng,
      source: current?.source === "gps" ? "gps-adjusted" : "map-picker"
    }));
  };
  const place = async () => {
    if (!navigator.onLine) {
      notify("You are offline. Reconnect before placing an order.");
      return;
    }
    if (!validPhone || (deliveryType === "delivery" && !address.trim())) {
      notify(deliveryType === "delivery" ? "Enter a mobile number and delivery address before placing the order." : "Enter a mobile number before placing the order.");
      return;
    }
    if (deliveryType === "delivery" && !deliveryMarker) {
      notify("Confirm the exact delivery pin before placing the order.");
      return;
    }
    setBusy(true);
    try {
      const orderPayload = {
        customerId: user.uid,
        customerName: user.name,
        customerEmail: user.email,
        phone: normalizedPhone,
        phoneVerified: verifiedPhone,
        phoneVerifiedAt: verifiedPhone ? profile?.phoneVerifiedAt || Date.now() : null,
        smsNotifications: Boolean(verifiedPhone && smsOptIn),
        smsNotificationsRequested: Boolean(smsOptIn),
        address: deliveryType === "delivery" ? address : "Store pickup",
        landmark: deliveryType === "delivery" ? landmark : "",
        deliveryLocation: deliveryType === "delivery" ? {
          ...deliveryLocation,
          address,
          landmark,
          source: deliveryLocation?.source || "map-picker"
        } : null,
        deliveryType,
        notes,
        paymentMethod: payment,
        total,
        items: cart.map(({ id, name, price, qty, stock }) => ({ id, name, price, qty, stock }))
      };
      const orderId = await createOrder(orderPayload);
      if (payment === "gcash") {
        try {
          const result = await api.createPayment({ orderId });
          if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
          else notify(`Order ${orderId} created. Online payment setup is not ready yet.`);
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
    <div className="modal d-block" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
          <div className="modal-header"><h5 className="modal-title" id="checkout-title">Secure checkout</h5><button className="btn-close" aria-label="Close checkout" onClick={onClose} /></div>
          <div className="modal-body">
            {cart.map((item) => <div className="d-flex justify-content-between border-bottom py-2" key={item.id}><span>{item.qty}× {item.name}</span><strong>{currency(item.price * item.qty)}</strong></div>)}
            <div className="checkout-mode-grid mt-3" aria-label="Order type">
              <button className={deliveryType === "delivery" ? "active" : ""} type="button" aria-pressed={deliveryType === "delivery"} onClick={() => setDeliveryType("delivery")}><strong>Delivery</strong><small>With rider fee</small></button>
              <button className={deliveryType === "pickup" ? "active" : ""} type="button" aria-pressed={deliveryType === "pickup"} onClick={() => setDeliveryType("pickup")}><strong>Pickup</strong><small>Claim at store</small></button>
            </div>
            <label className="form-label mt-3">Mobile number<input className={`form-control ${phone && !validPhone ? "is-invalid" : ""}`} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0917 123 4567" /></label>
            <div className="checkout-sms-panel">
              <span className={`stock-badge ${verifiedPhone ? "healthy" : "low"}`}>{verifiedPhone ? "Verified phone" : "Phone not verified"}</span>
              <label><input type="checkbox" checked={smsOptIn} onChange={(event) => setSmsOptIn(event.target.checked)} /> Send me SMS order updates</label>
              <small>{smsProviderEnabled ? "SMS updates will send after phone OTP verification." : "SMS provider is not configured yet. We will save this preference without sending paid SMS."}</small>
            </div>
            {deliveryType === "delivery" && <>
              <label className="form-label">Delivery address<textarea className="form-control" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="House no., street, barangay, city" /></label>
              <label className="form-label">Landmark<input className="form-control" value={landmark} onChange={(event) => setLandmark(event.target.value)} placeholder="Example: near sari-sari store, blue gate" /></label>
              <div className="checkout-location-panel">
                <div className="module-heading"><div><p className="eyebrow text-danger">Delivery pin</p><h3>Confirm exact drop-off</h3></div><span className="module-note">Use GPS on HTTPS/Cloudflare, then drag the pin if needed.</span></div>
                <div className="checkout-location-actions">
                  <button className="btn btn-outline-dark btn-sm" type="button" disabled={locating} onClick={useCurrentLocation}>{locating ? "Getting location..." : "Use my current location"}</button>
                  <button className="btn btn-danger btn-sm" type="button" onClick={confirmManualPin}>{deliveryMarker ? "Reconfirm pin" : "Start with map pin"}</button>
                </div>
                {deliveryMarker ? (
                  <>
                    <div className="checkout-location-map"><Suspense fallback={<SectionLoader label="Loading pin map..." />}><DeliveryMap customer={deliveryMarker} editableCustomer onCustomerChange={updatePin} /></Suspense></div>
                    <div className="pin-coordinate-grid">
                      <label className="form-label">Latitude<input className="form-control" type="number" step="0.000001" value={Number(deliveryLocation?.lat || 0)} onChange={(event) => updatePin({ lat: Number(event.target.value), lng: Number(deliveryLocation?.lng || 0) })} /></label>
                      <label className="form-label">Longitude<input className="form-control" type="number" step="0.000001" value={Number(deliveryLocation?.lng || 0)} onChange={(event) => updatePin({ lat: Number(deliveryLocation?.lat || 0), lng: Number(event.target.value) })} /></label>
                    </div>
                    <small className="text-secondary">Pin source: {deliveryLocation?.source || "map-picker"}{deliveryLocation?.accuracy ? ` - accuracy about ${Math.round(deliveryLocation.accuracy)}m` : ""}</small>
                  </>
                ) : <div className="empty-chat">No delivery pin yet. Tap current location or start with the store map pin.</div>}
              </div>
            </>}
            <label className="form-label">Order notes<textarea className="form-control" rows="2" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional: landmark, extra request, or pickup note" /></label>
            <div className="row g-2">
              <div className="col-6"><button className={`payment-option ${payment === "gcash" ? "active" : ""}`} aria-pressed={payment === "gcash"} disabled={!paymongoEnabled} onClick={() => setPayment("gcash")}><strong>GCash</strong><small>{paymongoEnabled ? "Online checkout" : "Not ready"}</small></button></div>
              <div className="col-6"><button className={`payment-option ${payment === "cod" ? "active" : ""}`} aria-pressed={payment === "cod"} onClick={() => setPayment("cod")}><strong>Cash on delivery</strong><small>Rider ledger</small></button></div>
            </div>
            <div className="checkout-total"><span>{deliveryType === "delivery" ? "Total including delivery" : "Pickup total"}</span><strong>{currency(total)}</strong></div>
            {deliveryFee > 0 && <small className="text-secondary d-block mt-2">Delivery fee: {currency(deliveryFee)}</small>}
          </div>
          <div className="modal-footer"><button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={busy || !validPhone || (deliveryType === "delivery" && (!address.trim() || !deliveryMarker))} onClick={place}>{busy ? "Processing..." : "Place order"}</button></div>
        </div>
      </div>
    </div>
  );
}

export function OrdersView({ orders, onTrack, isRevenueOrder, notify }) {
  const revenueCheck = isRevenueOrder || (() => false);
  const activeOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const pastOrders = orders.filter((order) => ["delivered", "cancelled"].includes(order.status));
  const totalSpent = orders.filter(revenueCheck).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const latestOrder = orders[0];
  const cancelOrder = async (order) => {
    const reason = window.prompt(`Why do you want to cancel ${order.id}?`);
    if (!reason?.trim()) return;
    try {
      await updateOrder(order.id, { cancel: true, cancelReason: reason.trim() });
      notify?.(`${order.id} cancellation submitted.`);
    } catch (error) {
      notify?.(error.message || "This order can no longer be cancelled here.");
    }
  };
  const renderOrderTable = (title, list, emptyText) => (
    <section className="order-table-card">
      <div className="order-table-heading">
        <h3>{title}</h3>
        <span>{list.length}</span>
      </div>
      <div className="order-table">
        <div className="order-table-head">
          <span>Order</span>
          <span>Date</span>
          <span>Status</span>
          <span>Delivery</span>
          <span>Total</span>
          <span>Action</span>
        </div>
        {list.length === 0 && <div className="empty-state compact">{emptyText}</div>}
        {list.map((order) => (
          <article className="order-table-row" key={order.id}>
            <div className="order-line-item" data-label="Order">
              <small>{order.id}</small>
              <strong>{order.items?.map((item) => `${item.qty} x ${item.name}`).join(", ") || "Order items"}</strong>
            </div>
            <div data-label="Date">{order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-PH") : "-"}</div>
            <div data-label="Status"><span className={`status status-${order.status}`}>{statusLabel(order.status)}</span></div>
            <div className="order-delivery-cell" data-label="Delivery">{order.address || "Counter pickup"}</div>
            <div className="order-total-cell" data-label="Total">{currency(order.total)}</div>
            <div data-label="Action"><div className="d-flex flex-wrap gap-1"><button className="btn btn-sm btn-outline-danger" onClick={() => onTrack(order)}>Track</button>{["pending-payment", "received"].includes(order.status) && <button className="btn btn-sm btn-outline-dark" onClick={() => cancelOrder(order)}>Cancel</button>}</div></div>
          </article>
        ))}
      </div>
    </section>
  );

  return (
    <main className="container-fluid customer-page order-history-page">
      <div className="order-history-layout">
        <section className="order-history-main">
          <div className="section-title">
            <div><p className="eyebrow text-danger">Your orders</p><h2>Order history</h2></div>
            <p>Review previous and active purchases with live delivery status.</p>
          </div>
          {orders.length === 0 ? <div className="empty-state">No orders yet.</div> : (
            <>
              {renderOrderTable("Active orders", activeOrders, "No active orders right now.")}
              {renderOrderTable("Past orders", pastOrders, "Completed orders will appear here.")}
            </>
          )}
        </section>
        <aside className="order-summary-panel">
          <h3>Summary</h3>
          <div className="summary-metric"><span>Active orders</span><strong>{activeOrders.length}</strong></div>
          <div className="summary-metric"><span>Completed orders</span><strong>{pastOrders.length}</strong></div>
          <div className="summary-metric"><span>Total spend</span><strong>{currency(totalSpent)}</strong></div>
          <div className="summary-metric"><span>Latest update</span><strong>{latestOrder ? statusLabel(latestOrder.status) : "-"}</strong></div>
        </aside>
      </div>
    </main>
  );
}

export function CustomerProfile({ user, profile, notify, smsProviderEnabled = false }) {
  const [form, setForm] = useState(profile || {});
  useEffect(() => setForm(profile || {}), [profile]);
  const normalizedPhone = normalizePhilippinePhone(form.phone || "");
  const validPhone = !form.phone || isValidPhilippineMobile(normalizedPhone);
  const phoneChanged = normalizePhilippinePhone(profile?.phone || "") !== normalizedPhone;
  const verifiedPhone = !phoneChanged && Boolean(profile?.phoneVerified);
  const save = async (event) => {
    event.preventDefault();
    if (!validPhone) {
      notify("Enter a valid Philippine mobile number.");
      return;
    }
    await saveUserProfile(user, {
      ...form,
      phone: normalizedPhone,
      phoneVerified: phoneChanged ? false : Boolean(profile?.phoneVerified),
      phoneVerifiedAt: phoneChanged ? null : profile?.phoneVerifiedAt || null,
      smsNotificationsRequested: Boolean(form.smsNotificationsRequested || form.smsNotifications),
      smsNotifications: Boolean(!phoneChanged && profile?.phoneVerified && (form.smsNotificationsRequested || form.smsNotifications))
    });
    notify("Personal information and saved address updated.");
  };
  return (
    <main className="container py-5 customer-page">
      <div className="section-title"><div><p className="eyebrow text-danger">Account settings</p><h2>Personal info</h2></div><p>Keep your contact details and preferred delivery address ready for checkout.</p></div>
      <form className="dashboard-card profile-form" onSubmit={save}>
        <div className="row g-3">
          <label className="form-label col-md-6">Full name<input className="form-control" required value={form.name || ""} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="form-label col-md-6">Email<input className="form-control" value={user.email} disabled /></label>
          <label className="form-label col-md-6">Mobile number<input className={`form-control ${form.phone && !validPhone ? "is-invalid" : ""}`} value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+63 917 123 4567" /><small className={verifiedPhone ? "text-success" : "text-secondary"}>{verifiedPhone ? "Phone verified for SMS updates." : "Phone OTP verification is prepared but not active yet."}</small></label>
          <label className="form-label col-md-6">City<input className="form-control" value={form.city || ""} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} /></label>
          <label className="form-label col-12">Saved delivery address<textarea className="form-control" rows="3" value={form.address || ""} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="House number, street, barangay and landmark" /></label>
          <label className="form-label col-12">Default landmark<input className="form-control" value={form.landmark || ""} onChange={(event) => setForm((current) => ({ ...current, landmark: event.target.value }))} placeholder="Example: near sari-sari store, blue gate" /></label>
        </div>
        <div className="profile-preferences"><strong>Notification preferences</strong><label><input type="checkbox" checked={form.notificationPreferences?.orderUpdates !== false} onChange={(event) => setForm((current) => ({ ...current, notificationPreferences: { ...current.notificationPreferences, orderUpdates: event.target.checked } }))} /> Order status updates</label><label><input type="checkbox" checked={form.notificationPreferences?.promotions !== false} onChange={(event) => setForm((current) => ({ ...current, notificationPreferences: { ...current.notificationPreferences, promotions: event.target.checked } }))} /> Promotions and offers</label><label><input type="checkbox" checked={Boolean(form.smsNotificationsRequested || form.smsNotifications)} onChange={(event) => setForm((current) => ({ ...current, smsNotificationsRequested: event.target.checked, smsNotifications: event.target.checked && verifiedPhone }))} /> Send me SMS order updates</label><small>{smsProviderEnabled ? "SMS OTP can be connected to this phone readiness flow." : "SMS provider is not configured yet, so this saves the preference only."}</small></div>
        <button className="btn btn-danger">Save personal information</button>
      </form>
    </main>
  );
}

export function ReceiptsView({ orders, printReceipt, notify }) {
  const [sendingReceiptId, setSendingReceiptId] = useState("");
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
  const emailReceipt = async (order) => {
    setSendingReceiptId(order.id);
    try {
      const result = await resendReceiptEmail(order.id);
      notify?.(result.sent ? "Receipt email sent." : "Receipt email is not available in local preview.");
    } catch (error) {
      notify?.(error.message || "Receipt email could not be sent.");
    } finally {
      setSendingReceiptId("");
    }
  };
  return (
    <main className="container py-5 customer-page">
      <div className="section-title"><div><p className="eyebrow text-danger">Paperless records</p><h2>Digital receipts</h2></div><p>View and download itemized receipts for online orders.</p></div>
      <div className="receipt-grid">{orders.length === 0 && <div className="empty-state">No receipts available yet.</div>}{orders.map((order) => <article className="receipt-card" key={order.id}><BrandMark className="receipt-brand" /><div><small>{new Date(order.createdAt).toLocaleDateString("en-PH")}</small><h3>{order.id}</h3><p>{order.items?.map((item) => `${item.qty}× ${item.name}`).join(", ")}</p><span>{order.paymentMethod?.toUpperCase()} · {statusLabel(order.status)}</span></div><div className="receipt-total"><strong>{currency(order.total)}</strong><button className="btn btn-sm btn-outline-dark" onClick={() => printReceipt(order)}>Print</button><button className="btn btn-sm btn-outline-dark" onClick={() => downloadReceipt(order)}>Download PDF</button><button className="btn btn-sm btn-danger" disabled={sendingReceiptId === order.id} onClick={() => emailReceipt(order)}>{sendingReceiptId === order.id ? "Sending..." : "Email receipt"}</button></div></article>)}</div>
    </main>
  );
}

export function ReviewsView({ user, orders, reviews, notify }) {
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
        <div className="col-lg-5"><form className="dashboard-card review-form" onSubmit={submit}><h3>Rate your recent orders</h3>{eligibleOrders.length === 0 ? <div className="empty-chat">Delivered orders without reviews will appear here.</div> : <><label className="form-label">Order<select className="form-select" value={selectedOrder?.id || ""} onChange={(event) => setSelectedOrderId(event.target.value)}>{eligibleOrders.map((order) => <option key={order.id} value={order.id}>{order.id} · {new Date(order.createdAt).toLocaleDateString("en-PH")}</option>)}</select></label><div className="rating-picker" role="radiogroup" aria-label="Rating">{[1,2,3,4,5].map((star) => <button type="button" role="radio" aria-checked={star === rating} aria-label={`${star} star${star === 1 ? "" : "s"}`} className={star <= rating ? "active" : ""} key={star} onClick={() => setRating(star)}>★</button>)}</div><label className="form-label">Feedback<textarea className="form-control" rows="4" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Tell us about the food and service..." /></label><button className="btn btn-danger w-100">Submit review</button></>}</form></div>
        <div className="col-lg-7"><div className="dashboard-card"><h3>Previous reviews</h3>{reviews.length === 0 && <div className="empty-chat">You have not submitted a review yet.</div>}{reviews.map((review) => <article className="previous-review" key={review.id}><div><strong>{review.orderId}</strong><span>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></div><p>{review.comment || "No written feedback."}</p><small>{review.items?.join(", ")} · {new Date(review.createdAt).toLocaleDateString("en-PH")}</small></article>)}</div></div>
      </div>
    </main>
  );
}
