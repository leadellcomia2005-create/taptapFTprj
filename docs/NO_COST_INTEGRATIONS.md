# No-Cost Website Integrations

These features are optional. Missing configuration leaves them disabled or safely reduced without
changing login, checkout, orders, dashboards, or demo mode.

## Firebase Cloud Messaging

1. In the existing Firebase project, create or reuse a Web Push certificate.
2. Set its public key as `VITE_FIREBASE_VAPID_KEY` in the production client environment.
3. Keep Firebase Admin credentials on the server only.
4. Build and serve the website over HTTPS in production.
5. Sign in, open Notifications, open More actions, and choose **Turn on browser alerts**.

The website never asks for permission on page load. Tokens are stored under `pushTokens/{uid}` using
hashed record IDs. Push content contains only a display order reference and a status message. The
approved events are confirmed, ready for pickup, out for delivery, rider arrived, cancelled, and
customer action required. In-website notifications remain authoritative.

## Firebase Analytics

Set `VITE_FIREBASE_MEASUREMENT_ID`, then set `VITE_ENABLE_ANALYTICS=true` only in the production
environment. Analytics stays off in development, demo tests, and unsupported browsers. The purchase
event uses a persistent order key to prevent duplicate reporting. See `docs/ANALYTICS.md` for the
privacy allowlist.

## Firebase Performance Monitoring

Set `VITE_ENABLE_PERFORMANCE_MONITORING=true` only in production. It loads lazily and records menu
loading, checkout submission, and initial dashboard traces. It does not record customer identity,
contact data, delivery locations, order notes, messages, or payment details.

## Cloudflare Turnstile

Set:

- `VITE_TURNSTILE_SITE_KEY` in the client environment
- `TURNSTILE_SECRET_KEY` in the server secret environment
- `TURNSTILE_EXPECTED_ACTION=customer_registration`
- `TURNSTILE_ALLOWED_HOSTNAMES` only when the hostnames differ from `CLIENT_ORIGIN`

`TURNSTILE_BYPASS=true` is an explicit local-only escape hatch. Server startup rejects that value
when `NODE_ENV=production`. Turnstile tokens are verified on the server for action, hostname, age,
validity, and Cloudflare's one-time token result.

## PWA Website Support

`VITE_ENABLE_PWA=true` keeps the production website optionally installable. No installation prompt is
shown. The shared FCM/PWA worker caches only safe public static files and the offline page. It never
caches authenticated API responses, Firebase records, checkout submissions, payment redirects,
delivery proofs, dashboards, or private notifications.

## Free-First Deployment Boundary

The local Express server, browser PWA, Turnstile widget, and local automated tests do not require a
paid API subscription. Firebase product quotas and deployment-plan rules still apply. The repository's
free-first `npm run deploy` command deploys Database rules only. Do not run
`npm run deploy:paid-services` or deploy Cloud Functions unless the project owner intentionally accepts
the Firebase plan and usage implications.

Run before approval:

```bash
npm run typecheck --prefix client
npm run lint --prefix client
npm run test:policy --prefix client
npm run build --prefix client
npm run smoke:preview --prefix client
npm test --prefix server
npm run test:e2e:pwa
npm run test:e2e
```
