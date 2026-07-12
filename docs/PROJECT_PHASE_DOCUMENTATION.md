# Taptap Foodtrip Project Documentation by Phase

This document explains the whole Taptap Foodtrip system by project phase. It is written as a code review and project guide, so you can understand what each part does, where the files are, and what should be checked when improving the system.

## 1. Project Overview

Taptap Foodtrip is a role-based food ordering and store operations system. It supports four major roles:

- Customer: browses menu, orders food, receives receipts, tracks delivery, reviews orders, and uses support chat.
- Staff: handles walk-in POS, online order queue, kitchen queue, inventory changes, shift logs, reviews, and chat support.
- Rider: claims ready delivery orders, updates delivery milestones, sends GPS updates, captures delivery proof, and tracks COD collections.
- Owner: monitors sales, reports, inventory, user roles, audit logs, reviews, settings, and business insights.

The project is built as a full-stack application:

- Frontend: React and Vite in `client/`.
- Local backend: Node.js and Express in `server/`.
- Optional deployed backend: Firebase Cloud Functions in `functions/`.
- Database: Firebase Realtime Database with rules in `database.rules.json`.
- Hosting and emulator configuration: `firebase.json`.
- Shared business behavior exists in both local Express and Cloud Functions so the project can run locally for free, then move to deployment later.

## 2. Main Folder Map

| Path | Purpose |
| --- | --- |
| `client/` | React frontend application. |
| `client/src/App.jsx` | Main app shell, role screens, dashboard routing, reports, POS, rider screens, and UI flow. |
| `client/src/styles.css` | Main UI styling and responsive layout. |
| `client/src/data/menu.js` | Fallback menu items, categories, prices, stock defaults, and image mapping. |
| `client/src/services/firebase.js` | Firebase client logic, subscriptions, customer orders, menu, inventory, reviews, support messages, and rider proof upload. |
| `client/src/services/api.js` | Calls to backend API endpoints. |
| `client/src/services/passkeys.js` | Browser WebAuthn/passkey registration and authentication helpers. |
| `client/src/services/socket.js` | Socket.IO client for live updates and rider GPS. |
| `client/src/components/` | Smaller reusable UI components such as charts, delivery map, and camera proof. |
| `client/public/assets/` | Logo, hero image, and menu food photos. |
| `server/` | Local Express backend for free/local development. |
| `server/src/index.js` | API route registration, Firebase Admin setup, Socket.IO setup, and server startup. |
| `server/src/business.js` | Core order, menu, inventory, review, rider, proof, and shift-log business rules. |
| `server/src/security.js` | Role checks, order access checks, status transition validation, and input validation. |
| `server/src/twoFactor.js` | TOTP, email OTP, SMS OTP, backup codes, lockouts, and 2FA status. |
| `server/src/passkeys.js` | Customer passkey registration and authentication verification. |
| `server/src/notifications.js` | Notification record creation, cleanup, read, dismiss, and clear operations. |
| `server/src/services.js` | External services such as OpenAI, Dialogflow, PayMongo, Twilio, and Gmail SMTP. |
| `server/src/seed.js` | Creates demo users, role claims, menu, store data, and inventory. |
| `server/test/` | Backend tests for security, status, and 2FA/passkey rules. |
| `functions/` | Firebase Functions version of secure API behavior. |
| `database.rules.json` | Firebase Realtime Database access rules. |
| `storage.rules` | Firebase Storage rules. |
| `firebase.json` | Firebase database, storage, hosting, functions, and emulator configuration. |
| `.vscode/` | VS Code settings, tasks, launch profiles, and extension recommendations. |

## 3. Phase 1: Foundation and Local Setup

### Goal

Create a runnable full-stack project that can be developed locally without requiring paid cloud hosting.

### Main Files

- `package.json`
- `client/package.json`
- `server/package.json`
- `functions/package.json`
- `README.md`
- `OPEN-DEVELOPMENT.bat`
- `.vscode/tasks.json`
- `.vscode/launch.json`
- `.vscode/settings.json`

