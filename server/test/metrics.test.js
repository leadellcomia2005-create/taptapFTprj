import assert from "node:assert/strict";
import test from "node:test";
import { createOperationalMetrics } from "../src/observability/metrics.js";

test("records bounded aggregate metrics without request or customer data", () => {
  const metrics = createOperationalMetrics({ startedAt: Date.now() - 5_000 });
  metrics.observeRequest({
    method: "POST",
    path: "/api/orders",
    status: 400,
    durationMs: 240,
    requestId: "private-request-id",
    userId: "customer-1"
  });
  metrics.observeRequest({ method: "GET", path: "/api/admin/users", status: 403, durationMs: 6_000 });
  metrics.increment("stockConflicts", 3);
  metrics.increment("socketDisconnections", 20);
  metrics.increment("stockConflicts", Number.NaN);
  metrics.recordRecoverySummary({ incomplete_cancellation: 1, unresolved_cod_handoff: 2 });

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.requests.total, 2);
  assert.equal(snapshot.requests.clientErrors, 2);
  assert.equal(snapshot.counters.authorizationFailures, 1);
  assert.equal(snapshot.counters.checkoutFailures, 1);
  assert.equal(snapshot.counters.stockConflicts, 3);
  assert.equal(snapshot.counters.cancellationDiscrepancies, 1);
  assert.equal(snapshot.counters.codDiscrepancies, 2);
  assert.equal(snapshot.latency.buckets.le250Ms, 1);
  assert.equal(snapshot.latency.buckets.over5000Ms, 1);
  assert.equal(snapshot.alerts.stockConflicts, true);
  assert.equal(snapshot.alerts.socketDisconnections, true);

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private-request-id|customer-1/);
});
