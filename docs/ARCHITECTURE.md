# TapTap Foodtrip Architecture

## Direction

TapTap Foodtrip is a modular monolith. It uses one React website, one canonical Express API,
and one Firebase Realtime Database. The system does not use microservices.

```mermaid
flowchart LR
  Browser["React/Vite website"] --> Shell["App shell and role features"]
  Shell --> Reads["Typed Firebase read subscriptions"]
  Shell --> API["Express /api"]
  Shell --> Socket["Socket.IO realtime channel"]
  Reads --> RTDB["Firebase Realtime Database"]
  API --> Auth["Authentication and authorization middleware"]
  Auth --> UseCases["Application use-case boundaries"]
  UseCases --> Domain["Domain policies and integrity rules"]
  Domain --> Repository["Firebase repository adapter"]
  Repository --> RTDB
  Socket --> RTDB
  Functions["Undeployed Functions compatibility entry"] -. reuses canonical rules .-> Domain
```

Sensitive writes flow through Express. Firebase browser subscriptions provide realtime reads.
Realtime Database is authoritative for operational data.

## Client Responsibilities

| Area | Location | Responsibility |
| --- | --- | --- |
| App shell | `client/src/App.jsx` | Authentication gates, lazy feature composition, and global status UI |
| Cross-cutting hooks | `client/src/hooks/useAppState.js` | Auth/profile, role navigation, notifications, and cart/checkout state |
| Role features | `client/src/features/` | Customer, owner, staff, rider, and authentication screens |
| Shared UI | `client/src/components/` | Branding, loaders, maps, charts, photos, and camera proof |
| Typed contracts | `client/src/types/` and `client/src/contracts/` | Domain types, constants, API records, and runtime guards |
| API adapter | `client/src/services/api.ts` | Authenticated HTTP requests and response-object validation |
| Firebase facades | `client/src/services/firebase/` | Domain-specific import boundaries and subscription APIs |
| Compatibility adapter | `client/src/services/firebase.js` | Existing implementation retained during gradual migration |

All feature code imports a domain Firebase facade instead of importing the compatibility
adapter directly. Firebase and API payloads are filtered through runtime guards before feature
screens receive them. Subscriptions return cleanup functions and are removed by React effects.

## Server Responsibilities

| Area | Location | Responsibility |
| --- | --- | --- |
| Transport | `server/src/index.js` | Express routes, status endpoint, request mapping, and Socket.IO setup |
| Middleware | `server/src/middleware/` | Headers, rate limits, authentication, role checks, and validation helpers |
| Application boundaries | `server/src/application/` | Stable use-case imports grouped by orders, catalog, feedback, delivery, and workforce |
| Domain | `server/src/domain/` | Order transitions, authorization policies, idempotency, aggregates, and 2FA policy |
| Repository | `server/src/repositories/firebaseRepository.js` | Firebase read, update, and transaction operations |
| Compatibility core | `server/src/business.js` | Existing use-case implementations retained while extraction proceeds incrementally |
| Optional adapters | `server/src/services.js` and related modules | Email and deferred provider integrations with disabled fallbacks |

`server/src/business.js` remains a tested compatibility core. New policy logic belongs in
`server/src/domain/`; new data access should use the repository adapter. Moving individual
use cases out of the core is future incremental work, not a reason to duplicate behavior.

## Canonical Backend

Express is the authoritative implementation for:

- order creation and idempotency
- status transitions and cancellation
- price recalculation and stock transactions
- rider claims and assignment
- delivery proof persistence
- inventory and payment movement records
- review moderation and public review projection
- shifts, approvals, notifications, audit logs, and reporting aggregates

`functions/` is optional and undeployed. Its policy exports point to the canonical server
modules so a second implementation cannot drift. Because those imports cross the Functions
package boundary, do not deploy it as-is. A future paid deployment must first package the shared
core explicitly and rerun the complete test suite.

## Data Integrity

The backend applies these invariants:

- Clients send item IDs and quantities; the server reloads prices and recalculates totals.
- Order creation keys prevent accidental duplicate submissions for seven days.
- Stock deduction, cancellation restoration, and rider claims use Firebase transactions.
- Inventory and payment movements are append-only server records.
- Daily sales aggregates use Asia/Manila date keys and server increment operations.
- Available rider jobs use a sanitized projection without customer address or private details.
- Public reviews contain approved display fields only.
- Notifications and compressed proof records include retention timestamps.

## Firebase Access

