let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

const serviceWorkerSupported = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

export async function getWebsiteServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerSupported() || !import.meta.env.PROD) return null;
  registrationPromise ||= navigator.serviceWorker
    .register("/service-worker.js", {
      scope: "/",
      type: "module",
      updateViaCache: "none"
    })
    .catch(() => null);
  return registrationPromise;
}

export function registerWebsiteServiceWorker(): void {
  if (import.meta.env.VITE_ENABLE_PWA === "false") return;
  void getWebsiteServiceWorker().then((registration) => registration?.update().catch(() => {}));
}
