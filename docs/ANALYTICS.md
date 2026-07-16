# TapTap Foodtrip Analytics

## Purpose

Firebase Analytics measures anonymous website conversion steps. It is optional, loads during browser
idle time or on the first event, and must never block authentication, ordering, or dashboard work.
Demo mode and browsers unsupported by Firebase Analytics continue without measurement.

## Event Dictionary

| Event | Trigger | Allowed parameters |
| --- | --- | --- |
| `select_content` | A landing-page order or sign-in entry is selected | `content_type`, coded `item_id`, `role` |
| `view_item_list` | A visitor opens a landing menu section | menu ID, menu name, coded `source` |
| `sign_up_start` | Customer registration is opened | `method`, coded `source` |
| `sign_up` | Customer account creation succeeds | `method` |
| `login` | Authentication succeeds | `method`, `role` |
| `begin_checkout` | A customer opens checkout | currency, value, product IDs/names, prices, quantities |
| `checkout_abandoned` | A customer closes checkout before ordering | checkout fields above, coded `reason` |
| `purchase` | The canonical API creates an order | transaction ID, server-recalculated value, currency |

`select_content`, `view_item_list`, `sign_up`, `login`, `begin_checkout`, and `purchase` use Firebase
recommended event names where applicable. The two remaining events are project-specific diagnostics.

## Privacy Contract

Allowed data is limited to product identifiers and names, item quantity and price, order value,
currency, user role, authentication method, generic UI source, coded reason, and transaction ID.

Never send any of the following to Analytics:

- user/customer ID, name, email address, or phone number
- delivery address, landmark, latitude, longitude, or GPS accuracy
- order notes, support messages, reviews, or complaint text
- passwords, passkeys, TOTP secrets, email/SMS codes, or delivery OTPs
- proof photos, signatures, receipt contents, or payment credentials

The typed boundary in `client/src/services/analytics.ts` is the only UI entry point for funnel events.
Raw `trackEvent` calls remain inside the Firebase compatibility layer for the server-confirmed purchase
event. Review this contract before adding any new event or parameter.

## Firebase Console Funnel

Create a funnel in Firebase Analytics using these ordered steps:

1. `select_content` where `content_type` is `landing_order_entry`
2. `login` or `sign_up`
3. `begin_checkout`
4. `purchase`

Use `view_item_list` as a menu-engagement segment and `checkout_abandoned` as a diagnostic segment.
Compare source and role only at aggregate level. Do not attempt to identify individual customers.

## Reporting Boundary

The owner dashboard intentionally does not show Firebase Analytics totals. Analytics events do not
exist in Realtime Database, and the website has no trusted aggregate API for them. Displaying local
or fabricated funnel numbers would be misleading. Add owner-visible analytics only after a trusted,
privacy-reviewed reporting source and retention policy are implemented.

Before production launch, configure the Firebase Analytics data-retention and deletion settings and
confirm whether a consent banner is required for the deployment's audience and privacy policy.
