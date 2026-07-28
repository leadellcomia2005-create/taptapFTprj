# PayMongo Test Setup

TapTap Foodtrip uses PayMongo's hosted Checkout Session for GCash. The browser never receives the secret API key, and a signed webhook is the only path that changes an order from pending to paid.

## 1. Get Test Credentials

1. Sign in to the PayMongo Dashboard.
2. Switch the dashboard to **Test Mode**.
3. Open **Settings > Developers**.
4. Copy the `sk_test_` secret key into your server's secret storage. Do not put it in client code, screenshots, chat, or Git.

The hosted Checkout integration does not require a PayMongo public key in the React website.

## 2. Create One Test Webhook

Create one webhook in the PayMongo Dashboard while it is in **Test Mode**.

- Event: `checkout_session.payment.paid`
- Firebase Hosting URL: `https://YOUR_SITE.web.app/api/payments/paymongo/webhook`
- Express API URL: `https://YOUR_API_DOMAIN/api/payments/paymongo/webhook`

PayMongo requires a publicly reachable HTTPS URL. For local testing, expose port `8080` through a trusted HTTPS tunnel and use its `/api/payments/paymongo/webhook` URL. Never register `localhost` as the dashboard webhook.

Store the webhook's `whsk_` secret separately from the API key. Register the webhook once, not once per order.

## 3. Configure the Local Express Server

Set these values in the ignored `server/.env` file:

```dotenv
ENABLE_PAYMONGO=true
PAYMONGO_MODE=test
PAYMONGO_SECRET_KEY=sk_test_REPLACE_IN_LOCAL_ENV_ONLY
PAYMONGO_WEBHOOK_SECRET=whsk_REPLACE_IN_LOCAL_ENV_ONLY
CLIENT_ORIGIN=http://localhost:5173
```

Restart both the server and website after changing environment values, then run:

```powershell
npm run paymongo:check
```

The command reports only readiness checks. It never prints credential values.

## 4. Configure Firebase Functions

Store both secret values with Firebase Secret Manager:

```powershell
firebase functions:secrets:set PAYMONGO_SECRET_KEY
firebase functions:secrets:set PAYMONGO_WEBHOOK_SECRET
```

Set the non-secret values in the ignored `functions/.env` or project-specific Firebase Functions environment file:

```dotenv
ENABLE_PAYMONGO=true
PAYMONGO_MODE=test
CLIENT_ORIGIN=https://YOUR_SITE.web.app
```

Deploy Functions and Hosting only after the normal release validation passes.

## 5. Test the Full Flow

1. Confirm `/api/status` reports `services.paymongo: true`.
2. Sign in as a customer and place a small GCash order.
3. Confirm the website redirects to `checkout.paymongo.com`.
4. Complete the transaction using PayMongo's test-mode checkout controls. No real money should move in test mode.
5. Confirm the signed webhook changes the order from `pending-payment` / `pending` to `received` / `paid`.
6. Confirm the customer, staff, and owner receive the expected payment/order notifications.
7. Replay the same webhook from the PayMongo Dashboard and confirm it does not create another sale or payment movement.
8. Test cancellation or failed/abandoned checkout separately; a return URL alone must never mark an order paid.

## 6. Replace the Test Account Later

No checkout code change is required when the client's PayMongo account is ready.

1. Set `ENABLE_PAYMONGO=false` during credential rotation.
2. Disable the old account's webhook.
3. Replace `PAYMONGO_SECRET_KEY` with the client's key.
4. Create one webhook in the client's account and replace `PAYMONGO_WEBHOOK_SECRET`.
5. Keep `PAYMONGO_MODE=test` while validating the client's test account.
6. For launch, use `PAYMONGO_MODE=live`, an `sk_live_` key, the live webhook secret, and a production HTTPS website origin.
7. Run the readiness check and full checkout smoke test before re-enabling payments.

Test and live keys are deliberately rejected when they do not match `PAYMONGO_MODE`.
