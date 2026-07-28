# TapTap Foodtrip Operations Runbook

This runbook prepares the website for controlled staging and recovery work. It does not
authorize a production deployment. OpenAI, Twilio, PayMongo, Storage, Functions, Cloud Run,
and App Hosting remain disabled or undeployed unless a separate approved change enables them.

## Environment Isolation

Use three separate environments. Never point a local or staging server at the production
Realtime Database.

| Environment | Firebase project | Client configuration | Server credentials | Data |
| --- | --- | --- | --- | --- |
| Local test | Demo project and emulators | `client/.env.e2e` | No cloud credentials | Disposable fixtures |
| Staging | Dedicated staging project | Copy `docs/config/client.staging.env.example` to an ignored file | Dedicated least-privilege staging service account | Synthetic, non-customer data |
| Production | Dedicated production project | Host-managed production variables | Host secret manager or application-default credentials | Live business data |

Required staging controls:

- Use a different Firebase project ID, database URL, Authentication tenant, and web app.
- Use staging-only owner, staff, rider, and customer accounts. Do not copy live passwords,
  phone numbers, addresses, delivery proofs, reviews, or messages.
- Keep `VITE_ENABLE_DEMO_MODE=false` outside automated browser tests.
- Keep `VITE_ENABLE_FIREBASE_STORAGE=false`, `ENABLE_OPENAI=false`, `ENABLE_TWILIO=false`,
  and `ENABLE_PAYMONGO=false`.
- Restrict the staging website and API to the intended reviewers where the host supports it.
- Set `TRUST_PROXY` only to the verified proxy hop count used by the selected host.
- Store `TWO_FACTOR_ENCRYPTION_KEY`, service-account material, email credentials, and
  Turnstile secrets in the host secret manager. Never place them in a client variable.

Before any staging deployment, compare the populated variables against the two templates and
confirm that no value contains the production project ID or production database hostname.

## Release Evidence

Record the following for every staging or production candidate:

- Git commit SHA and branch
- operator and reviewer
- target Firebase project and hosting/server target
- UTC and Asia/Manila timestamps
- `npm run validate:release` result
- production dependency-audit result
- backup filename and SHA-256 hash
- deployed website/server version identifiers
- post-deployment health and role smoke-test results

The baseline measured on 2026-07-21 was 52 passing server tests, 9 passing Realtime Database
Rules tests, 67 preview smoke checks, 11 passing Playwright tests, no circular dependencies,
and no production dependency advisories. The client bundle baseline was 1,877.1 KiB total
JavaScript, 377.0 KiB for the largest JavaScript chunk, and 411.4 KiB for the largest stylesheet.
A low-severity advisory remains in Vite's local Windows development server dependency; it is not
in the production dependency tree and should be removed during a separately tested Vite 8 upgrade.

## Backup Procedure

Backups can contain customer and operational data. Store them outside the repository in an
encrypted, access-controlled location. Never attach a live backup to an issue or chat.

1. Announce a maintenance window if a consistent operational snapshot is required.
2. Confirm the Firebase CLI target with `firebase use` and the explicit `--project` value.
3. Export the root of the intended Realtime Database to a timestamped JSON file:

   ```powershell
   firebase database:get / --project <production-project-id> --output <encrypted-backup-path>
   Get-FileHash -Algorithm SHA256 <encrypted-backup-path>
   ```

4. Confirm the command succeeded, the file is non-empty, and PowerShell can parse it with
   `Get-Content -Raw <backup-path> | ConvertFrom-Json`.
5. Record the byte size, SHA-256 hash, operator, timestamp, Firebase project ID, and source
   Git commit in the release evidence.
6. Retain the latest 10 verified backups and at least one monthly backup for 90 days, subject
   to the project's approved privacy and retention policy. Delete expired copies securely.

Do not run a root `database:set` against staging or production as a verification step.

## Restore Rehearsal

Restore verification must use a disposable recovery Firebase project with no live users or data.

1. Create or select the isolated recovery project and confirm its project ID aloud with the reviewer.
2. Deploy the exact Rules from the release commit to the recovery project.
3. Restore the verified backup to the recovery database only:

   ```powershell
   firebase database:set / <encrypted-backup-path> --project <recovery-project-id> --confirm
   ```

4. Export the restored database, calculate its SHA-256 hash, and compare record counts for users,
   menu items, orders, inventory, reviews, complaints, audit logs, shifts, notifications, and
   idempotency records. A raw JSON hash may differ because of ordering; compare normalized content.
5. Run read-only reconciliation checks, Rules tests, and role smoke tests against recovery.
6. Record differences. A missing collection, authorization regression, or unexplained count mismatch
   fails the rehearsal and blocks deployment.
7. Destroy the disposable recovery data according to the approved retention policy.

