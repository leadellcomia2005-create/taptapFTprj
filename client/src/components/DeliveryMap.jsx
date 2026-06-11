import { useEffect } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

const markerIcon = (label, color) => divIcon({
  className: "custom-map-marker",
  html: `<span style="background:${color}">${label}</span>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18]
});

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, 15);
  }, [center, map]);
  return null;
}

export default function DeliveryMap({ rider, customer = [14.4445, 120.9939] }) {
  const store = [14.4507, 120.9942];
  const riderPosition = rider ? [rider.lat, rider.lng] : [14.4475, 120.994];
  return (
    <MapContainer center={riderPosition} zoom={15} className="delivery-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter center={riderPosition} />
      <Marker position={store} icon={markerIcon("T", "#d93624")}><Popup>Taptap Foodtrip</Popup></Marker>
      <Marker position={riderPosition} icon={markerIcon("R", "#d5a94d")}><Popup>Live rider location</Popup></Marker>
      <Marker position={customer} icon={markerIcon("C", "#2b714d")}><Popup>Customer address</Popup></Marker>
    </MapContainer>
  );
}
