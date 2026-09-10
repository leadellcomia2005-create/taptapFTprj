import type { DeliveryLocation } from "../types/domain";
import {
  isLasPinasBarangay,
  isWithinLasPinasBounds,
  LAS_PINAS_BOUNDS,
  LAS_PINAS_CITY,
  type LasPinasBarangay
} from "../data/lasPinas";

interface NominatimResult {
  lat?: string;
  lon?: string;
}

const geocodingEndpoint = import.meta.env.VITE_GEOCODING_URL || "https://nominatim.openstreetmap.org/search";
const cachePrefix = "taptap-las-pinas-geocode:v1:";
let lastRequestAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function readCachedLocation(barangay: LasPinasBarangay): DeliveryLocation | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${cachePrefix}${barangay}`) || "null") as Partial<DeliveryLocation> | null;
    return isWithinLasPinasBounds(parsed) ? {
      lat: Number(parsed?.lat),
      lng: Number(parsed?.lng),
      accuracy: 1200,
      source: "barangay-lookup"
    } : null;
  } catch {
    return null;
  }
}

function cacheLocation(barangay: LasPinasBarangay, location: DeliveryLocation): void {
  try {
    window.localStorage.setItem(`${cachePrefix}${barangay}`, JSON.stringify({ lat: location.lat, lng: location.lng }));
  } catch {
    // The lookup remains usable when browser storage is unavailable.
  }
}

async function rateLimitedFetch(url: string): Promise<Response> {
  const request = requestQueue.then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (delay) await wait(delay);
    lastRequestAt = Date.now();
    return fetch(url, {
      headers: { "Accept-Language": "en-PH,en;q=0.9" },
      referrerPolicy: "strict-origin-when-cross-origin"
    });
  });
  requestQueue = request.catch(() => undefined);
  return request;
}

export async function geocodeLasPinasBarangay(barangay: string): Promise<DeliveryLocation> {
  if (!isLasPinasBarangay(barangay)) throw new Error("Choose a valid Las Piñas barangay.");
  const cached = readCachedLocation(barangay);
  if (cached) return cached;

  const query = new URLSearchParams({
    q: `${barangay}, ${LAS_PINAS_CITY}, Metro Manila, Philippines`,
    format: "jsonv2",
    limit: "3",
    countrycodes: "ph",
    bounded: "1",
    viewbox: `${LAS_PINAS_BOUNDS.west},${LAS_PINAS_BOUNDS.north},${LAS_PINAS_BOUNDS.east},${LAS_PINAS_BOUNDS.south}`
  });
  const response = await rateLimitedFetch(`${geocodingEndpoint}?${query.toString()}`);
  if (!response.ok) throw new Error("The barangay map lookup is temporarily unavailable.");
  const results = await response.json() as NominatimResult[];
  const match = results
    .map((result) => ({ lat: Number(result.lat), lng: Number(result.lon) }))
    .find((location) => isWithinLasPinasBounds(location));
  if (!match) throw new Error("The selected barangay could not be located on the map.");

  const location: DeliveryLocation = {
    ...match,
    accuracy: 1200,
    source: "barangay-lookup"
  };
  cacheLocation(barangay, location);
  return location;
}