No production restore should start until a recent rehearsal has passed and two authorized people
have approved the exact backup, target project, maintenance window, and rollback plan.

## Deployment Checklist

1. Confirm the worktree is clean and the release commit is reviewed.
2. Confirm all provider opt-in flags remain `false`.
3. Confirm staging and production variables are not mixed.
4. Run `npm ci`, `npm ci --prefix client`, and `npm ci --prefix server` from lockfiles.
5. Run production audits for the root, client, and server packages.
6. Run `npm run validate:release` with Node.js 22, Java 21, and Chromium installed.
7. Create and verify a fresh database backup.
8. Deploy to staging first; verify `/health/live`, `/health/ready`, request IDs, and structured logs.
9. Smoke-test customer checkout, owner reporting/account administration, staff POS, rider delivery,
   notifications, reviews, complaints, audit logs, shifts, receipts, delivery pin, and proof fallback.
10. Review error rate, readiness, response time, and Firebase usage before production approval.

The repository's default `npm run deploy` validates and deploys Realtime Database Rules only.
It does not publish the website or Express server. Never use `deploy:paid-services` as a shortcut.

## Rollback

### Website

1. Stop further releases and record the incident start time and affected release.
2. Use the hosting provider's immutable release history to reactivate the last known-good website
   artifact built from a recorded Git commit. Do not rebuild old source with new dependencies.
3. Verify the landing page, customer sign-in, menu, cart, and checkout entry point.

### Express Server

1. Remove the affected server revision from traffic.
2. Route traffic to the last known-good immutable image or artifact and its matching environment.
3. Verify `/health/live`, `/health/ready`, authentication, one read-only request per role, and logs.
4. Do not roll back data contracts until compatibility with records written by the newer server is proven.

### Realtime Database Rules

1. Use a separate clean worktree at the last known-good release commit.
2. Run `npm run test:rules` against that exact `database.rules.json`.
3. Compare the rule diff and obtain a second reviewer approval.
4. Deploy only Rules to the explicit project: `firebase deploy --only database --project <project-id>`.
5. Run the Rules suite and role access smoke tests again. Never weaken Rules temporarily to restore access.

### Data

Application rollback and data restore are separate decisions. Prefer an idempotent, audited repair for
specific records. A full database restore is a last resort because it can discard valid orders created
after the backup. Follow the restore rehearsal and two-person approval requirements above.

### Owner Recovery API

The owner-only recovery boundary is intentionally narrower than a database editor:

- `GET /api/admin/recovery/scan?limit=200` performs a bounded, read-only scan.
- `POST /api/admin/recovery/preview` returns the exact proposed change and a state-bound preview hash.
- `POST /api/admin/recovery/apply` requires that hash, `APPLY_RECOVERY`, a reason, and a unique request ID.

Only incomplete cancellation finalization, public stock projection synchronization, and expired
processing-claim release are executable. Repeating the same request ID replays its stored result.
Missing proof, unresolved COD, failed notifications, malformed order quantities, and aggregate gaps
remain review-only. Resolve those findings through verified source records and existing business actions;
never change a status or total merely to make a warning disappear.

## Emergency Owner Access

Maintain two independently controlled, MFA-protected production owner accounts before launch. The API
prevents removing or suspending the final owner, but that safeguard cannot recover a lost password.

1. Use the second owner account to suspend a suspected account, correct its role, and review audit logs.
2. If the password is lost but the account is trusted, use Firebase Authentication's password-reset
   flow. Re-enable the account in Firebase Console only after verifying the owner identity out of band.
3. Revoke the affected user's refresh tokens after a role, password, device, or compromise event.
4. Rotate the owner password, TOTP enrollment or backup codes, server credentials, and any exposed
   email/Turnstile secrets. Never rotate Firebase web configuration as if it were a server secret.
5. Confirm the restored session has the expected custom claim and that another owner still exists.
6. Record the incident, actions, request IDs, operator, reviewer, and follow-up work in an external
   incident record; do not put passwords, OTPs, backup codes, tokens, or customer data in audit notes.

If every owner account is inaccessible, stop. Do not run `seed`, weaken Rules, edit database roles from
the browser, or improvise a production Admin SDK command. Recovery requires a separately reviewed,
single-purpose credential-recovery procedure using an authorized Admin credential and a second reviewer.

## Credential Rotation

- Rotate service-account keys by creating a replacement, deploying and verifying it, then revoking the
  old key. Prefer application-default credentials without downloadable keys where supported.
- Rotate `TWO_FACTOR_ENCRYPTION_KEY` only with a tested migration plan; changing it invalidates stored
  encrypted TOTP secrets.
- Rotate Gmail and Turnstile secrets independently and test their disabled/failure fallback paths.
- Revoke Firebase user refresh tokens after account compromise or privilege reduction.
- Keep OpenAI, Twilio, and PayMongo credentials absent while their flags remain disabled.
