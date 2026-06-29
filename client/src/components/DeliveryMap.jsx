import { useEffect, useState } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { estimateDeliveryRoute } from "../utils/operations";
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

function toPoint(value) {
  if (!value) return null;
  if (Array.isArray(value)) return pointFromCoordinates(value[0], value[1]);
  return pointFromCoordinates(value.lat, value.lng);
}

export default function DeliveryMap({ rider, customer = null, editableCustomer = false, onCustomerChange = () => {} }) {
  const [focusRequest, setFocusRequest] = useState(0);
  const store = storePoint;
  const riderPosition = toPoint(rider);
  const customerPosition = toPoint(customer);
  const route = estimateDeliveryRoute({ store, rider: riderPosition, customer: customerPosition });
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
        {route && <Polyline positions={route.points} pathOptions={{ color: "#d93624", weight: 5, opacity: 0.72, dashArray: riderPosition ? "" : "8 10" }} />}
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
        <div className="route-eta-chip">
          <strong>{route.label}</strong>
          <span>{route.distanceLabel}{riderPosition ? " from rider" : " shop to drop-off"}</span>
        </div>
      )}
      <button className="focus-store-button" type="button" onClick={() => setFocusRequest((current) => current + 1)}>Focus Taptap shop</button>
    </div>
  );
}