### What This Phase Provides

- Root scripts for installing all project packages, running the app, building, testing, and deploying rules.
- Separate package files for frontend, backend, and Firebase Functions.
- VS Code tasks for running the full project, client only, server only, tests, and build.
- Local-first development using:
  - Vite frontend on port `5173`.
  - Express backend on port `8080`.
  - Firebase Realtime Database and Firebase Authentication.

### Important Local Commands

```powershell
npm run install:all
npm run dev
npm run test
npm run build
npm run deploy
```

### Review Notes

- Keep `.env` files local only. They are ignored by Git and should never be pushed.
- `.vscode/` is useful for local development and should be kept unless you want a very clean repository.
- `.codex-tools/` is only for temporary local tunnel testing and is ignored.

## 4. Phase 2: Authentication and Account Security

### Goal

Secure the system before users can access role dashboards or place/manage orders.

### Main Files

- `client/src/services/firebase.js`
- `client/src/services/api.js`
- `client/src/services/passkeys.js`
- `client/src/App.jsx`
- `server/src/security.js`
- `server/src/twoFactor.js`
- `server/src/passkeys.js`
- `server/src/index.js`
- `functions/twoFactor.js`
- `functions/passkeys.js`
- `functions/index.js`
- `database.rules.json`

### Login Flow

1. User signs in with Firebase Authentication.
2. The app checks email verification.
3. The app checks 2FA/passkey security status.
4. User completes the required security method.
5. Backend returns a session/custom token with the `mfaSession` claim.
6. User enters the correct role workspace.

### Role Security Rules

| Role | Allowed Security Methods |
| --- | --- |
| Customer | Passkey, authenticator app, email OTP, SMS OTP |
| Owner | Authenticator app |
| Staff | Authenticator app |
| Rider | Authenticator app |

### Customer Passkey

Customer passkeys use WebAuthn through `navigator.credentials`. The browser asks for fingerprint, Face ID, PIN, or screen lock depending on the device.

Important requirements:

- Works on `localhost`.
- Works on trusted HTTPS domains.
- Does not work on plain IP HTTP such as `http://192.168.1.7:5173`.
- Temporary Cloudflare HTTPS links work only while the tunnel is running.

### Email OTP

Email OTP is customer-only. The backend:

- Sends to the verified Firebase email address.
- Hashes OTP records before saving.
- Expires codes after 10 minutes.
- Limits resend frequency.
- Uses Gmail SMTP when `GMAIL_USER` and `GMAIL_APP_PASSWORD` are configured.

### Authenticator App

The authenticator method uses TOTP and QR code setup. This remains required for owner, staff, and rider roles.

### Review Notes

- Passkeys are a good fit for customer login because they reduce app-switching on mobile.
- For production, use a stable HTTPS domain. Temporary tunnel domains can break saved passkeys because passkeys are tied to the domain.
- Database rules require `email_verified` and `mfaSession` for protected data.

## 5. Phase 3: Customer Storefront and Ordering

### Goal

Allow customers to browse the menu, place orders, manage profile details, receive receipts, track delivery, and submit reviews.

### Main Files

- `client/src/App.jsx`
- `client/src/data/menu.js`
- `client/src/services/firebase.js`
- `client/src/services/api.js`
- `client/src/components/DeliveryMap.jsx`
- `server/src/business.js`
- `server/src/security.js`
- `server/src/index.js`
- `client/public/assets/menu/`

### Customer Views

Customer navigation is defined in `client/src/App.jsx` under `roleNavigation.customer`.

Main customer screens:

- Storefront
- My Orders
- Profile
- Receipts
- Reviews

### Menu Structure

The current fallback menu is defined in `client/src/data/menu.js`.

Categories:

- Favorite Meal
- Alacarte
- Solo
- Drinks
- Special Meal
- Walk-in Add-on

The food photos used by the app are in:

```text
client/public/assets/menu/
```

### Order Creation

Order creation is handled by:

