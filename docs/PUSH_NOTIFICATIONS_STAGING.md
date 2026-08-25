# Staging Browser Push Validation

Firebase Cloud Messaging is optional and must be validated with staging data before production use.
The website must remain usable when permission is denied, messaging is unsupported, or Firebase is
temporarily unavailable.

## Configuration

1. Open the staging Firebase project.
2. In **Project settings > Cloud Messaging > Web configuration**, create or reuse a Web Push
   certificate.
3. Put only its public key in the staging client environment:

   ```env
   VITE_FIREBASE_VAPID_KEY=replace-with-staging-web-push-public-key
   ```

4. Keep Firebase Admin credentials on the server and out of client files.
5. Build and deploy the staging website over HTTPS.
6. Confirm that the staging API uses the same Firebase project as the staging website.

Do not commit the environment-specific key even though VAPID client keys are public. Keeping staging
configuration outside source control prevents accidental production/staging mixing.

## Required Test Matrix

| Scenario | Expected result |
| --- | --- |
| First visit | No permission prompt appears automatically |
| User enables alerts | One permission prompt appears after the explicit button action |
| Permission denied | Website continues normally and explains browser settings |
| Unsupported browser | Push action is unavailable without affecting website notifications |
| Return to tab or reconnect | Existing granted token is synchronized without prompting |
| Sign out | Only the current browser token is detached before the session closes |
| Two devices | Both devices remain registered and receive an eligible update |
| Token rotation | New token is registered; rejected stale tokens are removed after delivery |
| Foreground message | A privacy-safe in-website status message appears |
| Background message | The browser shows one tagged notification |
| Notification click | The authenticated customer opens the matching Orders view |
| Duplicate event | The same order event is not delivered twice |

## Eligible Staging Events

- Order confirmed
- Ready for pickup
- Out for delivery
- Rider arrived
- Cancelled
- Customer action required

Payloads must contain only a display order reference, approved status text, an allowlisted destination,
and the order ID needed for authorized navigation. Never include customer names, phone numbers,
addresses, delivery pins, notes, payment details, or full order contents.

## Evidence to Record

- Staging URL and build commit
- Browser and operating-system versions
- Desktop and Android device or browser profile used
- Permission result
- Token count shown by the authenticated status endpoint
- Order event tested
- Foreground/background result
- Notification-click destination
- Any Firebase Messaging error code, without copying the token

Automated tests validate policy and server behavior, but they do not prove delivery through Firebase.
Mark real delivery as blocked until a staging VAPID key, HTTPS deployment, authenticated test customer,
and at least one real browser device are available.
