import { useEffect, useState } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const storeLocation = {
  name: import.meta.env.VITE_STORE_NAME || "Taptap Foodtrip",
  address: import.meta.env.VITE_STORE_ADDRESS || "#17 Gemini Street, Pamplona Park, Pamplona Dos, Las Pinas City 1740",
  lat: Number(import.meta.env.VITE_STORE_LATITUDE || 14.4509229),
  lng: Number(import.meta.env.VITE_STORE_LONGITUDE || 120.9764514)
};

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

function toPoint(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

export default function DeliveryMap({ rider, customer = null, editableCustomer = false, onCustomerChange = () => {} }) {
  const [focusRequest, setFocusRequest] = useState(0);
  const store = [storeLocation.lat, storeLocation.lng];
  const riderPosition = rider ? [rider.lat, rider.lng] : null;
  const customerPosition = toPoint(customer);
  return (
    <div className="delivery-map-wrap">
      <MapContainer center={store} zoom={18} className="delivery-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapViewport store={store} rider={riderPosition} customer={customerPosition} focusRequest={focusRequest} />
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
      <button className="focus-store-button" type="button" onClick={() => setFocusRequest((current) => current + 1)}>Focus Taptap shop</button>
    </div>
  );
}