- Frontend: `createOrder` in `client/src/services/firebase.js`
- Backend: `POST /api/orders`
- Business logic: `createOrderRecord` in `server/src/business.js`

The backend recalculates prices from the menu instead of trusting the browser. This is important because customers should not be able to modify prices from the frontend.

### Receipts

Receipts are shown in the customer receipt view. The project supports:

- Print receipt
- Download PDF receipt
- Email receipt when Gmail SMTP is configured

### Reviews

Customers can review delivered orders. Reviews are saved with moderation status and can be managed by owner or staff.

### Review Notes

- Menu photos now use individual files, which is better than the old `menu-grid.png` approach.
- `client/public/assets/menu-grid.png` is still referenced as a CSS fallback. Clean this only after updating the fallback CSS.

## 6. Phase 4: Staff Operations

### Goal

Provide the staff role with realistic daily store operations: POS, order queue, kitchen flow, inventory, shifts, chat support, and review moderation.

### Main Files

- `client/src/App.jsx`
- `client/src/services/firebase.js`
- `client/src/services/api.js`
- `server/src/business.js`
- `server/src/security.js`
- `server/src/notifications.js`

### Staff Views

Staff navigation is defined in `client/src/App.jsx` under `roleNavigation.staff`.

Main staff screens:

- Staff overview
- Walk-in POS
- Order queue
- Kitchen queue
- Inventory
- Shift logs
- Chat support
- Reviews
- Settings

### Walk-in POS

The POS supports:

- Category filtering
- Adding menu items
- Increasing/decreasing quantities
- Removing items
- Clearing cart
- Dine-in and takeout selection
- Discount input
- Cash received input
- Change calculation
- Walk-in order creation

### Kitchen Queue

Kitchen status flow:

```text
received -> preparing -> ready
```

The kitchen queue should focus on food preparation. Delivery-specific rider steps begin only after the order is ready and assigned or claimed.

### Inventory

Staff can adjust inventory through the API. Direct browser writes to inventory are blocked in `database.rules.json`.

### Shift Logs

Shift logs support staff accountability and cash control.

### Chat Support

Customer chatbot/support messages are visible to staff. Staff replies are sent back into the customer's support conversation.

### Review Notes

- Staff dashboards are already mobile-friendly and desktop-friendly in the current UI direction.
- The kitchen queue and order queue are separated, which is realistic for staff workflow.

## 7. Phase 5: Rider Delivery Flow

### Goal

Give riders a mobile-friendly delivery dashboard for order claiming, GPS tracking, delivery milestones, proof capture, and COD tracking.

### Main Files

- `client/src/App.jsx`
- `client/src/components/DeliveryMap.jsx`
- `client/src/components/CameraProof.jsx`
- `client/src/services/socket.js`
- `client/src/services/firebase.js`
- `server/src/business.js`
- `server/src/security.js`
- `server/src/index.js`

### Rider Views

Rider navigation is defined in `client/src/App.jsx` under `roleNavigation.rider`.

Main rider screens:

- Assigned Orders
- COD Ledger

### Delivery Status Flow

The main delivery flow is:

```text
ready -> out-for-delivery -> arrived -> delivered
```

The full backend status flow is defined in `server/src/security.js`:

```text
received -> preparing -> ready -> out-for-delivery -> arrived -> delivered
```

### Rider Features

- Claim available ready orders
- Mark order as picked up
- Send live GPS updates
- Open navigation route
- Mark arrived
- Capture proof of delivery with camera
- Track COD to collect and COD collected

### Camera Proof

Camera proof uses `MediaDevices API` through `client/src/components/CameraProof.jsx`. Proof is saved through backend logic instead of direct database write.

### GPS Tracking

Rider GPS uses:

- Browser geolocation
- Socket.IO for live broadcasts
- Realtime Database mirror for storage/subscription

Direct writes to `riderLocations` are blocked by database rules. Riders update location through the API/socket flow.

### Review Notes

- Rider dashboard is designed for mobile use.
- Camera and geolocation need `localhost` or HTTPS.
- Temporary Cloudflare URLs are useful for testing on mobile but should not be used as final production hosting.

