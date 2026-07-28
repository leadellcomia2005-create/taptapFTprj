const latencyBounds = [100, 250, 500, 1000, 2000, 5000];
const counterNames = [
  "authorizationFailures",
  "cancellationDiscrepancies",
  "checkoutFailures",
  "codDiscrepancies",
  "readinessFailures",
  "socketDisconnections",
  "stockConflicts"
];

function emptyCounters() {
  return Object.fromEntries(counterNames.map((name) => [name, 0]));
}

function emptyLatencyBuckets() {
  return Object.fromEntries([...latencyBounds.map((bound) => [`le${bound}Ms`, 0]), ["over5000Ms", 0]]);
}

export function createOperationalMetrics({ startedAt = Date.now() } = {}) {
  const counters = emptyCounters();
  const requests = { total: 0, clientErrors: 0, serverErrors: 0 };
  const latency = { count: 0, totalMs: 0, maxMs: 0, buckets: emptyLatencyBuckets() };

  function increment(name, amount = 1) {
    if (!Object.hasOwn(counters, name)) return;
    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount)) return;
    counters[name] += Math.max(0, normalizedAmount);
  }

  function observeRequest({ method = "", path = "", status = 0, durationMs = 0 } = {}) {
    const normalizedStatus = Number(status || 0);
    const normalizedDuration = Math.max(0, Number(durationMs || 0));
    requests.total += 1;
    if (normalizedStatus >= 500) requests.serverErrors += 1;
    else if (normalizedStatus >= 400) requests.clientErrors += 1;
    if ([401, 403].includes(normalizedStatus)) increment("authorizationFailures");
    if (method === "POST" && path === "/api/orders" && normalizedStatus >= 400) increment("checkoutFailures");

    latency.count += 1;
    latency.totalMs += normalizedDuration;
    latency.maxMs = Math.max(latency.maxMs, normalizedDuration);
    if (normalizedDuration > latencyBounds.at(-1)) {
      latency.buckets.over5000Ms += 1;
    } else {
      latencyBounds
        .filter((value) => normalizedDuration <= value)
        .forEach((value) => { latency.buckets[`le${value}Ms`] += 1; });
    }
  }

  function recordRecoverySummary(summary = {}) {
    increment("cancellationDiscrepancies", Number(summary.incomplete_cancellation || 0));
    increment("codDiscrepancies", Number(summary.unresolved_cod_handoff || 0));
  }

  function snapshot() {
    const serverErrorRatio = requests.total ? requests.serverErrors / requests.total : 0;
    const averageMs = latency.count ? latency.totalMs / latency.count : 0;
    return {
      startedAt,
      uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
      requests: { ...requests, serverErrorRatio: Number(serverErrorRatio.toFixed(4)) },
      latency: {
        count: latency.count,
        averageMs: Number(averageMs.toFixed(1)),
        maxMs: latency.maxMs,
        buckets: { ...latency.buckets }
      },
      counters: { ...counters },
      alerts: {
        serverErrors: requests.total >= 20 && serverErrorRatio >= 0.02,
        slowRequests: latency.buckets.over5000Ms >= 5,
        checkoutFailures: counters.checkoutFailures >= 5,
        stockConflicts: counters.stockConflicts >= 3,
        authorizationFailures: counters.authorizationFailures >= 10,
        socketDisconnections: counters.socketDisconnections >= 20,
        readinessFailures: counters.readinessFailures >= 1,
        cancellationDiscrepancies: counters.cancellationDiscrepancies >= 1,
        codDiscrepancies: counters.codDiscrepancies >= 1
      }
    };
  }

  return { increment, observeRequest, recordRecoverySummary, snapshot };
}

export function createNoopOperationalMetrics() {
  return {
    increment() {},
    observeRequest() {},
    recordRecoverySummary() {},
    snapshot() {
      return createOperationalMetrics().snapshot();
    }
  };
}
