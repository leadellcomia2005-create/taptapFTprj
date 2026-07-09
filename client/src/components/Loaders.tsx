interface LoaderProps {
  label?: string;
}

export function PageLoader({ label = "Loading Taptap Foodtrip..." }: LoaderProps) {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-busy="true">
      {label}
    </div>
  );
}

export function SectionLoader({ label = "Loading section..." }: LoaderProps) {
  return (
    <div className="section-loader" role="status" aria-live="polite" aria-busy="true">
      <span className="section-loader-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
