import { firebaseApp, firebaseEnabled } from "./firebase";

type TraceName = "menu_loading" | "checkout_submission" | "dashboard_initial_loading";
type TraceOutcome = "success" | "error" | "cancelled";
type SafeTraceAttributes = {
  role?: "customer" | "owner" | "staff" | "rider";
};

const monitoringConfigured = firebaseEnabled
  && import.meta.env.PROD
  && import.meta.env.VITE_ENABLE_PERFORMANCE_MONITORING === "true";

let performanceModulePromise: Promise<{
  module: typeof import("firebase/performance");
  instance: ReturnType<typeof import("firebase/performance")["getPerformance"]>;
} | null> | null = null;

function loadPerformanceMonitoring() {
  if (!monitoringConfigured || !firebaseApp) return Promise.resolve(null);
  performanceModulePromise ||= import("firebase/performance")
    .then((module) => ({
      module,
      instance: module.getPerformance(firebaseApp)
    }))
    .catch(() => null);
  return performanceModulePromise;
}

export function initializePerformanceMonitoring(): void {
  if (!monitoringConfigured || typeof window === "undefined") return;
  const load = () => void loadPerformanceMonitoring();
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 5000 });
  } else {
    window.setTimeout(load, 3000);
  }
}

export function startPerformanceTrace(
  name: TraceName,
  attributes: SafeTraceAttributes = {}
): { stop: (outcome?: TraceOutcome) => void } {
  const startedAt = Date.now();
  let stopped = false;

  return {
    stop(outcome: TraceOutcome = "success") {
      if (stopped) return;
      stopped = true;
      const duration = Math.max(1, Date.now() - startedAt);
      void loadPerformanceMonitoring().then((loaded) => {
        if (!loaded) return;
        try {
          const safeAttributes = {
            outcome,
            ...(attributes.role ? { role: attributes.role } : {})
          };
          loaded.module.trace(loaded.instance, name).record(startedAt, duration, {
            attributes: safeAttributes
          });
        } catch {
          // Optional monitoring must not affect the measured workflow.
        }
      });
    }
  };
}

export async function runPerformanceTrace<T>(
  name: TraceName,
  operation: () => Promise<T>,
  attributes: SafeTraceAttributes = {}
): Promise<T> {
  const trace = startPerformanceTrace(name, attributes);
  try {
    const result = await operation();
    trace.stop("success");
    return result;
  } catch (error) {
    trace.stop("error");
    throw error;
  }
}
