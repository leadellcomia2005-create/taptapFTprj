import { useEffect, useMemo, useRef, useState } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { distanceKm, estimateDeliveryRoute } from "../utils/operations";
import { api } from "../services/api";
import "leaflet/dist/leaflet.css";

const storeLocation = {
  name: import.meta.env.VITE_STORE_NAME || "Taptap Foodtrip",
  address: import.meta.env.VITE_STORE_ADDRESS || "#17 Gemini Street, Pamplona Park, Pamplona Dos, Las Pinas City 1740",
  lat: Number(import.meta.env.VITE_STORE_LATITUDE || 14.4509229),
  lng: Number(import.meta.env.VITE_STORE_LONGITUDE || 120.9764514)
};
const storePoint = [storeLocation.lat, storeLocation.lng];

const markerIcon = (label, color) => divIcon({
  className: "custom-map-marker",
  html: `<span style="background:${color}">${label}</span>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18]
});

function MapViewport({ store, rider, customer, focusRequest }) {
  const map = useMap();
  useEffect(() => {
    if (focusRequest > 0 || (!rider && !customer)) {
      map.flyTo(store, 18, { duration: 0.7 });
      return;
    }
    const points = [store];
    if (rider) points.push(rider);
    if (customer) points.push(customer);
    map.fitBounds(points, { padding: [45, 45], maxZoom: 17 });
  }, [customer, focusRequest, map, rider, store]);
  return null;
}

function MapSizeSync({ resizeKey }) {
  const map = useMap();
  useEffect(() => {
    let frame = 0;
    let timer = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    };
    resize();
    timer = window.setTimeout(resize, 250);
    const container = map.getContainer();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [map, resizeKey]);
  return null;
}

function pointFromCoordinates(latValue, lngValue) {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180 ? [lat, lng] : null;
}

const PREPARING_STATUSES = new Set(["received", "preparing"]);

function arrivalWindow(durationMinutes, status) {
  const prepMinimum = PREPARING_STATUSES.has(status) ? 15 : status === "ready" ? 5 : 0;
  const prepMaximum = PREPARING_STATUSES.has(status) ? 25 : status === "ready" ? 10 : 5;
  const format = (minutes) => new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  }).format(new Date(Date.now() + minutes * 60_000));
  return `${format(durationMinutes + prepMinimum)}–${format(durationMinutes + prepMaximum)}`;
}

function distanceLabel(distanceMeters) {
  return distanceMeters < 1000 ? `${Math.max(1, Math.round(distanceMeters))} m` : `${(distanceMeters / 1000).toFixed(1)} km`;
}

export default function DeliveryMap({ rider, customer = null, editableCustomer = false, onCustomerChange = () => {}, orderId = "", orderStatus = "" }) {
  const [focusRequest, setFocusRequest] = useState(0);
  const [roadRoute, setRoadRoute] = useState(null);
  const [routeState, setRouteState] = useState("idle");
  const lastRoadRequest = useRef(null);
  const store = storePoint;
  const riderLat = Array.isArray(rider) ? rider[0] : rider?.lat;
  const riderLng = Array.isArray(rider) ? rider[1] : rider?.lng;
  const customerLat = Array.isArray(customer) ? customer[0] : customer?.lat;
  const customerLng = Array.isArray(customer) ? customer[1] : customer?.lng;
  const riderPosition = useMemo(() => pointFromCoordinates(riderLat, riderLng), [riderLat, riderLng]);
  const customerPosition = useMemo(() => pointFromCoordinates(customerLat, customerLng), [customerLat, customerLng]);
  const fallbackRoute = useMemo(
    () => estimateDeliveryRoute({ store, rider: riderPosition, customer: customerPosition }),
    [customerPosition, riderPosition, store]
  );
  const route = roadRoute || fallbackRoute;
  useEffect(() => {
    if (!fallbackRoute || !customerPosition) {
      setRoadRoute(null);
      setRouteState("idle");
      lastRoadRequest.current = null;
      return undefined;
    }
    const origin = riderPosition || store;
    const destinationKey = `${orderId}|${customerPosition[0].toFixed(5)},${customerPosition[1].toFixed(5)}`;
    if (lastRoadRequest.current?.destinationKey === destinationKey
      && distanceKm(lastRoadRequest.current.origin, origin) < 0.05) {
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(async () => {
      setRouteState("loading");
      try {
        const result = await api.deliveryRoute(
          { lat: origin[0], lng: origin[1] },
          { lat: customerPosition[0], lng: customerPosition[1] },
          orderId || undefined,
          controller.signal
        );
        if (!active) return;
        lastRoadRequest.current = { destinationKey, origin };
        setRoadRoute({
          points: result.points,
          distanceKm: result.distanceMeters / 1000,
          etaMinutes: Math.max(1, Math.ceil(result.durationSeconds / 60)),
          label: `${Math.max(1, Math.ceil(result.durationSeconds / 60))} min drive`,
          distanceLabel: distanceLabel(result.distanceMeters),
          source: "road-route"
        });
        setRouteState("ready");
      } catch (error) {
        if (!active || controller.signal.aborted || error?.name === "AbortError") return;
        setRoadRoute(null);
        setRouteState("fallback");
      }
    }, editableCustomer ? 500 : 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customerPosition, editableCustomer, fallbackRoute, orderId, riderPosition, store]);
  const resizeKey = `${riderPosition?.join(",") || "no-rider"}|${customerPosition?.join(",") || "no-customer"}|${editableCustomer}`;
  return (
    <div className="delivery-map-wrap">
      <MapContainer center={store} zoom={18} className="delivery-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapSizeSync resizeKey={resizeKey} />
        <MapViewport store={store} rider={riderPosition} customer={customerPosition} focusRequest={focusRequest} />
        {route && <Polyline positions={route.points} pathOptions={{ color: "#d93624", weight: 6, opacity: 0.92, lineCap: "round", lineJoin: "round" }} />}
        <Marker position={store} icon={markerIcon("T", "#d93624")}><Popup><strong>{storeLocation.name}</strong><br />{storeLocation.address}</Popup></Marker>
        {riderPosition && <Marker position={riderPosition} icon={markerIcon("R", "#d5a94d")}><Popup>Live rider location</Popup></Marker>}
        {customerPosition && <Marker
          position={customerPosition}
          draggable={editableCustomer}
          eventHandlers={editableCustomer ? {
            dragend: (event) => {
              const next = event.target.getLatLng();
              onCustomerChange({ lat: next.lat, lng: next.lng });
            }
          } : undefined}
          icon={markerIcon("C", "#2b714d")}
        ><Popup>{editableCustomer ? "Drag to adjust delivery pin" : "Customer delivery pin"}</Popup></Marker>}
      </MapContainer>
      {route && (
        <div className="route-eta-chip" aria-live="polite">
          <strong>{orderId ? `Est. arrival ${arrivalWindow(route.etaMinutes, orderStatus)}` : route.label}</strong>
          <span>{route.distanceLabel}{riderPosition ? " remaining" : " shop to drop-off"}</span>
          <small>{routeState === "loading" ? "Finding the road route…" : route.source === "road-route" ? "Road-route estimate · traffic not included" : "Approximate route · road service unavailable"}</small>
        </div>
      )}
      <button className="focus-store-button" type="button" onClick={() => setFocusRequest((current) => current + 1)}>Focus Taptap shop</button>
    </div>
  );
}
