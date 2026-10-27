# TextBee SMS Setup

TextBee is integrated but disabled by default. The website must continue using email, push, and in-app notifications until a real Android gateway is healthy.

## Scope

- Customer phone verification and customer login OTP only
- Out-for-delivery SMS for verified customers who opted in
- Cancellation email and SMS for verified customers who opted in
- No owner, staff, or rider SMS OTP
- No marketing SMS
- No delivery handoff OTP
- No SMS for order confirmation, preparing, or delivered status

## Required equipment

1. One Android phone that can remain powered, online, and running the TextBee gateway app.
2. One active Philippine SIM with SMS service and sufficient load or plan allowance.
3. Battery optimization disabled for the TextBee app so heartbeat and sending continue in the background.

## Render secrets

Set these only in the `taptap-foodtrip-api` Render service. Do not add them to Firebase Hosting, the client `.env`, Git, or browser storage.

```text
TEXTBEE_API_KEY=<TextBee API key>
TEXTBEE_DEVICE_ID=<optional explicit Android device ID>
TEXTBEE_WEBHOOK_SECRET=<long random webhook secret>
ENABLE_TEXTBEE=false
```

Keep `ENABLE_TEXTBEE=false` until the device health check and signed webhook test both pass.

## Webhook

Register this HTTPS endpoint in TextBee:

```text
https://taptap-foodtrip-api.onrender.com/api/integrations/textbee/webhook
```

Configure TextBee to sign webhook requests with the same value stored in `TEXTBEE_WEBHOOK_SECRET`. The API validates `X-Signature` against the exact raw request body and deduplicates retries by TextBee idempotency key.

Subscribe to outgoing message events:

- `MESSAGE_SENT`
- `MESSAGE_DELIVERED`
- `MESSAGE_FAILED`
- `UNKNOWN_STATE`

Queued messages remain `pending`; they are never shown as delivered until a valid delivery webhook arrives.

## Activation checklist

1. Confirm the Android device heartbeat is recent in TextBee.
2. Deploy the API with the three secrets while `ENABLE_TEXTBEE=false`.
3. Register and test the signed webhook.
4. Set `ENABLE_TEXTBEE=true` and redeploy the API.
5. Confirm `/api/status` reports both `sms` and `textbee` as `true` without returning any secret.
6. Verify a test customer phone from Profile > Updates.
7. Test customer SMS login, email fallback, out-for-delivery, and cancellation.
8. Replay a status update and webhook; confirm no duplicate SMS or delivery update is created.
9. Turn `ENABLE_TEXTBEE=false` immediately if the Android phone is lost, the SIM is replaced, or the API key may be exposed.

## Failure behavior

- OTP sends check the Android gateway heartbeat and time out after eight seconds.
- A failed OTP directs the customer to email OTP.
- Order-status changes complete without waiting for TextBee.
- SMS failures are recorded for owner operational review.
- OTP values, API keys, webhook secrets, and full phone numbers are not logged.
