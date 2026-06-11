# Taptap Foodtrip Integrated Edition

This is the full-stack edition of the capstone system. The original static
prototype remains in the separate `taptap-foodtrip` folder.

## Technology coverage

| Technology | Implementation |
| --- | --- |
| ReactJS | Role-based customer, owner, staff and rider application |
| Bootstrap | Responsive layout, forms, tables, modals and controls |
| Chart.js | Owner sales-performance dashboard |
| Node.js and Express | Backend routing, validation, authentication and API requests |
| Leaflet | Interactive delivery tracking map |
| OpenStreetMap | Leaflet map tiles and attribution |
| jsPDF | Downloadable sales reports |
| Firebase Authentication | Email/password accounts and verified sessions |
| Firebase Realtime Database | Menu, users, orders, inventory, chat and rider GPS |
| Firebase Storage | Proof-of-delivery camera photos |
| Firebase Analytics | Purchase event tracking |
| Firebase Hosting | React production deployment |
| Firebase Cloud Functions | Secure server-side API endpoints |
| Socket.IO | Low-latency rider location and order broadcasts |
| Dialogflow ES | FAQ and known-intent chatbot responses |
| OpenAI API | Assistant fallback plus sales and inventory insights |
| PayMongo | Hosted GCash checkout sessions |
| Twilio | SMS order-status notifications |
| HTML5 Geolocation API | Rider `watchPosition` tracking |
| MediaDevices API | Rear-camera proof of delivery |
| Vibration API | Rider assignment and milestone alerts |
| Google Maps URL Scheme | Native turn-by-turn navigation handoff |

Credential-dependent services use safe demo behavior until configured.
Secret keys never belong in `client/.env`.

The paper also names Visual Studio Code, Figma, Microsoft Word and Canva.
Those are development, design and documentation tools rather than website
runtime dependencies. The source is ready for VS Code; the React screens can
be used as the reference for Figma/Canva materials, and this README provides
the implementation documentation for export to Word.

## Demo role accounts

The login screen fills these automatically when a role is selected:

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@demo.ph` | `Customer123!` |
| Owner | `owner@taptap.ph` | `Owner123!` |
| Staff | `staff@taptap.ph` | `Staff123!` |
| Rider | `rider@taptap.ph` | `Rider123!` |

Without Firebase configuration these use the built-in local demo mode. After
running the seed command, the same accounts use Firebase Authentication and
role claims.

## Role workspaces

- Customer: storefront, cart, checkout, personal information with a saved
  delivery address, order history, downloadable digital receipts, previous
  reviews, recent-order ratings, delivery tracking and AI menu assistance.
- Owner / Super Admin: dashboard, sales and orders, inventory, reports and
  reconciliation, users and roles, audit logs, and system settings.
- Staff / Admin: shift dashboard, walk-in POS, order queue, inventory
  receiving and wastage, shift logs, chat support, and workstation settings.
- Rider: assigned orders, duty/GPS status, delivery milestones, navigation,
  camera proof of delivery, and COD ledger.

Only customers can access the storefront after login. Employee roles are
redirected directly to their authorized operational workspace.

Customer chatbot messages are also saved to the Staff Chat Support inbox.
Staff can select the customer's conversation and reply; the reply appears
inside that customer's chatbot. The walk-in POS supports increasing,
decreasing, removing, and clearing line items before payment, with totals
recalculated immediately.

Every role has a realtime notification center. Customers receive order and
staff-reply updates, staff receive new order/chat/review alerts, riders receive
delivery assignments, and owners receive live sale notifications.

The delivery map defaults to the exact shop pin at **#17 Gemini Street,
Pamplona Park, Pamplona Dos, Las Pinas City 1740**
(`14.4509229, 120.9764514`). Use `VITE_STORE_LATITUDE` and
`VITE_STORE_LONGITUDE` in `client/.env` if the storefront entrance pin needs
fine adjustment. The `Focus Taptap shop` button restores the shop-centered
map at any time.

## Local setup

1. Install Node.js 22 or newer.
2. Run `npm run install:all` in this folder.
3. Copy `client/.env.example` to `client/.env`.
4. Copy `server/.env.example` to `server/.env`.
5. Add your Firebase web configuration to `client/.env`.
6. Add server credentials only to `server/.env`.
7. Run `npm run dev`.
8. Open `http://localhost:5173`.

You can also double-click `OPEN-DEVELOPMENT.bat` after dependencies are
installed.

## Firebase configuration

This repository is linked to Firebase project
`taptapftprj-leadell-2026`. Its Web app and Realtime Database in
`asia-southeast1` are created, and the role-based database rules are deployed.

1. In Firebase Console, open Authentication and click **Get started**.
2. Enable the **Email/Password** provider.
3. Install the Firebase CLI and sign in with `firebase login`.
4. Use Application Default Credentials or an ignored local service-account
   file when running Admin SDK commands.
5. Run `npm run seed --prefix server` to create the four demo accounts,
   custom role claims, menu, store details and inventory.
6. Enable Storage only when proof-of-delivery uploads are required.
7. Cloud Functions deployment requires the Blaze plan. Do not enable billing
   unless serverless deployment is needed.
8. Set Cloud Function secrets when deploying Functions:

```powershell
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set PAYMONGO_SECRET_KEY
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
```

9. Add `DIALOGFLOW_PROJECT_ID`, `DIALOGFLOW_LANGUAGE_CODE`,
   `OPENAI_MODEL`, and `TWILIO_FROM_NUMBER` to `functions/.env`.
10. Give the Firebase Functions service account Dialogflow API Client access.
11. Run `npm run build`, then deploy the Firebase services available on the
    selected plan.

## Socket.IO deployment

Firebase Functions handles request/response APIs but is not the right place
for a persistent Socket.IO connection. Deploy `server/` to Cloud Run:

```powershell
gcloud run deploy taptap-realtime --source server --region asia-southeast1
```

Set its environment variables and update `VITE_SOCKET_URL` to the Cloud Run
URL before building the client. Every rider GPS update is broadcast by
Socket.IO and mirrored into Firebase Realtime Database.

## Required third-party setup

- Create a Dialogflow ES agent with menu, store-hours, allergen and
  order-status intents.
- Create OpenAI and PayMongo API keys.
- Create a Twilio Messaging sender and verify test recipient numbers if the
  account is still in trial mode.
- Add PayMongo webhook handling before accepting production payments.
- Use HTTPS for camera and geolocation outside localhost.

## Important production notes

- Demo passwords are suitable only for development.
- Firebase Security Rules enforce data access; hiding UI controls is not
  security.
- PayMongo and Twilio webhooks should validate provider signatures.
- Never commit `.env`, Firebase service-account JSON or API keys.
- Test Auth, Database, Storage and Functions with the Firebase Emulator Suite.
