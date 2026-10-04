const productionServerOrigin = "https://taptap-foodtrip-api.onrender.com";

const isLoopbackUrl = (value = ""): boolean => /^https?:\/\/(localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(value);
const browserIsLoopback = (): boolean => typeof window !== "undefined"
  && ["localhost", "127.0.0.1"].includes(window.location.hostname);

function productionSafeUrl(configured: string | undefined, fallback: string): string {
  if (import.meta.env.PROD && !browserIsLoopback() && isLoopbackUrl(configured)) return fallback;
  return configured || fallback;
}

export const apiBaseUrl = (): string => productionSafeUrl(
  import.meta.env.VITE_API_BASE_URL,
  import.meta.env.PROD ? `${productionServerOrigin}/api` : "/api"
);

export const socketServerUrl = (): string => productionSafeUrl(
  import.meta.env.VITE_SOCKET_URL,
  import.meta.env.PROD
    ? productionServerOrigin
    : typeof window !== "undefined" ? window.location.origin : "http://localhost:8080"
);