Realtime Database rules enforce customer isolation, review ownership, protected profile fields,
role scopes, notification privacy, rider assignment access, and server-only operational writes.
`storage.rules` denies every Storage operation because Storage is disabled in the free-first
configuration. Delivery proof fallback data is compressed, validated, size-limited, and written
through Express to Realtime Database.

Rule behavior is tested in `test/database.rules.test.mjs` against the Realtime Database emulator.

## Analytics Boundary

Website conversion events pass through the typed `client/src/services/analytics.ts` boundary.
It accepts product, role, source, quantity, value, currency, and coded funnel facts only. Customer
identity, contact details, addresses, delivery coordinates, notes, OTPs, messages, and proof data
must never be sent to Analytics. Event definitions, funnel setup, and reporting limitations are in
`docs/ANALYTICS.md`.

## Environment Modes

### Client

| Variable | Purpose |
| --- | --- |
| `VITE_ENABLE_DEMO_MODE` | Must be exactly `true` to allow local demo accounts |
| `VITE_DISABLE_FIREBASE` | Disables browser Firebase initialization for deterministic tests |
| `VITE_ENABLE_FIREBASE_STORAGE` | Keep `false` in the free-first setup |
| `VITE_USE_FIREBASE_EMULATORS` | Connects browser SDKs to local emulators in development |
| `VITE_API_BASE_URL` | Express API base URL |
| `VITE_SOCKET_URL` | Socket.IO server URL |
| `VITE_FIREBASE_*` | Public Firebase web application configuration |
| `VITE_STORE_*` | Website store name, address, and delivery pin |

### Server

| Variable | Purpose |
| --- | --- |
| `PORT`, `CLIENT_ORIGIN` | Local HTTP port and allowed website origin |
| `FIREBASE_DATABASE_URL` | Admin SDK Realtime Database target |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ignored local service-account path or use application-default credentials |
| `TWO_FACTOR_ENCRYPTION_KEY` | Server-only TOTP secret encryption key |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Optional email OTP and receipt delivery |
| `TURNSTILE_SECRET_KEY` | Optional server-side registration bot protection |
| `ENABLE_OPENAI`, `ENABLE_TWILIO`, `ENABLE_PAYMONGO` | Explicit provider opt-ins; keep `false` while deferred |

Never put server secrets in `client/.env` or commit any `.env` file.

### Demo Versus Production

`client/.env.e2e` explicitly enables demo mode, disables Firebase, and contains no secrets.
Development may use demo mode for local role walkthroughs. Production must set
`VITE_ENABLE_DEMO_MODE=false`, configure Firebase Authentication, remove demo passwords, and use
real role claims. An absent Firebase configuration does not silently enable demo credentials.

## Deferred Integrations

OpenAI, Twilio, and PayMongo are outside the current architecture update. Their optional code is
retained, but credentials alone cannot enable them. Each provider also requires its explicit
`ENABLE_*` flag. Tests clear their credentials and assert that no related network request occurs.
The supported demonstration path uses deterministic assistant fallbacks, in-website
notifications, TOTP or email verification, and COD/manual payment.

Do not configure provider keys, add webhooks, or enable these integrations until a separate
review covers provider security, signatures, privacy, failure handling, and cost.

## Local Setup

1. Install Node.js 22 and Java 21.
2. Run `npm install`, `npm install --prefix client`, and `npm install --prefix server`.
3. Copy the client and server `.env.example` files to ignored `.env` files.
4. For a Firebase-backed session, enable Email/Password Auth and provide local Admin credentials.
5. Run `npm run dev`.
6. Open `http://localhost:5173`.

## Validation

```powershell
npm run typecheck --prefix client
npm run lint --prefix client
npm run build --prefix client
npm run performance:check --prefix client
npm run test --prefix server
npm run smoke:preview --prefix client
npm run test:rules
npm run test:e2e
```

`npm run test:rules` starts the Database emulator and requires Java. Playwright starts isolated
demo servers on ports 4173 and 8181. It covers the landing and registration flow, COD checkout,
owner reports, staff POS/order queue, rider delivery/proof workflow, console errors,
accessibility, touch targets, and 375 px overflow.

## Free-Service Boundary

Local development and demonstration can run without paid integrations. Firebase Spark quotas
and terms still apply, and a public production website is not guaranteed to remain free.
The default `npm run deploy` builds the client and deploys Database rules only. Storage,
Functions, Cloud Run, and App Hosting remain disabled or undeployed.

A public deployment needs an HTTPS host for the website and a reachable HTTPS Express/Socket.IO
backend. Hosting that backend may incur cost. Future Firebase Functions, Cloud Run, Storage,
OpenAI, Twilio, or PayMongo use must be treated as a separate paid deployment decision.
