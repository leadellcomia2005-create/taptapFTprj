import { serviceDisplayNames } from "../config/appConfig";

export function BrandMark({ className = "" }) {
  return (
    <span className={`brand-mark ${className}`.trim()}>
      <img src="/assets/taptap-logo.png" alt="TapTap FoodTrip logo" />
    </span>
  );
}

export function ServiceBadge({ name, active, note }) {
  const displayName = serviceDisplayNames[name] || name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
  return (
    <div className="service-badge">
      <span className={`service-dot ${active ? "active" : ""}`} />
      <div><strong>{displayName}</strong><small>{note || (active ? "Ready" : "Needs setup")}</small></div>
    </div>
  );
}
