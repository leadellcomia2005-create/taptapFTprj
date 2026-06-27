export function PageLoader({ label = "Loading Taptap Foodtrip..." }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-busy="true">
      {label}
    </div>
  );
}

export function SectionLoader({ label = "Loading section..." }) {
  return (
    <div className="section-loader" role="status" aria-live="polite" aria-busy="true">
      <span className="section-loader-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
