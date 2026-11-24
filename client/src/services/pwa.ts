let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let updateListenersRegistered = false;
let waitingRegistration: ServiceWorkerRegistration | null = null;
let activationRequested = false;
const updateListeners = new Set<(available: boolean) => void>();

const serviceWorkerSupported = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

const announceUpdate = (registration: ServiceWorkerRegistration): void => {
  waitingRegistration = registration;
  updateListeners.forEach((listener) => listener(true));
  window.dispatchEvent(new CustomEvent("taptap:update-available"));
};

export function subscribeWebsiteUpdates(listener: (available: boolean) => void): () => void {
  updateListeners.add(listener);
  listener(Boolean(waitingRegistration?.waiting));
  return () => updateListeners.delete(listener);
}

export async function activateWebsiteUpdate(): Promise<boolean> {
  const registration = waitingRegistration || await getWebsiteServiceWorker();
  if (!registration?.waiting) return false;
  activationRequested = true;
  registration.waiting.postMessage({ type: "TAPTAP_ACTIVATE_UPDATE" });
  return true;
}

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

  if (!updateListenersRegistered && serviceWorkerSupported()) {
    updateListenersRegistered = true;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!activationRequested) return;
      window.location.reload();
    });
  }

  void getWebsiteServiceWorker().then((registration) => {
    if (!registration) return;

    if (registration.waiting) announceUpdate(registration);
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          announceUpdate(registration);
        }
      });
    });
    void registration.update().catch(() => {});
  });
}