## 8. Phase 6: Owner Administration and Reporting

### Goal

Give the owner control over business performance, inventory, menu management, staff/user control, reports, audits, and settings.

### Main Files

- `client/src/App.jsx`
- `client/src/components/SalesChart.jsx`
- `client/src/services/firebase.js`
- `client/src/services/api.js`
- `server/src/business.js`
- `server/src/index.js`
- `server/src/notifications.js`

### Owner Views

Owner navigation is defined in `client/src/App.jsx` under `roleNavigation.owner`.

Main owner screens:

- Overview
- Sales
- Inventory
- Reports
- Users
- Reviews
- Audit logs
- Settings

### Reports

Owner reports include:

- Daily orders
- Revenue-counted orders
- Pending/uncompleted orders
- Cancelled orders
- Delivered orders
- COD remittance
- Daily order ledger
- Printable daily sales report

### Inventory and Menu Management

Owner can:

- Adjust stock
- Update menu item details
- Create new menu items
- Manage menu availability

### User Management

Owner can:

- View users
- Change roles
- Reset 2FA
- Unlock 2FA
- Send admin messages

### Audit Logs

Audit logs support accountability for:

- Orders
- Inventory changes
- Menu changes
- Shift logs
- Review moderation

### Review Notes

- Owner reports are now more realistic because they separate revenue-counted orders from pending/cancelled orders.
- COD remittance tracking is important because riders may collect cash before the owner receives it.

## 9. Phase 7: Notifications, Support, and Integrations

### Goal

Connect system events to users and optional third-party services.

### Main Files

- `client/src/services/firebase.js`
- `server/src/notifications.js`
- `server/src/services.js`
- `server/src/index.js`
- `functions/notifications.js`
- `functions/index.js`

### Realtime Notifications

Notifications are saved in Realtime Database and shown in the app notification center.

Examples:

- Customer receives order updates.
- Staff receives new order/chat/review alerts.
- Rider receives assignment updates.
- Owner receives sale and business activity notifications.

### Optional Integrations

| Integration | Purpose | Local Requirement |
| --- | --- | --- |
| Gmail SMTP | Email OTP and digital receipts | `GMAIL_USER`, `GMAIL_APP_PASSWORD` |
| Twilio | SMS updates and SMS OTP | Twilio SID, token, sender |
| OpenAI | Sales/inventory insight and assistant fallback | `OPENAI_API_KEY` |
| Dialogflow | FAQ/intent chatbot answers | Dialogflow project credentials |
| PayMongo | GCash/online checkout | PayMongo secret key |

### Review Notes

- Integrations are optional. The core system still works locally without paid services.
- Secrets must remain in `.env` files or Firebase secrets, never in client code.

## 10. Phase 8: Backend API and Data Flow

### Goal

Keep sensitive operations on the backend and prevent clients from writing directly to important database paths.

### Local Express API

Routes are registered in `server/src/index.js`.

Core API groups:

| Route Group | Purpose |
| --- | --- |
| `/api/status` | Service availability status. |
| `/api/2fa/*` | Security app, email OTP, SMS OTP, backup codes, lockout handling. |
| `/api/passkeys/*` | Customer passkey registration and authentication. |
| `/api/assistant` | Customer assistant and fallback AI support. |
| `/api/insights` | Owner AI sales/inventory insights. |
| `/api/payments/checkout` | Online checkout session creation. |
| `/api/notifications/*` | Send, read, clear, dismiss, and cleanup notifications. |
| `/api/orders` | List and create orders. |
| `/api/orders/:orderId` | Update order status and assignment. |
| `/api/orders/:orderId/proof` | Save delivery proof. |
| `/api/inventory/*` | Inventory listing and adjustments. |
| `/api/menu/*` | Owner menu update and create actions. |
| `/api/reviews/*` | Staff/owner review moderation. |
| `/api/riders/location` | Rider GPS update. |
| `/api/shift-logs` | Shift logging. |
| `/api/admin/*` | Owner user management and role controls. |

