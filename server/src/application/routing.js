import { HttpError } from "../security.js";

const routeCache = new Map();

function radians(value) {
  return value * Math.PI / 180;
}

function distanceKm(from, to) {
  const dLat = radians(to[0] - from[0]);
  const dLng = radians(to[1] - from[1]);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(from[0])) * Math.cos(radians(to[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cacheKey(origin, destination) {
  return [...origin, ...destination].map((value) => Number(value).toFixed(5)).join(":");
}

function approximateRoute(origin, destination) {
  const estimatedDistanceMeters = Math.max(1, Math.round(distanceKm(origin, destination) * 1_000 * 1.25));
  const estimatedDurationSeconds = Math.max(60, Math.round(estimatedDistanceMeters / 1_000 / 22 * 3_600));
  return {
    points: [origin, destination],
    distanceMeters: estimatedDistanceMeters,
    durationSeconds: estimatedDurationSeconds,
    source: "approximate-route",
    cached: false,
    degraded: true
  };
}

function pruneCache(now) {
  if (routeCache.size < 250) return;
  for (const [key, entry] of routeCache) {
    if (entry.expiresAt <= now) routeCache.delete(key);
  }
  while (routeCache.size > 300) routeCache.delete(routeCache.keys().next().value);
}

export async function fetchDeliveryRoute({ origin, destination, config, fetchImpl = fetch, now = Date.now() }) {
  const store = config?.store || [14.4509229, 120.9764514];
  if (distanceKm(store, origin) > 30 || distanceKm(store, destination) > 30) {
    throw new HttpError(400, "The requested route is outside the delivery service area.");
  }

  const key = cacheKey(origin, destination);
  const cached = routeCache.get(key);
  if (cached?.expiresAt > now) return { ...cached.value, cached: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config?.timeoutMs || 7000);
  const coordinates = `${origin[1]},${origin[0]};${destination[1]},${destination[0]}`;
  const url = `${config?.baseUrl || "https://router.project-osrm.org"}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  let response;
  let payload;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json", "User-Agent": "TapTap-Foodtrip/1.0 delivery-routing" }
    });
    if (!response.ok) return approximateRoute(origin, destination);
    payload = await response.json();
  } catch (error) {
    return approximateRoute(origin, destination);
  } finally {
    clearTimeout(timeout);
  }
  const route = payload?.routes?.[0];
  const coordinatesResult = route?.geometry?.coordinates;
  if (!Array.isArray(coordinatesResult) || coordinatesResult.length < 2) {
    throw new HttpError(422, "No drivable route was found for these delivery points.");
  }
  const points = coordinatesResult
    .map((point) => [Number(point?.[1]), Number(point?.[0])])
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length < 2) throw new HttpError(422, "No drivable route was found for these delivery points.");

  const value = {
    points,
    distanceMeters: Math.max(0, Math.round(Number(route.distance) || 0)),
    durationSeconds: Math.max(60, Math.round(Number(route.duration) || 60)),
    source: "road-route",
    cached: false
  };
  pruneCache(now);
  routeCache.set(key, { value, expiresAt: now + (config?.cacheTtlMs || 300_000) });
  return value;
}

export function clearDeliveryRouteCache() {
  routeCache.clear();
}
