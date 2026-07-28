# Security and Monitoring

TapTap Foodtrip uses structured logs plus free, in-process aggregate metrics. The metrics reset when
the Express process restarts and are intended for live diagnosis, demonstrations, and integration with
host log alerts later. They do not replace durable production monitoring.

## Privacy Boundary

The owner-only `GET /api/admin/metrics` response contains counts, latency buckets, uptime, ratios, and
boolean alerts only. It does not contain names, email addresses, phone numbers, addresses, coordinates,
order payloads, proof data, credentials, tokens, or socket payloads. Structured logger redaction remains
the final guard for accidental sensitive fields.

Signals include:

- HTTP request counts, 4xx/5xx counts, error ratio, average/max latency, and fixed latency buckets
- checkout failures and stock conflicts
- authorization failures and readiness failures
- Socket.IO disconnections
- incomplete cancellation and unresolved COD findings observed by an owner recovery scan

## Alert Thresholds

The endpoint sets an alert flag when a process-lifetime counter reaches these conservative defaults:

| Signal | Threshold | First response |
| --- | --- | --- |
| HTTP 5xx ratio | At least 2% after 20 requests | Check recent request IDs and readiness |
| Requests over 5 seconds | 5 | Check Firebase latency and query bounds |
| Checkout failures | 5 | Inspect validation, connectivity, and stock conflicts |
| Stock conflicts | 3 | Check inventory accuracy and concurrent order volume |
| Authorization failures | 10 | Check expired sessions, role changes, and suspicious access |
| Socket disconnections | 20 | Check network stability and Socket.IO host health |
| Readiness failure | 1 | Remove the revision from traffic and verify Firebase Admin |
| Incomplete cancellation | 1 | Run owner dry-run recovery and verify inventory |
| Unresolved COD | 1 | Verify physical cash before confirming remittance |

For a real deployment, alert on counter deltas over five minutes from structured logs rather than the
cumulative process values. Do not send customer or request payloads to an alert destination.

## Security Review

- CORS accepts only exact origins from `CLIENT_ORIGIN`; credentials remain enabled for the approved site.
- Helmet supplies API security headers. Firebase Hosting currently serves the website and requires a
  separately tested Content Security Policy before one is enforced. Maps, Firebase, camera previews,
  data-image fallbacks, and optional Analytics must be included deliberately; a guessed CSP can break checkout.
- The API has a global 90-request-per-minute limiter plus stricter registration and authentication controls.
- Firebase ID tokens are checked for revocation. Role changes, suspension, and compromise response revoke sessions.
- Operational roles require verified email and MFA. Emergency owner access and credential rotation are in
  `docs/OPERATIONS_RUNBOOK.md`.
- Firebase App Check is deferred. The current custom Express API and deterministic demo mode do not yet have a
  compatible, fully tested attestation flow. Enforcing App Check now would break demos and unsupported clients.
- The scheduled GitHub workflow audits root, client, server, and Firebase Functions production dependencies
  every Monday and can be run manually. High or critical findings fail the job; lower findings still require
  review during planned dependency updates.