### Firebase Functions API

The `functions/` folder mirrors most of the Express API for a deployed version. This is useful later if the project moves from local free development to Firebase Hosting and Functions.

### Socket.IO

Socket.IO is configured in `server/src/index.js` and used through `client/src/services/socket.js`.

It supports:

- Private user rooms
- Role rooms
- Order rooms
- Rider GPS updates
- Order update broadcasts

### Review Notes

- Direct writes to protected data are blocked. This is the correct pattern for realistic systems.
- The backend should stay the source of truth for prices, inventory, order status, rider assignment, and proof submission.

## 11. Phase 9: Database Rules and Security Model

### Goal

Protect business data in Firebase Realtime Database.

### Main File

- `database.rules.json`

### Important Rule Patterns

- Default root read/write is blocked.
- Public menu/store can be read by everyone.
- Owner can write public menu/store after verified email and 2FA session.
- Users can read their own profile; owner can read users.
- Orders can be read by owner/staff, assigned rider, matching customer, or available rider query.
- Orders cannot be written directly from the browser.
- Inventory cannot be written directly from the browser.
- Rider locations cannot be written directly from the browser.
- Delivery proofs cannot be written directly from the browser.
- Reviews can be created only by the matching customer for a delivered order.
- Notifications can be read only by the target user.
- 2FA records are not directly readable or writable.

### Review Notes

- `".write": false` on paths such as `orders`, `inventory`, `riderLocations`, and `deliveryProofs` is intentional because backend API code performs the secure write.
- The `mfaSession` claim is central to the protection model.

## 12. Phase 10: Testing, Build, and Deployment

### Goal

Confirm the project works and can be safely deployed.

### Main Files

- `server/test/security.test.js`
- `server/test/status.test.js`
- `server/test/two-factor.test.js`
- `client/eslint.config.js`
- `firebase.json`
- `README.md`

### Current Checks

Recommended checks before pushing:

```powershell
npm run lint --prefix client
npm run build --prefix client
npm run test --prefix server
```

### Deployment Options

Free/local-first option:

- Run React and Express locally.
- Deploy only Firebase database rules when needed.
- Keep Firebase Functions and paid services undeployed.

Paid/production option:

- Deploy frontend to Firebase Hosting.
- Deploy APIs to Firebase Functions or server to Cloud Run.
- Use a stable HTTPS domain.
- Configure Firebase secrets and third-party service credentials.

### Review Notes

- Passkeys require HTTPS in production.
- Camera and GPS also require trusted HTTPS outside localhost.
- Temporary Cloudflare links are useful only for phone testing.

## 13. Current Code Review Notes

These are the main findings from the current codebase review.

### Keep

- `.vscode/` because it contains useful editor settings and run tasks.
- `.env.example` files because they document required environment variables.
- `server/` and `functions/` because they support local backend and future deployed backend options.
- `client/public/assets/menu/` because those are the active menu images.

### Clean Carefully

- `client/public/assets/menu-grid.png` is currently deleted locally, but `client/src/styles.css` still references it as a fallback background. Before removing it permanently, update the CSS fallback to rely only on individual menu item images.
- `separated-menu-photos/` is a local working folder. Most files duplicate `client/public/assets/menu/`. It is safe to keep locally, but it is not needed by the running app.
- Root `package.json` includes `openai`, but actual OpenAI imports are in `server/` and `functions/`. This can likely be removed from the root package later with `npm uninstall openai`, then tested.

### Do Not Push

- `.env` files
- `service-account.local.json`
- `.codex-tools/`
- Runtime logs
- Local tunnel URLs

### Strong Next Improvements

1. Replace the remaining `menu-grid.png` CSS fallback with a plain gradient or image-required state.
2. Split `client/src/App.jsx` into role modules because it is currently the largest file and contains many screens.
3. Keep shared backend logic synchronized between `server/` and `functions/`, or extract shared modules if the project grows.
4. Add more tests for order cancellation, COD remittance, menu item creation, and passkey failure paths.
5. Use a stable HTTPS domain before relying on passkeys for real users.

