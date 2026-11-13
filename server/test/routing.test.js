import assert from "node:assert/strict";
import test from "node:test";
import { clearDeliveryRouteCache, fetchDeliveryRoute } from "../src/application/routing.js";

const config = {
  baseUrl: "https://routing.example.test",
  timeoutMs: 1000,
  cacheTtlMs: 60_000,
  store: [14.4509229, 120.9764514]
};

test("returns a road-following route with distance and travel time", async () => {
  clearDeliveryRouteCache();
  let requestedUrl = "";
  const result = await fetchDeliveryRoute({
    origin: [14.4509229, 120.9764514],
    destination: [14.455, 120.982],
    config,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({
        routes: [{
          distance: 1053.8,
          duration: 110.3,
          geometry: { coordinates: [[120.9764514, 14.4509229], [120.98, 14.453], [120.982, 14.455]] }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  assert.match(requestedUrl, /route\/v1\/driving\/120\.9764514,14\.4509229;120\.982,14\.455/);
  assert.deepEqual(result.points[1], [14.453, 120.98]);
  assert.equal(result.distanceMeters, 1054);
  assert.equal(result.durationSeconds, 110);
  assert.equal(result.source, "road-route");
});

test("caches nearby routes and rejects use outside the delivery area", async () => {
  clearDeliveryRouteCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ routes: [{
      distance: 500,
      duration: 90,
      geometry: { coordinates: [[120.9764, 14.4509], [120.98, 14.455]] }
    }] }), { status: 200 });
  };
  const input = { origin: [14.4509, 120.9764], destination: [14.455, 120.98], config, fetchImpl, now: 1000 };
  await fetchDeliveryRoute(input);
  const cached = await fetchDeliveryRoute({ ...input, now: 2000 });
  assert.equal(calls, 1);
  assert.equal(cached.cached, true);

  await assert.rejects(
    () => fetchDeliveryRoute({ ...input, destination: [15.5, 121.5] }),
    /outside the delivery service area/i
  );
});
