import { serviceDisplayNames } from "../config/appConfig";

interface BrandMarkProps {
  className?: string;
}

interface ServiceBadgeProps {
  name: string;
  active?: boolean;
  note?: string;
}

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <span className={`brand-mark ${className}`.trim()}>
      <picture>
        <source srcSet="/assets/taptap-logo.avif" type="image/avif" />
        <source srcSet="/assets/taptap-logo.webp" type="image/webp" />
        <img src="/assets/taptap-logo.png" alt="TapTap FoodTrip logo" width={720} height={742} decoding="async" />
      </picture>
    </span>
  );
}

export function ServiceBadge({ name, active = false, note }: ServiceBadgeProps) {
  const serviceLabels = serviceDisplayNames as Record<string, string>;
  const displayName = serviceLabels[name] || name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
  return (
    <div className="service-badge">
      <span className={`service-dot ${active ? "active" : ""}`} />
      <div><strong>{displayName}</strong><small>{note || (active ? "Ready" : "Needs setup")}</small></div>
    </div>
  );
}