## 14. Suggested Phase Roadmap

### Phase A: Stabilize Current Local App

- Keep local Express and Vite flow working.
- Fix `menu-grid.png` fallback.
- Keep tests passing.
- Keep `.env` files private.

### Phase B: Code Organization

- Move customer screens into separate files.
- Move owner screens into separate files.
- Move staff screens into separate files.
- Move rider screens into separate files.
- Keep shared UI modules reusable.

### Phase C: Operational Completeness

- Improve owner reports and printable daily report.
- Strengthen COD remittance flow.
- Add more audit log entries.
- Add clearer inventory availability handling.

### Phase D: Mobile and Security

- Test customer passkeys on a stable HTTPS domain.
- Test rider camera proof on actual mobile devices.
- Test GPS tracking with real rider movement.
- Confirm role rules with Firebase Emulator Suite.

### Phase E: Production Readiness

- Replace demo accounts/passwords.
- Configure production secrets.
- Add provider webhook verification for PayMongo/Twilio if enabled.
- Deploy to stable hosting.
- Use monitoring/logging for backend errors.

## 15. Free-First Modular Architecture Update

Completed on 2026-07-12 without deploying, committing, or pushing changes.

### Architecture Changes

- Added typed client contracts and runtime guards for Firebase and API records.
- Added focused auth, cart, notification, and role-navigation hooks.
- Added domain-specific Firebase service facades while retaining the original adapter for compatibility.
- Added Express application boundaries, domain policies, middleware, and a Firebase repository adapter.
- Made Express the documented canonical mutation backend and replaced duplicated Functions operations with canonical exports.
- Added order idempotency, transaction-based stock/rider operations, immutable movement records, reporting aggregates, retention timestamps, and sanitized public projections.
- Hardened Realtime Database rules and denied all Firebase Storage access in the free-first setup.
- Added Playwright, Axe accessibility coverage, Database emulator tests, CI, and production bundle budgets.
- Deferred OpenAI, Twilio, and PayMongo; COD/manual payment and deterministic fallbacks remain the tested paths.

### Final Validation

| Check | Result |
| --- | --- |
| Client TypeScript | Passed |
| Client ESLint | Passed |
| Client production build | Passed |
| Bundle budget | Passed: 465.2 KiB largest JS, 1971.4 KiB total JS, 384.9 KiB CSS |
| Website source smoke | Passed 45/45 |
| Server tests | Passed 25/25 |
| Realtime Database emulator rules | Passed 7/7 |
| Playwright role/accessibility journeys | Passed 5/5 |
| Functions compatibility import | Passed |
| Git whitespace check | Passed |

Production dependency audits report zero vulnerabilities for the root runtime, client, server,
and Functions packages. The full development-tool audits retain five moderate Firebase CLI
transitive findings and one low Vite/esbuild finding; these do not ship in the website runtime.
Firebase CLI was upgraded to 15.23.0 and its emulator suite passes.

### Free-Service Impact

Local development and demonstrations continue to use Vite, local Express, COD/manual payment,
Firebase Authentication/Realtime Database within available quotas, and the free Emulator Suite.
Storage, Functions, Cloud Run, and paid provider calls remain disabled or undeployed. Public
production operation is not guaranteed to remain free because hosting, backend availability,
traffic, and Firebase quotas depend on deployment choices and usage.

### Remaining Risks

- `client/src/services/firebase.js` and `server/src/business.js` remain compatibility cores; move
  one tested domain at a time rather than rewriting them.
- The Functions adapter imports canonical modules outside its package and must not be deployed
  until shared packaging is designed and retested.
- Real Firebase Authentication, email delivery, camera, GPS, and passkeys still require separate
  credentialed/manual testing on a stable HTTPS environment.
- Existing approved private reviews need an explicit backfill or re-moderation before they appear
  in the new sanitized `public/reviews` projection.

The repository is safe to continue developing locally. A push still requires explicit approval.
